import { ErrorBox, Loading, PageHeader, Chip } from "../components/ui";
import { useLoad } from "../components/ui";

interface Integration { id: string; name: string; role: string; state: string; detail: string; problems: string[] }

const STATE_TEXT: Record<string, string> = {
  connected: "Connected", development: "Development mode", degraded: "Degraded", not_configured: "Not configured",
  available_adapter: "Adapter ready", disconnected: "Disconnected",
};

export function Ecosystem() {
  const { data, error, loading } = useLoad<{ integrations: Integration[] }>("/ecosystem");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="page">
      <PageHeader title="HCG Ecosystem" kicker="How HCG ADS connects to the rest of Hakmi Capital Group" />
      <div className="eco-grid">
        {data?.integrations.map((i) => (
          <article key={i.id} className={`eco eco-${i.state}`}>
            <div className="eco-head">
              <span className="eco-dot" aria-hidden />
              <div className="grow"><h3>{i.name}</h3><div className="muted small">{i.role}</div></div>
              <Chip value={i.state} label={STATE_TEXT[i.state] ?? i.state} />
            </div>
            <p className="eco-detail">{i.detail}</p>
            {i.problems.length > 0 && <ul className="problems small">{i.problems.map((p, k) => <li key={k}>{p}</li>)}</ul>}
          </article>
        ))}
      </div>
    </div>
  );
}
