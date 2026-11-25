/**
 * Destination and media URL validation. Advertising never carries executable
 * content: only https:// (http://localhost in development) URLs are accepted.
 */
const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "cutt.ly", "rebrand.ly"]);

export interface UrlCheck { ok: boolean; problems: string[]; url?: URL }

export function checkDestinationUrl(raw: string, opts: { allowLocalhost?: boolean } = {}): UrlCheck {
  const problems: string[] = [];
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, problems: ["The destination is not a valid URL."] };
  }
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (url.protocol !== "https:" && !(opts.allowLocalhost && isLocal && url.protocol === "http:")) {
    problems.push("The destination must use https://.");
  }
  if (url.username || url.password) problems.push("The destination must not contain credentials.");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !isLocal) problems.push("The destination must use a domain name, not an IP address.");
  if (host.includes("[") || host.includes(":")) problems.push("IPv6 literal destinations are not accepted.");
  if (SHORTENERS.has(host)) problems.push("Link shorteners hide the real destination and are not accepted.");
  if (!host.includes(".") && !isLocal) problems.push("The destination host is not a public domain.");
  if (raw.length > 2048) problems.push("The destination URL is too long.");
  return { ok: problems.length === 0, problems, url };
}

export function isHcgHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "hakmicapitalgroup.com" || h.endsWith(".hakmicapitalgroup.com");
}
