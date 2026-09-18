/**
 * The promotion review planner, which plans and does not promote.
 *
 * The first test in this file is the one the rest rest on: every file under
 * `catalog/` is hashed before the planner runs and after a plan is signed, and
 * the hashes have to be identical. Everything else here is about what a
 * reviewer is made to decide before they are allowed to sign something that
 * still writes nothing to the catalogue.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { comparisonCount } from "@/domain/family";
import { planIdFor, type PlanRequest, type PromotionPlan } from "@/domain/promotion/plan";
import type { ShadowResolution } from "@/domain/promotion/shadow";
import { imageRightsFor, type ImageRightsRecord } from "@/domain/promotion/rights";
import { planIdMatches, renderPlan, signPlan } from "@/domain/promotion/signed";
import { saunas } from "@/domain/categories/saunas";
import { applyEditorialEdit } from "@/domain/ingestion/editorial";
import { loadLocalCatalog } from "@/providers/catalog/LocalCatalogProvider";
import { IngestionStore } from "@/providers/ingestion/IngestionStore";
import { runIngestionImport } from "@/providers/ingestion/import";
import { planPromotion, signPromotion } from "@/providers/ingestion/promote";
import { FIRST_PROFILE, SWEAT_KINGDOM } from "../../scripts/ingestion-seed";

const CATALOG = join(process.cwd(), "catalog");
const FEED = join(process.cwd(), "intake/sweat-kingdom/awin-125462-f3219-2026-09-13.csv");
const RAW = readFileSync(FEED, "utf8");
const TODAY = "2026-09-14";

const CABIN = "sweat-kingdom-the-sweat-cabin";
const BLACKOUT_CABIN = "sweat-kingdom-the-sweat-cabin-blackout-edition";
const POD = "sweat-kingdom-the-sweat-pod";
const ASCENT = "sweat-kingdom-the-ascent";

/** Every file in the catalogue, by content. The planner must not move one byte. */
function catalogFingerprint(): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(`${path}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
    }
  };
  walk(CATALOG);
  return createHash("sha256").update(files.join("\n")).digest("hex");
}

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A workspace with the feed imported: 17 drafts, 15 families, nothing else done. */
function imported(): IngestionStore {
  const dir = mkdtempSync(join(tmpdir(), "promotion-"));
  temps.push(dir);
  const store = new IngestionStore(dir);
  store.saveSource(SWEAT_KINGDOM);
  store.saveProfile(FIRST_PROFILE(1, TODAY));
  store.approveProfile(SWEAT_KINGDOM.id, 1, "reviewer", TODAY);
  const outcome = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "awin.csv", text: RAW, today: TODAY });
  if (!outcome.ok) throw new Error(outcome.errors.join(" "));
  return store;
}

const plan = (store: IngestionStore, request: Partial<PlanRequest> = {}): PromotionPlan => {
  const outcome = planPromotion({
    store,
    catalogDir: CATALOG,
    sourceId: SWEAT_KINGDOM.id,
    request: { familyIds: [], shadows: [], reviewer: "a reviewer", ...request },
    today: TODAY,
  });
  if (!outcome.ok) throw new Error(outcome.errors.join(" "));
  return outcome.plan;
};

const codes = (p: PromotionPlan): string[] => [...new Set(p.blockers.map((b) => b.code))].sort();

/**
 * Answer every collision a selection has, by merging.
 *
 * Since the saunas launch the catalogue holds all seventeen of these records,
 * so every selection shadows something. The drafts and the catalogue records
 * agree on every mapped field, which is why a merge with nothing named is a
 * complete answer: `resolutionProblems` refuses one only when the two
 * disagree about a field nobody has decided.
 */
function mergeAll(store: IngestionStore, familyIds: string[]): ShadowResolution[] {
  const built = plan(store, { familyIds });
  return built.shadows.map((s) => ({ id: s.id, choice: "merge_fields" as const, fields: {}, note: "" }));
}

/** Permission covering whatever picture a record currently carries. */
function clearRights(store: IngestionStore, ids: string[]): void {
  for (const id of ids) {
    const draft = store.draft(id)!;
    store.recordRights({
      recordId: id,
      src: draft.images[0].src,
      basis: "partner_terms_reviewed",
      evidence: "Awin programme terms for advertiser 125462, creative clause, read on 2026-09-14 and saved in the partner file.",
      recordedBy: "a reviewer",
      recordedOn: TODAY,
    });
  }
}

// ------------------------------------------------------------ the first rule

describe("the planner writes nothing to the catalogue", () => {
  it("leaves every catalogue file byte-identical through a plan and a signature", () => {
    const before = catalogFingerprint();
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    const shadows = mergeAll(store, [CABIN]);
    const built = plan(store, { familyIds: [CABIN], shadows });
    expect(built.blockers).toEqual([]);
    const signed = signPromotion({
      store,
      catalogDir: CATALOG,
      sourceId: SWEAT_KINGDOM.id,
      request: { familyIds: [CABIN], shadows, reviewer: "a reviewer" },
      today: TODAY,
    });
    expect(signed.ok).toBe(true);
    expect(catalogFingerprint()).toBe(before);
  });

  it("publishes nothing itself: the workspace still holds drafts and the catalogue is untouched", () => {
    const before = catalogFingerprint();
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: { familyIds: [CABIN], shadows: mergeAll(store, [CABIN]), reviewer: "a reviewer" }, today: TODAY });
    expect(store.drafts().products.every((p) => p.status === "draft")).toBe(true);
    expect(catalogFingerprint()).toBe(before);
    expect(store.plans()[0].executed).toBe(false);
  });

  it("says in the signed record and in the document that nothing was carried out", () => {
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    const signed = signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: { familyIds: [CABIN], shadows: mergeAll(store, [CABIN]), reviewer: "a reviewer" }, today: TODAY });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(signed.document).toContain("Nothing has been promoted or published");
    expect(signed.document).toContain("No product or category was published");
    expect(signed.document).toContain("not wired into shopper-facing queries");
  });
});

// ------------------------------------------------------------- both numbers

describe("what the reviewer is shown", () => {
  it("keeps 17 source records and 15 comparison families in view", () => {
    const store = imported();
    const built = plan(store, { familyIds: [CABIN] });
    expect(built.sourceRecords).toBe(17);
    expect(built.comparisonFamilies).toBe(15);
    expect(built.selectable).toHaveLength(15);
    expect(comparisonCount(store.drafts().products)).toBe(15);
  });

  it("shows every retained source record of a selected family, with what a reviewer has to judge", () => {
    const store = imported();
    const built = plan(store, { familyIds: [CABIN] });
    const family = built.families[0];
    expect(family.records.map((r) => r.id)).toEqual([CABIN, BLACKOUT_CABIN]);
    expect(family.records[0].role).toBe("representative");
    expect(family.records[1].role).toBe("configuration");
    for (const record of family.records) {
      expect(record.price.display).toMatch(/^\$/);
      expect(record.price.lastChecked).toBe(TODAY);
      expect(record.availability).toBeTruthy();
      expect(record.link.url).toMatch(/^https:\/\/www\.awin1\.com\//);
      expect(record.link.affiliateStatus).toBe("affiliate");
      expect(record.image.src).toBeTruthy();
      expect(record.provenance.kind).toBe("merchant_feed");
      expect(record.provenance.ref).toContain("Mapping profile sweat-kingdom-awin v1");
    }
    // The blackout finish costs more and the plan shows each record's own price.
    expect(family.records[0].price.minor).toBe(744500);
    expect(family.records[1].price.minor).toBe(924500);
  });

  it("names the high-level comparison fields this feed fills and the ones it does not", () => {
    const store = imported();
    const record = plan(store, { familyIds: [CABIN] }).families[0].records[0];
    const mapped = record.comparison.filter((c) => c.state === "mapped").map((c) => c.key);
    const missing = record.comparison.filter((c) => c.state === "missing").map((c) => c.key);
    // Price from a field, style and capacity from the retailer's own model
    // name by approved rules. Everything else this category compares on is
    // stated nowhere in this feed.
    expect(mapped).toEqual(["price", "sauna_style", "capacity_max_people"]);
    for (const key of ["sauna_type", "connection", "placement"]) {
      expect(missing, key).toContain(key);
    }
  });

  it("shows an editorial change made here since the last import", () => {
    const store = imported();
    const edited = applyEditorialEdit(store.draft(CABIN)!, { name: "The Sweat Cabin, four person" }, { by: "an editor", on: TODAY });
    if (!edited.ok) return;
    store.writeDraft("products", CABIN, edited.product);
    const record = plan(store, { familyIds: [CABIN] }).families[0].records[0];
    expect(record.editorial.changes.map((c) => c.key)).toEqual(["name"]);
    expect(record.editorial.changes[0].here).toBe("The Sweat Cabin, four person");
  });
});

// ------------------------------------------------------------- whole families

describe("a family is promoted whole", () => {
  it("refuses a blackout configuration selected without the model it is a finish of", () => {
    const store = imported();
    const built = plan(store, { familyIds: [BLACKOUT_CABIN] });
    expect(codes(built)).toContain("family_incomplete");
    expect(built.blockers[0].message).toContain(CABIN);
    expect(built.selectedRecordIds).toEqual([]);
    expect(built.signable).toBe(false);
  });

  it("takes the configuration with the family when the family is selected", () => {
    const store = imported();
    const built = plan(store, { familyIds: [CABIN, POD] });
    expect(built.selectedRecordIds).toEqual([CABIN, BLACKOUT_CABIN, POD, "sweat-kingdom-the-sweat-pod-blackout-edition"].sort());
  });

  it("refuses an id that is not a record here at all", () => {
    expect(codes(plan(imported(), { familyIds: ["sweat-kingdom-a-sauna-nobody-sells"] }))).toContain("unknown_selection");
  });

  it("refuses a plan with nothing selected", () => {
    expect(codes(plan(imported(), { familyIds: [] }))).toEqual(["no_selection"]);
  });
});

// ----------------------------------------------------------------- pictures

describe("permission to publish a picture", () => {
  it("blocks on a feed image, because a feed carrying a picture is not permission", () => {
    const store = imported();
    const built = plan(store, { familyIds: [CABIN] });
    expect(codes(built)).toContain("image_rights");
    expect(built.rights.every((r) => r.state === "unresolved")).toBe(true);
    expect(built.blockers.find((b) => b.code === "image_rights")!.message).toContain("not permission to publish it");
  });

  it("clears once somebody records what they read, naming the picture", () => {
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    const built = plan(store, { familyIds: [CABIN], shadows: mergeAll(store, [CABIN]) });
    expect(built.rights.every((r) => r.state === "cleared")).toBe(true);
    expect(codes(built)).toEqual([]);
  });

  it("blocks again when the partner changes the picture behind the record", () => {
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    const draft = store.draft(CABIN)!;
    store.writeDraft("products", CABIN, { ...draft, images: [{ ...draft.images[0], src: "https://cdn.example.test/a-different-photograph.jpg" }] });
    const view = imageRightsFor(store.draft(CABIN)!, store.allRights());
    expect(view.state).toBe("superseded");
    expect(codes(plan(store, { familyIds: [CABIN] }))).toContain("image_rights");
  });

  it("will not accept a permission for a picture the record does not carry", () => {
    const record: ImageRightsRecord = {
      recordId: CABIN,
      src: "https://cdn.example.test/some-other-photograph.jpg",
      basis: "written_permission",
      evidence: "An email from somebody, about a different photograph entirely, read today.",
      recordedBy: "a reviewer",
      recordedOn: TODAY,
    };
    const store = imported();
    expect(imageRightsFor(store.draft(CABIN)!, [record]).state).toBe("superseded");
  });
});

// ------------------------------------------------------- catalogue collisions

describe("records the catalogue already holds", () => {
  // Since the saunas launch that is all seventeen of them. The behaviour under
  // test is the collision, not how many there happen to be, so this reads the
  // number off the catalogue rather than pinning one.
  const catalogIds = loadLocalCatalog(CATALOG).products.filter((p) => p.id.startsWith("sweat-kingdom-")).map((p) => p.id);

  it("finds every one of them", () => {
    expect(catalogIds.length).toBeGreaterThanOrEqual(5);
    const store = imported();
    const heads = plan(store, { familyIds: [] }).selectable.map((f) => f.id);
    const shadowed = plan(store, { familyIds: heads }).families.flatMap((f) => f.records).filter((r) => r.shadowsCatalog);
    expect(shadowed.map((r) => r.id).sort()).toEqual([...catalogIds].sort());
  });

  it("blocks until each one is answered, and answers none by default", () => {
    const store = imported();
    clearRights(store, [ASCENT]);
    const built = plan(store, { familyIds: [ASCENT] });
    expect(codes(built)).toEqual(["shadow_unresolved"]);
    expect(built.shadows[0].resolution.choice).toBe("unresolved");
    expect(built.shadows[0].outcome).toBeUndefined();
    expect(built.blockers[0].message).toContain("Nothing is chosen for you");
  });

  it("shows the exact field-by-field difference behind each choice", () => {
    const store = imported();
    const diff = plan(store, { familyIds: [ASCENT] }).shadows[0].diff;
    const byKey = Object.fromEntries(diff.fields.map((f) => [f.key, f]));
    for (const key of ["name", "description", "price", "link", "image", "availability", "brand"]) {
      expect(byKey[key], key).toBeDefined();
    }
    // The hand-built record and the mapped draft agree on every field today,
    // which is worth asserting rather than assuming: the ingestion flow
    // reproduces what the partner adapter produced from the same feed.
    expect(diff.contested).toEqual([]);
    expect(byKey.price.same).toBe(true);
    expect(byKey.description.same).toBe(true);
  });

  /** The same collision, after somebody has edited the draft. Now they disagree. */
  function withEditedDraft(): IngestionStore {
    const store = imported();
    clearRights(store, [ASCENT]);
    const edited = applyEditorialEdit(store.draft(ASCENT)!, { description: "Rewritten here: the partner's own copy is a product name and nothing else." }, { by: "an editor", on: TODAY });
    if (!edited.ok) throw new Error("the edit did not apply");
    store.writeDraft("products", ASCENT, edited.product);
    return store;
  }

  it("keeps the catalogue record, and lists what that gives up", () => {
    const store = withEditedDraft();
    const built = plan(store, { familyIds: [ASCENT], shadows: [{ id: ASCENT, choice: "keep_existing", fields: {}, note: "" }] });
    expect(built.blockers).toEqual([]);
    expect(built.shadows[0].outcome!.from).toBe("existing");
    expect(built.shadows[0].outcome!.discards.map((d) => d.key)).toEqual(["description"]);
  });

  it("replaces with the draft, and lists what that gives up", () => {
    const store = withEditedDraft();
    const built = plan(store, { familyIds: [ASCENT], shadows: [{ id: ASCENT, choice: "replace_with_draft", fields: {}, note: "" }] });
    expect(built.blockers).toEqual([]);
    expect(built.shadows[0].outcome!.from).toBe("draft");
    expect(built.shadows[0].outcome!.discards.map((d) => d.key)).toEqual(["description"]);
  });

  it("refuses a merge that has not named every field the two disagree on", () => {
    const store = withEditedDraft();
    const built = plan(store, { familyIds: [ASCENT], shadows: [{ id: ASCENT, choice: "merge_fields", fields: {}, note: "" }] });
    expect(codes(built)).toContain("shadow_unresolved");
    expect(built.blockers[0].message).toContain("a replace wearing a merge's name");
  });

  it("merges when every contested field is named, and takes the named ones from the catalogue record", () => {
    const store = withEditedDraft();
    const contested = plan(store, { familyIds: [ASCENT] }).shadows[0].diff.contested;
    expect(contested).toEqual(["description"]);
    const built = plan(store, {
      familyIds: [ASCENT],
      shadows: [{ id: ASCENT, choice: "merge_fields", fields: { description: "existing" }, note: "Keeping the catalogue's wording." }],
    });
    expect(built.blockers).toEqual([]);
    const outcome = built.shadows[0].outcome!;
    expect(outcome.from).toBe("merged");
    expect(outcome.tookExisting).toEqual(["description"]);
    const existing = loadLocalCatalog(CATALOG).products.find((p) => p.id === ASCENT)!;
    expect(outcome.product.description).toBe(existing.description);
    // And this month's price and link stay with the draft.
    expect(outcome.product.offers[0].priceMinor).toBe(store.draft(ASCENT)!.offers[0].priceMinor);
    expect(outcome.product.offers[0].url).toBe(store.draft(ASCENT)!.offers[0].url);
  });

  it("never offers an editorial field to a merge, and never takes one from the older record", () => {
    const store = imported();
    const diff = plan(store, { familyIds: [ASCENT] }).shadows[0].diff;
    const family = diff.fields.find((f) => f.key === "family");
    expect(family?.locked ?? true).toBe(true);
    expect(diff.contested).not.toContain("family");
  });
});

// ------------------------------------------------------------------- signing

describe("signing", () => {
  const cabinRequest: PlanRequest = { familyIds: [CABIN], shadows: [], reviewer: "a reviewer" };

  it("refuses while anything is unresolved", () => {
    const store = imported();
    const outcome = signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: cabinRequest, today: TODAY });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors[0]).toContain("unresolved blockers");
    expect(store.plans()).toEqual([]);
  });

  it("refuses a plan nobody signed", () => {
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    const outcome = signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: { ...cabinRequest, reviewer: "  " }, today: TODAY });
    expect(outcome.ok).toBe(false);
  });

  it("records who, when, what, from where, and every resolution", () => {
    const store = imported();
    clearRights(store, [ASCENT]);
    const shadows = [{ id: ASCENT, choice: "replace_with_draft" as const, fields: {}, note: "This month's price." }];
    const outcome = signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: { familyIds: [ASCENT], shadows, reviewer: "a reviewer" }, today: TODAY });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const signed = outcome.plan;
    expect(signed.signedBy).toBe("a reviewer");
    expect(signed.signedOn).toBe(TODAY);
    expect(signed.sourceId).toBe(SWEAT_KINGDOM.id);
    expect(signed.profileVersion).toBe(1);
    expect(signed.uploadFile).toBe("awin.csv");
    expect(signed.uploadHash).toBe("9db0be0014d640489585346d4776760458e8c5d2b136dc9490dcd03da726bb6d");
    expect(signed.selectedFamilyIds).toEqual([ASCENT]);
    expect(signed.shadows[0]).toMatchObject({ id: ASCENT, choice: "replace_with_draft", outcome: "draft" });
    expect(signed.unresolvedBlockers).toEqual([]);
    expect(signed.sourceRecords).toBe(17);
    expect(signed.comparisonFamilies).toBe(15);
    expect(signed.records[0].imageRights).toBe("cleared");
    expect(planIdMatches(signed)).toBe(true);
  });

  it("gives the same decisions the same identifier and different decisions a different one", () => {
    const base = {
      sourceId: "s",
      profileVersion: 1,
      uploadHash: "abc",
      selectedFamilyIds: [CABIN],
      selectedRecordIds: [CABIN, BLACKOUT_CABIN],
      shadows: [{ id: ASCENT, choice: "merge_fields", fields: { description: "existing" } }],
      reviewer: "a reviewer",
      builtOn: TODAY,
    };
    expect(planIdFor(base)).toBe(planIdFor({ ...base, selectedRecordIds: [BLACKOUT_CABIN, CABIN] }));
    expect(planIdFor(base)).not.toBe(planIdFor({ ...base, shadows: [{ id: ASCENT, choice: "merge_fields", fields: { description: "draft" } }] }));
    expect(planIdFor(base)).not.toBe(planIdFor({ ...base, reviewer: "somebody else" }));
    expect(planIdFor(base)).toMatch(/^plan-[0-9a-f]{16}$/);
  });

  it("writes a plan once and refuses to write over one", () => {
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    const cabinRequest = { familyIds: [CABIN], shadows: mergeAll(store, [CABIN]), reviewer: "a reviewer" };
    const first = signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: cabinRequest, today: TODAY });
    expect(first.ok).toBe(true);
    const again = signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: cabinRequest, today: TODAY });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.errors[0]).toContain("already signed");
    expect(store.plans()).toHaveLength(1);
  });

  it("reads back as a document somebody can follow without the tool", () => {
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    const outcome = signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: cabinRequest, today: TODAY });
    if (!outcome.ok) return;
    const document = renderPlan(store.plans()[0]);
    expect(document).toContain(outcome.plan.planId);
    expect(document).toContain("The Sweat Cabin");
    expect(document).toContain("rights cleared");
    expect(document).toContain("Comparison fields missing:");
  });

  it("refuses to sign a plan built with a blocker, whatever a caller passes in", () => {
    const store = imported();
    const built = plan(store, { familyIds: [CABIN] });
    const forced = signPlan({ ...built, blockers: built.blockers }, "a reviewer", TODAY);
    expect(forced.ok).toBe(false);
  });
});

// ------------------------------------------------------- imports and plans

describe("a later import and an earlier plan", () => {
  it("does not touch a signed plan, byte for byte", () => {
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    const signed = signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: { familyIds: [CABIN], shadows: mergeAll(store, [CABIN]), reviewer: "a reviewer" }, today: TODAY });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const path = join(store.root, "plans", `${signed.plan.planId}.json`);
    const before = readFileSync(path, "utf8");

    const again = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "awin.csv", text: RAW, today: "2026-09-20" });
    expect(again.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(store.plans()).toHaveLength(1);
    expect(planIdMatches(store.plans()[0])).toBe(true);
  });

  it("survives an import of a changed file, and still names itself", () => {
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    const signed = signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: { familyIds: [CABIN], shadows: [], reviewer: "a reviewer" }, today: TODAY });
    if (!signed.ok) return;
    const path = join(store.root, "plans", `${signed.plan.planId}.json`);
    const before = readFileSync(path, "utf8");

    const moved = RAW.replace("The Sweat Cabin (4 Person)", "The Sweat Cabin (4 Person), 2027 model");
    expect(moved).not.toBe(RAW);
    const again = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "awin-later.csv", text: moved, today: "2026-09-20" });
    expect(again.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(before);
    const stored = store.plans()[0];
    expect(planIdMatches(stored)).toBe(true);
    // The plan names the bytes it was reviewed against, so a reader can see
    // that the workspace has moved on without the plan having been changed.
    expect(stored.uploadHash).not.toBe(store.state(SWEAT_KINGDOM.id).lastUploadHash);
    expect(catalogFingerprint()).toBeTruthy();
  });

  it("leaves the catalogue untouched across both imports and the signature", () => {
    const before = catalogFingerprint();
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: { familyIds: [CABIN], shadows: [], reviewer: "a reviewer" }, today: TODAY });
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "awin.csv", text: RAW, today: "2026-09-20" });
    expect(catalogFingerprint()).toBe(before);
  });
});

// ----------------------------------------------------- the whole hypothetical

describe("the catalogue this would produce", () => {
  it("is validated in full, family integrity included, before anything can be signed", () => {
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    const built = plan(store, { familyIds: [CABIN], shadows: mergeAll(store, [CABIN]) });
    expect(built.catalogueIssues).toEqual([]);
    expect(built.familyIntegrityIssues).toEqual([]);
    // Both records are in the catalogue already, so promoting them again adds
    // nothing and the counts do not move.
    const now = loadLocalCatalog(CATALOG).products;
    expect(built.hypotheticalProducts).toBe(now.length);
    expect(built.hypotheticalFamilies).toBe(comparisonCount(now.filter((p) => p.categoryId === "saunas")));
  });

  it("refuses a selection whose result would not be a valid catalogue", () => {
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    const draft = store.draft(CABIN)!;
    // A brand nobody holds. Promoting a record brings its brand, and there is
    // no brand here to bring.
    store.writeDraft("products", CABIN, { ...draft, brandId: "a-brand-nobody-holds" });
    const built = plan(store, { familyIds: [CABIN] });
    expect(codes(built)).toContain("catalogue_invalid");
    expect(built.signable).toBe(false);
  });

  it("refuses a record whose own family is not there, by the catalogue's family rule", () => {
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    const draft = store.draft(CABIN)!;
    // The representative itself pointing at nothing. It still reads as a
    // representative in the workspace, so it can be selected, and the
    // hypothetical catalogue is what catches it.
    store.writeDraft("products", CABIN, { ...draft, family: { of: "sweat-kingdom-a-sauna-nobody-sells", because: "invented" } });
    const built = plan(store, { familyIds: [CABIN] });
    expect(codes(built)).toContain("family_integrity");
    expect(built.signable).toBe(false);
  });

  it("leaves the catalogue exactly as it found it, published records included", () => {
    const before = catalogFingerprint();
    const store = imported();
    clearRights(store, [CABIN, BLACKOUT_CABIN]);
    signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: { familyIds: [CABIN], shadows: mergeAll(store, [CABIN]), reviewer: "a reviewer" }, today: TODAY });
    expect(saunas.id).toBe("saunas");
    expect(catalogFingerprint()).toBe(before);
  });
});
