/** Every internal link in the web app points at a page that the static export builds (no dead links to a 404). */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "../src";

const WEB_SRC = resolve(__dirname, "../../../web/src");
const APP = join(WEB_SRC, "app");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

const routeExists = (path: string) => existsSync(join(APP, ...path.split("/").filter(Boolean), "page.tsx"));

describe("routes", () => {
  it("RT-01 every sidebar item has a page", () => {
    expect(NAV.filter((n) => !routeExists(n.href)).map((n) => n.href)).toEqual([]);
  });

  it("RT-02 every internal link literal in the source has a page", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of files(WEB_SRC)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:href=|location\.href = |href: )[{]?["`](\/[a-z0-9\-/]*)[?"`$]/g)) {
        seen++;
        const path = m[1]!;
        if (path.startsWith("/__/") || path === "/") continue;
        if (!routeExists(path)) bad.push(`${relative(WEB_SRC, f)}: ${path}`);
      }
    }
    expect(seen).toBeGreaterThan(15);
    expect(bad).toEqual([]);
  });

  it("RT-03 modules built so far render their own page, never the coming-soon placeholder", () => {
    const built = ["/", "/projects/", "/projects/new/", "/projects/edit/", "/projects/view/", "/labour/", "/labour/workers/view/", "/labour/workers/edit/",
      "/clients/", "/clients/view/", "/clients/edit/", "/settings/"];
    const bad = built.filter((path) => {
      const f = join(APP, ...path.split("/").filter(Boolean), "page.tsx");
      return !existsSync(f) || /ModulePage/.test(readFileSync(f, "utf8"));
    });
    expect(bad).toEqual([]);
  });
});
