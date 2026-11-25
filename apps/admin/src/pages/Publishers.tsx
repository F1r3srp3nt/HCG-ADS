import { useState } from "react";
import type { Placement, Platform, Publisher } from "@hcg-ads/contracts";
import { api, fmt } from "../api";
import { useCan, useSession } from "../App";
import { Icon } from "../components/Icon";
import { Button, Chip, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Panel, navigate, useAction, useConfirm, useLoad } from "../components/ui";

const PLATFORMS: Platform[] = ["web", "ios", "android", "macos", "windows", "linux", "desktop"];
const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

function RegisterPublisher({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: "", productId: "", domains: "", appIds: "", testOrigins: "", platforms: new Set<Platform>(["web"]), internal: true, external: false });
  const act = useAction();
  return (
    <Modal wide title="Register publisher" onClose={onClose} footer={
      <>
        <span className="muted small grow">Registered publishers start as pending, in test delivery mode.</span>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.busy} disabled={f.name.trim().length < 2 || f.productId.trim().length < 2 || f.platforms.size === 0} onClick={async () => {
          const r = await act.run(() => api.post<Publisher>("/publishers", {
            name: f.name.trim(), productId: f.productId.trim(), domains: lines(f.domains), appIdentifiers: lines(f.appIds), testOrigins: lines(f.testOrigins),
            platforms: [...f.platforms], campaignEligibility: { internal: f.internal, external: f.external },
          }));
          if (r) { onClose(); navigate(`publishers/${r.id}`); }
        }}>Register</Button>
      </>
    }>
      <div className="form-grid">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="HCG product id" hint="e.g. hcg.store"><input className="input mono" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} /></Field>
        <Field label="Domains" hint="One per line. Live delivery only answers these."><textarea className="input mono" rows={3} value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} placeholder="store.hakmicapitalgroup.com" /></Field>
        <Field label="App identifiers" hint="Bundle / package ids"><textarea className="input mono" rows={3} value={f.appIds} onChange={(e) => setF({ ...f, appIds: e.target.value })} placeholder="com.hakmi.store" /></Field>
        <Field label="Test origins" hint="Origins that receive test delivery"><textarea className="input mono" rows={3} value={f.testOrigins} onChange={(e) => setF({ ...f, testOrigins: e.target.value })} placeholder="http://localhost:3000" /></Field>
        <Field label="Campaigns accepted">
          <div className="stack-tight">
            <label className="radio"><input type="checkbox" checked={f.internal} onChange={(e) => setF({ ...f, internal: e.target.checked })} /> Internal HCG promotions</label>
            <label className="radio"><input type="checkbox" checked={f.external} onChange={(e) => setF({ ...f, external: e.target.checked })} /> External advertisers</label>
          </div>
        </Field>
        <Field label="Platforms" wide>
          <div className="row wrap">
            {PLATFORMS.map((p) => (
              <label key={p} className={`pill ${f.platforms.has(p) ? "pill-on" : ""}`}>
                <input type="checkbox" checked={f.platforms.has(p)} onChange={() => { const s = new Set(f.platforms); if (s.has(p)) s.delete(p); else s.add(p); setF({ ...f, platforms: s }); }} /> {p}
              </label>
            ))}
          </div>
        </Field>
      </div>
      <ErrorBox error={act.error} onClose={act.clear} />
    </Modal>
  );
}

function LiveMode({ p, onClose }: { p: Publisher; onClose: () => void }) {
  const [text, setText] = useState("");
  const act = useAction();
  const phrase = `ENABLE LIVE ${p.name}`;
  return (
    <Modal title="Enable live delivery" onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" busy={act.busy} disabled={text !== phrase} onClick={async () => {
          const r = await act.run(() => api.post(`/publishers/${p.id}/delivery-mode`, { mode: "live", confirmation: text }));
          if (r) onClose();
        }}>Enable live delivery</Button>
      </>
    }>
      <div className="stack">
        <Notice tone="danger">
          <strong>Live delivery puts advertisements on the real website and apps of {p.name}.</strong> Readers on {p.domains.join(", ") || "its registered domains"} will see every active campaign assigned to its placements. Only the founder can approve this.
        </Notice>
        <Field label={`Type ${phrase} to confirm`}><input className="input mono" value={text} onChange={(e) => setText(e.target.value)} autoFocus /></Field>
        <ErrorBox error={act.error} />
      </div>
    </Modal>
  );
}

function PublisherDetail({ id }: { id: string }) {
  const can = useCan();
  const session = useSession();
  const { data: p, error, loading } = useLoad<Publisher & { placements: Placement[] }>(`/publishers/${id}`, [id]);
  const act = useAction();
  const confirm = useConfirm();
  const [live, setLive] = useState(false);
  if (loading && !p) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!p) return null;
  const setStatus = async (status: string, label: string, danger = false) => {
    const r = await confirm.ask({ title: `${label} ${p.name}`, body: status === "suspended" ? "Suspended publishers receive no advertisements at all." : `The publisher becomes ${status}.`, confirmLabel: label, danger, noteLabel: "Note" });
    if (r.ok) await act.run(() => api.post(`/publishers/${p.id}/status`, { status, note: r.note || undefined }));
  };
  const isFounder = session.principal.roles.includes("founder");
  return (
    <Panel title={<>{p.name} <Chip value={p.status} /> <Chip value={p.deliveryMode} label={p.deliveryMode === "live" ? "LIVE" : "TEST"} /></>}
      subtitle={<span className="mono">{p.productId}{p.isInternal ? " · HCG internal" : ""}</span>}
      actions={<div className="row wrap">
        {p.status !== "active" && <Button small variant="primary" disabled={!can("publishers.approve")} busy={act.busy} onClick={() => setStatus("active", "Approve")}>Approve</Button>}
        {p.status === "active" && <Button small variant="danger" disabled={!can("publishers.write")} busy={act.busy} onClick={() => setStatus("suspended", "Suspend", true)}>Suspend</Button>}
        {p.status === "pending" && <Button small variant="danger" disabled={!can("publishers.approve")} onClick={() => setStatus("rejected", "Reject", true)}>Reject</Button>}
      </div>}>
      <ErrorBox error={act.error} onClose={act.clear} />
      <div className={`mode-card ${p.deliveryMode === "live" ? "mode-live" : ""}`}>
        <div className="grow">
          <div className="mode-title">{p.deliveryMode === "live" ? "LIVE delivery" : "TEST delivery"}</div>
          <div className="muted small">
            {p.deliveryMode === "live"
              ? `Advertisements are shown to real readers. Approved by ${p.liveApprovedBy ?? "—"} ${p.liveApprovedAt ? fmt.dateTime(p.liveApprovedAt) : ""}.`
              : "Advertisements are delivered only to the registered test origins below. The real website shows nothing."}
          </div>
        </div>
        {p.deliveryMode === "test"
          ? <Button variant="danger" disabled={!isFounder || p.status !== "active"} title={!isFounder ? "Only the founder can enable live delivery" : undefined} onClick={() => setLive(true)}>Enable live…</Button>
          : <Button disabled={!can("publishers.approve")} busy={act.busy} onClick={() => act.run(() => api.post(`/publishers/${p.id}/delivery-mode`, { mode: "test" }))}>Return to test mode</Button>}
      </div>
      <dl className="dl dl-wide">
        <dt>Domains</dt><dd>{p.domains.length ? p.domains.map((d) => <code key={d} className="tag">{d}</code>) : <span className="muted">None</span>}</dd>
        <dt>App identifiers</dt><dd>{p.appIdentifiers.length ? p.appIdentifiers.map((d) => <code key={d} className="tag">{d}</code>) : <span className="muted">None</span>}</dd>
        <dt>Test origins</dt><dd>{p.testOrigins.length ? p.testOrigins.map((d) => <code key={d} className="tag">{d}</code>) : <span className="muted">None</span>}</dd>
        <dt>Platforms</dt><dd>{p.platforms.join(", ")}</dd>
        <dt>Formats</dt><dd>{p.supportedFormats.join(", ")}</dd>
        <dt>Accepts</dt><dd>{[p.campaignEligibility.internal && "Internal promotions", p.campaignEligibility.external && "External advertisers"].filter(Boolean).join(" · ") || "Nothing"}</dd>
      </dl>
      <h4 className="section-title">Placements ({p.placements.length})</h4>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Placement</th><th>Size</th><th>Platform</th><th>Status</th></tr></thead>
          <tbody>{p.placements.map((pl) => <tr key={pl.id}><td>{pl.name}<div className="muted small mono">{pl.slot}</div></td><td>{fmt.size(pl.width, pl.height)}</td><td>{pl.platform}</td><td><Chip value={pl.status} /></td></tr>)}</tbody>
        </table>
      </div>
      <a className="btn btn-subtle btn-sm" href="#/placements">Manage placements →</a>
      {confirm.element}
      {live && <LiveMode p={p} onClose={() => setLive(false)} />}
    </Panel>
  );
}

export function Publishers({ selected }: { selected?: string }) {
  const can = useCan();
  const { data, error, loading } = useLoad<{ publishers: Publisher[] }>("/publishers");
  const [creating, setCreating] = useState(false);
  const current = selected ?? data?.publishers[0]?.id;
  return (
    <div className="page">
      <PageHeader title="Publishers" kicker="Websites and apps that show HCG ADS">
        <Button variant="primary" disabled={!can("publishers.write")} onClick={() => setCreating(true)}><Icon name="plus" /> Register publisher</Button>
      </PageHeader>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !data?.publishers.length ? (
        <Panel><Empty title="No publishers yet">Connect HCG News under Content Sources — it is registered as the first publisher automatically.</Empty></Panel>
      ) : (
        <div className="split">
          <div className="split-list">
            {data.publishers.map((p) => (
              <a key={p.id} href={`#/publishers/${p.id}`} className={`list-card ${current === p.id ? "list-card-on" : ""}`}>
                <b>{p.name}</b>
                <small>{p.domains[0] ?? p.productId}</small>
                <span className="row"><Chip value={p.status} /><Chip value={p.deliveryMode} label={p.deliveryMode === "live" ? "LIVE" : "TEST"} /></span>
              </a>
            ))}
          </div>
          <div className="split-main">{current && <PublisherDetail id={current} />}</div>
        </div>
      )}
      {creating && <RegisterPublisher onClose={() => setCreating(false)} />}
    </div>
  );
}
