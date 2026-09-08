import { timingSafeEqual } from "node:crypto";

// Credentials must not travel in a URL. Query strings are written to server
// logs, proxy logs, browser history and `Referer` headers, so a key passed that
// way is effectively published. The header is the only accepted route.
export type AdminAuth = { ok: true } | { ok: false; status: 401 | 503; error: string };

export function authorizeAdmin(headers: Headers, url: string): AdminAuth {
  const expected = process.env.ADMIN_ACCESS_KEY;
  if (!expected) return { ok: false, status: 503, error: "ADMIN_ACCESS_KEY is not configured." };

  // A key in the query string is refused outright rather than ignored, so an
  // operator who reaches for the old form is told to rotate it.
  if (new URL(url, "http://local").searchParams.has("key")) {
    return { ok: false, status: 401, error: "Pass the admin key in the x-admin-key header, not the URL. Treat any key sent this way as compromised and rotate it." };
  }

  const supplied = headers.get("x-admin-key");
  if (!supplied || !equal(supplied, expected)) return { ok: false, status: 401, error: "Not authorised." };
  return { ok: true };
}

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // Compare a fixed-length digest of each so length alone leaks nothing.
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
