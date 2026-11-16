/**
 * Demo data added by features (so their screens are not empty in the demo and in "Load sample data").
 *
 * A feature owns `packages/core/src/demo/<feature>.ts` and exports `seed<Feature>(ctx: FeatureSeedCtx): void | Promise<void>`. It writes
 * through the store or through commands (`ctx.store.set / merge`, or the feature's own command functions, so postings and
 * totals are made the same way as in real use), uses ids that start with its own prefix, dates relative to
 * `ctx.anchor` (never a fixed calendar date), and money in integer paise. It may read what the base seed made
 * (`DEMO_IDS` in ./seed.ts) but never changes it.
 *
 * ONLY THE LANE LEAD EDITS THIS FILE.
 */
import type { MemoryStore } from "../store";
// <seed:imports> (append only)
import { seedAccounts } from "./accounts";
import { seedExpenses } from "./expenses";
import { seedBilling } from "./billing";
// </seed:imports>

export interface FeatureSeedCtx {
  store: MemoryStore;
  /** "Today" for the demo (IST date, YYYY-MM-DD). */
  anchor: string;
  /** The ISO time the demo records are stamped with. */
  nowIso: string;
  /** The demo owner's user id (createdBy for seeded records). */
  ownerUid: string;
}

export const FEATURE_SEEDS: ((ctx: FeatureSeedCtx) => void | Promise<void>)[] = [
  // <seed:list> (append only)
  seedExpenses,
  seedBilling,
  seedAccounts,
  // </seed:list>
];
