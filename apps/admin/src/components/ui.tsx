import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, onMutation } from "../api";

// ---- Routing (hash based) -------------------------------------------------

export function useRoute(): string[] {
  const read = () => (window.location.hash.replace(/^#\/?/, "") || "command-center").split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const h = () => setRoute(read());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return route;
}
export function navigate(path: string) {
  window.location.hash = "#/" + path.replace(/^\//, "");
}

// ---- Data loading ------------------------------------------------------------

export interface Loaded<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/** Loads a GET endpoint; reloads after any successful write anywhere in the app. */
export function useLoad<T>(path: string | null, deps: unknown[] = []): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) { setLoading(false); return; }
    const n = ++seq.current;
    setLoading(true);
    api.get<T>(path)
      .then((d) => { if (n === seq.current) { setData(d); setError(null); } })
      .catch((e: ApiError) => { if (n === seq.current) setError(e); })
      .finally(() => { if (n === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onMutation(load), [load]);
  return { data, error, loading, reload: load };
}

/** Wraps an action: tracks busy state and the last error. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "error", (e as Error).message));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: () => setError(null) };
}

// ---- Primitives -----------------------------------------------------------

export function Panel({ title, subtitle, actions, children, className = "", tone }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; tone?: "danger" | "warn" }) {
  return (
    <section className={`panel ${tone ? `panel-${tone}` : ""} ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div>
            {title && <h2 className="panel-title">{title}</h2>}
            {subtitle && <p className="panel-sub">{subtitle}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, kicker, children }: { title: string; kicker?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-main">
        {kicker && <div className="kicker">{kicker}</div>}
        <h1 className={`page-title ${title.length > 48 ? "page-title-long" : ""}`}>{title}</h1>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "subtle" | "violet"; busy?: boolean; small?: boolean };
export function Button({ variant = "ghost", busy, small, children, className = "", disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant} ${small ? "btn-sm" : ""} ${className}`} disabled={disabled || busy} {...rest}>
      {busy && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

const STATE_TONE: Record<string, string> = {
  draft: "slate", pending_approval: "amber", approved: "cyan", scheduled: "violet", active: "green", paused: "orange",
  completed: "slate", rejected: "red", archived: "dim", pending: "amber", suspended: "red", connected: "green",
  degraded: "orange", not_configured: "dim", disconnected: "slate", development: "violet", available_adapter: "cyan",
  ready: "cyan", deleted: "dim", uploaded: "slate", processing: "violet", test: "cyan", live: "red", internal: "violet", external: "cyan",
};
export function Chip({ value, label, tone }: { value?: string; label?: ReactNode; tone?: string }) {
  const t = tone ?? STATE_TONE[value ?? ""] ?? "slate";
  return <span className={`chip chip-${t}`}>{label ?? (value ? value.replace(/_/g, " ") : "")}</span>;
}

export function ErrorBox({ error, onClose }: { error: ApiError | null | undefined; onClose?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <div className="alert-body">
        <strong>{error.message}</strong>
        {error.problems.length > 0 && (
          <ul className="problems">{error.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        )}
        <span className="alert-code">{error.code}</span>
      </div>
      {onClose && <button className="alert-x" onClick={onClose} aria-label="Dismiss">×</button>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode }) {
  return <div className={`alert alert-${tone}`}><div className="alert-body">{children}</div></div>;
}

export function Problems({ items, title = "Not ready yet" }: { items: string[]; title?: string }) {
  if (!items.length) return null;
  return (
    <div className="alert alert-warn">
      <div className="alert-body">
        <strong>{title}</strong>
        <ul className="problems">{items.map((p, i) => <li key={i}>{p}</li>)}</ul>
      </div>
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="loading"><span className="spinner" /> {label}…</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden>◇</div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? "field-wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal aria-label={title}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="alert-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, accent = "cyan" }: { label: string; value: ReactNode; sub?: ReactNode; accent?: "cyan" | "violet" | "green" | "amber" | "red" }) {
  return (
    <div className={`stat stat-${accent}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={`tab ${o.value === value ? "tab-on" : ""}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button small variant="subtle" onClick={() => {
      navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => undefined);
    }}>{done ? "Copied" : label}</Button>
  );
}

/** A confirm-with-text dialog for consequential actions. */
export function useConfirm() {
  const [state, setState] = useState<null | { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; requireNote?: boolean; noteLabel?: string; resolve: (v: { ok: boolean; note: string }) => void }>(null);
  const [note, setNote] = useState("");
  const ask = (o: { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; requireNote?: boolean; noteLabel?: string }) =>
    new Promise<{ ok: boolean; note: string }>((resolve) => { setNote(""); setState({ confirmLabel: "Confirm", ...o, resolve }); });
  const close = (ok: boolean) => { state?.resolve({ ok, note }); setState(null); };
  const element = state ? (
    <Modal title={state.title} onClose={() => close(false)} footer={
      <>
        <Button onClick={() => close(false)}>Cancel</Button>
        <Button variant={state.danger ? "danger" : "primary"} disabled={state.requireNote && !note.trim()} onClick={() => close(true)}>{state.confirmLabel}</Button>
      </>
    }>
      <div className="stack">
        <div>{state.body}</div>
        {(state.requireNote || state.noteLabel) && (
          <Field label={state.noteLabel ?? "Note"}>
            <textarea className="input" rows={3} value={note} autoFocus onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  ) : null;
  return { ask, element };
}
