import { useState } from "react";
import type { Campaign, MetricTotals } from "@hcg-ads/contracts";
import { api, fmt } from "../api";
import { useCan } from "../App";
import { AreaChart } from "../components/Chart";
import { Icon } from "../components/Icon";
import { Button, Chip, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Panel, Stat, useAction, useLoad } from "../components/ui";

interface Overview {
  campaigns: Record<string, number>;
  activeCampaigns: Array<Campaign & { creativeCount: number }>;
  pendingApprovals: number;
  suspended: Array<{ id: string; name: string }>;
  publishers: number;
  placements: number;
  advertisers: number;
  mediaAssets: number;
  emergency: { active: boolean; reason: string | null; at: string | null; by: string | null };
  metrics: { dataset: "measured"; totals: MetricTotals; byDay: Array<{ day: string } & MetricTotals> };
  recentActivity: Array<{ id: string; at: string; actor: { name: string }; action: string; summary: string }>;
}

export function EmergencyControl({ emergency }: { emergency: Overview["emergency"] }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const act = useAction();
  const turningOn = !emergency.active;
  const phrase = turningOn ? "SHUT DOWN" : "RESUME";
  return (
    <div className={`emergency ${emergency.active ? "emergency-on" : ""}`}>
      <div className="emergency-icon"><Icon name="power" size={26} /></div>
      <div className="emergency-text">
        <div className="emergency-title">{emergency.active ? "Emergency shutdown is ACTIVE" : "Emergency advertising shutdown"}</div>
        <div className="muted">
          {emergency.active
            ? `Nothing is delivered on any publisher. ${emergency.reason ?? ""} — ${emergency.by ?? ""}`
            : "Stops every advertisement on every publisher immediately. Host websites and apps keep working; placements collapse."}
        </div>
      </div>
      <Button variant={emergency.active ? "primary" : "danger"} disabled={!can("governance.emergency")} onClick={() => { setOpen(true); setConfirm(""); setReason(""); act.clear(); }}>
        {emergency.active ? "Lift shutdown" : "Shut down all advertising"}
      </Button>
      {open && (
        <Modal title={turningOn ? "Emergency shutdown" : "Lift emergency shutdown"} onClose={() => setOpen(false)} footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={turningOn ? "danger" : "primary"} busy={act.busy} disabled={confirm !== phrase || (turningOn && !reason.trim())}
              onClick={async () => { const r = await act.run(() => api.post("/governance/emergency", { active: turningOn, reason: reason.trim() || null })); if (r) setOpen(false); }}>
              {turningOn ? "Shut down now" : "Resume delivery"}
            </Button>
          </>
        }>
          <div className="stack">
            {turningOn
              ? <Notice tone="danger">Every placement on every publisher stops receiving advertisements immediately. Campaign states are not changed, so delivery resumes exactly as before when the shutdown is lifted.</Notice>
              : <Notice tone="warn">Active campaigns start delivering again immediately.</Notice>}
            {turningOn && <Field label="Reason (recorded in the audit log)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>}
            <Field label={`Type ${phrase} to confirm`}><input className="input mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
            <ErrorBox error={act.error} />
          </div>
        </Modal>
      )}
    </div>
  );
}

export function CommandCenter() {
  const { data, error, loading } = useLoad<Overview>("/overview");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const t = data.metrics.totals;
  const active = data.campaigns.active ?? 0;
  return (
    <div className="page">
      <PageHeader title="Command Center" kicker="HCG ADS · Advertising infrastructure">
        <a className="btn btn-ghost" href="#/content-sources"><Icon name="sources" /> Promote HCG content</a>
        <a className="btn btn-primary" href="#/campaigns/new"><Icon name="plus" /> New campaign</a>
      </PageHeader>

      <EmergencyControl emergency={data.emergency} />

      {data.suspended.length > 0 && (
        <Notice tone="warn">
          <strong>{data.suspended.length} campaign(s) suspended automatically</strong> because their promoted content is no longer published:{" "}
          {data.suspended.map((s, i) => <span key={s.id}>{i > 0 && ", "}<a href={`#/campaigns/${s.id}`}>{s.name}</a></span>)}
        </Notice>
      )}

      <div className="stats">
        <Stat label="Impressions · 14 days" value={fmt.int(t.impressions)} sub={`${fmt.int(t.viewable)} viewable`} />
        <Stat label="Clicks · 14 days" value={fmt.int(t.clicks)} sub={`CTR ${fmt.pct(t.ctr)}`} accent="violet" />
        <Stat label="Active campaigns" value={active} sub={`${data.campaigns.scheduled ?? 0} scheduled · ${data.campaigns.paused ?? 0} paused`} accent="green" />
        <Stat label="Pending approvals" value={data.pendingApprovals} sub={<a href="#/approvals">Open queue →</a>} accent="amber" />
      </div>

      <div className="grid-2-1">
        <Panel title="Delivery — last 14 days" subtitle={<><Chip tone="green" label="Measured" /> real impressions and clicks only; simulated data is never mixed in.</>}>
          <AreaChart labels={data.metrics.byDay.map((d) => d.day)} series={[
            { key: "imp", label: "Impressions", color: "#22d3ee", values: data.metrics.byDay.map((d) => d.impressions) },
            { key: "clk", label: "Clicks", color: "#a78bfa", axis: "right", values: data.metrics.byDay.map((d) => d.clicks) },
          ]} />
        </Panel>
        <Panel title="Network">
          <div className="kv-grid">
            <a href="#/publishers" className="kv-tile"><b>{data.publishers}</b><span>Publishers</span></a>
            <a href="#/placements" className="kv-tile"><b>{data.placements}</b><span>Placements</span></a>
            <a href="#/advertisers" className="kv-tile"><b>{data.advertisers}</b><span>Advertisers</span></a>
            <a href="#/media" className="kv-tile"><b>{data.mediaAssets}</b><span>Media assets</span></a>
          </div>
          <div className="state-strip">
            {Object.entries(data.campaigns).filter(([, n]) => n > 0).map(([s, n]) => <span key={s}><Chip value={s} /> {n}</span>)}
          </div>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Live now" subtitle="Campaigns currently eligible for delivery">
          {data.activeCampaigns.length === 0 ? (
            <Empty title="No active campaigns">Connect HCG News under Content Sources and promote an article to get started.</Empty>
          ) : (
            <ul className="list">
              {data.activeCampaigns.map((c) => (
                <li key={c.id}>
                  <a href={`#/campaigns/${c.id}`} className="list-row">
                    <span className="pulse" aria-hidden />
                    <span className="grow"><b>{c.name}</b><small>{c.kind} · priority {c.priority} · {c.placementIds.length} placement(s)</small></span>
                    <Chip value={c.kind} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent activity" subtitle="From the audit log">
          <ul className="timeline">
            {data.recentActivity.map((a) => (
              <li key={a.id}>
                <span className="tl-dot" />
                <div><b>{a.summary}</b><small>{a.actor.name} · {fmt.dateTime(a.at)} · {a.action}</small></div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
