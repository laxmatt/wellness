import type { AnalyticsEvent } from "@/domain/analytics";

export interface AnalyticsProvider {
  readonly name: string;
  track(event: AnalyticsEvent): Promise<void>;
}

export class ConsoleAnalyticsProvider implements AnalyticsProvider {
  readonly name = "console";
  async track(event: AnalyticsEvent) {
    if (process.env.NODE_ENV !== "test") console.info("[analytics]", JSON.stringify(event));
  }
}

export class MemoryAnalyticsProvider implements AnalyticsProvider {
  readonly name = "memory";
  readonly events: AnalyticsEvent[] = [];
  async track(event: AnalyticsEvent) {
    this.events.push(event);
  }
}
