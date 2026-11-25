import { useState } from "react";
import type { AnalyticsReport, Campaign, MetricTotals } from "@hcg-ads/contracts";
import { api, fmt } from "../api";
import { useCan, useSession } from "../App";
import { AreaChart, Bars } from "../components/Chart";
import { Button, ErrorBox, Field, Loading, Notice, PageHeader, Panel, Stat, Tabs, useAction, useConfirm, useLoad } from "../components/ui";

const day = (d: Date) => d.toISOString().slice(0, 10);

function MetricTable({ rows }: { rows: Array<{ id: string; name: string } & MetricTotals> }) {
  if (!rows.length) return <p className="muted">No data in this period.</p>;
  return (
    <div className="table-wrap">
      <table className="table compact num">
        <thead><tr><th>Name</th><th>Requests</th><th>Filled</th><th>Impressions</th><th>Viewable</th><th>Clicks</th><th>CTR</th><th>Video starts</th><th>Completes</th><th>Invalid</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="ellipsis" title={r.name}>{r.name}</td>
              <td>{fmt.int(r.requests)}</td><td>{fmt.int(r.filled)}</td><td><b>{fmt.int(r.impressions)}</b></td><td>{fmt.int(r.viewable)}</td>
              <td><b>{fmt.int(r.clicks)}</b></td><td>{fmt.pct(r.ctr)}</td><td>{fmt.int(r.videoStarts)}</td><td>{fmt.int(r.videoCompletes)}</td><td>{fmt.int(r.invalid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Analytics() {
  const can = useCan();
  const session = useSession();
  const [dataset, setDataset] = useState<"measured" | "simulated">("measured");
  const [from, setFrom] = useState(day(new Date(Date.now() - 29 * 86400_000)));
  const [to, setTo] = useState(day(new Date()));
  const [group, setGroup] = useState<"byCampaign" | "byPlacement" | "byPublisher" | "byCreative">("byCampaign");
  const q = new URLSearchParams({ dataset, from, to });
  const { data, error, loading } = useLoad<AnalyticsReport>(`/analytics?${q}`, [dataset, from, to]);
  const campaigns = useLoad<{ campaigns: Campaign[] }>("/campaigns");
  const [simCampaign, setSimCampaign] = useState("");
  const [simDays, setSimDays] = useState(14);
  const sim = useAction();
  const confirm = useConfirm();
  const isDev = session.environment !== "production";
  const simulated = dataset === "simulated";
  const t = data?.totals;

  return (
    <div className={`page ${simulated ? "page-simulated" : ""}`}>
      <PageHeader title="Analytics" kicker="Aggregate, privacy-preserving measurement">
        <Tabs value={dataset} onChange={setDataset} options={[{ value: "measured", label: "Measured" }, { value: "simulated", label: "Simulated" }]} />
      </PageHeader>
      {simulated
        ? <div className="sim-banner">SIMULATED DEVELOPMENT DATA — generated for testing, never mixed with measured results</div>
        : <Notice tone="info">Measured data only: real impressions (rendered and visible), viewability, clicks and video progress. No personal identifiers are stored.</Notice>}
      <Panel>
        <div className="row wrap">
          <Field label="From"><input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="row wrap" style={{ alignSelf: "end" }}>
            {[7, 14, 30, 90].map((n) => <Button key={n} small variant="subtle" onClick={() => { setTo(day(new Date())); setFrom(day(new Date(Date.now() - (n - 1) * 86400_000))); }}>{n} days</Button>)}
          </div>
        </div>
      </Panel>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : t && data && (
        <>
          <div className="stats">
            <Stat label="Impressions" value={fmt.int(t.impressions)} sub={`${fmt.int(t.filled)} filled of ${fmt.int(t.requests)} requests`} />
            <Stat label="Viewable" value={fmt.int(t.viewable)} sub={t.impressions ? `${((t.viewable / t.impressions) * 100).toFixed(1)}% of impressions` : "—"} accent="violet" />
            <Stat label="Clicks" value={fmt.int(t.clicks)} sub={`CTR ${fmt.pct(t.ctr)}`} accent="green" />
            <Stat label="Video completes" value={fmt.int(t.videoCompletes)} sub={`${fmt.int(t.videoStarts)} starts · ${fmt.int(t.invalid)} invalid filtered`} accent="amber" />
          </div>
          <Panel title="By day" subtitle={simulated ? "Simulated" : "Measured"}>
            <AreaChart watermark={simulated ? "SIMULATED DEVELOPMENT DATA" : undefined} labels={data.byDay.map((d) => d.day)} series={[
              { key: "imp", label: "Impressions", color: "#22d3ee", values: data.byDay.map((d) => d.impressions) },
              { key: "view", label: "Viewable", color: "#7c3aed", values: data.byDay.map((d) => d.viewable) },
              { key: "clk", label: "Clicks", color: "#34d399", axis: "right", values: data.byDay.map((d) => d.clicks) },
            ]} />
          </Panel>
          <div className="stack">
            <Panel title="Breakdown" actions={<Tabs value={group} onChange={setGroup} options={[
              { value: "byCampaign", label: "Campaign" }, { value: "byPlacement", label: "Placement" }, { value: "byPublisher", label: "Publisher" }, { value: "byCreative", label: "Creative" },
            ]} />}>
              <MetricTable rows={data[group]} />
            </Panel>
            <Panel title="Top campaigns" subtitle="Impressions">
              <Bars rows={data.byCampaign.slice(0, 8).map((r) => ({ label: r.name, value: r.impressions, sub: `· ${fmt.pct(r.ctr)}` }))} />
              {!data.byCampaign.length && <p className="muted">No data.</p>}
            </Panel>
          </div>
        </>
      )}
      {isDev && can("analytics.simulate") && (
        <Panel title="Development: simulated traffic" subtitle="Generate clearly separated test data for a campaign. Not available in production." tone="warn">
          <div className="row wrap">
            <select className="input" value={simCampaign} onChange={(e) => setSimCampaign(e.target.value)} aria-label="Campaign">
              <option value="">Choose a campaign…</option>
              {(campaigns.data?.campaigns ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="input" value={simDays} onChange={(e) => setSimDays(Number(e.target.value))} aria-label="Days">
              {[7, 14, 30, 60].map((n) => <option key={n} value={n}>{n} days</option>)}
            </select>
            <Button variant="violet" busy={sim.busy} disabled={!simCampaign} onClick={async () => { const r = await sim.run(() => api.post("/analytics/simulate", { campaignId: simCampaign, days: simDays })); if (r) setDataset("simulated"); }}>Generate simulated data</Button>
            <Button variant="subtle" busy={sim.busy} onClick={async () => {
              const r = await confirm.ask({ title: "Clear simulated data", body: "All simulated events are removed. Measured data is not affected.", confirmLabel: "Clear", danger: true });
              if (r.ok) await sim.run(() => api.del("/analytics/simulated"));
            }}>Clear simulated data</Button>
          </div>
          <ErrorBox error={sim.error} onClose={sim.clear} />
        </Panel>
      )}
      {confirm.element}
    </div>
  );
}
