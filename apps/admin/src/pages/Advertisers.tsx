import { useState } from "react";
import type { Advertiser } from "@hcg-ads/contracts";
import { api, fmt } from "../api";
import { useCan } from "../App";
import { Icon } from "../components/Icon";
import { Button, Chip, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Panel, useAction, useConfirm, useLoad } from "../components/ui";

export function QuotaBar({ used, quota }: { used: number; quota: number }) {
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  return (
    <div className="quota" title={`${fmt.bytes(used)} of ${fmt.bytes(quota)}`}>
      <div className="quota-track"><div className={`quota-fill ${pct > 90 ? "quota-hot" : ""}`} style={{ width: `${pct}%` }} /></div>
      <span className="small muted">{fmt.bytes(used)} / {fmt.bytes(quota)}</span>
    </div>
  );
}

function CreateAdvertiser({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: "", kind: "external" as "external" | "internal", contactEmail: "", website: "", accountSubject: "", quotaMb: "" });
  const act = useAction();
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title="Register advertiser" onClose={onClose} footer={
      <>
        <span className="muted small grow">New advertisers start as pending and need approval.</span>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.busy} disabled={f.name.trim().length < 2} onClick={async () => {
          const r = await act.run(() => api.post("/advertisers", {
            name: f.name.trim(), kind: f.kind, contactEmail: f.contactEmail.trim() || null, website: f.website.trim() || null,
            accountSubject: f.accountSubject.trim() || null, ...(f.quotaMb ? { storageQuotaBytes: Math.round(Number(f.quotaMb) * 1024 * 1024) } : {}),
          }));
          if (r) onClose();
        }}>Register</Button>
      </>
    }>
      <div className="form-grid">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
        <Field label="Type">
          <select className="input" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="external">External advertiser</option><option value="internal">Internal HCG division</option>
          </select>
        </Field>
        <Field label="Contact email"><input className="input" type="email" value={f.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></Field>
        <Field label="Website" hint="https:// only"><input className="input" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" /></Field>
        <Field label="HCG Connect account" hint="Subject of the advertiser's HCG account, when linked"><input className="input mono" value={f.accountSubject} onChange={(e) => set("accountSubject", e.target.value)} /></Field>
        <Field label="Storage quota (MB)" hint="Empty = default from Settings"><input className="input" inputMode="numeric" value={f.quotaMb} onChange={(e) => set("quotaMb", e.target.value.replace(/[^\d.]/g, ""))} /></Field>
      </div>
      <ErrorBox error={act.error} onClose={act.clear} />
    </Modal>
  );
}

export function AdvertiserStatusActions({ a }: { a: Advertiser }) {
  const can = useCan();
  const act = useAction();
  const confirm = useConfirm();
  const setStatus = async (status: string, title: string, danger = false) => {
    const r = await confirm.ask({ title, body: `${a.name} will be ${status}.`, confirmLabel: title, danger, noteLabel: "Note (recorded in the audit log)", requireNote: status === "rejected" || status === "suspended" });
    if (r.ok) await act.run(() => api.post(`/advertisers/${a.id}/status`, { status, note: r.note || undefined }));
  };
  const allowed = can("advertisers.approve");
  return (
    <div className="row wrap">
      {a.status !== "approved" && <Button small variant="primary" disabled={!allowed} busy={act.busy} onClick={() => setStatus("approved", "Approve")}>Approve</Button>}
      {a.status === "pending" && <Button small variant="danger" disabled={!allowed} busy={act.busy} onClick={() => setStatus("rejected", "Reject", true)}>Reject</Button>}
      {a.status === "approved" && a.kind === "external" && <Button small variant="danger" disabled={!allowed} busy={act.busy} onClick={() => setStatus("suspended", "Suspend", true)}>Suspend</Button>}
      <ErrorBox error={act.error} onClose={act.clear} />
      {confirm.element}
    </div>
  );
}

export function Advertisers() {
  const can = useCan();
  const { data, error, loading } = useLoad<{ advertisers: Advertiser[] }>("/advertisers");
  const [creating, setCreating] = useState(false);
  return (
    <div className="page">
      <PageHeader title="Advertisers" kicker="Accounts · approval · storage">
        <Button variant="primary" disabled={!can("advertisers.write")} onClick={() => setCreating(true)}><Icon name="plus" /> Register advertiser</Button>
      </PageHeader>
      <Panel>
        <ErrorBox error={error} />
        {loading && !data ? <Loading /> : !data?.advertisers.length ? <Empty title="No advertisers yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Advertiser</th><th>Status</th><th>Type</th><th>Contact</th><th>Media storage</th><th>Since</th><th /></tr></thead>
              <tbody>
                {data.advertisers.map((a) => (
                  <tr key={a.id}>
                    <td><b>{a.name}</b><div className="muted small mono">{a.id}</div></td>
                    <td><Chip value={a.status === "approved" ? "active" : a.status} label={a.status} /></td>
                    <td><Chip value={a.kind} /></td>
                    <td className="small">{a.contactEmail ?? "—"}{a.website && <div><a href={a.website} target="_blank" rel="noreferrer">{a.website.replace(/^https:\/\//, "")}</a></div>}</td>
                    <td style={{ minWidth: 180 }}><QuotaBar used={a.storageUsedBytes} quota={a.storageQuotaBytes} /></td>
                    <td className="small muted">{fmt.date(a.createdAt)}</td>
                    <td><AdvertiserStatusActions a={a} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {creating && <CreateAdvertiser onClose={() => setCreating(false)} />}
    </div>
  );
}
