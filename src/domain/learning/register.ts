/**
 * What the owner has learned, and what they propose doing about it.
 *
 * This is the only part of the dashboard that holds real content, because it is
 * the only part with a source: a person who noticed something and wrote it
 * down. Everything else on that page is a measurement this site does not take.
 *
 * Two rules shape the record.
 *
 * An observation is not a hypothesis. They are separate fields, and what the
 * entry rests on is named beside them, so a reader can tell what was seen from
 * what somebody concluded. Whether it was measured by an instrument or noticed
 * by a person is shown rather than hidden, and neither is dismissed: watching
 * three people use the site is evidence.
 *
 * A proposed change is not an outcome. The status says which it is, and an
 * outcome can only be recorded once something was actually done.
 */

/**
 * Where an entry came from. Written down, so an entry cannot cite a source
 * nobody defined.
 *
 * Two separate properties, because the first version confused them.
 *
 * `observed` says whether somebody actually looked at something. Watching three
 * people use the site on a Tuesday is an observation with a real sample and a
 * real date, and an earlier version of this file refused to let it carry
 * either, which was wrong: it treated "not an analytics dashboard" as "not
 * evidence". Only reasoning observes nothing, and only reasoning is refused a
 * sample.
 *
 * `measured` says whether it came from an instrument counting things. That is
 * the distinction worth keeping visible, and it is not the same question: three
 * people watched is observed and not measured, and both of those are true at
 * once.
 */
export const EVIDENCE_SOURCES = [
  { id: "owner_observation", label: "Something the owner noticed", observed: true, measured: false },
  { id: "partner_feedback", label: "A partner or reviewer said so", observed: true, measured: false },
  { id: "usability_session", label: "Watching somebody use the site", observed: true, measured: false },
  { id: "code_review", label: "Reading the code or the catalogue", observed: true, measured: false },
  { id: "reasoning", label: "Reasoning from what we know, with nothing observed", observed: false, measured: false },
  { id: "site_analytics", label: "Site analytics", observed: true, measured: true },
  { id: "search_console", label: "Search Console or Bing Webmaster Tools", observed: true, measured: true },
] as const;

export type EvidenceSourceId = (typeof EVIDENCE_SOURCES)[number]["id"];
export const evidenceSource = (id: string) => EVIDENCE_SOURCES.find((s) => s.id === id);
export const isMeasured = (id: string) => evidenceSource(id)?.measured === true;
/** Whether somebody looked at something, and so whether a sample size means anything. */
export const isObserved = (id: string) => evidenceSource(id)?.observed === true;

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
    /** How much was seen, where anything was: "12 sessions", "3 of 5 people". */
    sample?: string;
    /** When, where anything was seen. Free text: "1 to 14 September". */
    dateRange?: string;
    /** Where to look: a file, a page, a conversation. Never a visitor's words. */
    reference?: string;
  };
  /** What we think it means. Separate from the observation on purpose. */
  hypothesis?: string;
  /** What to do about it, once there is something to say. Optional: writing down what you saw comes first. */
  proposedChange?: string;
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
const MAX_SHORT = 200;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** A field that may be absent, and must be a string when it is not. */
const optionalString = (v: unknown) => v === undefined || v === null || typeof v === "string";

/**
 * What an entry has to be before it is worth keeping.
 *
 * Takes `unknown`, because this runs over a file somebody could have edited by
 * hand. An earlier version took a shaped object and threw on `null`, so a
 * backup containing one null entry failed to load at all rather than reporting
 * the bad entry and keeping the rest.
 *
 * Two rules about evidence, and they are narrower than they were. Only
 * reasoning is refused a sample and a date, because only reasoning observed
 * nothing; watching three people on a Tuesday is evidence with a sample in it.
 * And an outcome still needs a status saying something was done, because an
 * outcome is what happened and a proposal is not.
 *
 * A proposed change is no longer required. Writing down what you saw, before
 * you know what to do about it, is the most common and most useful thing to
 * record, and demanding a remedy first is a good way to lose the observation.
 */
export function validateEntry(candidate: unknown): ValidationProblem[] {
  if (!isObject(candidate)) return [{ field: "entry", message: `An entry is an object, not ${candidate === null ? "null" : Array.isArray(candidate) ? "a list" : typeof candidate}.` }];
  const entry = candidate;
  const problems: ValidationProblem[] = [];

  if (typeof entry.observation !== "string" || entry.observation.trim() === "") problems.push({ field: "observation", message: "An entry starts with what was seen." });

  if (!isObject(entry.evidence)) {
    problems.push({ field: "evidence.source", message: "Name where this came from." });
  } else {
    const evidence = entry.evidence;
    const source = text(evidence.source);
    if (source === "") problems.push({ field: "evidence.source", message: "Name where this came from." });
    else if (!evidenceSource(source)) problems.push({ field: "evidence.source", message: `"${source}" is not a source this register knows.` });

    for (const key of ["sample", "dateRange", "reference"] as const) {
      if (!optionalString(evidence[key])) problems.push({ field: `evidence.${key}`, message: `${key} has to be text.` });
    }

    // Only a source that observed nothing is refused a sample. Everything else
    // may carry one: "3 of 5 people" is a sample whether a machine counted it
    // or a person did.
    if (source !== "" && evidenceSource(source) && !isObserved(source)) {
      if (text(evidence.sample) !== "") problems.push({ field: "evidence.sample", message: "Nothing was observed here, so there is nothing a sample size could be a sample of." });
      if (text(evidence.dateRange) !== "") problems.push({ field: "evidence.dateRange", message: "Nothing was observed here, so a date range would be describing nothing." });
    }
  }

  if (!STATUSES.some((st) => st.id === entry.status)) problems.push({ field: "status", message: "Choose a status." });

  for (const key of ["hypothesis", "proposedChange", "outcome"] as const) {
    if (!optionalString(entry[key])) problems.push({ field: key, message: `${key} has to be text.` });
  }

  if (text(entry.outcome) !== "" && entry.status !== "done" && entry.status !== "dropped") {
    problems.push({ field: "outcome", message: "An outcome is what happened after the change. Mark it changed or decided against first." });
  }

  const bounded: [string, unknown, number][] = [
    ["observation", entry.observation, MAX_FIELD],
    ["hypothesis", entry.hypothesis, MAX_FIELD],
    ["proposedChange", entry.proposedChange, MAX_FIELD],
    ["outcome", entry.outcome, MAX_FIELD],
    ["evidence.reference", isObject(entry.evidence) ? entry.evidence.reference : undefined, MAX_FIELD],
    ["evidence.sample", isObject(entry.evidence) ? entry.evidence.sample : undefined, MAX_SHORT],
    ["evidence.dateRange", isObject(entry.evidence) ? entry.evidence.dateRange : undefined, MAX_SHORT],
  ];
  for (const [field, value, max] of bounded) {
    if (typeof value === "string" && value.length > max) problems.push({ field, message: `Keep this under ${max} characters.` });
  }

  return problems;
}

const isIsoDate = (v: unknown) => typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v));

/**
 * What a stored entry needs on top of what a person types.
 *
 * The fields the tool writes itself: an id, two timestamps, and the example
 * marker. An entry that validated as a draft but arrived from a file without a
 * timestamp used to be accepted and then crash the sort that reads it, which is
 * the shape of every bug in this file: a value nobody checked, trusted later by
 * something that could not cope without it.
 */
export function validateStoredEntry(candidate: unknown): ValidationProblem[] {
  const problems = validateEntry(candidate);
  if (!isObject(candidate)) return problems;

  // An id is not checked here. A missing or repeated one is the only damage in
  // this file that can be repaired without guessing at anything the owner
  // wrote, so `parseRegister` gives the entry an id and says it did, rather
  // than dropping a note over a field the tool generates itself.
  if (typeof candidate.id === "string" && candidate.id.length > MAX_SHORT) problems.push({ field: "id", message: `An id is under ${MAX_SHORT} characters.` });

  for (const key of ["createdAt", "updatedAt"] as const) {
    if (!isIsoDate(candidate[key])) problems.push({ field: key, message: `${key} has to be a date this can read.` });
  }

  if (candidate.demo !== undefined && candidate.demo !== true) problems.push({ field: "demo", message: "The example marker is true or absent." });

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
 * Every entry is checked in full before any of them is returned, and an entry
 * that does not pass is reported and left out rather than silently repaired: a
 * backup that changes on the way back in is not a backup.
 *
 * A repeated id is the one thing that is changed rather than dropped, because
 * dropping it would lose a note. The second one is renamed and the rename is
 * reported, since two entries sharing an id means editing one edits both.
 */
/**
 * An id nothing else is using.
 *
 * `newId` is a date and six random digits, which is nearly always free and is
 * not guaranteed to be: two repairs in one pass can collide, and a caller
 * passing a fixed generator collides every time. Trying again a bounded number
 * of times handles the first; counting up from the last attempt handles the
 * second and always terminates, because the set is finite.
 */
export function uniqueId(makeId: () => string, taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = makeId();
    if (candidate !== "" && !taken.has(candidate)) return candidate;
  }
  const base = makeId() || "L";
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function parseRegister(raw: string, makeId: () => string = newId): { ok: true; entries: LearningEntry[]; notes: string[] } | { ok: false; reason: string } {
  if (raw.length > MAX_REGISTER_BYTES) return { ok: false, reason: `That file is ${Math.round(raw.length / 1000)} kB. A register is notes, not a database.` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "That is not JSON." };
  }
  if (!isObject(parsed)) return { ok: false, reason: "A register file is a JSON object." };
  if (parsed.version !== 1) return { ok: false, reason: `That file says version ${String(parsed.version)}. This tool writes and reads version 1.` };
  if (!Array.isArray(parsed.entries)) return { ok: false, reason: "A register file needs an entries array." };

  const entries: LearningEntry[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();

  for (const [i, candidate] of parsed.entries.entries()) {
    const problems = validateStoredEntry(candidate);
    if (problems.length > 0) {
      notes.push(`Entry ${i + 1} was left out: ${problems.map((p) => p.message).join(" ")}`);
      continue;
    }
    const entry = candidate as LearningEntry;
    let id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (id === "") {
      id = uniqueId(makeId, seen);
      notes.push(`Entry ${i + 1} had no id and was kept under "${id}".`);
    } else if (seen.has(id)) {
      id = uniqueId(makeId, seen);
      notes.push(`Entry ${i + 1} repeated the id "${entry.id}", which would make editing one edit both. It was kept under "${id}".`);
    }
    seen.add(id);
    entries.push({ ...entry, id });
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
