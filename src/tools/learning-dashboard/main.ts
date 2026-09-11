/**
 * The owner's dashboard, as a page that runs from a file on disk.
 *
 * Same shape as the import demonstration and for the same reason: there is no
 * route, so there is nothing to leave unauthenticated by accident. It opens with
 * file://, keeps its register in this browser, and exports it as a file the
 * owner keeps.
 *
 * What it shows is mostly what it cannot show. Four questions the owner wants
 * answered have no figures behind them, because nothing in this project records
 * anything, and each says so in place of a number. The register is the part with
 * real content, because a person wrote it.
 */

import { METRIC_PANELS, SOURCES } from "../../domain/learning/metrics";
import {
  EVIDENCE_SOURCES,
  MAX_REGISTER_BYTES,
  STATUSES,
  evidenceSource,
  isMeasured,
  isObserved,
  newId,
  parseRegister,
  registerSummary,
  serialiseRegister,
  sortEntries,
  validateEntry,
  type LearningEntry,
  type StatusId,
} from "../../domain/learning/register";
import { DEMO_ENTRIES } from "../../domain/learning/demo";

const KEY = "wc.learning.v1";

let entries: LearningEntry[] = [];
let editing: string | null = null;
/**
 * Set when stored notes could not be read. While it is set nothing is written
 * back, because writing would overwrite whatever is still in there. The page
 * offers the raw text as a file instead, so the owner can rescue it before
 * deciding anything.
 */
let unreadable: { raw: string; reason: string } | null = null;
/** A file that has been read and not yet applied. Applying it is a decision. */
let pending: { entries: LearningEntry[]; notes: string[]; name: string } | null = null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // textContent, never innerHTML. The owner's own notes are still text.
  if (text !== undefined) node.textContent = text;
  return node;
};
const byId = (id: string) => document.getElementById(id)!;
const clear = (node: HTMLElement) => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

// ------------------------------------------------------------- persistence

function load() {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Storage switched off, or a browser refusing it. Nothing was stored, so
    // nothing is at risk; the page says so rather than pretending it saved.
    unreadable = { raw: "", reason: "This browser will not let the page read its storage, so nothing can be loaded or saved here. Use the file." };
    return;
  }
  if (!raw) return;

  const parsed = parseRegister(raw);
  if (!parsed.ok) {
    // The saved text is still there and this will not write over it.
    unreadable = { raw, reason: `The notes saved in this browser could not be read: ${parsed.reason}` };
    return;
  }
  entries = parsed.entries;
  if (parsed.notes.length > 0) setSaveState(`Loaded from this browser. ${parsed.notes.join(" ")}`, true);
}

/** Returns whether it actually saved, so a caller cannot report success over a failure. */
function save(): boolean {
  if (unreadable) {
    setSaveState("Nothing was saved: there are unread notes in this browser's storage, and writing would overwrite them. Rescue them first.", true);
    return false;
  }
  try {
    window.localStorage.setItem(KEY, serialiseRegister(entries));
    setSaveState("saved in this browser");
    return true;
  } catch {
    setSaveState("Could not be saved in this browser. Save the register to a file to keep it.", true);
    return false;
  }
}

function setSaveState(message: string, bad = false) {
  const node = byId("save-state");
  node.textContent = message;
  node.className = bad ? "save bad" : "save";
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- metrics

function renderMetrics() {
  const host = byId("metrics");
  clear(host);

  const sources = el("div", "sources");
  sources.appendChild(el("h3", undefined, "Where figures could come from"));
  const list = el("ul");
  for (const s of SOURCES) {
    const li = el("li");
    li.appendChild(el("span", `pill ${s.connected ? "on" : "off"}`, s.connected ? "connected" : "not connected"));
    li.appendChild(el("span", "src", s.label));
    li.appendChild(el("span", "note", s.note));
    list.appendChild(li);
  }
  sources.appendChild(list);
  host.appendChild(sources);

  for (const panel of METRIC_PANELS) {
    const card = el("article", "panel", undefined);
    card.setAttribute("data-panel", panel.id);
    card.setAttribute("data-status", panel.status);

    const head = el("header");
    head.appendChild(el("h3", undefined, panel.question));
    head.appendChild(el("span", "pill off", "not connected"));
    card.appendChild(head);

    // In place of a figure. Never a zero: nobody counted, so nobody knows.
    const nofigure = el("p", "nofigure", "No figure. " + panel.why);
    card.appendChild(nofigure);

    card.appendChild(el("p", "what", `A figure here would be: ${panel.wouldComeFrom}`));
    if (panel.contract) card.appendChild(el("p", "contract", `The typed events for it already exist: ${panel.contract} (src/domain/analytics.ts).`));

    const toConnect = el("div", "block");
    toConnect.appendChild(el("h4", undefined, "What it would take"));
    const ul = el("ul");
    for (const step of panel.toConnect) ul.appendChild(el("li", undefined, step));
    toConnect.appendChild(ul);
    card.appendChild(toConnect);

    const never = el("div", "block never");
    never.appendChild(el("h4", undefined, "What must never be kept"));
    const ul2 = el("ul");
    for (const rule of panel.neverStored) ul2.appendChild(el("li", undefined, rule));
    never.appendChild(ul2);
    card.appendChild(never);

    host.appendChild(card);
  }
}

// --------------------------------------------------------------- register

function statusLabel(id: StatusId) {
  return STATUSES.find((s) => s.id === id)?.label ?? id;
}

function renderSummary() {
  const host = byId("summary");
  clear(host);
  const s = registerSummary(entries);

  if (s.total === 0 && s.demo === 0) {
    host.appendChild(el("p", "empty", "The register is empty. Add what you have noticed, however small; an entry with no measurement behind it is still worth writing down, and this marks it as one."));
    return;
  }

  if (s.total === 0) {
    // Only examples. A row of zeros beside them would read as a finding about
    // this site rather than as an empty register.
    host.appendChild(el("p", "empty", "No entries of your own yet."));
  } else {
    const written = STATUSES.filter((st) => s.byStatus[st.id] > 0).map((st) => `${s.byStatus[st.id]} ${st.label.toLowerCase()}`);
    const line = el("p", "counts");
    line.textContent = `${s.total} ${s.total === 1 ? "entry" : "entries"}: ${written.join(", ")}.`;
    host.appendChild(line);

    // The distinction the whole page turns on, as two counts and no score.
    const evidence = el("p", "counts");
    evidence.textContent = `${s.measured} rest on a measurement. ${s.unmeasured} rest on something somebody noticed or reasoned out. There is no score here: a count of notes is not a measure of how the site is doing.`;
    host.appendChild(evidence);
  }

  if (s.demo > 0) host.appendChild(el("p", "demo-note", `${s.demo} example ${s.demo === 1 ? "entry is" : "entries are"} loaded. They are marked EXAMPLE and are not about this site.`));
}

function renderEntries() {
  const host = byId("entries");
  clear(host);

  for (const entry of sortEntries(entries)) {
    const card = el("article", `entry ${entry.demo ? "is-demo" : ""}`);
    card.setAttribute("data-entry", entry.id);
    card.setAttribute("data-status", entry.status);

    const head = el("header");
    if (entry.demo) head.appendChild(el("span", "pill demo", "EXAMPLE"));
    head.appendChild(el("span", `pill status-${entry.status}`, statusLabel(entry.status)));
    const src = evidenceSource(entry.evidence.source);
    head.appendChild(el("span", `pill ${isMeasured(entry.evidence.source) ? "measured" : "unmeasured"}`, isMeasured(entry.evidence.source) ? "measured" : "not measured"));
    card.appendChild(head);

    card.appendChild(el("p", "observation", entry.observation));

    const meta = el("p", "meta");
    meta.textContent = [
      `Source: ${src?.label ?? entry.evidence.source}`,
      entry.evidence.sample ? `Sample: ${entry.evidence.sample}` : null,
      entry.evidence.dateRange ? `Dates: ${entry.evidence.dateRange}` : null,
      entry.evidence.reference ? `Reference: ${entry.evidence.reference}` : null,
      `Updated ${entry.updatedAt.slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join(" · ");
    card.appendChild(meta);

    if (entry.hypothesis) {
      const h = el("p", "hypothesis");
      h.appendChild(el("strong", undefined, "What we think it means: "));
      h.appendChild(document.createTextNode(entry.hypothesis));
      card.appendChild(h);
    }

    if (entry.proposedChange) {
      const change = el("p", "change");
      change.appendChild(el("strong", undefined, "Proposed change: "));
      change.appendChild(document.createTextNode(entry.proposedChange));
      card.appendChild(change);
    }

    if (entry.outcome) {
      const o = el("p", "outcome");
      o.appendChild(el("strong", undefined, "What happened: "));
      o.appendChild(document.createTextNode(entry.outcome));
      card.appendChild(o);
    }

    const actions = el("div", "actions");
    const edit = el("button", "link", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => startEdit(entry.id));
    actions.appendChild(edit);

    const remove = el("button", "link", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => {
      entries = entries.filter((e) => e.id !== entry.id);
      save();
      render();
    });
    actions.appendChild(remove);
    card.appendChild(actions);

    host.appendChild(card);
  }
}

// ------------------------------------------------------------------- form

const field = (id: string) => byId(id) as HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement;

function fillForm(entry?: LearningEntry) {
  field("f-observation").value = entry?.observation ?? "";
  field("f-source").value = entry?.evidence.source ?? "owner_observation";
  field("f-sample").value = entry?.evidence.sample ?? "";
  field("f-dates").value = entry?.evidence.dateRange ?? "";
  field("f-reference").value = entry?.evidence.reference ?? "";
  field("f-hypothesis").value = entry?.hypothesis ?? "";
  field("f-change").value = entry?.proposedChange ?? "";
  field("f-status").value = entry?.status ?? "open";
  field("f-outcome").value = entry?.outcome ?? "";
  syncMeasurementFields();
}

/**
 * A sample and a date describe something somebody looked at. Only a source that
 * observed nothing is refused them, and the note says which case this is rather
 * than leaving a disabled field unexplained.
 */
function syncMeasurementFields() {
  const source = field("f-source").value;
  const observed = isObserved(source);
  for (const id of ["f-sample", "f-dates"]) {
    const input = field(id);
    input.disabled = !observed;
    if (!observed) input.value = "";
  }
  byId("measurement-note").textContent = observed
    ? isMeasured(source)
      ? "Counted by something. A sample and a date range belong here, and the entry is marked as measured."
      : "Somebody looked at something. A sample and a date range belong here; the entry is marked as observed rather than measured."
    : "Nothing was observed here, so there is nothing a sample size could be a sample of. Both fields are switched off.";
}

function startEdit(id: string) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  editing = id;
  fillForm(entry);
  byId("form-title").textContent = entry.demo ? "Editing an example entry" : "Editing an entry";
  byId("cancel-edit").hidden = false;
  byId("f-observation").scrollIntoView({ block: "center" });
}

function cancelEdit() {
  editing = null;
  fillForm();
  byId("form-title").textContent = "Add what you noticed";
  byId("cancel-edit").hidden = true;
  showProblems([]);
}

function showProblems(problems: { field: string; message: string }[]) {
  const host = byId("problems");
  clear(host);
  host.hidden = problems.length === 0;
  for (const p of problems) host.appendChild(el("p", "problem", p.message));
}

function submit() {
  const now = new Date().toISOString();
  const source = field("f-source").value;
  const draft: Partial<LearningEntry> = {
    observation: field("f-observation").value.trim(),
    evidence: {
      source: source as LearningEntry["evidence"]["source"],
      sample: field("f-sample").value.trim() || undefined,
      dateRange: field("f-dates").value.trim() || undefined,
      reference: field("f-reference").value.trim() || undefined,
    },
    hypothesis: field("f-hypothesis").value.trim() || undefined,
    proposedChange: field("f-change").value.trim(),
    status: field("f-status").value as StatusId,
    outcome: field("f-outcome").value.trim() || undefined,
  };

  const problems = validateEntry(draft);
  showProblems(problems);
  if (problems.length > 0) return;

  if (editing) {
    entries = entries.map((e) => (e.id === editing ? ({ ...e, ...draft, id: e.id, createdAt: e.createdAt, updatedAt: now } as LearningEntry) : e));
  } else {
    entries = [...entries, { ...draft, id: newId(), createdAt: now, updatedAt: now } as LearningEntry];
  }
  save();
  cancelEdit();
  render();
}

function renderPending() {
  const host = byId("pending");
  clear(host);
  host.hidden = pending === null;
  if (!pending) return;

  const box = el("div", "banner");
  box.appendChild(el("strong", undefined, `${pending.name}: read, and not applied.`));
  box.appendChild(
    el(
      "p",
      undefined,
      `${pending.entries.length} ${pending.entries.length === 1 ? "entry" : "entries"} can be loaded. You have ${entries.length} here now. Nothing has changed yet.`,
    ),
  );
  for (const note of pending.notes) box.appendChild(el("p", "problem", note));
  if (pending.entries.length === 0) box.appendChild(el("p", "problem", "There is nothing in it to load. Replacing would empty the register, so that choice is not offered."));

  const actions = el("div", "toolbar");
  if (pending.entries.length > 0) {
    const merge = el("button", undefined, "Add these to what is here");
    merge.type = "button";
    merge.addEventListener("click", () => applyPending("merge"));
    actions.appendChild(merge);

    const replace = el("button", undefined, `Replace all ${entries.length}`);
    replace.type = "button";
    replace.addEventListener("click", () => applyPending("replace"));
    actions.appendChild(replace);
  }
  const cancel = el("button", "link", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    pending = null;
    renderPending();
    setSaveState("Nothing was changed.");
  });
  actions.appendChild(cancel);
  box.appendChild(actions);
  host.appendChild(box);
}

/** Merge keeps everything and renames a collision; replace is only ever explicit. */
function applyPending(how: "merge" | "replace") {
  if (!pending) return;
  const incoming = pending.entries;
  const name = pending.name;

  if (how === "replace") {
    entries = incoming;
  } else {
    const taken = new Set(entries.map((e) => e.id));
    entries = [
      ...entries,
      ...incoming.map((entry) => {
        if (!taken.has(entry.id)) {
          taken.add(entry.id);
          return entry;
        }
        // Keeping both rather than overwriting one with the other.
        const id = newId();
        taken.add(id);
        return { ...entry, id };
      }),
    ];
  }

  pending = null;
  renderPending();
  render();
  const saved = save();
  if (saved) setSaveState(`${how === "replace" ? "Replaced with" : "Added"} ${incoming.length} ${incoming.length === 1 ? "entry" : "entries"} from ${name}.`);
}

function renderRescue() {
  const host = byId("rescue");
  clear(host);
  host.hidden = unreadable === null;
  if (!unreadable) return;

  const box = el("div", "banner bad-banner");
  box.appendChild(el("strong", undefined, "Saved notes could not be read."));
  box.appendChild(el("p", undefined, unreadable.reason));
  box.appendChild(el("p", undefined, "They have not been changed and nothing will be written over them while this message is here. Save the raw text first, then decide what to do with it."));
  if (unreadable.raw !== "") {
    const rescue = el("button", undefined, "Save the raw text to a file");
    rescue.type = "button";
    rescue.addEventListener("click", () => download(`learning-register-unreadable-${new Date().toISOString().slice(0, 10)}.txt`, unreadable!.raw));
    box.appendChild(rescue);

    const discard = el("button", "link", "I have a copy: start a new register");
    discard.type = "button";
    discard.addEventListener("click", () => {
      unreadable = null;
      renderRescue();
      save();
      render();
    });
    box.appendChild(discard);
  }
  host.appendChild(box);
}

function render() {
  renderRescue();
  renderPending();
  renderSummary();
  renderEntries();
}

// ---------------------------------------------------------------- wiring

/** The two vocabularies, filled from the domain so the page cannot offer a value the validator refuses. */
function fillChoices() {
  const source = byId("f-source") as HTMLSelectElement;
  for (const s of EVIDENCE_SOURCES) {
    const option = el("option", undefined, s.measured ? `${s.label} (a measurement)` : s.label);
    option.value = s.id;
    source.appendChild(option);
  }
  const status = byId("f-status") as HTMLSelectElement;
  for (const s of STATUSES) {
    const option = el("option", undefined, s.label);
    option.value = s.id;
    status.appendChild(option);
  }
}

export function start() {
  load();
  fillChoices();
  renderMetrics();
  render();
  fillForm();
  if (unreadable) setSaveState("Saved notes could not be read. Nothing has been written over them.", true);
  else setSaveState(entries.length > 0 ? "loaded from this browser" : "nothing saved yet");

  byId("f-source").addEventListener("change", syncMeasurementFields);
  byId("save-entry").addEventListener("click", submit);
  byId("cancel-edit").addEventListener("click", cancelEdit);

  byId("export").addEventListener("click", () => {
    download(`learning-register-${new Date().toISOString().slice(0, 10)}.json`, serialiseRegister(entries));
  });

  byId("import").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";
    if (file.size > MAX_REGISTER_BYTES) {
      setSaveState(`That file is ${Math.round(file.size / 1000)} kB. A register is notes, not a database.`, true);
      return;
    }
    const parsed = parseRegister(await file.text());
    if (!parsed.ok) {
      setSaveState(`That file was not read, and nothing here was touched. ${parsed.reason}`, true);
      return;
    }
    // Read, and nothing applied. Replacing what the owner has written is a
    // decision they make after seeing what is in the file, not a side effect of
    // choosing one. The first version replaced everything immediately, even
    // when every entry in the file had been rejected.
    pending = { entries: parsed.entries, notes: parsed.notes, name: file.name };
    renderPending();
  });

  byId("load-demo").addEventListener("click", () => {
    // Kept apart, and marked. Example entries are about an imaginary site.
    entries = [...entries.filter((e) => !e.demo), ...DEMO_ENTRIES];
    save();
    render();
  });

  byId("clear-demo").addEventListener("click", () => {
    entries = entries.filter((e) => !e.demo);
    save();
    render();
  });
}
