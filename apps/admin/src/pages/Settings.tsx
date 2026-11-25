import { useEffect, useState } from "react";
import { api, fmt, getToken, setToken } from "../api";
import { useCan, useSession } from "../App";
import { Button, Chip, ErrorBox, Field, Loading, Notice, PageHeader, Panel, useAction, useLoad } from "../components/ui";
import { EmergencyControl } from "./CommandCenter";

interface Settings {
  emergencyShutdown: { active: boolean; reason: string | null; at: string | null; by: string | null };
  analyticsRetentionDays: number;
  mediaRetentionDays: number;
  defaultConsent: { storage: boolean; measurement: boolean };
  disclosureLabels: string[];
  blockedPhrases: string[];
  maxImageBytes: number;
  maxVideoBytes: number;
  maxVideoSeconds: number;
  defaultAdvertiserQuotaBytes: number;
}
interface AuditEntry { id: string; at: string; actor: { subject: string; name: string; authority: string }; action: string; entityType: string; entityId: string | null; summary: string }

const MB = 1024 * 1024;

function SettingsForm({ s }: { s: Settings }) {
  const can = useCan();
  const editable = can("settings.write");
  const init = () => ({
    analyticsRetentionDays: String(s.analyticsRetentionDays), mediaRetentionDays: String(s.mediaRetentionDays),
    storage: s.defaultConsent.storage, measurement: s.defaultConsent.measurement,
    disclosureLabels: s.disclosureLabels.join("\n"), blockedPhrases: s.blockedPhrases.join("\n"),
    maxImageMb: String(s.maxImageBytes / MB), maxVideoMb: String(s.maxVideoBytes / MB), maxVideoSeconds: String(s.maxVideoSeconds),
    quotaMb: String(s.defaultAdvertiserQuotaBytes / MB),
  });
  const [f, setF] = useState(init);
  useEffect(() => setF(init()), [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = useAction();
  const [saved, setSaved] = useState(false);
  const list = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    setSaved(false);
    const r = await act.run(() => api.patch("/settings", {
      analyticsRetentionDays: Number(f.analyticsRetentionDays), mediaRetentionDays: Number(f.mediaRetentionDays),
      defaultConsent: { storage: f.storage, measurement: f.measurement },
      disclosureLabels: list(f.disclosureLabels), blockedPhrases: list(f.blockedPhrases),
      maxImageBytes: Math.round(Number(f.maxImageMb) * MB), maxVideoBytes: Math.round(Number(f.maxVideoMb) * MB),
      maxVideoSeconds: Number(f.maxVideoSeconds), defaultAdvertiserQuotaBytes: Math.round(Number(f.quotaMb) * MB),
    }));
    if (r) setSaved(true);
  };
  return (
    <Panel title="Governance settings" subtitle="Changes are recorded in the audit log." actions={editable && <Button variant="primary" busy={act.busy} onClick={save}>Save settings</Button>}>
      <fieldset disabled={!editable} className="stack">
        <h4 className="section-title">Privacy & retention</h4>
        <div className="form-grid">
          <Field label="Analytics retention (days)" hint="Measured events older than this are deleted"><input className="input" inputMode="numeric" value={f.analyticsRetentionDays} onChange={(e) => setF({ ...f, analyticsRetentionDays: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Deleted media retention (days)" hint="Then purged from storage"><input className="input" inputMode="numeric" value={f.mediaRetentionDays} onChange={(e) => setF({ ...f, mediaRetentionDays: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Default consent" hint="Used when a publisher sends no consent signal">
            <div className="stack-tight">
              <label className="radio"><input type="checkbox" checked={f.measurement} onChange={(e) => setF({ ...f, measurement: e.target.checked })} /> Aggregate measurement</label>
              <label className="radio"><input type="checkbox" checked={f.storage} onChange={(e) => setF({ ...f, storage: e.target.checked })} /> On-device frequency storage</label>
            </div>
          </Field>
        </div>
        <h4 className="section-title">Disclosure & safety</h4>
        <div className="form-grid">
          <Field label="Disclosure labels" hint="One per line. Every advertisement shows one of these."><textarea className="input" rows={6} value={f.disclosureLabels} onChange={(e) => setF({ ...f, disclosureLabels: e.target.value })} /></Field>
          <Field label="Blocked phrases" hint="Creatives imitating system or security prompts are refused"><textarea className="input" rows={6} value={f.blockedPhrases} onChange={(e) => setF({ ...f, blockedPhrases: e.target.value })} /></Field>
        </div>
        <h4 className="section-title">Upload limits</h4>
        <div className="form-grid">
          <Field label="Max image size (MB)"><input className="input" inputMode="decimal" value={f.maxImageMb} onChange={(e) => setF({ ...f, maxImageMb: e.target.value })} /></Field>
          <Field label="Max video size (MB)"><input className="input" inputMode="decimal" value={f.maxVideoMb} onChange={(e) => setF({ ...f, maxVideoMb: e.target.value })} /></Field>
          <Field label="Max video length (s)"><input className="input" inputMode="numeric" value={f.maxVideoSeconds} onChange={(e) => setF({ ...f, maxVideoSeconds: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Default advertiser quota (MB)"><input className="input" inputMode="decimal" value={f.quotaMb} onChange={(e) => setF({ ...f, quotaMb: e.target.value })} /></Field>
        </div>
      </fieldset>
      <ErrorBox error={act.error} onClose={act.clear} />
      {saved && <Notice tone="ok">Settings saved.</Notice>}
    </Panel>
  );
}

export function Settings() {
  const session = useSession();
  const can = useCan();
  const settings = useLoad<Settings>("/settings");
  const audit = useLoad<{ entries: AuditEntry[] }>(can("audit.read") ? "/audit?limit=100" : null);
  const retention = useAction();
  const [retResult, setRetResult] = useState<string | null>(null);
  const p = session.principal;
  return (
    <div className="page">
      <PageHeader title="Settings" kicker="Governance · identity · audit" />
      <div className="grid-2">
        <Panel title="Your session" subtitle={session.identity.label}>
          <dl className="dl">
            <dt>Name</dt><dd>{p.displayName}</dd>
            <dt>Account</dt><dd className="mono">{p.subject}</dd>
            {p.email && <><dt>Email</dt><dd>{p.email}</dd></>}
            <dt>Authority</dt><dd><Chip value={p.authority === "development" ? "development" : "connected"} label={p.authority === "development" ? "Local development" : "HCG Connect"} /></dd>
            <dt>Roles</dt><dd>{p.roles.map((r) => <span key={r} className="chip chip-violet">{session.roleLabels[r] ?? r}</span>)}</dd>
            <dt>Permissions</dt><dd className="small muted">{p.permissions.length} operations</dd>
            <dt>Environment</dt><dd>{session.environment} · v{session.version}</dd>
          </dl>
          {session.identity.problems.length > 0 && <ul className="problems small">{session.identity.problems.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          {getToken() && <Button small onClick={() => { setToken(null); location.reload(); }}>Sign out (forget token)</Button>}
        </Panel>
        <Panel title="Emergency control">
          {settings.data && <EmergencyControl emergency={settings.data.emergencyShutdown} />}
          {can("settings.write") && (
            <div className="row wrap" style={{ marginTop: 14 }}>
              <Button busy={retention.busy} onClick={async () => {
                const r = await retention.run(() => api.post<{ eventsDeleted: number; mediaPurged: number }>("/maintenance/retention"));
                if (r) setRetResult(`Deleted ${r.eventsDeleted} expired event(s) and purged ${r.mediaPurged} deleted media file(s).`);
              }}>Run retention now</Button>
              {retResult && <span className="small muted">{retResult}</span>}
            </div>
          )}
          <ErrorBox error={retention.error} onClose={retention.clear} />
        </Panel>
      </div>
      <ErrorBox error={settings.error} />
      {settings.loading && !settings.data ? <Loading /> : settings.data && <SettingsForm s={settings.data} />}
      {can("audit.read") && (
        <Panel title="Audit log" subtitle="Last 100 governance-relevant actions">
          <ErrorBox error={audit.error} />
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Summary</th></tr></thead>
              <tbody>
                {(audit.data?.entries ?? []).map((a) => (
                  <tr key={a.id}>
                    <td className="small nowrap">{fmt.dateTime(a.at)}</td>
                    <td className="small">{a.actor.name}{a.actor.authority === "development" && <span className="muted"> (dev)</span>}</td>
                    <td><code className="tag">{a.action}</code></td>
                    <td className="small">{a.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
