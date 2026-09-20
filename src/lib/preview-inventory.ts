import { hasPublicSiteUrl } from "./site-url";

/**
 * Whether this process may load the local preview catalogue.
 *
 * The preview catalogue holds invented products staged from a synthetic
 * supplier file. It exists so an operator can see the whole workflow end to
 * end on their own machine, and it must never reach anybody else.
 *
 * So the switch is explicit and it is not sufficient. A deployment that somehow
 * carried the flag still does not load the overlay: every signal a common host
 * sets is treated as proof this is not somebody's laptop, and so is a
 * configured public address. Fail closed, and in the direction where the cost
 * of being wrong is an operator seeing nothing rather than a visitor seeing
 * invented products.
 */
export const PREVIEW_INVENTORY_FLAG = "WELLNESS_PREVIEW_INVENTORY";

export type PreviewInventoryEnv = Record<string, string | undefined>;

/**
 * Variables that say somebody else is running this.
 *
 * Presence is the signal, not value: a host that sets `VERCEL_ENV=production`
 * and one that sets `VERCEL_ENV=preview` are both hosts. This list is not a
 * claim to know every platform, which is why the public-address check sits
 * beside it: between them they catch a deployment that sets nothing familiar
 * but has been given a domain.
 */
export const DEPLOYMENT_SIGNALS = [
  "VERCEL",
  "VERCEL_ENV",
  "NEXT_PUBLIC_VERCEL_ENV",
  "NETLIFY",
  "CONTEXT",
  "CF_PAGES_BRANCH",
  "RENDER",
  "FLY_APP_NAME",
  "DYNO",
  "RAILWAY_ENVIRONMENT",
  "AWS_LAMBDA_FUNCTION_NAME",
  "KUBERNETES_SERVICE_HOST",
  "CI",
] as const;

export type PreviewDecision =
  /** Load it. */
  | { allowed: true }
  /** Do not. `announce` is set when somebody asked for it and was refused. */
  | { allowed: false; announce: boolean; reason: string };

export function previewInventoryDecision(env: PreviewInventoryEnv): PreviewDecision {
  if (env[PREVIEW_INVENTORY_FLAG]?.trim() !== "1") {
    return { allowed: false, announce: false, reason: `${PREVIEW_INVENTORY_FLAG} is not set to 1.` };
  }

  const signalled = DEPLOYMENT_SIGNALS.filter((name) => env[name] !== undefined && env[name] !== "");
  if (signalled.length > 0) {
    return {
      allowed: false,
      announce: true,
      reason: `${PREVIEW_INVENTORY_FLAG} is set, and ${signalled.join(", ")} ${signalled.length === 1 ? "says" : "say"} this is not a local machine. The preview catalogue holds invented products and never loads on a deployment.`,
    };
  }

  if (hasPublicSiteUrl(env)) {
    return {
      allowed: false,
      announce: true,
      reason: `${PREVIEW_INVENTORY_FLAG} is set, and NEXT_PUBLIC_SITE_URL points at a public address. The preview catalogue holds invented products and never loads where the public could reach them.`,
    };
  }

  return { allowed: true };
}
