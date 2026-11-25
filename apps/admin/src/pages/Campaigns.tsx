import { useState } from "react";
import { CAMPAIGN_STATES, type Campaign, type Creative } from "@hcg-ads/contracts";
import { fmt } from "../api";
import { Icon } from "../components/Icon";
import { Chip, Empty, ErrorBox, Loading, PageHeader, Panel, Tabs, useLoad } from "../components/ui";

export function Campaigns() {
  const [state, setState] = useState<string>("");
  const [kind, setKind] = useState<"" | "internal" | "external">("");
  const params = new URLSearchParams();
  if (state) params.set("state", state);
  if (kind) params.set("kind", kind);
  const { data, error, loading } = useLoad<{ campaigns: Array<Campaign & { creatives: Creative[] }> }>(`/campaigns?${params}`, [state, kind]);
  const all = useLoad<{ campaigns: Campaign[] }>("/campaigns");
  const counts = (all.data?.campaigns ?? []).reduce<Record<string, number>>((a, c) => { a[c.state] = (a[c.state] ?? 0) + 1; return a; }, {});

  return (
    <div className="page">
      <PageHeader title="Campaigns" kicker="Lifecycle · scheduling · rotation">
        <a className="btn btn-ghost" href="#/content-sources"><Icon name="sources" /> From HCG content</a>
        <a className="btn btn-primary" href="#/campaigns/new"><Icon name="plus" /> New campaign</a>
      </PageHeader>
      <div className="filters">
        <div className="chip-filter">
          <button className={`chipbtn ${state === "" ? "on" : ""}`} onClick={() => setState("")}>All <b>{all.data?.campaigns.length ?? 0}</b></button>
          {CAMPAIGN_STATES.map((s) => (
            <button key={s} className={`chipbtn ${state === s ? "on" : ""}`} onClick={() => setState(s)}>{fmt.state(s)} <b>{counts[s] ?? 0}</b></button>
          ))}
        </div>
        <Tabs value={kind} onChange={setKind} options={[{ value: "", label: "All types" }, { value: "internal", label: "Internal" }, { value: "external", label: "External" }]} />
      </div>
      <Panel>
        <ErrorBox error={error} />
        {loading && !data ? <Loading /> : !data?.campaigns.length ? (
          <Empty title="No campaigns here yet">Promote an HCG News article from Content Sources, or create an external campaign.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Campaign</th><th>State</th><th>Type</th><th>Schedule</th><th>Placements</th><th>Priority</th><th>Updated</th></tr></thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.id} onClick={() => { window.location.hash = `#/campaigns/${c.id}`; }} className="clickable">
                    <td><a href={`#/campaigns/${c.id}`} className="strong">{c.name}</a><div className="muted small">{c.creatives.length} creative(s) · {c.disclosureLabel}</div></td>
                    <td><Chip value={c.state} />{c.stateReason && c.stateReason !== "manual" && <div className="muted small">{fmt.state(c.stateReason)}</div>}</td>
                    <td><Chip value={c.kind} /></td>
                    <td className="small">{c.startAt ? fmt.date(c.startAt) : "On activation"} → {c.endAt ? fmt.date(c.endAt) : "open"}</td>
                    <td>{c.placementIds.length}</td>
                    <td>{c.priority}</td>
                    <td className="small muted">{fmt.dateTime(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
