import { useState } from "react";
import type { Advertiser, Campaign, CampaignKind, Placement, Publisher } from "@hcg-ads/contracts";
import { api, fmt, isoToLocal, localToIso } from "../api";
import { Button, Chip, ErrorBox, Field, Notice, PageHeader, Panel, Tabs, navigate, useAction, useLoad } from "../components/ui";
import { shapeStyle } from "./ContentSources";

const FALLBACK_LABELS = ["Sponsored", "Promoted", "Advertisement", "Promoted by HCG", "Paid partnership"];

export function CampaignForm({ initial, onSaved }: { initial?: Campaign; onSaved?: (c: Campaign) => void }) {
  const editing = !!initial;
  const [kind, setKind] = useState<CampaignKind>(initial?.kind ?? "external");
  const advertisers = useLoad<{ advertisers: Advertiser[] }>("/advertisers");
  const placements = useLoad<{ placements: Placement[] }>("/placements");
  const publishers = useLoad<{ publishers: Publisher[] }>("/publishers");
  const settings = useLoad<{ disclosureLabels: string[] }>("/settings");
  const labels = settings.data?.disclosureLabels ?? FALLBACK_LABELS;

  const [f, setF] = useState({
    name: initial?.name ?? "",
    advertiserId: initial?.advertiserId ?? "",
    objective: initial?.objective ?? "traffic",
    startAt: isoToLocal(initial?.startAt),
    endAt: isoToLocal(initial?.endAt),
    priority: initial?.priority ?? 5,
    placementIds: new Set(initial?.placementIds ?? []),
    rotation: initial?.rotation ?? "even",
    impressionLimit: initial?.impressionLimit?.toString() ?? "",
    dailyImpressionLimit: initial?.dailyImpressionLimit?.toString() ?? "",
    freqCount: initial?.frequencyLimit?.count.toString() ?? "",
    freqHours: initial?.frequencyLimit?.windowHours.toString() ?? "24",
    categories: initial?.contextual.categories.join(", ") ?? "",
    pricingModel: initial?.pricing.model ?? "cpm",
    rate: initial?.pricing.rateMinor != null ? (initial.pricing.rateMinor / 100).toString() : "",
    budget: initial?.pricing.budgetMinor != null ? (initial.pricing.budgetMinor / 100).toString() : "",
    currency: initial?.pricing.currency ?? "NOK",
    disclosureLabel: initial?.disclosureLabel ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const act = useAction();

  const advList = (advertisers.data?.advertisers ?? []).filter((a) => a.kind === kind);
  const eligible = (placements.data?.placements ?? []).filter((p) => (kind === "internal" ? p.internalEligible : p.externalEligible) && p.status === "active");
  const pubName = (id: string) => publishers.data?.publishers.find((p) => p.id === id)?.name ?? id;
  const grouped = eligible.reduce<Record<string, Placement[]>>((a, p) => { (a[p.publisherId] ??= []).push(p); return a; }, {});
  const label = f.disclosureLabel || (kind === "internal" ? "Promoted by HCG" : "Sponsored");

  const save = async () => {
    const num = (s: string) => (s.trim() ? Number(s) : null);
    const body = {
      name: f.name.trim(), kind, advertiserId: kind === "external" ? f.advertiserId : undefined, objective: f.objective,
      startAt: localToIso(f.startAt), endAt: localToIso(f.endAt), priority: f.priority, placementIds: [...f.placementIds], publisherIds: [],
      rotation: f.rotation, impressionLimit: num(f.impressionLimit), dailyImpressionLimit: num(f.dailyImpressionLimit),
      frequencyLimit: f.freqCount ? { count: Number(f.freqCount), windowHours: Number(f.freqHours || 24) } : null,
      contextual: { categories: f.categories.split(",").map((s) => s.trim()).filter(Boolean), keywords: [] },
      pricing: kind === "internal" ? { model: "none", budgetMinor: null, rateMinor: null, currency: f.currency }
        : { model: f.pricingModel, rateMinor: f.rate ? Math.round(Number(f.rate) * 100) : null, budgetMinor: f.budget ? Math.round(Number(f.budget) * 100) : null, currency: f.currency },
      disclosureLabel: label,
    };
    const out = await act.run(() => (editing ? api.patch<Campaign>(`/campaigns/${initial!.id}`, body) : api.post<Campaign>("/campaigns", body)));
    if (out) {
      if (onSaved) onSaved(out);
      else navigate(`creative-studio/${out.id}`);
    }
  };

  return (
    <div className="stack">
      {!editing && (
        <Tabs value={kind} onChange={(k) => { setKind(k); set("placementIds", new Set()); }} options={[
          { value: "external", label: "External advertiser" }, { value: "internal", label: "Internal HCG promotion" },
        ]} />
      )}
      {kind === "internal" && !editing && <Notice tone="info">Promoting an HCG article? Content Sources builds the creative from the article automatically. Internal campaigns are not priced.</Notice>}
      <h4 className="section-title">Basics</h4>
      <div className="form-grid">
        <Field label="Campaign name"><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        {kind === "external" && !editing && (
          <Field label="Advertiser" hint={advList.length === 0 ? <a href="#/advertisers">Register an advertiser first →</a> : "Only approved advertisers can run."}>
            <select className="input" value={f.advertiserId} onChange={(e) => set("advertiserId", e.target.value)}>
              <option value="">Choose…</option>
              {advList.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.status})</option>)}
            </select>
          </Field>
        )}
        <Field label="Objective">
          <select className="input" value={f.objective} onChange={(e) => set("objective", e.target.value as typeof f.objective)}>
            <option value="awareness">Awareness</option><option value="traffic">Traffic</option><option value="engagement">Engagement</option><option value="announcement">Announcement</option>
          </select>
        </Field>
        <Field label="Disclosure label" hint="Always shown on the advertisement">
          <select className="input" value={label} onChange={(e) => set("disclosureLabel", e.target.value)}>
            {labels.map((l) => <option key={l}>{l}</option>)}
          </select>
        </Field>
      </div>

      <h4 className="section-title">Placements</h4>
      {eligible.length === 0 && <Notice tone="info">No active placements accept {kind} campaigns yet.</Notice>}
      {Object.entries(grouped).map(([pub, list]) => (
        <div key={pub}>
          <div className="muted small">{pubName(pub)}</div>
          <div className="placement-picker">
            {list.map((p) => (
              <label key={p.id} className={`pick ${f.placementIds.has(p.id) ? "pick-on" : ""}`}>
                <input type="checkbox" checked={f.placementIds.has(p.id)} onChange={() => { const s = new Set(f.placementIds); if (s.has(p.id)) s.delete(p.id); else s.add(p.id); set("placementIds", s); }} />
                <span className="pick-shape" style={shapeStyle(p)} aria-hidden />
                <span className="grow"><b>{p.name}</b><small>{fmt.size(p.width, p.height)} · {p.formats.join(", ")} · max {fmt.bytes(p.maxFileBytes)}</small></span>
              </label>
            ))}
          </div>
        </div>
      ))}

      <h4 className="section-title">Schedule & delivery</h4>
      <div className="form-grid">
        <Field label="Start" hint="Empty = when activated"><input className="input" type="datetime-local" value={f.startAt} onChange={(e) => set("startAt", e.target.value)} /></Field>
        <Field label="End" hint="Empty = until paused"><input className="input" type="datetime-local" value={f.endAt} onChange={(e) => set("endAt", e.target.value)} /></Field>
        <Field label={`Priority: ${f.priority}`}><input type="range" min={1} max={10} value={f.priority} onChange={(e) => set("priority", Number(e.target.value))} /></Field>
        <Field label="Creative rotation">
          <select className="input" value={f.rotation} onChange={(e) => set("rotation", e.target.value as typeof f.rotation)}>
            <option value="even">Even</option><option value="weighted">Weighted</option><option value="sequential">Sequential</option>
          </select>
        </Field>
        <Field label="Total impression limit"><input className="input" inputMode="numeric" value={f.impressionLimit} onChange={(e) => set("impressionLimit", e.target.value.replace(/\D/g, ""))} placeholder="None" /></Field>
        <Field label="Daily impression limit"><input className="input" inputMode="numeric" value={f.dailyImpressionLimit} onChange={(e) => set("dailyImpressionLimit", e.target.value.replace(/\D/g, ""))} placeholder="None" /></Field>
        <Field label="Frequency limit" hint="Counted on the reader's device only, with consent">
          <div className="row">
            <input className="input" style={{ width: 70 }} inputMode="numeric" value={f.freqCount} onChange={(e) => set("freqCount", e.target.value.replace(/\D/g, ""))} placeholder="—" />
            <span className="muted">per</span>
            <input className="input" style={{ width: 70 }} inputMode="numeric" value={f.freqHours} onChange={(e) => set("freqHours", e.target.value.replace(/\D/g, ""))} />
            <span className="muted">hours</span>
          </div>
        </Field>
        <Field label="Contextual sections" hint="Comma-separated section slugs, e.g. technology, markets. Empty = all. No personal targeting."><input className="input" value={f.categories} onChange={(e) => set("categories", e.target.value)} /></Field>
      </div>

      {kind === "external" && (
        <>
          <h4 className="section-title">Budget & pricing <Chip tone="amber" label="TEST MODE" /></h4>
          <Notice tone="warn">HCG Payments is not connected. Pricing is recorded for test-mode projections only — nothing is charged.</Notice>
          <div className="form-grid">
            <Field label="Pricing model">
              <select className="input" value={f.pricingModel} onChange={(e) => set("pricingModel", e.target.value as typeof f.pricingModel)}>
                <option value="cpm">CPM (per 1,000 impressions)</option><option value="cpc">CPC (per click)</option><option value="fixed">Fixed price</option>
              </select>
            </Field>
            <Field label={`Rate (${f.currency})`}><input className="input" inputMode="decimal" value={f.rate} onChange={(e) => set("rate", e.target.value)} /></Field>
            <Field label={`Budget (${f.currency})`}><input className="input" inputMode="decimal" value={f.budget} onChange={(e) => set("budget", e.target.value)} /></Field>
            <Field label="Currency"><input className="input" maxLength={3} value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
          </div>
        </>
      )}
      <ErrorBox error={act.error} onClose={act.clear} />
      <div className="row end">
        <Button variant="primary" busy={act.busy} disabled={!f.name.trim() || (kind === "external" && !editing && !f.advertiserId)} onClick={save}>
          {editing ? "Save changes" : "Create draft and add creatives →"}
        </Button>
      </div>
    </div>
  );
}

export function NewCampaign() {
  return (
    <div className="page">
      <PageHeader title="New campaign" kicker="Campaign Manager">
        <a className="btn btn-subtle" href="#/campaigns">Cancel</a>
      </PageHeader>
      <Panel><CampaignForm /></Panel>
    </div>
  );
}
