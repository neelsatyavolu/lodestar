// Which redirect URIs a client may register, and whether a requested one
// matches. https anywhere; plain http only on this machine (RFC 8252 native
// apps); and app schemes like cursor:// that browsers hand to an installed app.

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:", "filesystem:", "ws:", "wss:", "ftp:"]);

function parse(uri: string): URL | null {
  if (uri.length > 2000) return null;
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

const isLoopback = (u: URL) => u.protocol === "http:" && LOOPBACK.has(u.hostname);

/** Whether a client may register this redirect URI. */
export function validRedirect(uri: string): boolean {
  const u = parse(uri);
  if (!u || u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return Boolean(u.hostname);
  if (u.protocol === "http:") return isLoopback(u);
  return !BLOCKED_SCHEMES.has(u.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(u.protocol);
}

/**
 * The registered URI a request's redirect_uri matches, or null. Matching is
 * exact, except that a loopback URI may use any port (RFC 8252 §7.3).
 */
export function matchRedirect(requested: string, registered: string[]): string | null {
  if (!validRedirect(requested)) return null;
  if (registered.includes(requested)) return requested;
  const r = parse(requested)!;
  if (!isLoopback(r)) return null;
  const portless = (u: URL) => `${u.protocol}//${u.hostname}${u.pathname}${u.search}`;
  return registered.some((reg) => {
    const u = parse(reg);
    return u !== null && isLoopback(u) && portless(u) === portless(r);
  })
    ? requested
    : null;
}
