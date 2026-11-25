import type { Advertiser, Campaign, Creative, Publisher } from "@hcg-ads/contracts";
import { api, fmt } from "../api";
import { useCan } from "../App";
import { Button, Chip, Empty, ErrorBox, Loading, PageHeader, Panel, Problems, useAction, useConfirm, useLoad } from "../components/ui";
import { CampaignPreview } from "./CampaignDetail";
import { AdvertiserStatusActions } from "./Advertisers";

type PendingCampaign = Campaign & { creatives: Creative[]; readiness: string[] };

function CampaignReview({ c }: { c: PendingCampaign }) {
  const can = useCan();
  const act = useAction();
  const confirm = useConfirm();
  const approve = async () => {
    const r = await confirm.ask({ title: `Approve ${c.name}`, body: "Approval re-checks promoted content at its source and approves every creative. It does not activate the campaign.", confirmLabel: "Approve", noteLabel: "Note (optional)" });
    if (r.ok) await act.run(() => api.post(`/campaigns/${c.id}/approve`, r.note ? { note: r.note } : {}));
  };
  const reject = async () => {
    const r = await confirm.ask({ title: `Reject ${c.name}`, body: "The owner sees your note and can revise and resubmit.", confirmLabel: "Reject", danger: true, requireNote: true, noteLabel: "Reason for rejection" });
    if (r.ok) await act.run(() => api.post(`/campaigns/${c.id}/reject`, { note: r.note }));
  };
  return (
    <Panel title={<><a href={`#/campaigns/${c.id}`}>{c.name}</a> <Chip value={c.kind} /></>} subtitle={`Submitted ${fmt.dateTime(c.updatedAt)} · ${c.creatives.length} creative(s) · ${c.placementIds.length} placement(s) · “${c.disclosureLabel}”`}
      actions={<div className="row">
        <Button variant="danger" busy={act.busy} disabled={!can("campaigns.approve")} onClick={reject}>Reject</Button>
        <Button variant="primary" busy={act.busy} disabled={!can("campaigns.approve") || c.readiness.length > 0} onClick={approve}>Approve</Button>
      </div>}>
      <ErrorBox error={act.error} onClose={act.clear} />
      <Problems items={c.readiness} title="Cannot be approved yet" />
      <div className="grid-2-1">
        <CampaignPreview campaign={c} compact />
        <div className="stack">
          {c.creatives.map((cr) => (
            <div key={cr.id} className="review-creative">
              <b>{cr.headline}</b>
              {cr.description && <p className="small muted">{cr.description}</p>}
              <div className="small">CTA “{cr.callToAction}” → <span className="mono">{cr.destinationUrl}</span></div>
              {cr.validationProblems.length > 0 && <ul className="problems small">{cr.validationProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
            </div>
          ))}
        </div>
      </div>
      {confirm.element}
    </Panel>
  );
}

function PublisherReview({ p }: { p: Publisher }) {
  const can = useCan();
  const act = useAction();
  return (
    <div className="list-row">
      <span className="grow"><b>{p.name}</b><small>{p.productId} · {p.domains.join(", ") || "no domains"} · {p.platforms.join(", ")}</small></span>
      <a className="btn btn-subtle btn-sm" href={`#/publishers/${p.id}`}>Details</a>
      <Button small variant="danger" busy={act.busy} disabled={!can("publishers.approve")} onClick={() => act.run(() => api.post(`/publishers/${p.id}/status`, { status: "rejected" }))}>Reject</Button>
      <Button small variant="primary" busy={act.busy} disabled={!can("publishers.approve")} onClick={() => act.run(() => api.post(`/publishers/${p.id}/status`, { status: "active" }))}>Approve</Button>
      <ErrorBox error={act.error} onClose={act.clear} />
    </div>
  );
}

export function Approvals() {
  const { data, error, loading } = useLoad<{ campaigns: PendingCampaign[]; advertisers: Advertiser[]; publishers: Publisher[] }>("/approvals");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const total = data.campaigns.length + data.advertisers.length + data.publishers.length;
  return (
    <div className="page">
      <PageHeader title="Approvals" kicker={`${total} item(s) waiting for review`} />
      {total === 0 && <Panel><Empty title="Nothing to review">Submitted campaigns, new advertisers and new publishers appear here.</Empty></Panel>}
      {data.campaigns.length > 0 && <h3 className="group-title">Campaigns ({data.campaigns.length})</h3>}
      {data.campaigns.map((c) => <CampaignReview key={c.id} c={c} />)}
      {data.advertisers.length > 0 && (
        <Panel title={`Advertisers (${data.advertisers.length})`}>
          <ul className="list">
            {data.advertisers.map((a) => (
              <li key={a.id} className="list-row"><span className="grow"><b>{a.name}</b><small>{a.contactEmail ?? "no contact"} · {a.website ?? "no website"} · {fmt.date(a.createdAt)}</small></span><AdvertiserStatusActions a={a} /></li>
            ))}
          </ul>
        </Panel>
      )}
      {data.publishers.length > 0 && (
        <Panel title={`Publishers (${data.publishers.length})`}>
          <ul className="list">{data.publishers.map((p) => <li key={p.id}><PublisherReview p={p} /></li>)}</ul>
        </Panel>
      )}
    </div>
  );
}
