import { describe, expect, it } from "vitest";
import { coldPlunge } from "@/domain/categories";
import { assignBadges, recommendCategory } from "@/domain/recommend";
import { toScoringInput } from "@/domain/recommend/score";
import { buyableOffers, toProductView } from "@/domain/view";
import { catalog, miniCategory, miniProduct, miniView, viewsFor } from "./fixtures";

// Edge Theory Labs states on its own site that the company has gone out of
// business. Its record held Best Premium in Cold Plunges at 44.4, so the site
// was recommending a product whose maker had stopped selling it.

const plunges = () => viewsFor("cold-plunge");
const edge = () => plunges().find((v) => v.id === "edge-tub-elite")!;

describe("an offer from a seller that has stopped selling", () => {
  it("is not somewhere a shopper can be sent", () => {
    expect(edge().offers.some((o) => o.availability === "discontinued")).toBe(true);
    expect(buyableOffers(edge())).toEqual([]);
  });

  it("prices nothing, so the product quotes no amount", () => {
    expect(edge().price.money).toBeUndefined();
  });

  // `pricedOffers` and `liveOffers` already dropped discontinued and
  // `buyableOffers` did not, so an offer that priced nothing and counted as
  // dead was still a Shop button on the card, the picks row and the comparison.
  it("closes the gap between what prices a product and what a card links to", () => {
    const built = miniProduct("gone", 20000, { power: 50, size: "m" });
    built.offers[0].availability = "discontinued";
    const view = miniView(built);
    expect(view.offers).toHaveLength(1);
    expect(buyableOffers(view)).toEqual([]);
    expect(view.price.money).toBeUndefined();
  });
});

describe("the generic copy says what happened, not why", () => {
  // `discontinued` means a product is no longer sold. It does not mean the
  // maker closed: a healthy brand retiring one model is in exactly this state,
  // and the page was telling every such product's visitors that its maker had
  // gone out of business.
  it("keeps the closure claim on the record that holds the evidence", () => {
    const notices = edge().editorial.tradeoffs.filter((t) => /gone out of business/i.test(t));
    expect(notices).toHaveLength(1);
    // And it is sourced, on the product, rather than derived from a status flag.
    const note = catalog().products.find((p) => p.id === "edge-tub-elite")!.editorial.tradeoffs[0];
    expect(note.source?.url).toBe("https://www.edgetheorylabs.com/");
    expect(note.date).toBe("2026-09-11");
  });

  it("does not let a discontinued status alone carry a closure claim", () => {
    // A product marked discontinued with no such note on its record must not
    // acquire one. Built rather than found, because today Edge is the only
    // discontinued product and this is the case that would be missed.
    const built = miniProduct("retired", 20000, { power: 50, size: "m" });
    built.offers[0].availability = "discontinued";
    const view = miniView(built);
    expect(view.availability).not.toBe("discontinued");
    expect(view.editorial.tradeoffs.some((t) => /out of business/i.test(t))).toBe(false);
  });
});

describe("a badge needs somewhere to send a shopper", () => {
  it("takes every badge off the product nobody can buy", () => {
    const { products } = recommendCategory(plunges(), coldPlunge);
    expect(products.find((p) => p.view.id === "edge-tub-elite")!.badges).toEqual([]);
  });

  it("leaves it ranked where its specifications put it", () => {
    // The first attempt filtered `eligible`, which took unbuyable products out
    // of the ranking too and sent Plunge Original, scoring 64.8, below a tub
    // scoring zero. Rank is about the product; the badge is about the offer.
    const order = recommendCategory(plunges(), coldPlunge).products.map((p) => p.view.id);
    expect(order.indexOf("edge-tub-elite")).toBeLessThan(order.indexOf("ice-barrel-400"));
    expect(order.indexOf("plunge-original")).toBeLessThan(order.indexOf("edge-tub-elite"));
  });

  it("moves no badge that was not on it", () => {
    const { products } = recommendCategory(plunges(), coldPlunge);
    const held = Object.fromEntries(products.filter((p) => p.badges.length > 0).map((p) => [p.view.id, p.badges]));
    expect(held).toEqual({ "renu-cold-stoic-2": ["best_overall"], "the-cold-pod-88": ["best_value"] });
  });

  // Best Overall is not price-gated, so the price mechanism alone would have
  // handed it over on score if the dead product had ranked first. This asserts
  // the rule rather than the luck.
  it("withholds even the badge no price could have blocked", () => {
    const views = [
      toProductView(catalog().products.find((p) => p.id === "edge-tub-elite")!, { category: coldPlunge, brands: catalog().brands, merchants: catalog().merchants }),
    ];
    const { products } = recommendCategory(views, coldPlunge);
    expect(products).toHaveLength(1);
    expect(products[0].badges).toEqual([]);
  });

  it("keeps ranking blind to offers: the sellable set is not part of scoring", () => {
    // ScoringInput carries no offer data, enforced elsewhere. Badges take the
    // set as their own argument, and omitting it treats everything as sellable.
    const inputs = [miniProduct("a", 20000, { power: 90, size: "l" }), miniProduct("b", 10000, { power: 10, size: "s" })].map(miniView).map(toScoringInput);
    expect(Object.keys(inputs[0])).not.toContain("buyable");
    const withAll = assignBadges(inputs, miniCategory);
    const withNone = assignBadges(inputs, miniCategory, new Set<string>());
    expect(withAll.badges.length).toBeGreaterThan(0);
    expect(withNone.badges).toEqual([]);
  });
});
