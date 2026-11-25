import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Principal, Permission } from "@hcg-ads/contracts";
import { api, ApiError, setCsrf, authStatus, signIn, signOut, type AuthStatus } from "./api";
import { Button, ErrorBox, Field, Loading, navigate, useLoad, useRoute } from "./components/ui";
import { Icon, type IconName } from "./components/Icon";
import { CommandCenter } from "./pages/CommandCenter";
import { Campaigns } from "./pages/Campaigns";
import { CampaignDetail } from "./pages/CampaignDetail";
import { NewCampaign } from "./pages/NewCampaign";
import { Advertisers } from "./pages/Advertisers";
import { Publishers } from "./pages/Publishers";
import { ContentSources } from "./pages/ContentSources";
import { Placements } from "./pages/Placements";
import { CreativeStudio } from "./pages/CreativeStudio";
import { MediaLibrary } from "./pages/MediaLibrary";
import { Analytics } from "./pages/Analytics";
import { Revenue } from "./pages/Revenue";
import { Approvals } from "./pages/Approvals";
import { Ecosystem } from "./pages/Ecosystem";
import { Settings } from "./pages/Settings";

export interface Session {
  principal: Principal;
  csrfToken?: string | null;
  roleLabels: Record<string, string>;
  identity: { mode: string; configured: boolean; label: string; problems: string[] };
  environment: string;
  version: string;
}

const SessionCtx = createContext<Session | null>(null);
export const useSession = () => useContext(SessionCtx)!;
export const useCan = () => {
  const s = useSession();
  return (p: Permission) => s.principal.permissions.includes(p);
};

const NAV: Array<{ id: string; label: string; icon: IconName }> = [
  { id: "command-center", label: "Command Center", icon: "command" },
  { id: "campaigns", label: "Campaigns", icon: "campaigns" },
  { id: "advertisers", label: "Advertisers", icon: "advertisers" },
  { id: "publishers", label: "Publishers", icon: "publishers" },
  { id: "content-sources", label: "Content Sources", icon: "sources" },
  { id: "placements", label: "Placements", icon: "placements" },
  { id: "creative-studio", label: "Creative Studio", icon: "studio" },
  { id: "media", label: "Media Library", icon: "media" },
  { id: "analytics", label: "Analytics", icon: "analytics" },
  { id: "revenue", label: "Revenue", icon: "revenue" },
  { id: "approvals", label: "Approvals", icon: "approvals" },
  { id: "ecosystem", label: "HCG Ecosystem", icon: "ecosystem" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function Page({ route }: { route: string[] }) {
  const [section, id, sub] = route;
  switch (section) {
    case "command-center": return <CommandCenter />;
    case "campaigns":
      if (id === "new") return <NewCampaign />;
      if (id) return <CampaignDetail id={id} />;
      return <Campaigns />;
    case "advertisers": return <Advertisers />;
    case "publishers": return <Publishers selected={id} />;
    case "content-sources": return <ContentSources />;
    case "placements": return <Placements />;
    case "creative-studio": return <CreativeStudio campaignId={id} creativeId={sub} />;
    case "media": return <MediaLibrary />;
    case "analytics": return <Analytics />;
    case "revenue": return <Revenue />;
    case "approvals": return <Approvals />;
    case "ecosystem": return <Ecosystem />;
    case "settings": return <Settings />;
    default: return <CommandCenter />;
  }
}

function SignIn({ error, onDone }: { error: ApiError | null; onDone: () => void }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  useEffect(() => { void authStatus().then(setStatus); }, []);
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get("signin");
  const available = status?.signInAvailable === true;
  // A refusal from HCG (no role, revoked) is shown as-is; "unauthenticated" just means: sign in.
  const showError = error && error.code !== "unauthenticated" ? error : null;
  return (
    <div className="signin">
      <div className="signin-card panel">
        <Brand />
        <h1 className="page-title">Sign in with HCG Connect</h1>
        <p className="muted">HCG ADS uses your HCG account. Your roles are granted centrally by HCG (ERP App Access); HCG ADS keeps no accounts or passwords of its own.</p>
        {outcome === "denied" && <p className="problems">You declined the HCG Connect consent. Nothing was shared with HCG ADS.</p>}
        {outcome === "failed" && <p className="problems">HCG Connect could not complete the sign-in. Please try again.</p>}
        <ErrorBox error={showError} />
        {available ? (
          <div className="row">
            <Button variant="primary" onClick={signIn}>Sign in with HCG Connect</Button>
          </div>
        ) : (
          <div className="note small" data-testid="signin-unavailable">
            <b>{status?.label ?? "HCG Connect"}</b>
            <p>Sign-in becomes available when HCG issues the HCG ADS web client (ERP → App Integrations → hcg.ads). No temporary or shared client is used in the meantime.</p>
            {status?.problems?.length ? <ul className="problems">{status.problems.map((p, i) => <li key={i}>{p}</li>)}</ul> : null}
          </div>
        )}
        <div className="row"><Button onClick={onDone}>Check again</Button></div>
        <p className="small muted">You are sent to HCG's own sign-in and consent page. Your HCG password is never entered into HCG ADS, and HCG tokens stay on the HCG ADS server.</p>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <svg viewBox="0 0 40 40" className="brand-mark" aria-hidden>
        <defs>
          <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#22d3ee" /><stop offset="1" stopColor="#7c3aed" /></linearGradient>
        </defs>
        <rect x="1" y="1" width="38" height="38" rx="10" fill="#0b1020" stroke="url(#bm)" strokeWidth="1.5" />
        <path d="M10 28 L20 11 L30 28" fill="none" stroke="url(#bm)" strokeWidth="3" strokeLinejoin="round" />
        <path d="M14.5 22.5 H25.5" stroke="#e8f6ff" strokeWidth="2" />
      </svg>
      <div>
        <div className="brand-name">HCG <span>ADS</span></div>
        <div className="brand-sub">Hakmi Capital Group</div>
      </div>
    </div>
  );
}

function Shell({ session, children, route }: { session: Session; children: ReactNode; route: string[] }) {
  const [open, setOpen] = useState(false);
  const overview = useLoad<{ emergency: { active: boolean; reason: string | null; at: string | null; by: string | null }; pendingApprovals: number }>("/overview");
  useEffect(() => { const t = setInterval(overview.reload, 30_000); return () => clearInterval(t); }, [overview.reload]);
  useEffect(() => { setOpen(false); }, [route.join("/")]);
  const emergency = overview.data?.emergency;
  const dev = session.principal.authority === "development";
  return (
    <div className={`shell ${open ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <Brand />
          <button className="nav-toggle" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
            <span /><span /><span />
          </button>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.id} href={`#/${n.id}`} className={`nav-item ${route[0] === n.id || (!route[0] && n.id === "command-center") ? "nav-on" : ""}`}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.id === "approvals" && !!overview.data?.pendingApprovals && <b className="nav-badge">{overview.data.pendingApprovals}</b>}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <div className="who-name">{session.principal.displayName}</div>
            <div className="who-roles">{session.principal.roles.map((r) => session.roleLabels[r] ?? r).join(" · ")}</div>
          </div>
          <div className="ver">v{session.version} · {session.environment}</div>
          {session.principal.authority === "hcg-connect" && <button className="link small" onClick={() => void signOut()}>Sign out</button>}
        </div>
      </aside>
      <div className="main">
        {dev && (
          <div className="banner banner-dev" role="note">
            <b>{session.identity.label}</b>
            <span>Roles are simulated on this local build. Production uses HCG Connect and ERP App Access.</span>
          </div>
        )}
        {emergency?.active && (
          <div className="banner banner-emergency" role="alert">
            <b>EMERGENCY SHUTDOWN ACTIVE</b>
            <span>No advertisement is delivered anywhere. {emergency.reason} — {emergency.by}, {emergency.at ? new Date(emergency.at).toLocaleString("en-GB") : ""}</span>
            <a href="#/command-center" className="banner-link">Manage</a>
          </div>
        )}
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    api.get<Session>("/session")
      .then((s) => { setCsrf(s.csrfToken ?? null); setSession(s); setError(null); })
      .catch((e: ApiError) => { setSession(null); setError(e); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => { if (!window.location.hash) navigate("command-center"); }, []);

  if (loading && !session) return <div className="boot"><Loading label="Connecting to HCG ADS" /></div>;
  if (!session) {
    if (error && error.status === 0) {
      return <div className="signin"><div className="signin-card panel"><Brand /><ErrorBox error={error} /><Button variant="primary" onClick={load}>Retry</Button></div></div>;
    }
    return <SignIn error={error} onDone={load} />;
  }
  return (
    <SessionCtx.Provider value={session}>
      <Shell session={session} route={route}>
        <Page route={route} />
      </Shell>
    </SessionCtx.Provider>
  );
}
