import { join } from "node:path";
import type { AIProvider } from "./ai/AIProvider";
import { MockAIProvider } from "./ai/AIProvider";
import type { AnalyticsProvider } from "./analytics/AnalyticsProvider";
import { ConsoleAnalyticsProvider } from "./analytics/AnalyticsProvider";
import type { CatalogProvider } from "./catalog/CatalogProvider";
import { LocalCatalogProvider } from "./catalog/LocalCatalogProvider";
import type { EmailProvider } from "./email/EmailProvider";
import { NoopEmailProvider } from "./email/EmailProvider";

// Composition root. Swap implementations here, nowhere else.
export const CATALOG_DIR = join(process.cwd(), "catalog");

let catalog: CatalogProvider | undefined;
export function getCatalog(): CatalogProvider {
  catalog ??= LocalCatalogProvider.fromDirectory(CATALOG_DIR);
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
