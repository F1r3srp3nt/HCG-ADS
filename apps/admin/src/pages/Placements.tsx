import { useState } from "react";
import type { MediaKind, Placement, Platform, Publisher, StandardFormat } from "@hcg-ads/contracts";
import { api, fmt } from "../api";
import { useCan } from "../App";
import { Icon } from "../components/Icon";
import { Button, Chip, Copy, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Panel, useAction, useLoad } from "../components/ui";
import { shapeStyle } from "./ContentSources";

const KINDS: MediaKind[] = ["image", "animated-image", "video", "native"];
const PLATFORMS: Platform[] = ["web", "ios", "android", "macos", "windows", "linux", "desktop"];

function embedSnippet(p: Placement) {
  return `<script src="${location.origin}/delivery/v1/sdk/hcg-ads.js" async></script>\n<div data-hcg-ads-placement="${p.publicKey}"></div>`;
}

function CreatePlacement({ publishers, onClose }: { publishers: Publisher[]; onClose: () => void }) {
  const formats = useLoad<{ formats: StandardFormat[] }>("/formats");
  const [f, setF] = useState({
    publisherId: publishers[0]?.id ?? "", name: "", slot: "", platform: "web" as Platform, preset: "medium-rectangle",
    width: "300", height: "250", responsive: "fixed" as Placement["responsive"], formats: new Set<MediaKind>(["image", "native"]),
    maxFileMb: "2", maxVideoSeconds: "30", allowAnimation: true, internalEligible: true, externalEligible: false, fallback: "collapse" as Placement["fallback"],
  });
  const act = useAction();
  const choosePreset = (id: string) => {
    if (id === "custom") return setF({ ...f, preset: id, responsive: "fixed" });
    if (id === "native") return setF({ ...f, preset: id, responsive: "responsive-native", width: "", height: "", formats: new Set(["native"]) });
    const s = formats.data?.formats.find((x) => x.id === id);
    if (s) setF({ ...f, preset: id, width: String(s.width), height: String(s.height), responsive: "fixed", name: f.name || s.name });
  };
  const native = f.responsive === "responsive-native";
  return (
    <Modal wide title="New placement" onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.busy} disabled={!f.publisherId || f.name.trim().length < 2 || !f.slot} onClick={async () => {
          const r = await act.run(() => api.post(`/publishers/${f.publisherId}/placements`, {
            name: f.name.trim(), slot: f.slot, platform: f.platform, width: native ? null : Number(f.width) || null, height: native ? null : Number(f.height) || null,
            responsive: f.responsive, formats: [...f.formats], maxFileBytes: Math.round(Number(f.maxFileMb || 2) * 1024 * 1024),
            maxVideoSeconds: Number(f.maxVideoSeconds || 30), allowAnimation: f.allowAnimation, internalEligible: f.internalEligible,
            externalEligible: f.externalEligible, fallback: f.fallback,
          }));
          if (r) onClose();
        }}>Create placement</Button>
      </>
    }>
      <div className="stack">
        <div className="preset-grid">
          {(formats.data?.formats ?? []).map((s) => (
            <button key={s.id} className={`preset ${f.preset === s.id ? "preset-on" : ""}`} onClick={() => choosePreset(s.id)} type="button">
              <span className="pick-shape" style={shapeStyle(s)} />
              <b>{s.name}</b><small>{s.width} × {s.height}</small>
            </button>
          ))}
          <button className={`preset ${f.preset === "native" ? "preset-on" : ""}`} onClick={() => choosePreset("native")} type="button"><span className="pick-shape" style={shapeStyle({ width: null, height: null })} /><b>Responsive native</b><small>fits the layout</small></button>
          <button className={`preset ${f.preset === "custom" ? "preset-on" : ""}`} onClick={() => choosePreset("custom")} type="button"><span className="pick-shape" style={{ width: 26, height: 18 }} /><b>Custom size</b><small>any W × H</small></button>
        </div>
        <div className="form-grid">
          <Field label="Publisher">
            <select className="input" value={f.publisherId} onChange={(e) => setF({ ...f, publisherId: e.target.value })}>
              {publishers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Slot id" hint="Lowercase, digits, hyphens — e.g. article-sidebar"><input className="input mono" value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></Field>
          <Field label="Platform">
            <select className="input" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value as Platform })}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select>
          </Field>
          {!native && <>
            <Field label="Width (px)"><input className="input" inputMode="numeric" value={f.width} onChange={(e) => setF({ ...f, width: e.target.value.replace(/\D/g, ""), preset: "custom" })} /></Field>
            <Field label="Height (px)"><input className="input" inputMode="numeric" value={f.height} onChange={(e) => setF({ ...f, height: e.target.value.replace(/\D/g, ""), preset: "custom" })} /></Field>
          </>}
          <Field label="Responsive behaviour">
            <select className="input" value={f.responsive} onChange={(e) => setF({ ...f, responsive: e.target.value as Placement["responsive"] })}>
              <option value="fixed">Fixed size</option><option value="fluid-width">Fluid width, fixed ratio</option><option value="responsive-native">Responsive native</option>
            </select>
          </Field>
          <Field label="When there is no advertisement">
            <select className="input" value={f.fallback} onChange={(e) => setF({ ...f, fallback: e.target.value as Placement["fallback"] })}>
              <option value="collapse">Collapse (take no space)</option><option value="keep-space">Keep the space empty</option><option value="house-ad">Show an HCG house promotion</option>
            </select>
          </Field>
          <Field label="Max file size (MB)"><input className="input" inputMode="decimal" value={f.maxFileMb} onChange={(e) => setF({ ...f, maxFileMb: e.target.value })} /></Field>
          <Field label="Max video length (s)"><input className="input" inputMode="numeric" value={f.maxVideoSeconds} onChange={(e) => setF({ ...f, maxVideoSeconds: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Formats" wide>
            <div className="row wrap">
              {KINDS.map((k) => (
                <label key={k} className={`pill ${f.formats.has(k) ? "pill-on" : ""}`}>
                  <input type="checkbox" checked={f.formats.has(k)} onChange={() => { const s = new Set(f.formats); if (s.has(k)) s.delete(k); else s.add(k); setF({ ...f, formats: s }); }} /> {k}
                </label>
              ))}
              <label className="pill"><input type="checkbox" checked={f.allowAnimation} onChange={(e) => setF({ ...f, allowAnimation: e.target.checked })} /> allow animation</label>
            </div>
          </Field>
          <Field label="Eligible campaigns" wide>
            <div className="row wrap">
              <label className="radio"><input type="checkbox" checked={f.internalEligible} onChange={(e) => setF({ ...f, internalEligible: e.target.checked })} /> Internal HCG promotions</label>
              <label className="radio"><input type="checkbox" checked={f.externalEligible} onChange={(e) => setF({ ...f, externalEligible: e.target.checked })} /> External advertisers</label>
            </div>
          </Field>
        </div>
        <ErrorBox error={act.error} onClose={act.clear} />
      </div>
    </Modal>
  );
}

function PlacementRow({ p }: { p: Placement }) {
  const can = useCan();
  const act = useAction();
  const [embed, setEmbed] = useState(false);
  return (
    <>
      <tr>
        <td><div className="row"><span className="pick-shape" style={shapeStyle(p)} aria-hidden /><div><b>{p.name}</b><div className="muted small mono">{p.slot} · {p.platform}</div></div></div></td>
        <td>{fmt.size(p.width, p.height)}<div className="muted small">{p.aspectRatio ?? p.responsive}</div></td>
        <td className="small">{p.formats.join(", ")}<div className="muted">≤ {fmt.bytes(p.maxFileBytes)}{p.formats.includes("video") ? ` · ≤ ${p.maxVideoSeconds}s` : ""}</div></td>
        <td className="small">{p.internalEligible && <Chip value="internal" />} {p.externalEligible && <Chip value="external" />}</td>
        <td className="small">{p.fallback}</td>
        <td><div className="row"><code className="tag">{p.publicKey}</code><Copy text={p.publicKey} /></div></td>
        <td><Chip value={p.status} /></td>
        <td>
          <div className="row">
            <Button small variant="subtle" onClick={() => setEmbed(!embed)}>{embed ? "Hide" : "Embed"}</Button>
            <Button small busy={act.busy} disabled={!can("placements.write")} onClick={() => act.run(() => api.post(`/placements/${p.id}/status`, { status: p.status === "active" ? "paused" : "active" }))}>
              {p.status === "active" ? "Pause" : "Activate"}
            </Button>
          </div>
        </td>
      </tr>
      {(embed || act.error) && (
        <tr className="subrow">
          <td colSpan={8}>
            <ErrorBox error={act.error} onClose={act.clear} />
            {embed && (
              <div className="embed">
                <div className="row"><b className="grow">Web embed</b><Copy text={embedSnippet(p)} label="Copy snippet" /></div>
                <pre className="code">{embedSnippet(p)}</pre>
                <p className="muted small">The public key is not a secret. Delivery only answers the publisher's registered domains (live) or test origins (test).</p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function Placements() {
  const can = useCan();
  const placements = useLoad<{ placements: Placement[] }>("/placements");
  const publishers = useLoad<{ publishers: Publisher[] }>("/publishers");
  const [creating, setCreating] = useState(false);
  const pubs = publishers.data?.publishers ?? [];
  const grouped = pubs.map((p) => ({ p, list: (placements.data?.placements ?? []).filter((x) => x.publisherId === p.id) }));
  return (
    <div className="page">
      <PageHeader title="Placements" kicker="Where advertisements can appear">
        <Button variant="primary" disabled={!can("placements.write") || pubs.length === 0} onClick={() => setCreating(true)}><Icon name="plus" /> New placement</Button>
      </PageHeader>
      <ErrorBox error={placements.error ?? publishers.error} />
      {(placements.loading && !placements.data) ? <Loading /> : grouped.length === 0 ? (
        <Panel><Empty title="No publishers yet">Connect HCG News under Content Sources to register its standard placements.</Empty></Panel>
      ) : grouped.map(({ p, list }) => (
        <Panel key={p.id} title={<>{p.name} <Chip value={p.deliveryMode} label={p.deliveryMode === "live" ? "LIVE" : "TEST"} /></>} subtitle={`${list.length} placement(s) · ${p.domains.join(", ") || p.productId}`}>
          {list.length === 0 ? <p className="muted">No placements.</p> : (
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>Placement</th><th>Size</th><th>Formats</th><th>Eligible</th><th>Fallback</th><th>Public key</th><th>Status</th><th /></tr></thead>
                <tbody>{list.map((pl) => <PlacementRow key={pl.id} p={pl} />)}</tbody>
              </table>
            </div>
          )}
        </Panel>
      ))}
      {creating && <CreatePlacement publishers={pubs} onClose={() => setCreating(false)} />}
    </div>
  );
}
