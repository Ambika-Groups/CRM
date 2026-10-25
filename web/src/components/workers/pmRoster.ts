"use client";
import { searchKeywords, type RosterEntry, type Worker } from "@ag/core";
import { useRead, useSession } from "@/data/DataProvider";

/**
 * A PM's workers: everyone on the rosters of their assigned projects (QA F1). Rosters are small per-site
 * collections the PM may read whole, so this never queries the worker master (rule 9; rules T-350…T-353).
 * Names, roles, phone and thekedar only: rosters carry no rates (D-33). Also used for a supervisor's own site (QA N11).
 * Undefined for other roles.
 */
export function usePmWorkers(): Worker[] | undefined {
  const session = useSession();
  return useRead(`pm-roster:${session?.role}:${session?.projectIds.join(",")}`, async (s) => {
    if (session?.role !== "pm" && session?.role !== "supervisor") return undefined;
    const lists = await Promise.all(session.projectIds.map((pid) =>
      s.listSmall<RosterEntry>(`projects/${pid}/roster`).then((r) => r.map((e) => ({ ...e, projectId: pid })))));
    const byId = new Map<string, Worker>();
    for (const e of lists.flat()) {
      if (!e.active) continue;
      const cur = byId.get(e.id);
      if (cur) { cur.siteIds = [...(cur.siteIds ?? []), e.projectId]; continue; }
      byId.set(e.id, {
        id: e.id, name: e.workerName ?? "", role: e.workerRole ?? "", phone: e.workerPhone, thekedarId: e.thekedarId ?? null,
        thekedarName: e.thekedarName ?? null, isThekedar: e.workerRole === "thekedar", defaultPayType: e.payType, active: true,
        siteIds: [e.projectId], searchKeywords: searchKeywords(e.workerName ?? "", e.workerPhone ?? ""),
      } as Worker & { searchKeywords: string[] });
    }
    return [...byId.values()];
  });
}

/** Thekedars a PM can pick: the ones named on their sites' rosters. */
export function thekedarsOf(workers: Worker[]): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const w of workers) {
    if (w.isThekedar) m.set(w.id, w.name);
    if (w.thekedarId && w.thekedarName) m.set(w.thekedarId, w.thekedarName);
  }
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
