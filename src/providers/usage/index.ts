import { MemoryUsageStore } from "./MemoryUsageStore";
import { PostgresUsageStore } from "./PostgresUsageStore";
import { UsageMeter, type UsageStore } from "./UsageMeter";

// Composition root for spend tracking. Postgres when DATABASE_URL is set,
// which is the only configuration a live model is allowed to run against;
// otherwise an in-process store the route refuses to spend against.
let meter: UsageMeter | null = null;

export function getMeter(): UsageMeter {
  if (meter) return meter;
  let store: UsageStore = new MemoryUsageStore();
  if (process.env.DATABASE_URL) {
    try {
      store = new PostgresUsageStore(process.env.DATABASE_URL);
    } catch {
      // Falls back to the unshared store, which the route will not spend
      // against, rather than running a live model with no working ledger.
      store = new MemoryUsageStore();
    }
  }
  meter = new UsageMeter(store);
  return meter;
}

export function resetMeterForTests(next: UsageMeter | null) {
  meter = next;
}
