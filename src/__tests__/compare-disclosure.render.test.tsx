// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CompareView } from "@/components/compare/CompareView";
import { categoryById } from "@/domain/categories";
import { buildCompareModel } from "@/domain/compare";
import { recommendCategory } from "@/domain/recommend";
import { RELATIONSHIP_COPY } from "@/domain/outbound";
import { viewsFor } from "./fixtures";

afterEach(cleanup);
it.each(["affiliate", "non_affiliate", "unknown"] as const)("shows the %s relationship beside each comparison merchant", (status) => {
  const cat = categoryById("wellness-drinks")!;
  const views = viewsFor(cat.id).map(v => ({...v, offers: v.offers.map(o => ({...o, affiliateStatus: status}))}));
  const item = recommendCategory(views, cat).products.find(p => p.view.id === "liquid-iv-hydration-multiplier-16")!;
  const model = buildCompareModel([item], cat);
  render(<CompareView model={model} ids={[item.view.id]} categoryId={cat.id} />);
  const links = screen.getAllByRole("link", {name: /^Visit /});
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    expect(link.getAttribute("rel")!.split(" ").includes("sponsored")).toBe(status === "affiliate");
    expect(link.parentElement!.textContent).toContain(RELATIONSHIP_COPY[status]);
  }
  const remove = screen.getByRole("link", {name: /Remove .* from comparison/});
  expect(remove.getAttribute("href")).toBe("/compare?ids=");
});
