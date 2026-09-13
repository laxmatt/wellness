/**
 * The supplier import demonstration, as a page that runs from a file on disk.
 *
 * There is no server here and no route. This is bundled into one HTML file that
 * opens with file://, which is why it cannot become a public admin page by
 * accident: there is nothing to expose. It reads a file the operator picks,
 * in their own browser, and writes nothing anywhere.
 *
 * Everything it shows comes from src/domain/import, so what the tests check and
 * what the page displays are the same code.
 *
 * Two rules in the rendering itself. File content reaches the page only through
 * textContent, never innerHTML, so a cell containing markup is text on screen.
 * And no URL from a file is ever put in an href or fetched: a supplier's link is
 * shown as the characters it is made of.
 */

import { readCsv, LIMITS, type CsvTable } from "../../domain/import/csv";
import { DRINK_FIELDS } from "../../domain/import/fields";
import { buildDrafts, STANDING_REVIEW, type DraftSet } from "../../domain/import/draft";
import { MAX_MAPPING_BYTES, parseMapping, serialiseMapping, suggestMapping, type ColumnMapping } from "../../domain/import/mapping";
import { SUPPORTED_CURRENCIES, SUPPORTED_UNITS, unitFromHeader, type CellValue } from "../../domain/import/values";

type State = { table?: CsvTable; mapping?: ColumnMapping; fileName?: string };
const state: State = {};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // textContent, always. Supplier text is data, and this is the line that keeps
  // it data rather than markup.
  if (text !== undefined) node.textContent = text;
  return node;
};

const byId = (id: string) => document.getElementById(id)!;
const clear = (node: HTMLElement) => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

function status(message: string, kind: "ok" | "bad" | "plain" = "plain") {
  const node = byId("status");
  clear(node);
  node.className = `status ${kind}`;
  node.appendChild(el("p", undefined, message));
}

// --------------------------------------------------------------- the file

async function loadFile(file: File) {
  state.table = undefined;
  state.mapping = undefined;
  state.fileName = file.name;

  if (file.size > LIMITS.bytes) {
    status(`${file.name} is ${Math.round(file.size / 1000)} kB. This demonstration reads files up to ${LIMITS.bytes / 1000} kB.`, "bad");
    render();
    return;
  }
  const text = await file.text();
  const result = readCsv(text, file.size);
  if (!result.ok) {
    status(`${file.name} was not read. ${result.reason}`, "bad");
    render();
    return;
  }
  state.table = result;
  const suggestion = suggestMapping(result.headers, file.name);
  state.mapping = suggestion.mapping;
  const mapped = Object.keys(suggestion.mapping.columns).length;
  status(`${file.name}: ${result.rows.length} rows, ${result.headers.length} columns, ${mapped} of ${DRINK_FIELDS.length} fields matched by name. Nothing has been saved.`, "ok");
  render();
}

// ------------------------------------------------------------- the mapping

function renderMapping() {
  const host = byId("mapping");
  clear(host);
  const table = state.table;
  if (!table || !state.mapping) return;

  for (const note of table.notes) host.appendChild(el("p", "note", note));

  const grid = el("div", "grid");
  for (const field of DRINK_FIELDS) {
    const row = el("div", "row");
    const label = el("label", "field");
    label.textContent = field.label + (field.required ? " (required)" : "");
    label.htmlFor = `map-${field.key}`;

    const select = el("select");
    select.id = `map-${field.key}`;
    const none = el("option", undefined, "not mapped");
    none.value = "";
    select.appendChild(none);
    for (const header of table.headers) {
      const option = el("option", undefined, header);
      option.value = header;
      if (state.mapping.columns[field.key] === header) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      if (select.value === "") delete state.mapping!.columns[field.key];
      else state.mapping!.columns[field.key] = select.value;
      render();
    });

    row.appendChild(label);
    row.appendChild(select);

    // A measure column that states no unit anywhere reads nothing. This is
    // where a person states one, rather than the tool assuming the one it
    // happens to store.
    if (field.kind === "measure") {
      const chosen = state.mapping.columns[field.key];
      const stated = chosen ? unitFromHeader(chosen) : undefined;
      const unitLabel = el("label", "unit");
      unitLabel.htmlFor = `unit-${field.key}`;
      unitLabel.textContent = stated ? `Unit: ${stated}, from the heading` : "Unit, if the file states none";
      const unitSelect = el("select");
      unitSelect.id = `unit-${field.key}`;
      unitSelect.disabled = stated !== undefined;
      const blank = el("option", undefined, stated ? stated : "not stated");
      blank.value = "";
      unitSelect.appendChild(blank);
      if (!stated) {
        for (const u of SUPPORTED_UNITS) {
          const option = el("option", undefined, u);
          option.value = u;
          if (state.mapping.units?.[field.key] === u) option.selected = true;
          unitSelect.appendChild(option);
        }
      }
      unitSelect.addEventListener("change", () => {
        const units = { ...(state.mapping!.units ?? {}) };
        if (unitSelect.value === "") delete units[field.key];
        else units[field.key] = unitSelect.value;
        state.mapping!.units = Object.keys(units).length > 0 ? units : undefined;
        render();
      });
      row.appendChild(unitLabel);
      row.appendChild(unitSelect);
    }

    if (field.kind === "count") {
      const basis = el("label", "basis");
      const box = el("input");
      box.type = "checkbox";
      box.id = "servings-basis";
      box.checked = state.mapping.servingsBasis === true;
      box.addEventListener("change", () => {
        state.mapping!.servingsBasis = box.checked ? true : undefined;
        render();
      });
      basis.appendChild(box);
      basis.appendChild(el("span", undefined, " One item in a pack is one serving"));
      row.appendChild(basis);
    }

    row.appendChild(el("p", "review", field.review));
    row.appendChild(el("p", "path", `Would land in ${field.catalogPath}`));
    grid.appendChild(row);
  }
  host.appendChild(grid);

  const unmapped = table.headers.filter((h) => !Object.values(state.mapping!.columns).includes(h));
  if (unmapped.length > 0) {
    host.appendChild(el("p", "note", `Columns this tool has no field for, and does not read: ${unmapped.join(", ")}.`));
  }
}

// -------------------------------------------------------------- the drafts

function renderDrafts() {
  const host = byId("drafts");
  clear(host);
  if (!state.table || !state.mapping) return;

  const set: DraftSet = buildDrafts(state.table.headers, state.table.rows, state.mapping);

  if (set.missingRequired.length > 0) {
    const warn = el("div", "banner bad");
    warn.appendChild(el("p", undefined, `No column is mapped to ${set.missingRequired.map((f) => f.label).join(", ")}. A draft needs ${set.missingRequired.length === 1 ? "it" : "them"}, so every row below is blocked.`));
    host.appendChild(warn);
  }

  const totals = el("p", "totals");
  totals.textContent = `${set.totals.rows} rows: ${set.totals.withBlockers} blocked, ${set.totals.withChecks} to confirm, ${set.totals.clean} with nothing flagged.`;
  host.appendChild(totals);

  for (const draft of set.drafts) {
    const card = el("article", `draft ${draft.blockers > 0 ? "blocked" : draft.checks > 0 ? "checks" : "clean"}`);
    const head = el("header");
    head.appendChild(el("h3", undefined, draft.label));
    head.appendChild(el("span", "rownum", `row ${draft.row}`));
    head.appendChild(el("span", "verdict", draft.blockers > 0 ? `${draft.blockers} blocked` : draft.checks > 0 ? `${draft.checks} to confirm` : "nothing flagged"));
    card.appendChild(head);

    const table = el("table");
    const thead = el("thead");
    const hrow = el("tr");
    for (const h of ["Field", "In the file", "Read as", "Flags"]) hrow.appendChild(el("th", undefined, h));
    thead.appendChild(hrow);
    table.appendChild(thead);

    const body = el("tbody");
    for (const f of draft.fields) {
      const tr = el("tr", f.flags.some((x) => x.severity === "blocker") ? "bad" : "");
      tr.appendChild(el("td", "k", f.field.label));
      // The raw text, as it is in the file, including whatever it contains.
      tr.appendChild(el("td", "raw", f.raw === "" ? "(empty)" : f.raw));
      tr.appendChild(el("td", "val", describe(f.value)));
      const flags = el("td");
      if (f.flags.length === 0) flags.textContent = "";
      for (const flag of f.flags) flags.appendChild(el("p", `flag ${flag.severity}`, `${flag.severity === "blocker" ? "Blocked" : "Confirm"}: ${flag.message}`));
      tr.appendChild(flags);
      body.appendChild(tr);
    }
    table.appendChild(body);
    card.appendChild(table);
    host.appendChild(card);
  }
}

function describe(value: CellValue | undefined): string {
  if (!value) return "not read";
  switch (value.kind) {
    case "number":
      return `${value.value}${value.unit ? ` ${value.unit}` : ""}`;
    case "money":
      return `${(value.minor / 100).toFixed(2)} ${value.currency} (${value.minor} minor units)`;
    case "integer":
      return String(value.value);
    case "list":
      return value.value.join(", ");
    case "text":
      return value.value;
  }
}

function renderReview() {
  const host = byId("review");
  clear(host);
  host.appendChild(el("h2", undefined, "Still to do, on every row, however clean the file is"));
  host.appendChild(el("p", "note", "None of this is decided by parsing. A file with nothing flagged has not answered any of it."));
  const list = el("ol");
  for (const item of STANDING_REVIEW) {
    const li = el("li");
    li.appendChild(el("strong", undefined, item.title));
    li.appendChild(el("p", undefined, item.detail));
    list.appendChild(li);
  }
  host.appendChild(list);
}

function render() {
  renderMapping();
  renderDrafts();
  byId("currency-row").hidden = !state.table;
  byId("mapping-actions").hidden = !state.table;
}

// ------------------------------------------------------------------ wiring

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function start() {
  renderReview();
  status("No file loaded. Nothing on this page is saved, sent anywhere, or published.");

  byId("file").addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void loadFile(file);
  });

  const currency = byId("currency") as HTMLInputElement;
  currency.addEventListener("change", () => {
    if (!state.mapping) return;
    const value = currency.value.trim().toUpperCase();
    if (value !== "" && !(SUPPORTED_CURRENCIES as readonly string[]).includes(value)) {
      state.mapping.currency = undefined;
      status(`"${currency.value.trim()}" is not a currency this reads. It handles ${SUPPORTED_CURRENCIES.join(", ")}, all of which divide into a hundred.`, "bad");
      render();
      return;
    }
    state.mapping.currency = value === "" ? undefined : value;
    currency.value = value;
    render();
  });

  byId("export-mapping").addEventListener("click", () => {
    if (!state.mapping) return;
    download(`mapping-${(state.fileName ?? "supplier").replace(/[^a-z0-9.-]/gi, "-")}.json`, serialiseMapping(state.mapping));
  });

  byId("mapping-file").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !state.table) return;
    if (file.size > MAX_MAPPING_BYTES) {
      status(`That mapping file is ${Math.round(file.size / 1000)} kB. A mapping is a handful of column names.`, "bad");
      return;
    }
    const parsed = parseMapping(await file.text(), state.table.headers);
    if (!parsed.ok) {
      status(`That mapping was not used. ${parsed.reason}`, "bad");
      return;
    }
    state.mapping = parsed.mapping;
    // Cleared, not left behind. A mapping that states no currency must not
    // leave the previous one showing in a box the state no longer holds.
    (byId("currency") as HTMLInputElement).value = parsed.mapping.currency ?? "";
    status(`Mapping "${parsed.mapping.name}" applied.${parsed.notes.length > 0 ? ` ${parsed.notes.join(" ")}` : ""}`, "ok");
    render();
  });
}
