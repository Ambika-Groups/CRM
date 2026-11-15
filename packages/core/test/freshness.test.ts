// Cache-first reads on the live database (D-51). IDs FR-xx are cited in docs/prd-traceability.md.
import { describe, expect, it } from "vitest";
import { FreshMap } from "../src";

describe("what the device may answer without asking the server", () => {
  it("FR-01 a read is fresh for the set time, then asked for again", () => {
    let now = 1_000_000;
    const f = new FreshMap<number>(5 * 60_000, () => now);
    f.set("d:expenses/e1", "expenses", 7);
    expect(f.get("d:expenses/e1")).toBe(7);
    now += 5 * 60_000 - 1;
    expect(f.has("d:expenses/e1")).toBe(true);
    now += 1;
    expect(f.get("d:expenses/e1")).toBeUndefined();
    expect(f.size).toBe(0);
    expect(f.get("d:never/read")).toBeUndefined();
  });

  it("FR-02 after a save only the collections it changed are forgotten", () => {
    const f = new FreshMap(60_000, () => 0);
    f.set("d:expenses/e1", "expenses", true);
    f.set("q:expenses|[]", "expenses", true);
    f.set("d:rollups/company_2026-11", "rollups", true);
    f.set("d:clients/c1", "clients", true);
    f.set("all:projects/p1/roster", "projects/p1/roster", true);
    f.forget(["expenses", "rollups"]);
    expect(f.has("d:expenses/e1")).toBe(false);
    expect(f.has("q:expenses|[]")).toBe(false);
    expect(f.has("d:rollups/company_2026-11")).toBe(false);
    expect(f.has("d:clients/c1")).toBe(true);
    expect(f.has("all:projects/p1/roster")).toBe(true);
  });

  it("FR-03 a collection matches what is under it and above it, but not a name that only starts the same", () => {
    const f = new FreshMap(60_000, () => 0);
    f.set("a", "projects", true);
    f.set("b", "projects/p1/roster", true);
    f.set("c", "projects_archive", true);
    f.forget(["projects/p1/roster"]);
    expect([f.has("a"), f.has("b"), f.has("c")]).toEqual([false, false, true]);
    f.set("a", "projects", true);
    f.set("b", "projects/p1/roster", true);
    f.forget(["projects"]);
    expect([f.has("a"), f.has("b"), f.has("c")]).toEqual([false, false, true]);
  });

  it("FR-04 a repeated request (a star) forgets everything", () => {
    const f = new FreshMap(60_000, () => 0);
    f.set("a", "expenses", true);
    f.set("b", "clients", true);
    f.forget(["*"]);
    expect(f.size).toBe(0);
    f.set("a", "expenses", true);
    f.forget("*");
    expect(f.size).toBe(0);
  });
});
