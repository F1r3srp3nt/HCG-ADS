import { useState } from "react";
import type { Advertiser, Campaign } from "@hcg-ads/contracts";
import { api, fmt } from "../api";
import { useCan } from "../App";
import { Button, Chip, Empty, ErrorBox, Field, Loading, PageHeader, Panel, Stat, useAction, useLoad } from "../components/ui";

interface RevenueSummary {
  mode: "test";
  gateway: { connected: boolean; message: string };
  publisherSharePercent: number;
  totals: { spendMinor: number; publisherShareMinor: number };
  campaigns: Array<{ campaignId: string; name: string; model: string; currency: string; budgetMinor: number | null; rateMinor: number | null; impressions: number; clicks: number; spendMinor: number; publisherShareMinor: number }>;
  ledger: Array<{ id: string; at: string; kind: string; campaignId: string | null; advertiserId: string | null; amountMinor: number; currency: string; testMode: boolean; description: string }>;
}

function AddEntry() {
  const advertisers = useLoad<{ advertisers: Advertiser[] }>("/advertisers");
  const campaigns = useLoad<{ campaigns: Campaign[] }>("/campaigns?kind=external");
  const [f, setF] = useState({ kind: "prepaid_credit", advertiserId: "", campaignId: "", amount: "", currency: "NOK", description: "" });
  const act = useAction();
  return (
    <Panel title="Add test ledger entry" subtitle="Recorded with a [TEST] prefix. No payment is made or requested.">
      <div className="form-grid">
        <Field label="Kind">
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="prepaid_credit">Prepaid credit</option><option value="invoice">Invoice</option><option value="refund">Refund</option><option value="adjustment">Adjustment</option>
          </select>
        </Field>
        <Field label="Advertiser">
          <select className="input" value={f.advertiserId} onChange={(e) => setF({ ...f, advertiserId: e.target.value })}>
            <option value="">—</option>{(advertisers.data?.advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Campaign">
          <select className="input" value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })}>
            <option value="">—</option>{(campaigns.data?.campaigns ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label={`Amount (${f.currency})`} hint="Negative for refunds/credits back"><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Currency"><input className="input" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Description"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      <ErrorBox error={act.error} onClose={act.clear} />
      <div className="row end">
        <Button variant="primary" busy={act.busy} disabled={!f.amount || Number.isNaN(Number(f.amount)) || f.description.trim().length < 2} onClick={async () => {
          const r = await act.run(() => api.post("/revenue/ledger", { kind: f.kind, advertiserId: f.advertiserId || null, campaignId: f.campaignId || null, amountMinor: Math.round(Number(f.amount) * 100), currency: f.currency, description: f.description.trim() }));
          if (r) setF({ ...f, amount: "", description: "" });
        }}>Add test entry</Button>
      </div>
    </Panel>
  );
}

export function Revenue() {
  const can = useCan();
  const { data, error, loading } = useLoad<RevenueSummary>("/revenue");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const cur = data.campaigns[0]?.currency ?? "NOK";
  return (
    <div className="page">
      <PageHeader title="Revenue" kicker="Projections · publisher share · ledger" />
      <div className="testmode-banner">
        <b>TEST MODE — no money moves</b>
        <span>{data.gateway.message}</span>
      </div>
      <div className="stats">
        <Stat label="Projected spend" value={fmt.money(data.totals.spendMinor, cur)} sub="From measured events and campaign pricing" accent="cyan" />
        <Stat label="Publisher share" value={fmt.money(data.totals.publisherShareMinor, cur)} sub={`${data.publisherSharePercent}% of spend`} accent="violet" />
        <Stat label="Priced campaigns" value={data.campaigns.length} accent="green" />
        <Stat label="Ledger entries" value={data.ledger.length} sub="All test mode" accent="amber" />
      </div>
      <Panel title="Spend projections by campaign">
        {!data.campaigns.length ? <Empty title="No priced campaigns">External campaigns with CPM, CPC or fixed pricing appear here.</Empty> : (
          <div className="table-wrap">
            <table className="table compact num">
              <thead><tr><th>Campaign</th><th>Model</th><th>Rate</th><th>Budget</th><th>Impressions</th><th>Clicks</th><th>Projected spend</th><th>Publisher share</th><th>Budget used</th></tr></thead>
              <tbody>
                {data.campaigns.map((c) => {
                  const used = c.budgetMinor ? Math.min(100, (c.spendMinor / c.budgetMinor) * 100) : null;
                  return (
                    <tr key={c.campaignId}>
                      <td><a href={`#/campaigns/${c.campaignId}`}>{c.name}</a></td>
                      <td>{c.model.toUpperCase()}</td>
                      <td>{c.rateMinor != null ? fmt.money(c.rateMinor, c.currency) : "—"}</td>
                      <td>{c.budgetMinor != null ? fmt.money(c.budgetMinor, c.currency) : "—"}</td>
                      <td>{fmt.int(c.impressions)}</td><td>{fmt.int(c.clicks)}</td>
                      <td><b>{fmt.money(c.spendMinor, c.currency)}</b></td>
                      <td>{fmt.money(c.publisherShareMinor, c.currency)}</td>
                      <td style={{ minWidth: 110 }}>{used == null ? "—" : <div className="quota"><div className="quota-track"><div className="quota-fill" style={{ width: `${used}%` }} /></div><span className="small muted">{used.toFixed(0)}%</span></div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <div className="grid-2">
        <Panel title="Ledger">
          {!data.ledger.length ? <p className="muted">No entries.</p> : (
            <ul className="timeline">
              {data.ledger.map((l) => (
                <li key={l.id}><span className="tl-dot" /><div><b>{fmt.money(l.amountMinor, l.currency)} · {l.kind.replace(/_/g, " ")} {l.testMode && <Chip tone="amber" label="TEST" />}</b><small>{l.description} · {fmt.dateTime(l.at)}</small></div></li>
              ))}
            </ul>
          )}
        </Panel>
        {can("revenue.write") ? <AddEntry /> : <Panel title="Ledger entries"><p className="muted">Your role cannot add ledger entries.</p></Panel>}
      </div>
    </div>
  );
}
