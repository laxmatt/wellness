import { join } from "node:path";
import type { AIProvider } from "./ai/AIProvider";
import { MockAIProvider } from "./ai/AIProvider";
import type { AnalyticsProvider } from "./analytics/AnalyticsProvider";
import { ConsoleAnalyticsProvider } from "./analytics/AnalyticsProvider";
import type { CatalogProvider } from "./catalog/CatalogProvider";
import { LocalCatalogProvider } from "./catalog/LocalCatalogProvider";
import { loadCatalogWithPreview } from "./catalog/preview-overlay";
import type { EmailProvider } from "./email/EmailProvider";
import { NoopEmailProvider } from "./email/EmailProvider";

// Composition root. Swap implementations here, nowhere else.
export const CATALOG_DIR = join(process.cwd(), "catalog");

// An operator's local preview catalogue, holding invented records staged from a
// sample supplier file. It is not committed, it is additive only, and it loads
// only where `previewInventoryDecision` allows it: the flag alone is not
// enough, and no caller can ask for it, because the decision is taken here.
export const PREVIEW_CATALOG_DIR = join(process.cwd(), "catalog-preview");

let catalog: CatalogProvider | undefined;
export function getCatalog(): CatalogProvider {
  if (!catalog) {
    const { catalog: data, notices } = loadCatalogWithPreview(CATALOG_DIR, PREVIEW_CATALOG_DIR, process.env);
    // Written where an operator running the site will see it, and never
    // silently: a preview that did not load and a preview that loaded are both
    // things somebody needs to know before they trust what is on the screen.
    for (const n of notices) console.warn(`[catalog] ${n}`);
    catalog = new LocalCatalogProvider(data);
  }
  return catalog;
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
