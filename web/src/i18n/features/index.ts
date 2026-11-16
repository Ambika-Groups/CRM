/**
 * English strings, one file per feature (so features built side by side never edit the same file).
 *
 * A feature owns `web/src/i18n/features/<feature>.en.ts` (`export const en = { ... }`) and `<feature>.hi.ts`
 * (`export const hi = { ... }`, the same keys). Screens read them as t("<feature>.some.key"): the feature name is the
 * first part of every key, so two features cannot collide. Older strings stay in ../strings.ts.
 *
 * ONLY THE LANE LEAD EDITS THIS FILE (one import and one line per feature, in both index.ts and index-hi.ts).
 */
// <features:en:imports> (append only)
import { en as filesEn } from "./files.en";
import { en as accountsEn } from "./accounts.en";
import { en as expensesEn } from "./expenses.en";
import { en as spendingsEn } from "./spendings.en";
// </features:en:imports>

export const featureEn = {
  // <features:en> (append only)
  files: filesEn,
  accounts: accountsEn,
  expenses: expensesEn,
  spendings: spendingsEn,
  // </features:en>
};
