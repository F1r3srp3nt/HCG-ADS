import { useRef, useState } from "react";
import type { Advertiser, MediaAsset, Placement } from "@hcg-ads/contracts";
import { api, ApiError, fmt, uploadWithProgress } from "../api";
import { useCan } from "../App";
import { Icon } from "../components/Icon";
import { Button, Chip, Empty, ErrorBox, Loading, Modal, Notice, PageHeader, Panel, useAction, useConfirm, useLoad } from "../components/ui";

export type MediaView = MediaAsset & { previewUrl: string; thumbnailUrl: string | null; publicUrl: string | null };
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm";

interface UploadJob { id: number; name: string; progress: number; error: ApiError | null; done: boolean }

export function MediaThumb({ m, className = "" }: { m: MediaView; className?: string }) {
  if (m.metadata.kind === "video") {
    return m.thumbnailUrl ? <img src={m.thumbnailUrl} alt="" className={className} /> : <video src={m.previewUrl} muted playsInline preload="metadata" className={className} />;
  }
  return <img src={m.thumbnailUrl ?? m.previewUrl} alt="" className={className} loading="lazy" />;
}

function MediaDetail({ m, placements, onClose, onNewVersion }: { m: MediaView; placements: Placement[]; onClose: () => void; onNewVersion: () => void }) {
  const can = useCan();
  const act = useAction();
  const confirm = useConfirm();
  const md = m.metadata;
  const compatible = placements.filter((p) => m.compatiblePlacementIds.includes(p.id));
  const incompatible = placements.filter((p) => !m.compatiblePlacementIds.includes(p.id));
  return (
    <Modal wide title={m.filename} onClose={onClose} footer={
      <>
        <Button variant="danger" disabled={!can("media.delete")} busy={act.busy} onClick={async () => {
          const r = await confirm.ask({ title: "Delete media", body: "Media used by a campaign that can still run cannot be deleted. Deleted media is purged after the retention period.", confirmLabel: "Delete", danger: true });
          if (r.ok) { const ok = await act.run(() => api.del(`/media/${m.id}`).then(() => true)); if (ok) onClose(); }
        }}>Delete</Button>
        <span className="grow" />
        <Button disabled={!can("media.write")} onClick={onNewVersion}><Icon name="upload" /> Upload new version</Button>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </>
    }>
      <ErrorBox error={act.error} onClose={act.clear} />
      <div className="media-detail">
        <div className="media-stage">
          {md.kind === "video"
            ? <video src={m.previewUrl} poster={m.thumbnailUrl ?? undefined} controls muted playsInline />
            : <img src={m.previewUrl} alt={m.filename} />}
        </div>
        <div className="stack">
          <div className="row wrap"><Chip value={m.status === "approved" ? "active" : m.status} label={m.status} /><Chip tone="slate" label={md.kind} /><Chip tone="dim" label={`v${m.version}`} /><Chip tone="dim" label={m.visibility} /></div>
          <dl className="dl">
            <dt>Type</dt><dd className="mono">{md.mime}</dd>
            <dt>Dimensions</dt><dd>{fmt.size(md.width, md.height)}{md.aspectRatio ? ` · ${md.aspectRatio}` : ""}</dd>
            <dt>File size</dt><dd>{fmt.bytes(m.bytes)}</dd>
            {md.durationSeconds != null && <><dt>Duration</dt><dd>{md.durationSeconds.toFixed(1)} s</dd></>}
            <dt>Animated</dt><dd>{md.animated ? `Yes${md.frameCount ? ` · ${md.frameCount} frames` : ""}` : "No"}</dd>
            {md.videoCodec && <><dt>Codec</dt><dd>{md.videoCodec}{md.hasAudio ? " · with audio (muted by default)" : ""}</dd></>}
            <dt>Storage</dt><dd>{m.storageProvider}</dd>
            <dt>Uploaded</dt><dd>{fmt.dateTime(m.createdAt)}</dd>
            <dt>SHA-256</dt><dd className="mono small ellipsis" title={m.sha256}>{m.sha256.slice(0, 24)}…</dd>
          </dl>
          {m.problems.length > 0 && <Notice tone="warn"><strong>Problems</strong><ul className="problems">{m.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></Notice>}
          <div>
            <div className="section-title">Fits {compatible.length} of {placements.length} placements</div>
            <div className="row wrap">
              {compatible.map((p) => <span key={p.id} className="chip chip-green">{p.name} · {fmt.size(p.width, p.height)}</span>)}
              {incompatible.map((p) => <span key={p.id} className="chip chip-dim" title="Wrong format, size, ratio or file size">{p.name} · {fmt.size(p.width, p.height)}</span>)}
            </div>
          </div>
        </div>
      </div>
      {confirm.element}
    </Modal>
  );
}

export function MediaLibrary() {
  const can = useCan();
  const { data, error, loading } = useLoad<{ assets: MediaView[]; processor: { name: string }; storage: string }>("/media");
  const placements = useLoad<{ placements: Placement[] }>("/placements");
  const advertisers = useLoad<{ advertisers: Advertiser[] }>("/advertisers");
  const [advertiserId, setAdvertiserId] = useState("");
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [drag, setDrag] = useState(false);
  const [open, setOpen] = useState<MediaView | null>(null);
  const [versionOf, setVersionOf] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const upload = (files: FileList | File[], previousVersionId?: string) => {
    for (const file of Array.from(files)) {
      const id = ++seq.current;
      setJobs((j) => [{ id, name: file.name, progress: 0, error: null, done: false }, ...j]);
      const form = new FormData();
      form.append("file", file);
      if (advertiserId) form.append("advertiserId", advertiserId);
      if (previousVersionId) form.append("previousVersionId", previousVersionId);
      uploadWithProgress<MediaView>("/media", form, (p) => setJobs((j) => j.map((x) => (x.id === id ? { ...x, progress: p } : x))))
        .then(() => {
          setJobs((j) => j.map((x) => (x.id === id ? { ...x, progress: 1, done: true } : x)));
          setTimeout(() => setJobs((j) => j.filter((x) => x.id !== id)), 2500);
        })
        .catch((e: ApiError) => setJobs((j) => j.map((x) => (x.id === id ? { ...x, error: e } : x))));
    }
  };

  const assets = (data?.assets ?? []).filter((a) => a.status !== "deleted").filter((a) => filter === "all" || (filter === "video" ? a.metadata.kind === "video" : a.metadata.kind !== "video"));
  const pls = placements.data?.placements ?? [];
  return (
    <div className="page">
      <PageHeader title="Media Library" kicker={`Storage: ${data?.storage ?? "…"} · processing: ${data?.processor.name ?? "…"}`}>
        <select className="input" value={advertiserId} onChange={(e) => setAdvertiserId(e.target.value)} aria-label="Owner">
          <option value="">Owner: HCG (internal)</option>
          {(advertisers.data?.advertisers ?? []).filter((a) => a.kind === "external").map((a) => <option key={a.id} value={a.id}>Owner: {a.name}</option>)}
        </select>
      </PageHeader>

      <div className={`dropzone ${drag ? "dropzone-on" : ""} ${!can("media.write") ? "dropzone-off" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (can("media.write")) upload(e.dataTransfer.files); }}
        onClick={() => can("media.write") && input.current?.click()} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}>
        <Icon name="upload" size={28} />
        <div><b>Drop images or video here</b>, or click to choose</div>
        <div className="muted small">PNG · JPEG · WebP · GIF · MP4 · WebM. Files are inspected, validated and stored privately until a campaign using them is approved.</div>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
      </div>
      <input id="version-input" type="file" accept={ACCEPT} hidden onChange={(e) => { if (e.target.files && versionOf) upload(e.target.files, versionOf); e.target.value = ""; setVersionOf(null); }} />

      {jobs.length > 0 && (
        <div className="jobs">
          {jobs.map((j) => (
            <div key={j.id} className={`job ${j.error ? "job-error" : j.done ? "job-done" : ""}`}>
              <div className="row"><b className="grow ellipsis">{j.name}</b><span className="small">{j.error ? "Refused" : j.done ? "Uploaded" : `${Math.round(j.progress * 100)}%`}</span>
                {j.error && <button className="alert-x" onClick={() => setJobs((x) => x.filter((y) => y.id !== j.id))} aria-label="Dismiss">×</button>}</div>
              <div className="progress"><div style={{ width: `${j.progress * 100}%` }} /></div>
              {j.error && <ErrorBox error={j.error} />}
            </div>
          ))}
        </div>
      )}

      <Panel title={`${assets.length} asset(s)`} actions={
        <div className="tabs">
          {(["all", "image", "video"] as const).map((k) => <button key={k} className={`tab ${filter === k ? "tab-on" : ""}`} onClick={() => setFilter(k)}>{k === "all" ? "All" : k === "image" ? "Images" : "Video"}</button>)}
        </div>
      }>
        <ErrorBox error={error} />
        {loading && !data ? <Loading /> : assets.length === 0 ? <Empty title="No media yet">Upload images or video to use them in creatives.</Empty> : (
          <div className="media-grid">
            {assets.map((m) => (
              <button key={m.id} className="media-card" onClick={() => setOpen(m)}>
                <div className="media-thumb"><MediaThumb m={m} />{m.metadata.kind === "video" && <span className="media-badge">▶ {m.metadata.durationSeconds?.toFixed(0)}s</span>}{m.metadata.animated && m.metadata.kind !== "video" && <span className="media-badge">GIF</span>}</div>
                <div className="media-info">
                  <b className="ellipsis">{m.filename}</b>
                  <small>{fmt.size(m.metadata.width, m.metadata.height)} · {fmt.bytes(m.bytes)} · v{m.version}</small>
                  <span className="row"><Chip value={m.status === "approved" ? "active" : m.status} label={m.status} /><span className="small muted">fits {m.compatiblePlacementIds.length}</span>{m.problems.length > 0 && <Chip tone="amber" label={`${m.problems.length} issue(s)`} />}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>
      {open && <MediaDetail m={open} placements={pls} onClose={() => setOpen(null)} onNewVersion={() => { setVersionOf(open.id); setOpen(null); setTimeout(() => (document.getElementById("version-input") as HTMLInputElement | null)?.click(), 0); }} />}
    </div>
  );
}
