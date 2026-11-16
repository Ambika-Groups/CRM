/** Hindi strings, one file per feature: see ./index.ts. Loaded only when Hindi is chosen. ONLY THE LANE LEAD EDITS THIS FILE. */
// <features:hi:imports> (append only)
import { hi as filesHi } from "./files.hi";
import { hi as accountsHi } from "./accounts.hi";
import { hi as expensesHi } from "./expenses.hi";
import { hi as spendingsHi } from "./spendings.hi";
import { hi as documentsHi } from "./documents.hi";
import { hi as billingHi } from "./billing.hi";
import { hi as adminHi } from "./admin.hi";
// </features:hi:imports>

export const featureHi = {
  // <features:hi> (append only)
  files: filesHi,
  accounts: accountsHi,
  expenses: expensesHi,
  spendings: spendingsHi,
  documents: documentsHi,
  billing: billingHi,
  admin: adminHi,
  // </features:hi>
};
