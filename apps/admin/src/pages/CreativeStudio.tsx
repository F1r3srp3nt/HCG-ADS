import { useEffect, useMemo, useState } from "react";
import type { Advertiser, Campaign, CreativeType, CreativeVariant, CropRect, DeviceClass, Placement, RenderableAd } from "@hcg-ads/contracts";
import { api, fmt } from "../api";
import { useCan } from "../App";
import { AdCreative, cropStyle } from "../components/AdPreview";
import { CropTool } from "../components/CropTool";
import { Icon } from "../components/Icon";
import { Button, Chip, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Panel, Problems, Tabs, navigate, useAction, useLoad } from "../components/ui";
import { CampaignPreview, type CampaignFull } from "./CampaignDetail";
import { MediaThumb, type MediaView } from "./MediaLibrary";

const DEVICES: DeviceClass[] = ["any", "desktop", "tablet", "mobile"];
type Draft = {
  type: CreativeType; headline: string; description: string; callToAction: string; destinationUrl: string;
  variants: Array<Omit<CreativeVariant, "id"> & { id?: string }>;
};
const blank = (kind: Campaign["kind"]): Draft => ({
  type: kind === "internal" ? "native-text" : "image", headline: "", description: "", callToAction: "Learn more", destinationUrl: "https://", variants: [],
});

function ratioOf(p: Placement | undefined) {
  return p && p.width && p.height && p.responsive !== "responsive-native" ? p.width / p.height : null;
}

function MediaPicker({ placement, media, onPick, onClose }: { placement?: Placement; media: MediaView[]; onPick: (m: MediaView) => void; onClose: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const list = media.filter((m) => m.status !== "deleted" && m.status !== "rejected");
  const fits = (m: MediaView) => !placement || m.compatiblePlacementIds.includes(placement.id);
  const shown = showAll ? list : list.filter(fits);
  return (
    <Modal wide title="Choose media" onClose={onClose}>
      <div className="stack">
        {placement && (
          <Notice tone="info">
            <b>{placement.name}</b> needs {placement.width && placement.height ? <><b>{placement.width} × {placement.height}</b> ({placement.aspectRatio})</> : "any size (responsive native)"} · {placement.formats.join(", ")} · ≤ {fmt.bytes(placement.maxFileBytes)}.
            Media with another ratio can still be used with a crop.
          </Notice>
        )}
        <label className="radio"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show media that does not fit as uploaded ({list.length - list.filter(fits).length})</label>
        {shown.length === 0 ? <Empty title="No compatible media">Upload a file of the right size in the <a href="#/media">Media Library</a>.</Empty> : (
          <div className="media-grid">
            {shown.map((m) => (
              <button key={m.id} className={`media-card ${fits(m) ? "" : "media-card-warn"}`} onClick={() => onPick(m)}>
                <div className="media-thumb"><MediaThumb m={m} /></div>
                <div className="media-info">
                  <b className="ellipsis">{m.filename}</b>
                  <small>{fmt.size(m.metadata.width, m.metadata.height)} · {m.metadata.kind}</small>
                  {fits(m) ? <Chip tone="green" label="Fits" /> : <Chip tone="amber" label="Needs crop" />}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function VariantEditor({ v, index, placements, media, onChange, onRemove }: {
  v: Draft["variants"][number]; index: number; placements: Placement[]; media: MediaView[];
  onChange: (v: Draft["variants"][number]) => void; onRemove: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [cropping, setCropping] = useState(false);
  const placement = placements.find((p) => p.id === v.placementId) ?? (placements.length === 1 ? placements[0] : undefined);
  const m = media.find((x) => x.id === v.mediaAssetId);
  const src = m?.previewUrl ?? v.imageUrl;
  const ratio = ratioOf(placement);
  return (
    <div className="variant">
      <div className="variant-thumb" style={{ aspectRatio: ratio ? String(ratio) : "16 / 9" }}>
        {src ? (
          v.crop ? <div className="crop-view"><img src={src} alt="" style={cropStyle(v.crop)} /></div> : <img src={src} alt="" className="contain" />
        ) : <span className="muted small">No media</span>}
      </div>
      <div className="grow stack-tight">
        <div className="row wrap">
          <b>Variant {index + 1}</b>
          {m && <span className="muted small">{m.filename} · {fmt.size(m.metadata.width, m.metadata.height)}</span>}
          {v.crop && <Chip tone="violet" label="cropped" />}
          {m && placement && !m.compatiblePlacementIds.includes(placement.id) && !v.crop && <Chip tone="amber" label="does not fit — crop it" />}
        </div>
        <div className="row wrap">
          <select className="input" value={v.device} onChange={(e) => onChange({ ...v, device: e.target.value as DeviceClass })} aria-label="Device">
            {DEVICES.map((d) => <option key={d} value={d}>{d === "any" ? "Any device" : d}</option>)}
          </select>
          <select className="input" value={v.placementId ?? ""} onChange={(e) => onChange({ ...v, placementId: e.target.value || null, crop: null })} aria-label="Placement">
            <option value="">Any placement</option>
            {placements.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmt.size(p.width, p.height)}</option>)}
          </select>
        </div>
        <div className="row wrap">
          <Button small onClick={() => setPicking(true)}><Icon name="media" /> {m ? "Change media" : "Choose media"}</Button>
          {src && m?.metadata.kind !== "video" && <Button small onClick={() => setCropping(true)}>Crop{ratio ? ` to ${placement?.aspectRatio}` : ""}</Button>}
          <Button small variant="subtle" onClick={onRemove}>Remove</Button>
        </div>
      </div>
      {picking && <MediaPicker placement={placement} media={media} onClose={() => setPicking(false)} onPick={(x) => { onChange({ ...v, mediaAssetId: x.id, imageUrl: null, crop: null }); setPicking(false); }} />}
      {cropping && src && <CropTool src={src} initial={v.crop} aspect={ratio} onClose={() => setCropping(false)} onSave={(c: CropRect | null) => { onChange({ ...v, crop: c }); setCropping(false); }} />}
    </div>
  );
}

function Editor({ campaign, creativeId }: { campaign: CampaignFull; creativeId?: string }) {
  const can = useCan();
  const placementsQ = useLoad<{ placements: Placement[] }>("/placements");
  const mediaQ = useLoad<{ assets: MediaView[] }>("/media");
  const formats = useLoad<{ callsToAction: string[] }>("/formats");
  const advertisers = useLoad<{ advertisers: Advertiser[] }>("/advertisers");
  const existing = campaign.creatives.find((c) => c.id === creativeId);
  const [d, setD] = useState<Draft>(() => existing ? {
    type: existing.type, headline: existing.headline, description: existing.description ?? "", callToAction: existing.callToAction,
    destinationUrl: existing.destinationUrl, variants: existing.variants,
  } : blank(campaign.kind));
  useEffect(() => {
    setD(existing ? { type: existing.type, headline: existing.headline, description: existing.description ?? "", callToAction: existing.callToAction, destinationUrl: existing.destinationUrl, variants: existing.variants } : blank(campaign.kind));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creativeId]);
  const [previewPlacement, setPreviewPlacement] = useState<string>(campaign.placementIds[0] ?? "");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const act = useAction();
  const placements = (placementsQ.data?.placements ?? []).filter((p) => campaign.placementIds.includes(p.id));
  const media = mediaQ.data?.assets ?? [];
  const pl = placements.find((p) => p.id === previewPlacement) ?? placements[0];
  const sponsor = advertisers.data?.advertisers.find((a) => a.id === campaign.advertiserId)?.name ?? "HCG";

  // Local live preview: same renderer and variant selection as delivery (placement+device → placement → device → any).
  const ad: RenderableAd = useMemo(() => {
    const score = (v: Draft["variants"][number]) => (v.placementId === pl?.id ? 2 : v.placementId ? -10 : 0) + (v.device === device ? 1 : v.device === "any" ? 0 : -10);
    const v = [...d.variants].sort((a, b) => score(b) - score(a)).find((x) => score(x) >= 0);
    const m = v ? media.find((x) => x.id === v.mediaAssetId) : undefined;
    const url = m?.previewUrl ?? v?.imageUrl ?? null;
    return {
      deliveryId: "preview", campaignId: campaign.id, creativeId: existing?.id ?? "new", type: d.type, headline: d.headline || "Headline",
      description: d.description || null, callToAction: d.callToAction, clickUrl: d.destinationUrl, displayUrl: d.destinationUrl,
      disclosure: campaign.disclosureLabel, sponsorName: sponsor, frequency: null, preview: true,
      beacons: { impression: "", viewable: "", video: "" },
      media: url ? { kind: m?.metadata.kind ?? "image", url, width: m?.metadata.width ?? null, height: m?.metadata.height ?? null, mime: m?.metadata.mime ?? null, posterUrl: m?.thumbnailUrl ?? null, crop: v?.crop ?? null, alt: d.headline } : null,
    };
  }, [d, pl, device, media, campaign, existing, sponsor]);

  const save = async () => {
    const body = { ...d, description: d.description.trim() || null, headline: d.headline.trim() };
    const out = await act.run(() => (existing ? api.patch(`/creatives/${existing.id}`, body) : api.post<{ id: string }>(`/campaigns/${campaign.id}/creatives`, body)));
    if (out && !existing) navigate(`creative-studio/${campaign.id}/${(out as { id: string }).id}`);
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const isArticle = d.type === "article-card";

  return (
    <div className="studio">
      <Panel title={existing ? "Edit creative" : "New creative"} subtitle={existing ? <>Saving resets moderation to pending. <Chip value={existing.moderation} tone={existing.moderation === "approved" ? "green" : "amber"} /></> : undefined}>
        <div className="stack">
          {existing && existing.validationProblems.length > 0 && <Problems items={existing.validationProblems} title="Validation" />}
          <Field label="Format">
            <Tabs value={d.type} onChange={(t) => set("type", t)} options={[
              ...(campaign.kind === "internal" ? [{ value: "article-card" as CreativeType, label: "Article card" }] : []),
              { value: "image", label: "Image" }, { value: "video", label: "Video" }, { value: "native-text", label: "Native" },
            ]} />
          </Field>
          <Field label={`Headline (${d.headline.length}/120)`}><input className="input" maxLength={120} value={d.headline} onChange={(e) => set("headline", e.target.value)} /></Field>
          <Field label={`Description (${d.description.length}/300)`}><textarea className="input" rows={3} maxLength={300} value={d.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <div className="form-grid">
            <Field label="Call to action">
              <select className="input" value={d.callToAction} onChange={(e) => set("callToAction", e.target.value)}>
                {[...new Set([d.callToAction, ...(formats.data?.callsToAction ?? [])])].map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Destination" hint={isArticle ? "The article's canonical URL" : "https:// only; checked for safety"}>
              <input className="input mono" value={d.destinationUrl} disabled={isArticle} onChange={(e) => set("destinationUrl", e.target.value)} />
            </Field>
          </div>
          <div className="row"><h4 className="section-title grow">Media variants</h4>
            <Button small onClick={() => set("variants", [...d.variants, { device: "any", placementId: null, mediaAssetId: null, imageUrl: null, crop: null }])}><Icon name="plus" /> Add variant</Button>
          </div>
          <p className="muted small">Add a variant per device or per placement when one image does not suit every size. Delivery picks the most specific match; media is never stretched.</p>
          {d.variants.length === 0 && <p className="muted">{d.type === "native-text" ? "Native creatives can run without media." : "Add at least one variant with media."}</p>}
          {d.variants.map((v, i) => (
            <VariantEditor key={v.id ?? `new-${i}`} v={v} index={i} placements={placements} media={media}
              onChange={(nv) => set("variants", d.variants.map((x, j) => (j === i ? nv : x)))}
              onRemove={() => set("variants", d.variants.filter((_, j) => j !== i))} />
          ))}
          <ErrorBox error={act.error} onClose={act.clear} />
          <div className="row end">
            {existing && <Button variant="subtle" disabled={!can("creatives.write")} onClick={async () => { const r = await act.run(() => api.del(`/creatives/${existing.id}`).then(() => true)); if (r) navigate(`creative-studio/${campaign.id}`); }}>Delete creative</Button>}
            <Button variant="primary" busy={act.busy} disabled={!can("creatives.write") || !d.headline.trim()} onClick={save}>{existing ? "Save creative" : "Add creative"}</Button>
          </div>
        </div>
      </Panel>
      <div className="stack studio-side">
        <Panel title="Live preview" subtitle="Updates as you type">
          <div className="row wrap">
            <select className="input" value={pl?.id ?? ""} onChange={(e) => setPreviewPlacement(e.target.value)} aria-label="Placement">
              {placements.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmt.size(p.width, p.height)}</option>)}
            </select>
            <Tabs value={device} onChange={setDevice} options={[{ value: "desktop", label: "Desktop" }, { value: "mobile", label: "Mobile" }]} />
          </div>
          {pl ? (
            <div className={`preview-stage preview-${device}`}>
              <div className="preview-device" style={{ width: device === "mobile" ? 390 : "100%" }}>
                <div className="preview-canvas preview-canvas-studio">
                  <div className="preview-slot" style={(() => { const avail = device === "mobile" ? 358 : 520; const s = pl.width && pl.responsive !== "responsive-native" && pl.width > avail ? avail / pl.width : 1; return s < 1 ? { transform: `scale(${s})`, transformOrigin: "top left", height: (pl.height ?? 0) * s } : undefined; })()}>
                    <AdCreative ad={ad} frame={{ width: pl.width, height: pl.height, responsive: pl.responsive }} device={device} />
                  </div>
                </div>
              </div>
              <div className="preview-caption">{fmt.size(pl.width, pl.height)} · {pl.responsive}<span className="preview-flag">PREVIEW · not counted</span></div>
            </div>
          ) : <Notice tone="info">This campaign has no placements yet.</Notice>}
        </Panel>
        {existing && (
          <Panel title="Server preview" subtitle="The saved creative, as delivered by HCG ADS">
            <CampaignPreview campaign={campaign} compact />
          </Panel>
        )}
      </div>
    </div>
  );
}

export function CreativeStudio({ campaignId, creativeId }: { campaignId?: string; creativeId?: string }) {
  const list = useLoad<{ campaigns: Campaign[] }>("/campaigns");
  const camp = useLoad<CampaignFull>(campaignId ? `/campaigns/${campaignId}` : null, [campaignId]);
  const editable = (list.data?.campaigns ?? []).filter((c) => c.state === "draft" || c.state === "rejected");
  const c = camp.data;
  return (
    <div className="page">
      <PageHeader title="Creative Studio" kicker="Headlines · media · variants · crops">
        <select className="input" value={campaignId ?? ""} onChange={(e) => navigate(e.target.value ? `creative-studio/${e.target.value}` : "creative-studio")} aria-label="Campaign">
          <option value="">Choose a draft campaign…</option>
          {editable.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.state})</option>)}
          {c && !editable.some((x) => x.id === c.id) && <option value={c.id}>{c.name} ({c.state})</option>}
        </select>
      </PageHeader>
      {!campaignId ? (
        <Panel>
          {list.loading && !list.data ? <Loading /> : editable.length === 0 ? (
            <Empty title="No editable campaigns">Creatives can be edited while a campaign is a draft or was rejected. <a href="#/campaigns/new">Create a campaign</a>.</Empty>
          ) : (
            <ul className="list">
              {editable.map((x) => <li key={x.id}><a className="list-row" href={`#/creative-studio/${x.id}`}><span className="grow"><b>{x.name}</b><small>{x.kind} · {x.placementIds.length} placement(s)</small></span><Chip value={x.state} /></a></li>)}
            </ul>
          )}
        </Panel>
      ) : camp.error ? <ErrorBox error={camp.error} /> : !c ? <Loading /> : (
        <>
          {!(c.state === "draft" || c.state === "rejected") && <Notice tone="warn">This campaign is {c.state.replace(/_/g, " ")}. <a href={`#/campaigns/${c.id}`}>Revise it</a> to return it to draft before editing creatives.</Notice>}
          <div className="creative-tabs">
            {c.creatives.map((cr) => (
              <a key={cr.id} href={`#/creative-studio/${c.id}/${cr.id}`} className={`ctab ${creativeId === cr.id ? "ctab-on" : ""}`}>
                {cr.variants[0]?.imageUrl ? <img src={cr.variants[0].imageUrl} alt="" /> : <span className="ctab-ph">{cr.type[0].toUpperCase()}</span>}
                <span className="ellipsis">{cr.headline}</span>
              </a>
            ))}
            <a href={`#/creative-studio/${c.id}/new`} className={`ctab ctab-new ${creativeId === "new" ? "ctab-on" : ""}`}><Icon name="plus" /> New creative</a>
            <a href={`#/campaigns/${c.id}`} className="btn btn-subtle btn-sm">Campaign →</a>
          </div>
          {(creativeId || c.creatives.length === 0) ? (
            <Editor key={`${c.id}-${creativeId ?? "new"}`} campaign={c} creativeId={creativeId === "new" ? undefined : creativeId} />
          ) : <Panel><Empty title="Choose a creative to edit">Or add a new one.</Empty></Panel>}
        </>
      )}
    </div>
  );
}
