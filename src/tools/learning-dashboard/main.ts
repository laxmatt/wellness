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
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = parseRegister(raw);
    if (parsed.ok) entries = parsed.entries;
  } catch {
    // A browser with storage switched off. The register is empty this session
    // and the page says so rather than failing to open.
  }
}

function save() {
  try {
    window.localStorage.setItem(KEY, serialiseRegister(entries));
    setSaveState("saved in this browser");
  } catch {
    setSaveState("could not be saved in this browser. Export the file to keep it.", true);
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

    const change = el("p", "change");
    change.appendChild(el("strong", undefined, "Proposed change: "));
    change.appendChild(document.createTextNode(entry.proposedChange));
    card.appendChild(change);

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
 * The measurement fields are only usable when the source measures something.
 * The validator refuses them anyway; disabling them says why before somebody
 * types into them.
 */
function syncMeasurementFields() {
  const measured = isMeasured(field("f-source").value);
  for (const id of ["f-sample", "f-dates"]) {
    const input = field(id);
    input.disabled = !measured;
    if (!measured) input.value = "";
  }
  byId("measurement-note").textContent = measured
    ? "This source measures something, so a sample size and a date range belong here."
    : "A sample size and a date range belong to a measurement. This source is not one, so they are switched off: putting them here would make a note look like data.";
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

function render() {
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
  setSaveState(entries.length > 0 ? "loaded from this browser" : "nothing saved yet");

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
    if (file.size > MAX_REGISTER_BYTES) {
      setSaveState(`That file is ${Math.round(file.size / 1000)} kB. A register is notes, not a database.`, true);
      return;
    }
    const parsed = parseRegister(await file.text());
    input.value = "";
    if (!parsed.ok) {
      setSaveState(`That file was not read. ${parsed.reason}`, true);
      return;
    }
    entries = parsed.entries;
    save();
    render();
    setSaveState(`Loaded ${entries.length} ${entries.length === 1 ? "entry" : "entries"} from the file.${parsed.notes.length > 0 ? ` ${parsed.notes.join(" ")}` : ""}`);
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
