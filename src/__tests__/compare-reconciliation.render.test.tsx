// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CompareProvider, CompareReconciler, useCompare, type CompareAuthority } from "@/components/compare/CompareProvider";
import { CompareTray } from "@/components/compare/CompareTray";

function Controls() {
  const c = useCompare();
  return <>
    <button onClick={() => {
      c.clear();
      for (const id of ["valid", "ghost", "other"]) c.toggle({ id, slug: id, name: id, categoryId: id === "other" ? "cold-plunge" : "wellness-drinks" });
    }}>Seed</button>
    <button onClick={() => {
      c.clear();
      for (let n = 0; n < 4; n++) c.toggle({ id: `ghost-${n}`, slug: `ghost-${n}`, name: `ghost-${n}`, categoryId: "wellness-drinks" });
    }}>Fill stale</button>
    <button onClick={() => c.toggle({ id: "valid", slug: "valid", name: "valid", categoryId: "wellness-drinks" })}>Add valid</button>
    <button onClick={() => c.clear()}>Reset</button>
  </>;
}
function App({ authority }: { authority?: CompareAuthority }) {
  return <CompareProvider><Controls /><CompareReconciler authority={authority} /><CompareTray categoryId="wellness-drinks" /></CompareProvider>;
}
afterEach(() => { fireEvent.click(screen.getByText("Reset")); cleanup(); });
const stored = () => JSON.parse(localStorage.getItem("wc.compare.v1") ?? "[]") as {id:string}[];

it("removes only unpublished selections in the authoritative category and fixes the tray link", () => {
  const app = render(<App />);
  fireEvent.click(screen.getByText("Seed"));
  app.rerender(<App authority={{ categoryId: "wellness-drinks", publishedIds: ["valid"] }} />);
  expect(stored().map(x => x.id)).toEqual(["valid", "other"]);
  expect(screen.getByRole("link", { name: "Compare 1" }).getAttribute("href")).toBe("/compare?ids=valid");
  expect(screen.queryByText("ghost")).toBeNull();
});

it("distinguishes absent authority from a successfully loaded empty category", () => {
  const app = render(<App />);
  fireEvent.click(screen.getByText("Seed"));
  app.rerender(<App />);
  expect(stored()).toHaveLength(3);
  app.rerender(<App authority={{ categoryId: "wellness-drinks", publishedIds: [] }} />);
  expect(stored().map(x => x.id)).toEqual(["other"]);
});

it("frees comparison capacity occupied by stale selections", () => {
  const app = render(<App />);
  fireEvent.click(screen.getByText("Fill stale"));
  app.rerender(<App authority={{ categoryId: "wellness-drinks", publishedIds: ["valid"] }} />);
  fireEvent.click(screen.getByText("Add valid"));
  expect(stored().map(x => x.id)).toEqual(["valid"]);
});
