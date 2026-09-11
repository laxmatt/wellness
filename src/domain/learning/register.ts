/**
 * What the owner has learned, and what they propose doing about it.
 *
 * This is the only part of the dashboard that holds real content, because it is
 * the only part with a source: a person who noticed something and wrote it
 * down. Everything else on that page is a measurement this site does not take.
 *
 * Two rules shape the record.
 *
 * An observation is not a finding. Every entry names where it came from, and a
 * source that is not a measurement can never carry a sample size or a date
 * range, because those are the furniture of measurement and putting them beside
 * a hunch is how a hunch starts being quoted as data.
 *
 * A proposed change is not an outcome. The status says which it is, and an
 * outcome can only be recorded once something was actually done.
 */

/** Where an entry came from. Written down, so an entry cannot cite a source nobody defined. */
export const EVIDENCE_SOURCES = [
  { id: "owner_observation", label: "Something the owner noticed", measured: false },
  { id: "partner_feedback", label: "A partner or reviewer said so", measured: false },
  { id: "usability_session", label: "Watching somebody use the site", measured: false },
  { id: "code_review", label: "Reading the code or the catalogue", measured: false },
  { id: "reasoning", label: "Reasoning from what we know, with nothing observed", measured: false },
  { id: "site_analytics", label: "Site analytics", measured: true },
  { id: "search_console", label: "Search Console or Bing Webmaster Tools", measured: true },
] as const;

export type EvidenceSourceId = (typeof EVIDENCE_SOURCES)[number]["id"];
export const evidenceSource = (id: string) => EVIDENCE_SOURCES.find((s) => s.id === id);
export const isMeasured = (id: string) => evidenceSource(id)?.measured === true;

export const STATUSES = [
  { id: "open", label: "Noticed, nothing done" },
  { id: "planned", label: "Change proposed" },
  { id: "doing", label: "Being worked on" },
  { id: "done", label: "Changed" },
  { id: "dropped", label: "Decided against" },
] as const;
export type StatusId = (typeof STATUSES)[number]["id"];

export type LearningEntry = {
  id: string;
  /** What was seen. One sentence, in plain words. */
  observation: string;
  evidence: {
    source: EvidenceSourceId;
    /** Only where the source measures something. "12 sessions", "3 of 5 people". */
    sample?: string;
    /** Only where the source measures something. Free text: "1 to 14 September". */
    dateRange?: string;
    /** Where to look: a file, a page, a conversation. Never a visitor's words. */
    reference?: string;
  };
  /** What we think it means. Separate from the observation on purpose. */
  hypothesis?: string;
  /** What to do about it. */
  proposedChange: string;
  status: StatusId;
  /** What happened after the change. Only once something was done. */
  outcome?: string;
  createdAt: string;
  updatedAt: string;
  /** Example content, shipped with the tool. Never mixed in silently. */
  demo?: true;
};

export type ValidationProblem = { field: string; message: string };

const MAX_FIELD = 2_000;

/**
 * What an entry has to be before it is worth keeping.
 *
 * The interesting rules are the ones about evidence. A sample size beside
 * "something the owner noticed" would read as a measurement, and an outcome on
 * an entry where nothing was done is a result nobody produced.
 */
export function validateEntry(entry: Partial<LearningEntry>): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  if (text(entry.observation) === "") problems.push({ field: "observation", message: "An entry starts with what was seen." });
  if (text(entry.proposedChange) === "") problems.push({ field: "proposedChange", message: "Say what to do about it, even if the answer is to look into it." });

  const source = text(entry.evidence?.source);
  if (source === "") problems.push({ field: "evidence.source", message: "Name where this came from." });
  else if (!evidenceSource(source)) problems.push({ field: "evidence.source", message: `"${source}" is not a source this register knows.` });

  if (!STATUSES.some((s) => s.id === entry.status)) problems.push({ field: "status", message: "Choose a status." });

  const measured = isMeasured(source);
  if (!measured) {
    if (text(entry.evidence?.sample) !== "") {
      problems.push({ field: "evidence.sample", message: `A sample size belongs to a measurement. "${evidenceSource(source)?.label ?? source}" is not one, so this would read as data it is not.` });
    }
    if (text(entry.evidence?.dateRange) !== "") {
      problems.push({ field: "evidence.dateRange", message: "A date range belongs to a measurement. Put the date in the reference if it matters." });
    }
  }

  if (text(entry.outcome) !== "" && entry.status !== "done" && entry.status !== "dropped") {
    problems.push({ field: "outcome", message: "An outcome is what happened after the change. Mark it changed or decided against first." });
  }

  for (const [field, value] of [
    ["observation", entry.observation],
    ["hypothesis", entry.hypothesis],
    ["proposedChange", entry.proposedChange],
    ["outcome", entry.outcome],
    ["evidence.reference", entry.evidence?.reference],
  ] as const) {
    if (typeof value === "string" && value.length > MAX_FIELD) problems.push({ field, message: `Keep this under ${MAX_FIELD} characters.` });
  }

  return problems;
}

/** A new id that does not need a server or a library. */
export function newId(now = new Date(), random = Math.random): string {
  return `L-${now.toISOString().slice(0, 10)}-${Math.floor(random() * 1e6).toString(36).padStart(4, "0")}`;
}

export type RegisterFile = { version: 1; exportedAt: string; entries: LearningEntry[] };

export const MAX_REGISTER_BYTES = 2_000_000;

export const serialiseRegister = (entries: LearningEntry[], now = new Date()): string =>
  JSON.stringify({ version: 1, exportedAt: now.toISOString(), entries } satisfies RegisterFile, null, 2);

/**
 * A register read back from a file, or the reason it was refused.
 *
 * Entries that do not validate are reported and left out rather than silently
 * repaired: a backup that quietly changes on the way back in is not a backup.
 */
export function parseRegister(text: string): { ok: true; entries: LearningEntry[]; notes: string[] } | { ok: false; reason: string } {
  if (text.length > MAX_REGISTER_BYTES) return { ok: false, reason: `That file is ${Math.round(text.length / 1000)} kB. A register is notes, not a database.` };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "That is not JSON." };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "A register file is a JSON object." };
  const file = raw as Partial<RegisterFile>;
  if (file.version !== 1) return { ok: false, reason: `That file says version ${String(file.version)}. This tool writes and reads version 1.` };
  if (!Array.isArray(file.entries)) return { ok: false, reason: "A register file needs an entries array." };

  const entries: LearningEntry[] = [];
  const notes: string[] = [];
  for (const [i, candidate] of file.entries.entries()) {
    const problems = validateEntry(candidate as Partial<LearningEntry>);
    if (problems.length > 0) {
      notes.push(`Entry ${i + 1} was left out: ${problems.map((p) => p.message).join(" ")}`);
      continue;
    }
    const e = candidate as LearningEntry;
    entries.push({ ...e, id: typeof e.id === "string" && e.id !== "" ? e.id : newId() });
  }
  return { ok: true, entries, notes };
}

/** Newest first, and anything still open before anything settled. */
export function sortEntries(entries: LearningEntry[]): LearningEntry[] {
  const rank: Record<StatusId, number> = { open: 0, planned: 1, doing: 2, done: 3, dropped: 4 };
  return [...entries].sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * What the register says about itself, for the line at the top of the page.
 *
 * Counts of entries, never a score. There is no number that says how well this
 * site is doing, and inventing one out of a list of notes would be the single
 * most misleading thing this tool could do.
 */
export function registerSummary(entries: LearningEntry[]) {
  const real = entries.filter((e) => !e.demo);
  return {
    total: real.length,
    demo: entries.length - real.length,
    byStatus: Object.fromEntries(STATUSES.map((s) => [s.id, real.filter((e) => e.status === s.id).length])) as Record<StatusId, number>,
    measured: real.filter((e) => isMeasured(e.evidence.source)).length,
    unmeasured: real.filter((e) => !isMeasured(e.evidence.source)).length,
  };
}
