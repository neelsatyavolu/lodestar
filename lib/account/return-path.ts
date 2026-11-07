/**
 * Where to go after signing in, as a same-site path, or null. The value is
 * parsed the way the browser will parse it (which strips tabs and newlines and
 * reads "\" as "/"), so "/\t/evil.example" can't slip out as "//evil.example".
 */
export function safeReturnPath(next: string | null, origin: string): string | null {
  if (!next || !next.startsWith("/")) return null;
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return null;
  }
  return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
}
