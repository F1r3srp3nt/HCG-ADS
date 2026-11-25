import { useEffect, useState } from "react";
import type { Campaign, CampaignHistoryEntry, ContentItem, Creative, DeliveryResponse, Placement } from "@hcg-ads/contracts";
import { api, ApiError, fmt } from "../api";
import { useCan } from "../App";
import { AdPreview } from "../components/AdPreview";
import { Icon } from "../components/Icon";
import { Button, Chip, ErrorBox, Loading, Modal, Notice, PageHeader, Panel, Problems, Tabs, navigate, useAction, useConfirm, useLoad } from "../components/ui";
import { CampaignForm } from "./NewCampaign";

export type CampaignFull = Campaign & {
  creatives: Creative[];
  history: CampaignHistoryEntry[];
  readiness: string[];
  content: Array<{ creativeId: string; item: (ContentItem & { checkedAt: string }) | null }>;
};

export function CampaignPreview({ campaign, compact }: { campaign: Campaign & { creatives: Creative[] }; compact?: boolean }) {
  const placements = useLoad<{ placements: Placement[] }>("/placements");
  const mine = (placements.data?.placements ?? []).filter((p) => campaign.placementIds.includes(p.id));
  const [placementId, setPlacementId] = useState<string>(campaign.placementIds[0] ?? "");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [creativeId, setCreativeId] = useState<string>("");
  const [res, setRes] = useState<DeliveryResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const creativeKey = campaign.creatives.map((c) => c.id + c.updatedAt).join();

  useEffect(() => {
    if (!placementId) return;
    setLoading(true);
    const q = new URLSearchParams({ placementId, device });
    if (creativeId) q.set("creativeId", creativeId);
    api.get<{ response: DeliveryResponse }>(`/campaigns/${campaign.id}/preview?${q}`)
      .then((r) => { setRes(r.response); setError(null); })
      .catch((e: ApiError) => setError(e))
      .finally(() => setLoading(false));
  }, [campaign.id, placementId, device, creativeId, creativeKey]);

  if (!campaign.placementIds.length) return <Notice tone="info">Select placements to preview this campaign.</Notice>;
  return (
    <div className="stack">
      <div className="row wrap">
        <select className="input" value={placementId} onChange={(e) => setPlacementId(e.target.value)} aria-label="Placement">
          {mine.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmt.size(p.width, p.height)}</option>)}
        </select>
        {campaign.creatives.length > 1 && (
          <select className="input" value={creativeId} onChange={(e) => setCreativeId(e.target.value)} aria-label="Creative">
            <option value="">Rotation (any creative)</option>
            {campaign.creatives.map((c) => <option key={c.id} value={c.id}>{c.headline}</option>)}
          </select>
        )}
        <Tabs value={device} onChange={setDevice} options={[{ value: "desktop", label: "Desktop" }, { value: "mobile", label: "Mobile" }]} />
        {loading && <span className="spinner" />}
      </div>
      <ErrorBox error={error} />
      {res && <AdPreview response={res} device={device} caption={compact ? undefined : undefined} />}
    </div>
  );
}

const ACTIONS: Record<string, Array<"submit" | "approve" | "reject" | "activate" | "pause" | "revise" | "archive" | "duplicate">> = {
  draft: ["submit", "archive", "duplicate"],
  pending_approval: ["approve", "reject", "revise"],
  approved: ["activate", "revise", "archive"],
  scheduled: ["pause"],
  active: ["pause"],
  paused: ["activate", "revise", "archive", "duplicate"],
  completed: ["archive", "duplicate"],
  rejected: ["submit", "revise", "archive", "duplicate"],
  archived: ["duplicate"],
};
const LABEL: Record<string, string> = {
  submit: "Submit for approval", approve: "Approve", reject: "Reject", activate: "Activate", pause: "Pause now",
  revise: "Revise (back to draft)", archive: "Archive", duplicate: "Duplicate",
};
const PERM = { submit: "campaigns.submit", approve: "campaigns.approve", reject: "campaigns.approve", activate: "campaigns.activate", pause: "campaigns.pause", revise: "campaigns.write", archive: "campaigns.write", duplicate: "campaigns.write" } as const;

export function CampaignDetail({ id }: { id: string }) {
  const can = useCan();
  const { data: c, error, loading } = useLoad<CampaignFull>(`/campaigns/${id}`, [id]);
  const act = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  if (loading && !c) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!c) return null;

  const run = async (action: string) => {
    let note: string | undefined;
    if (action === "reject") {
      const r = await confirm.ask({ title: "Reject campaign", body: "The campaign returns to its owner with your note.", confirmLabel: "Reject", danger: true, requireNote: true, noteLabel: "Why is it rejected?" });
      if (!r.ok) return; note = r.note;
    } else if (action === "approve") {
      const r = await confirm.ask({ title: "Approve campaign", body: <>Approval re-checks the promoted content at its source and makes approved media publicly servable. The campaign does <b>not</b> go live until it is activated.</>, confirmLabel: "Approve", noteLabel: "Note (optional)" });
      if (!r.ok) return; note = r.note || undefined;
    } else if (action === "activate") {
      const r = await confirm.ask({ title: "Activate campaign", body: <>The campaign becomes eligible for delivery on its placements{c.startAt && new Date(c.startAt) > new Date() ? ` from ${fmt.dateTime(c.startAt)}` : " immediately"}. Publishers in <b>test</b> mode only show it on registered test origins.</>, confirmLabel: "Activate" });
      if (!r.ok) return;
    } else if (action === "revise") {
      const r = await confirm.ask({ title: "Revise campaign", body: "The campaign returns to draft for editing and must be approved again before it can run.", confirmLabel: "Return to draft" });
      if (!r.ok) return;
    } else if (action === "archive") {
      const r = await confirm.ask({ title: "Archive campaign", body: "Archived campaigns are kept for history but can no longer run.", confirmLabel: "Archive" });
      if (!r.ok) return;
    }
    const out = await act.run(() => api.post<Campaign>(`/campaigns/${c.id}/${action}`, note ? { note } : {}));
    if (out && action === "duplicate") navigate(`campaigns/${out.id}`);
  };

  const editable = c.state === "draft" || c.state === "rejected";
  return (
    <div className="page">
      <PageHeader title={c.name} kicker={<>{c.kind === "internal" ? "Internal campaign" : "External campaign"} · {c.id}</>}>
        <a className="btn btn-subtle" href="#/campaigns">← All campaigns</a>
        {editable && <a className="btn btn-ghost" href={`#/creative-studio/${c.id}`}><Icon name="studio" /> Creative Studio</a>}
      </PageHeader>

      <div className="lifecycle">
        <div className="lifecycle-state">
          <Chip value={c.state} />
          {c.stateReason && c.stateReason !== "manual" && <span className="muted small">reason: {fmt.state(c.stateReason)}</span>}
        </div>
        <div className="row wrap">
          {(ACTIONS[c.state] ?? []).map((a) => (
            <Button key={a} variant={a === "pause" || a === "reject" ? "danger" : a === "approve" || a === "activate" || a === "submit" ? "primary" : "ghost"}
              busy={act.busy} disabled={!can(PERM[a])} onClick={() => run(a)}>{LABEL[a]}</Button>
          ))}
        </div>
      </div>
      <ErrorBox error={act.error} onClose={act.clear} />
      {c.state === "paused" && c.stateReason === "source_unavailable" && (
        <Notice tone="warn">Suspended automatically: the promoted article is no longer published at its source. Synchronise HCG News once it is available again, then activate.</Notice>
      )}
      {editable && <Problems items={c.readiness} title="Before this campaign can be submitted" />}
      {c.state === "pending_approval" && <Problems items={c.readiness} title="Approval is blocked" />}

      <div className="grid-2-1">
        <Panel title="Preview" subtitle="Exactly as the HCG ADS SDK renders it in the registered placement.">
          <CampaignPreview campaign={c} />
        </Panel>
        <Panel title="Summary" actions={editable && <Button small onClick={() => setEditing(true)}>Edit</Button>}>
          <dl className="dl">
            <dt>Objective</dt><dd>{c.objective}</dd>
            <dt>Disclosure</dt><dd><span className="chip chip-cyan">{c.disclosureLabel}</span></dd>
            <dt>Schedule</dt><dd>{c.startAt ? fmt.dateTime(c.startAt) : "On activation"} → {c.endAt ? fmt.dateTime(c.endAt) : "open-ended"}</dd>
            <dt>Priority</dt><dd>{c.priority} / 10</dd>
            <dt>Rotation</dt><dd>{c.rotation}</dd>
            <dt>Placements</dt><dd>{c.placementIds.length}</dd>
            <dt>Impression limit</dt><dd>{c.impressionLimit ? fmt.int(c.impressionLimit) : "None"}{c.dailyImpressionLimit ? ` · ${fmt.int(c.dailyImpressionLimit)}/day` : ""}</dd>
            <dt>Frequency</dt><dd>{c.frequencyLimit ? `${c.frequencyLimit.count} per ${c.frequencyLimit.windowHours} h (on device, with consent)` : "None"}</dd>
            <dt>Context</dt><dd>{c.contextual.categories.length ? c.contextual.categories.join(", ") : "All contexts"}</dd>
            <dt>Pricing</dt><dd>{c.pricing.model === "none" ? "Not priced (internal)" : <>{c.pricing.model.toUpperCase()} · {fmt.money(c.pricing.rateMinor, c.pricing.currency)} · budget {fmt.money(c.pricing.budgetMinor, c.pricing.currency)} <Chip tone="amber" label="TEST MODE" /></>}</dd>
          </dl>
          <a className="btn btn-subtle btn-sm" href={`#/analytics`}>View analytics →</a>
        </Panel>
      </div>

      <Panel title="Creatives" subtitle="Moderation and validation per creative" actions={editable && <a className="btn btn-ghost btn-sm" href={`#/creative-studio/${c.id}`}><Icon name="plus" /> Add or edit</a>}>
        <div className="creative-list">
          {c.creatives.map((cr) => {
            const src = c.content.find((x) => x.creativeId === cr.id)?.item;
            return (
              <div key={cr.id} className="creative-row">
                {cr.variants[0]?.imageUrl ? <img src={cr.variants[0].imageUrl} alt="" className="thumb" /> : <div className="thumb thumb-empty">{cr.type}</div>}
                <div className="grow">
                  <b>{cr.headline}</b>
                  <div className="muted small">{cr.description}</div>
                  <div className="row wrap small">
                    <Chip value={cr.type} tone="slate" /> <Chip value={cr.moderation} tone={cr.moderation === "approved" ? "green" : cr.moderation === "rejected" ? "red" : "amber"} />
                    <span className="muted">CTA “{cr.callToAction}” → {cr.destinationUrl}</span>
                    <span className="muted">{cr.variants.length} variant(s)</span>
                  </div>
                  {cr.moderationNotes && <div className="small">Reviewer: {cr.moderationNotes}</div>}
                  {cr.validationProblems.length > 0 && <ul className="problems small">{cr.validationProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
                  {cr.contentRef && (
                    <div className="source-status small">
                      Source: HCG News article {src ? <Chip value={src.status === "published" ? "connected" : "rejected"} label={src.status} /> : <Chip tone="dim" label="unknown" />}
                      {src?.checkedAt && <span className="muted"> · checked {fmt.dateTime(src.checkedAt)}</span>}
                      {src?.canonicalUrl && <> · <a href={src.canonicalUrl} target="_blank" rel="noreferrer">Open article ↗</a></>}
                    </div>
                  )}
                </div>
                {editable && <a className="btn btn-subtle btn-sm" href={`#/creative-studio/${c.id}/${cr.id}`}>Edit</a>}
              </div>
            );
          })}
          {!c.creatives.length && <p className="muted">No creatives yet. Open the Creative Studio to add one.</p>}
        </div>
      </Panel>

      <Panel title="History">
        <ul className="timeline">
          {[...c.history].reverse().map((h) => (
            <li key={h.id}>
              <span className="tl-dot" />
              <div>
                <b>{h.action}{h.fromState && h.toState && h.fromState !== h.toState ? `: ${fmt.state(h.fromState)} → ${fmt.state(h.toState)}` : ""}</b>
                <small>{h.actor} · {fmt.dateTime(h.at)}{h.note ? ` · ${h.note}` : ""}</small>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      {confirm.element}
      {editing && (
        <Modal wide title="Edit campaign" onClose={() => setEditing(false)}>
          <CampaignForm initial={c} onSaved={() => setEditing(false)} />
        </Modal>
      )}
    </div>
  );
}
