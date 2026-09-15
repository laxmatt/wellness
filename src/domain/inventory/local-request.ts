/**
 * What the operator tool's server will answer, and what it refuses.
 *
 * The tool listens on the loopback interface only, so the network cannot reach
 * it. That is not the whole problem. A page the operator visits in the same
 * browser can reach `http://127.0.0.1`, and a name the attacker controls can be
 * made to resolve to 127.0.0.1 so that the browser thinks their site and this
 * tool are one origin. Both are ordinary attacks on local tools and neither is
 * stopped by binding to loopback.
 *
 * So four checks, and they are here rather than tangled into the server because
 * this is the part worth testing.
 *
 * **The Host has to be loopback.** A request arriving as
 * `Host: inventory.attacker.example` is a rebinding attempt whatever address it
 * came from, and it is refused before anything else happens.
 *
 * **A change has to come from this page.** Every mutation needs an `Origin`
 * that is this server, a JSON content type, and a header no form can set. A
 * cross-origin form post cannot set either header; a cross-origin `fetch` that
 * sets them is a preflighted request, and the preflight is refused because this
 * server answers no `OPTIONS` and sends no `Access-Control-*` header, ever.
 *
 * **Nothing else is a method.** GET and HEAD read; POST changes; everything
 * else is refused rather than handled.
 *
 * None of this is authentication and none of it is offered as any. It is the
 * set of checks that makes a local tool safe to leave running on a machine
 * somebody also browses the web on. A tool on a shared or public host needs
 * accounts, and that work does not exist here.
 */

export type RequestFacts = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
};

export type Guard = { ok: true; kind: "read" | "write" } | { ok: false; status: 403 | 405 | 415; error: string };

/** The header a change has to carry. A form cannot set it and a preflight cannot pass. */
export const OPERATOR_HEADER = "x-wellness-operator";

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The names this server answers to. Anything else is somebody else's name pointed here. */
export function loopbackHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

export function allowedOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
}

export function guardRequest(facts: RequestFacts, port: number): Guard {
  const host = first(facts.headers.host)?.toLowerCase();
  if (!host || !loopbackHosts(port).includes(host)) {
    return {
      ok: false,
      status: 403,
      error: `This tool answers to ${loopbackHosts(port).join(", ")} and nothing else. A request addressed to "${host ?? "no host"}" is a name pointed at this machine, which is how a page on the web reaches a tool that only listens on loopback.`,
    };
  }

  const method = facts.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return { ok: true, kind: "read" };
  if (method !== "POST") {
    return { ok: false, status: 405, error: `${method} is not a method this answers. It reads with GET and changes with POST, and it answers no preflight.` };
  }

  const site = first(facts.headers["sec-fetch-site"]);
  if (site !== undefined && site !== "same-origin") {
    return { ok: false, status: 403, error: `This change came from ${site === "none" ? "no page" : "another site"}. Changes are made from the tool's own page.` };
  }

  const origin = first(facts.headers.origin);
  if (!origin || !allowedOrigins(port).includes(origin.toLowerCase())) {
    return { ok: false, status: 403, error: `This change carries the origin "${origin ?? "none"}". Changes are made from the tool's own page.` };
  }

  if (first(facts.headers[OPERATOR_HEADER]) !== "1") {
    return { ok: false, status: 403, error: "This change is missing the tool's own header. A form on another site cannot set it, which is the point of requiring it." };
  }

  const type = first(facts.headers["content-type"])?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    return { ok: false, status: 415, error: `A change is sent as application/json. This one says "${type ?? "nothing"}", and the types a form can send are exactly the ones another site could send.` };
  }

  return { ok: true, kind: "write" };
}

/** Sent on every response, whatever it is. */
export const SECURITY_HEADERS: Record<string, string> = {
  // No framing, so a page cannot put this behind its own buttons.
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  // Nothing here is for a crawler, and nothing here should ever be indexed.
  "X-Robots-Tag": "noindex, nofollow",
};
