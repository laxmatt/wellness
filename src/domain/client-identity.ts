import { createHash } from "node:crypto";

// Rate limiting has to key on something the caller does not choose.
//
// `x-forwarded-for` is chosen by the caller unless an edge overwrites it. A
// proxy that *appends* leaves the leftmost entry under the caller's control, so
// reading it is worse than no limit at all: it looks enforced and is not. This
// module therefore refuses to guess. Either the operator names a header their
// own edge overwrites, or the platform is one we know overwrites it, or the
// client cannot be identified and the caller decides what to do about that.

// Only the variables this module reads, so a caller (and a test) can pass a
// plain object instead of the whole process environment.
export type ClientEnv = Record<string, string | undefined>;

export type ClientIp = { ok: true; ip: string; source: string } | { ok: false; reason: string };

// Vercel documents that it overwrites `x-forwarded-for` and does not forward an
// externally supplied value, which is what makes it trustworthy there. `VERCEL`
// is set to "1" in every Vercel runtime. No other platform is assumed.
function vercel(env: ClientEnv): boolean {
  return env.VERCEL === "1";
}

export function resolveClientIp(headers: Headers, env: ClientEnv = process.env): ClientIp {
  const configured = env.ASSISTANT_TRUSTED_IP_HEADER?.trim().toLowerCase();

  if (configured) {
    // The operator asserts this header is written by their edge. Only the
    // first value is read, because a platform header carries one address.
    const raw = headers.get(configured);
    const ip = raw?.split(",")[0]?.trim();
    if (!ip) return { ok: false, reason: `The configured trusted header "${configured}" was not present on the request.` };
    return { ok: true, ip, source: configured };
  }

  if (vercel(env)) {
    const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (!ip) return { ok: false, reason: "Running on Vercel but no x-forwarded-for was present." };
    return { ok: true, ip, source: "x-forwarded-for (Vercel)" };
  }

  // Deliberately no fallback. Reading an unverified header here would produce a
  // limit that a single caller defeats by sending a different value each time.
  return {
    ok: false,
    reason: "No trusted source of the client address. Set ASSISTANT_TRUSTED_IP_HEADER to a header your edge overwrites (for example cf-connecting-ip behind Cloudflare), or set ASSISTANT_ALLOW_UNIDENTIFIED_CLIENTS=1 for a local run.",
  };
}

export type ClientSalt = { ok: true; salt: string } | { ok: false; reason: string };

const MIN_SALT = 16;

// The salt keeps readable addresses out of the ledger. A default value would
// make the stored hashes reversible by anyone with the source, so a live
// deployment must supply its own.
export function resolveClientSalt(env: ClientEnv = process.env): ClientSalt {
  const salt = env.ASSISTANT_CLIENT_SALT?.trim();
  if (!salt) return { ok: false, reason: "ASSISTANT_CLIENT_SALT is not set." };
  if (salt.length < MIN_SALT) return { ok: false, reason: `ASSISTANT_CLIENT_SALT is shorter than ${MIN_SALT} characters.` };
  return { ok: true, salt };
}

export function clientKeyFrom(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32);
}

export type ClientIdentity = { ok: true; key: string; source: string } | { ok: false; reason: string };

// Used for a live model only. `allowUnidentified` is the local-run escape
// hatch: it buckets every caller together, which is fine on one machine and
// useless in front of the public, so the route only permits it when the
// operator has explicitly asked for it.
export function resolveClientIdentity(headers: Headers, env: ClientEnv = process.env): ClientIdentity {
  const salt = resolveClientSalt(env);
  const unidentified = env.ASSISTANT_ALLOW_UNIDENTIFIED_CLIENTS === "1";

  if (!salt.ok && !unidentified) return { ok: false, reason: salt.reason };

  const ip = resolveClientIp(headers, env);
  if (!ip.ok) {
    if (!unidentified) return { ok: false, reason: ip.reason };
    // One shared bucket. The hourly limit still applies, to everyone at once.
    return { ok: true, key: "local-unidentified", source: "unidentified (local run)" };
  }

  if (!salt.ok) return { ok: true, key: "local-unidentified", source: "unidentified (local run)" };
  return { ok: true, key: clientKeyFrom(ip.ip, salt.salt), source: ip.source };
}
