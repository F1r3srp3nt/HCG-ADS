export type IconName =
  | "command" | "campaigns" | "advertisers" | "publishers" | "sources" | "placements" | "studio" | "media"
  | "analytics" | "revenue" | "approvals" | "ecosystem" | "settings" | "power" | "plus" | "refresh" | "check" | "upload";

const PATHS: Record<IconName, string> = {
  command: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 7v5l3 3",
  campaigns: "M4 14V10l12-5v14L4 14Z M16 9h2a3 3 0 0 1 0 6h-2 M7 15l1.5 5h3L10 15.5",
  advertisers: "M8 8a3 3 0 1 0 0.01 0 M3 20c0-3 2.5-5 5-5s5 2 5 5 M16 9a2.5 2.5 0 1 0 0.01 0 M15 15c3 0 6 1.5 6 5",
  publishers: "M4 4h16v16H4Z M4 9h16 M9 9v11",
  sources: "M5 6c0-1.5 3-2.5 7-2.5s7 1 7 2.5-3 2.5-7 2.5-7-1-7-2.5Z M5 6v12c0 1.5 3 2.5 7 2.5s7-1 7-2.5V6 M5 12c0 1.5 3 2.5 7 2.5s7-1 7-2.5",
  placements: "M3 5h18v4H3Z M3 11h8v8H3Z M13 11h8v3h-8Z M13 16h8v3h-8Z",
  studio: "M4 20l4-1 11-11-3-3L5 16l-1 4Z M14 7l3 3",
  media: "M3 5h18v14H3Z M3 15l5-5 4 4 3-3 6 6 M15.5 9a1.5 1.5 0 1 0 0.01 0",
  analytics: "M4 20V4 M4 20h16 M8 16v-5 M12 16V8 M16 16v-3 M20 16V6",
  revenue: "M12 3v18 M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3",
  approvals: "M9 12l2 2 4-4 M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3Z",
  ecosystem: "M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0 M12 3v6.5 M12 14.5V21 M3.5 7.5l6.3 3.3 M14.2 13.2l6.3 3.3 M20.5 7.5l-6.3 3.3 M9.8 13.2l-6.3 3.3",
  settings: "M12 9a3 3 0 1 0 0.01 0 M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  power: "M12 3v9 M6.3 6.3a8 8 0 1 0 11.4 0",
  plus: "M12 5v14 M5 12h14",
  refresh: "M20 11a8 8 0 0 0-14.9-3.5 M4 5v4h4 M4 13a8 8 0 0 0 14.9 3.5 M20 19v-4h-4",
  check: "M5 12l5 5 9-10",
  upload: "M12 16V4 M7 9l5-5 5 5 M4 16v4h16v-4",
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="icon">
      <path d={PATHS[name]} />
    </svg>
  );
}
