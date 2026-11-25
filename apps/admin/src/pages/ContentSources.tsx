import { useEffect, useState } from "react";
import type { Campaign, ContentItem, ContentPage, ContentSource, Placement } from "@hcg-ads/contracts";
import { api, ApiError, fmt, localToIso } from "../api";
import { useCan } from "../App";
import { Icon } from "../components/Icon";
import { Button, Chip, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Panel, navigate, useAction, useLoad } from "../components/ui";

type Source = ContentSource & { configured: boolean; configurationProblems: string[] };
interface SyncReport { checked: number; refreshed: number; unavailable: string[]; errors: number; suspendedCampaigns: string[] }

export function ContentSources() {
  const can = useCan();
  const { data, error, loading } = useLoad<{ sources: Source[] }>("/content-sources");
  const connect = useAction();
  const sync = useAction();
  const [report, setReport] = useState<SyncReport | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const sources = data?.sources ?? [];
  const news = sources.find((s) => s.kind === "hcg-news");
  const newsReady = news && (news.status === "connected" || news.status === "degraded");

  return (
    <div className="page">
      <PageHeader title="Content Sources" kicker="Internal advertising · promote HCG content directly" />
      <div className="source-grid">
        {sources.map((s) => (
          <Panel key={s.id} className={`source-card source-${s.kind}`} title={<>{s.name} <Chip value={s.status} /></>} subtitle={s.description}>
            <div className="source-meta">
              <span><b>{s.itemCount}</b> cached items</span>
              <span>Last sync: {s.lastSyncAt ? fmt.dateTime(s.lastSyncAt) : "never"}</span>
            </div>
            {s.lastSyncResult && <p className="muted small">{s.lastSyncResult}</p>}
            {!s.configured && <Notice tone="info">{s.configurationProblems.join(" ") || "Not configured."}</Notice>}
            {s.kind === "hcg-news" && s.configured && (
              <div className="row">
                {!newsReady ? (
                  <Button variant="primary" busy={connect.busy} disabled={!can("content_sources.write")}
                    onClick={() => connect.run(() => api.post("/integrations/hcg-news/connect"))}>
                    <Icon name="sources" /> Connect HCG News
                  </Button>
                ) : (
                  <>
                    <Button busy={sync.busy} disabled={!can("content_sources.write")} onClick={async () => {
                      const r = await sync.run(() => api.post<SyncReport>(`/content-sources/${s.id}/sync`));
                      if (r) setReport(r);
                    }}><Icon name="refresh" /> Synchronise</Button>
                    <Button variant="subtle" onClick={() => api.post(`/content-sources/${s.id}/disconnect`)} disabled={!can("content_sources.write")}>Disconnect</Button>
                  </>
                )}
              </div>
            )}
            {s.kind === "hcg-news" && <><ErrorBox error={connect.error} onClose={connect.clear} /><ErrorBox error={sync.error} onClose={sync.clear} /></>}
            {s.kind === "hcg-news" && report && (
              <Notice tone={report.unavailable.length ? "warn" : "ok"}>
                Checked {report.checked} promoted item(s): {report.refreshed} refreshed, {report.unavailable.length} no longer published, {report.errors} could not be checked.
                {report.suspendedCampaigns.length > 0 && <> {report.suspendedCampaigns.length} campaign(s) were suspended automatically.</>}
              </Notice>
            )}
          </Panel>
        ))}
      </div>
      {news && newsReady && <ArticleBrowser source={news} />}
      {news && !newsReady && news.configured && (
        <Panel title="HCG News is not connected">
          <p className="muted">Connecting reads published articles directly from the publication (read-only — articles are never modified) and registers HCG News as the first publisher with its standard placements, in test delivery mode.</p>
        </Panel>
      )}
    </div>
  );
}

function ArticleCard({ item, selected, onToggle }: { item: ContentItem; selected: boolean; onToggle: () => void }) {
  return (
    <button className={`article ${selected ? "article-on" : ""} ${item.isDemo ? "article-demo" : ""}`} onClick={onToggle} disabled={item.isDemo} aria-pressed={selected}
      title={item.isDemo ? "Demo content cannot be promoted" : undefined}>
      <div className="article-img">
        {item.imageUrl ? <img src={item.imageUrl} alt={item.imageAlt ?? ""} loading="lazy" /> : <div className="article-noimg">No cover image</div>}
        <span className="article-check" aria-hidden>{selected ? <Icon name="check" /> : null}</span>
        {item.isDemo && <span className="article-badge">Demo</span>}
        {item.promotional.isBreaking === true && <span className="article-badge article-badge-red">Breaking</span>}
      </div>
      <div className="article-body">
        <div className="article-meta">{item.category?.name ?? "News"} · {fmt.date(item.publishedAt)}{item.contentType ? ` · ${item.contentType}` : ""}</div>
        <div className="article-title">{item.headline}</div>
        {item.description && <div className="article-desc">{item.description}</div>}
      </div>
    </button>
  );
}

function ArticleBrowser({ source }: { source: Source }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<ContentItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<Map<string, ContentItem>>(new Map());
  const [creating, setCreating] = useState(false);
  const cats = useLoad<{ categories: Array<{ id: string; name: string; slug: string }> }>(`/content-sources/${source.id}/categories`);

  const load = (reset: boolean, cur: string | null) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "12" });
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    if (!reset && cur) params.set("cursor", cur);
    api.get<ContentPage>(`/content-sources/${source.id}/items?${params}`)
      .then((p) => { setItems((prev) => (reset ? p.items : [...prev, ...p.items])); setCursor(p.nextCursor); setError(null); })
      .catch((e: ApiError) => setError(e))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(true, null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [query, category, source.id]);

  const toggle = (it: ContentItem) => setSelected((prev) => {
    const m = new Map(prev);
    if (m.has(it.externalId)) m.delete(it.externalId); else m.set(it.externalId, it);
    return m;
  });

  return (
    <Panel title="Published articles" subtitle="Live from news.hakmicapitalgroup.com. Select one or more to promote." actions={
      <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <input className="input" placeholder="Search headlines" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All sections</option>
          {cats.data?.categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </select>
        <Button type="submit">Search</Button>
      </form>
    }>
      <ErrorBox error={error} />
      {items.length === 0 && !loading ? <Empty title="No published articles match">Try another search or section.</Empty> : (
        <div className="article-grid">
          {items.map((it) => <ArticleCard key={it.externalId} item={it} selected={selected.has(it.externalId)} onToggle={() => toggle(it)} />)}
        </div>
      )}
      <div className="row center">
        {loading && <Loading label="Loading articles" />}
        {!loading && cursor && <Button onClick={() => load(false, cursor)}>Load more</Button>}
      </div>
      {selected.size > 0 && (
        <div className="tray">
          <span><b>{selected.size}</b> article{selected.size > 1 ? "s" : ""} selected</span>
          <Button variant="subtle" onClick={() => setSelected(new Map())}>Clear</Button>
          <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" /> Create campaign</Button>
        </div>
      )}
      {creating && <CreateFromContent sourceId={source.id} items={[...selected.values()]} onClose={() => setCreating(false)} />}
    </Panel>
  );
}

function CreateFromContent({ sourceId, items, onClose }: { sourceId: string; items: ContentItem[]; onClose: () => void }) {
  const placements = useLoad<{ placements: Placement[] }>("/placements");
  const formats = useLoad<{ callsToAction: string[] }>("/formats");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"per-item" | "single">("per-item");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [priority, setPriority] = useState(5);
  const [overrides, setOverrides] = useState<Record<string, { headline: string; description: string; callToAction: string }>>(
    () => Object.fromEntries(items.map((i) => [i.externalId, { headline: i.headline, description: i.description ?? "", callToAction: "Read on HCG News" }])));
  const act = useAction();
  const eligible = (placements.data?.placements ?? []).filter((p) => p.internalEligible && p.status === "active");
  const byPublisher = eligible.reduce<Record<string, Placement[]>>((acc, p) => { (acc[p.publisherId] ??= []).push(p); return acc; }, {});

  const submit = async () => {
    const res = await act.run(() => api.post<{ campaigns: Campaign[] }>("/campaigns/from-content", {
      sourceId, externalIds: items.map((i) => i.externalId), mode, name: name.trim() || undefined,
      placementIds: [...chosen], startAt: localToIso(start), endAt: localToIso(end), priority,
      overrides: Object.fromEntries(items.map((i) => {
        const o = overrides[i.externalId];
        return [i.externalId, { headline: o.headline.trim() || i.headline, description: o.description.trim() || null, callToAction: o.callToAction }];
      })),
    }));
    if (res) {
      onClose();
      navigate(res.campaigns.length === 1 ? `campaigns/${res.campaigns[0].id}` : "campaigns");
    }
  };

  return (
    <Modal wide title={`Create internal campaign from ${items.length} article${items.length > 1 ? "s" : ""}`} onClose={onClose} footer={
      <>
        <span className="muted small grow">Creates a draft. Nothing is published until it is approved and activated.</span>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.busy} disabled={chosen.size === 0} onClick={submit}>Create draft</Button>
      </>
    }>
      <div className="stack">
        <ErrorBox error={act.error} onClose={act.clear} />
        <h4 className="section-title">1 · Where it appears</h4>
        {placements.loading && <Loading />}
        {Object.entries(byPublisher).map(([pub, list]) => (
          <div key={pub} className="placement-picker">
            {list.map((p) => (
              <label key={p.id} className={`pick ${chosen.has(p.id) ? "pick-on" : ""}`}>
                <input type="checkbox" checked={chosen.has(p.id)} onChange={() => setChosen((prev) => { const s = new Set(prev); if (s.has(p.id)) s.delete(p.id); else s.add(p.id); return s; })} />
                <span className="pick-shape" style={shapeStyle(p)} aria-hidden />
                <span className="grow"><b>{p.name}</b><small>{fmt.size(p.width, p.height)} · {p.platform} · {p.formats.join(", ")}</small></span>
              </label>
            ))}
          </div>
        ))}
        {items.length > 1 && (
          <>
            <h4 className="section-title">2 · Campaign structure</h4>
            <div className="row">
              <label className="radio"><input type="radio" checked={mode === "per-item"} onChange={() => setMode("per-item")} /> One campaign per article</label>
              <label className="radio"><input type="radio" checked={mode === "single"} onChange={() => setMode("single")} /> One campaign rotating all articles</label>
            </div>
          </>
        )}
        <h4 className="section-title">{items.length > 1 ? "3" : "2"} · Schedule</h4>
        <div className="form-grid">
          {(mode === "single" || items.length === 1) && <Field label="Campaign name (optional)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={items.length === 1 ? `Promote: ${items[0].headline}` : "Promotion"} /></Field>}
          <Field label="Start" hint="Empty = when activated"><input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End" hint="Empty = until paused"><input className="input" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label={`Priority: ${priority}`} hint="Higher wins when campaigns compete"><input type="range" min={1} max={10} value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></Field>
        </div>
        <h4 className="section-title">{items.length > 1 ? "4" : "3"} · Creative text</h4>
        <p className="muted small">Generated from each article's approved metadata. Changes apply to the advertisement only — the article is never modified.</p>
        {items.map((it) => {
          const o = overrides[it.externalId];
          const set = (k: keyof typeof o, v: string) => setOverrides((prev) => ({ ...prev, [it.externalId]: { ...prev[it.externalId], [k]: v } }));
          return (
            <div key={it.externalId} className="override">
              {it.imageUrl && <img src={it.imageUrl} alt="" className="override-img" />}
              <div className="form-grid grow">
                <Field label="Headline" wide><input className="input" maxLength={120} value={o.headline} onChange={(e) => set("headline", e.target.value)} /></Field>
                <Field label="Description" wide><textarea className="input" rows={2} maxLength={300} value={o.description} onChange={(e) => set("description", e.target.value)} /></Field>
                <Field label="Call to action">
                  <select className="input" value={o.callToAction} onChange={(e) => set("callToAction", e.target.value)}>
                    {(formats.data?.callsToAction ?? ["Read on HCG News"]).map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export function shapeStyle(p: Pick<Placement, "width" | "height">) {
  if (!p.width || !p.height) return { width: 26, height: 20, borderStyle: "dashed" as const };
  const r = p.width / p.height;
  const w = r >= 1 ? 34 : Math.max(8, 34 * r);
  const h = r >= 1 ? Math.max(5, 34 / r) : 34;
  return { width: w, height: Math.min(h, 34) };
}
