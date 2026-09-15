/**
 * Whether this process may run the ingestion tool.
 *
 * The same shape as the inventory tool's switch and for the same reason: a
 * local operator tool has no accounts, so the only thing keeping it local is
 * that it refuses to start anywhere that looks like it is not. Explicit flag,
 * and the flag is not sufficient. Every signal a common host sets, and a
 * configured public address, are each taken as proof this is somebody else's
 * machine.
 *
 * This tool writes partner data into a workspace and never into the catalogue,
 * so the cost of refusing wrongly is an operator seeing a message. The cost of
 * allowing wrongly is a partner's feed and an unauthenticated write endpoint on
 * somebody's deployment.
 */

import { DEPLOYMENT_SIGNALS, type PreviewDecision, type PreviewInventoryEnv } from "./preview-inventory";
import { hasPublicSiteUrl } from "./site-url";

export const INGESTION_ADMIN_FLAG = "WELLNESS_INGESTION_ADMIN";

export function ingestionAdminDecision(env: PreviewInventoryEnv): PreviewDecision {
  if (env[INGESTION_ADMIN_FLAG]?.trim() !== "1") {
    return { allowed: false, announce: false, reason: `${INGESTION_ADMIN_FLAG} is not set to 1.` };
  }
  const signalled = DEPLOYMENT_SIGNALS.filter((name) => env[name] !== undefined && env[name] !== "");
  if (signalled.length > 0) {
    return {
      allowed: false,
      announce: true,
      reason: `${INGESTION_ADMIN_FLAG} is set, and ${signalled.join(", ")} ${signalled.length === 1 ? "says" : "say"} this is not a local machine. The ingestion tool writes partner data and answers unauthenticated requests on loopback, and it never runs on a deployment.`,
    };
  }
  if (hasPublicSiteUrl(env)) {
    return {
      allowed: false,
      announce: true,
      reason: `${INGESTION_ADMIN_FLAG} is set, and NEXT_PUBLIC_SITE_URL points at a public address. The ingestion tool never runs where the public could reach it.`,
    };
  }
  return { allowed: true };
}
