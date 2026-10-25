/**
 * Spec §3.1 rule 9 ("No page may download a whole collection") and rule 17 ("small listeners only"),
 * checked statically over the web app's source. The runtime half (runQuery refuses a missing or
 * oversized limit) is M-0xx in m12.test.ts and R9-01 below.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { QueryLimitError, runQuery, SMALL_COLLECTIONS } from "../src";

const WEB_SRC = resolve(__dirname, "../../../web/src");
const DATA_LAYER = join(WEB_SRC, "data");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|mjs)$/.test(n) ? [p] : [];
  });
}

/** The text of a call's argument list, from the opening parenthesis to its matching close. */
function callArgs(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return src.slice(openIdx + 1, i);
  }
  return src.slice(openIdx + 1);
}

const typesSrc = readFileSync(join(DATA_LAYER, "types.ts"), "utf8");
const childrenMatch = /SMALL_PROJECT_CHILDREN = new Set\(\[([^\]]*)\]/.exec(typesSrc);
const SMALL_CHILDREN = new Set([...(childrenMatch?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!));

/** A collection path literal is small when its top collection or its project child is on the allow-list. */
function isSmallPath(path: string): boolean {
  const parts = path.split("/");
  if (parts.length === 1) return SMALL_COLLECTIONS.has(parts[0]!);
  const last = parts[parts.length - 1]!;
  return (parts[0] === "projects" && SMALL_CHILDREN.has(last)) || (parts[0] === "workers" && (last === "private" || last === "project_terms"));
}

const pageFiles = files(WEB_SRC).filter((f) => !f.startsWith(DATA_LAYER));

describe("rule 9: no page downloads a whole collection", () => {
  it("R9-00 the scan sees the app (sanity)", () => {
    expect(pageFiles.length).toBeGreaterThan(20);
    expect(SMALL_CHILDREN.has("roster")).toBe(true);
  });

  it("R9-01 the query layer refuses a query without a limit, or over 50", () => {
    const docs = Array.from({ length: 60 }, (_, i) => ({ id: `w${String(i).padStart(2, "0")}` }));
    expect(() => runQuery(docs, {} as never)).toThrow(QueryLimitError);
    expect(() => runQuery(docs, { limit: 51 })).toThrow(QueryLimitError);
    expect(() => runQuery(docs, { limit: 0 })).toThrow(QueryLimitError);
    expect(runQuery(docs, { limit: 50 }).items).toHaveLength(50);
  });

  it("R9-02 every list query outside the data layer carries a literal limit between 1 and 50", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of pageFiles) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\.query(?:<[^>(]*>)?\(/g)) {
        seen++;
        const args = callArgs(src, m.index! + m[0].length - 1);
        const lim = /\blimit:\s*(\d+)/.exec(args);
        if (!lim || Number(lim[1]) < 1 || Number(lim[1]) > 50) bad.push(`${relative(WEB_SRC, f)}: ${args.slice(0, 90)}`);
      }
    }
    expect(seen).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });

  it("R9-03 whole-collection reads (useSmall / listSmall) only name small collections", () => {
    const bad: string[] = [];
    for (const f of pageFiles) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\b(?:useSmall|listSmall)(?:<[^>(]*(?:<[^>]*>[^>(]*)*>)?\(/g)) {
        const args = callArgs(src, m.index! + m[0].length - 1);
        const paths = [...args.replace(/[=!]==?\s*"[^"]*"/g, "").matchAll(/["`]([a-z_]+(?:\/\$\{[^}]+\}\/[a-z_]+)*)["`]/g)].map((x) => x[1]!.replace(/\$\{[^}]+\}/g, "x"));
        if (paths.length === 0 && !/^\s*null\s*$/.test(args)) bad.push(`${relative(WEB_SRC, f)}: no literal path in (${args.slice(0, 60)})`);
        for (const p of paths) if (!isSmallPath(p)) bad.push(`${relative(WEB_SRC, f)}: ${p}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("R9-04 pages never call the store or the SDK directly (list, getDocs, collection reads)", () => {
    const bad: string[] = [];
    for (const f of pageFiles) {
      const src = readFileSync(f, "utf8");
      if (/\bgetDocs\(|\bfirebase\/firestore\b|\.list<|\.list\(\s*["']/.test(src)) bad.push(relative(WEB_SRC, f));
    }
    expect(bad).toEqual([]);
  });
});

describe("rule 17: small listeners only", () => {
  it("R17-01 live listeners exist only in the data layer, never in pages", () => {
    const bad = pageFiles.filter((f) => /\bonSnapshot\b/.test(readFileSync(f, "utf8"))).map((f) => relative(WEB_SRC, f));
    expect(bad).toEqual([]);
  });

  it("R17-02 any listener in the data layer is on a single document or a limited query", () => {
    const bad: string[] = [];
    for (const f of files(DATA_LAYER)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bonSnapshot\(/g)) {
        const args = callArgs(src, m.index! + m[0].length - 1);
        if (!/\bdoc\(|\blimit\(/.test(args)) bad.push(`${relative(WEB_SRC, f)}: ${args.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
