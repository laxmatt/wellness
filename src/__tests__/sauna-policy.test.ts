import { describe, expect, it } from "vitest";
import { groupSaunaListings, partitionSaunaOptions, SAUNA_COMPARISON_FIELDS, type SaunaIdentityDecision, type SaunaListingCandidate } from "@/domain/categories/sauna-policy";

describe("reusable sauna presentation policy", () => {
  it("keeps cosmetic checkout choices out of comparison unless a reviewer records a material reason", () => {
    const result = partitionSaunaOptions([
      { kind: "roof_color", label: "Roof color", value: "Black" },
      { kind: "door_orientation", label: "Door", value: "Left" },
      { kind: "electrical", label: "Power", value: "240 V", reviewedMaterialReason: "Changes required branch circuit." },
      { kind: "roof_kit", label: "Roof kit", value: "Snow-load kit", reviewedMaterialReason: "Reviewed as installation-relevant for snow load." },
    ]);
    expect(result.checkout.map((o) => o.kind)).toEqual(["roof_color", "door_orientation"]);
    expect(result.comparison.map((o) => o.kind)).toEqual(["electrical", "roof_kit"]);
  });

  it("lets a second partner adapter use the policy without Sweat Kingdom parsing", () => {
    type PartnerRow = { code: string; model: string; seats: string; finish: string };
    const adapt = (row: PartnerRow): SaunaListingCandidate<PartnerRow> => ({
      partnerId: "second-partner", partnerListingId: row.code, raw: row,
      comparison: { form: ["Cabin"], capacity: row.seats },
      options: [{ kind: "wood_finish", label: "Finish", value: row.finish }],
    });
    const rows = [
      { code: "A-RED", model: "Aura", seats: "2 people", finish: "Red cedar" },
      { code: "A-WHITE", model: "Aura", seats: "2 people", finish: "White cedar" },
      { code: "B-RED", model: "Beacon", seats: "4 people", finish: "Red cedar" },
    ];
    const listings = rows.map(adapt);
    const decisions: SaunaIdentityDecision[] = [
      { partnerId: "second-partner", partnerListingId: "A-RED", canonicalFamilyId: "second-aura", reviewedBy: "fixture-reviewer", reviewedAt: "2026-09-14" },
      { partnerId: "second-partner", partnerListingId: "A-WHITE", canonicalFamilyId: "second-aura", reviewedBy: "fixture-reviewer", reviewedAt: "2026-09-14" },
      { partnerId: "second-partner", partnerListingId: "B-RED", canonicalFamilyId: "second-beacon", reviewedBy: "fixture-reviewer", reviewedAt: "2026-09-14" },
    ];
    const grouped = groupSaunaListings(listings, decisions);
    expect([...grouped.families].map(([id, members]) => [id, members.length])).toEqual([["second-aura", 2], ["second-beacon", 1]]);
    expect(grouped.unresolved).toEqual([]);
    expect(partitionSaunaOptions(listings[0].options).comparison).toEqual([]);
    expect(SAUNA_COMPARISON_FIELDS).toContain("footprint");
  });

  it("does not merge an unreviewed listing, even when its title-like raw value matches", () => {
    const listing: SaunaListingCandidate<{ model: string }> = { partnerId: "new-partner", partnerListingId: "x", raw: { model: "The Sweat Barrel" }, comparison: {}, options: [] };
    const grouped = groupSaunaListings([listing], []);
    expect(grouped.families.size).toBe(0);
    expect(grouped.unresolved).toEqual([listing]);
  });
});
