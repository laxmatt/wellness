import { join } from "node:path";
import type { AIProvider } from "./ai/AIProvider";
import { MockAIProvider } from "./ai/AIProvider";
import type { AnalyticsProvider } from "./analytics/AnalyticsProvider";
import { ConsoleAnalyticsProvider } from "./analytics/AnalyticsProvider";
import type { CatalogProvider } from "./catalog/CatalogProvider";
import { LocalCatalogProvider } from "./catalog/LocalCatalogProvider";
import { loadCatalogWithPreview, previewSignature } from "./catalog/preview-overlay";
import { previewInventoryDecision } from "@/lib/preview-inventory";
import type { EmailProvider } from "./email/EmailProvider";
import { NoopEmailProvider } from "./email/EmailProvider";

// Composition root. Swap implementations here, nowhere else.
export const CATALOG_DIR = join(process.cwd(), "catalog");

// An operator's local preview catalogue, holding invented records staged from a
// sample supplier file. It is not committed, it is additive only, and it loads
// only where `previewInventoryDecision` allows it: the flag alone is not
// enough, and no caller can ask for it, because the decision is taken here.
export const PREVIEW_CATALOG_DIR = join(process.cwd(), "catalog-preview");

// The catalogue is built once and kept, which is what a read-only directory of
// JSON files deserves. The preview catalogue is the exception: an operator
// approves a record while the site is running, and the next page they load has
// to show it. So where the preview catalogue is allowed at all, its contents
// are signed on each call and the catalogue is rebuilt when that signature
// changes. Nothing about this runs on a site with no preview catalogue: the
// decision is taken first and it returns before any directory is read.
let cached: { signature: string; provider: CatalogProvider } | undefined;

export function getCatalog(): CatalogProvider {
  const signature = previewInventoryDecision(process.env).allowed ? previewSignature(PREVIEW_CATALOG_DIR) : "no preview";
  if (cached?.signature === signature) return cached.provider;

  const { catalog: data, notices } = loadCatalogWithPreview(CATALOG_DIR, PREVIEW_CATALOG_DIR, process.env);
  // Written where an operator running the site will see it, and only when
  // something changed: a preview that did not load and a preview that loaded
  // are both things somebody needs to know before they trust what is on screen.
  for (const n of notices) console.warn(`[catalog] ${n}`);
  cached = { signature, provider: new LocalCatalogProvider(data) };
  return cached.provider;
}

let ai: AIProvider | undefined;
export function getAI(): AIProvider {
  ai ??= new MockAIProvider();
  return ai;
}

let analytics: AnalyticsProvider | undefined;
export function getAnalytics(): AnalyticsProvider {
  analytics ??= new ConsoleAnalyticsProvider();
  return analytics;
}

let email: EmailProvider | undefined;
export function getEmail(): EmailProvider {
  email ??= new NoopEmailProvider();
  return email;
}
