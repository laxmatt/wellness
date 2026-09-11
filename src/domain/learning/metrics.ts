/**
 * The questions the owner wants answered, and the honest state of each.
 *
 * Nothing in this repository measures anything. `AnalyticsEvent` in
 * src/domain/analytics.ts describes events that could be recorded, and
 * `getAnalytics()` in src/providers/index.ts builds a provider that writes them
 * to the console. Nothing calls it. No event has ever been emitted, no store
 * exists, and there is no traffic data anywhere in this project.
 *
 * So every panel below reads "not connected", and that is the whole point of
 * them. A dashboard that showed zeros would be answering these questions with a
 * number, and the number would be false: nobody knows whether anything happened,
 * because nothing was ever counted. An empty measurement and a measurement of
 * zero are different claims, and this file exists so the second one is never
 * made by accident.
 *
 * Each panel says what would answer it, which existing contract would carry it,
 * and what would have to be built or connected. None of that is a plan anybody
 * has approved; it is what the question needs, written next to the question.
 */

export type MetricStatus = "not_connected" | "measured";

export type MetricPanel = {
  id: string;
  /** What the owner is actually asking. */
  question: string;
  status: MetricStatus;
  /** Why there is no figure. Shown in place of one. */
  why: string;
  /** What a figure here would be made of. */
  wouldComeFrom: string;
  /** The typed event that already describes this, where one exists. */
  contract?: string;
  /** What it would take to connect it. Not a commitment. */
  toConnect: string[];
  /** What must never be kept, whatever gets built. */
  neverStored: string[];
};

const NO_STORE = "Nothing records this. The event contract exists; nothing emits it, and there is no store to emit it to.";

export const METRIC_PANELS: MetricPanel[] = [
  {
    id: "discovery",
    question: "How do people find the site?",
    status: "not_connected",
    why: "Nothing records arrivals, and no search account is connected.",
    wouldComeFrom: "A count of arrivals grouped by where they came from: a search engine, a link from another site, or typed in directly.",
    toConnect: [
      "Search Console and Bing Webmaster Tools, once a domain exists and is verified. Neither is connected and no account exists.",
      "A store that counts arrivals by referring host. Nothing like it exists here.",
    ],
    neverStored: ["The full referring URL, including its query string.", "Anything identifying a visitor: address, fingerprint, or a stable id."],
  },
  {
    id: "interest",
    question: "Which categories and products do people look at?",
    status: "not_connected",
    why: NO_STORE,
    wouldComeFrom: "Counts of category and product views, and of which filters get pressed.",
    contract: "category_viewed, filter_selected, product_recommended, product_compared",
    toConnect: ["Somewhere to put the events, and something that calls the provider. Today nothing calls it."],
    neverStored: ["Anything tying a sequence of views to one person."],
  },
  {
    id: "friction",
    question: "Where do people get stuck?",
    status: "not_connected",
    why: NO_STORE,
    wouldComeFrom:
      "Counts only: how often a set of filters leaves nothing, and how often somebody asks the assistant about something this site does not sell. Both as totals, never as a list of what anybody typed.",
    contract: "preferences_extracted (unmappedCount), matcher_submitted (charCount)",
    toConnect: ["The same missing store. The existing events were designed for this: they carry counts and keys, never the text."],
    neverStored: ["What anybody typed, to the assistant or anywhere else. The event contract already refuses it and that must not be loosened to make a chart."],
  },
  {
    id: "clickouts",
    question: "How often does somebody leave for a merchant?",
    status: "not_connected",
    why: NO_STORE,
    wouldComeFrom: "A count of outbound merchant clicks, by product and merchant.",
    contract: "retailer_clicked",
    toConnect: ["The same missing store."],
    neverStored: [
      "Purchases. This site cannot see them: there is no affiliate programme, no merchant reporting and no way to know what anybody bought. A click is a click and must never be presented as a sale.",
    ],
  },
];

/**
 * Things that could one day supply figures, and whether they are connected.
 *
 * All of them are "no". The row exists so the answer is visible rather than
 * implied by an empty chart.
 */
export const SOURCES = [
  { id: "site_analytics", label: "Site analytics store", connected: false, note: "None. The event contract exists and nothing emits it." },
  { id: "search_console", label: "Google Search Console", connected: false, note: "Not connected. No domain, no account, nothing submitted." },
  { id: "bing", label: "Bing Webmaster Tools", connected: false, note: "Not connected. No domain, no account, nothing submitted." },
  { id: "merchant", label: "Merchant or affiliate reporting", connected: false, note: "None. There is no affiliate programme, so there is no purchase data to read." },
] as const;
