# Ambika Group CRM: security rules test matrix

Phase 0 deliverable. Draft 4, 25 Oct 2026 (adds §18 for M1.3 labour; draft 3 added §17 for M1.2 role scope and rates; draft 2 added §14–§15 for the Milestone 2 review fixes). Tests [firestore.rules](../firestore.rules) and [storage.rules](../storage.rules) against the read matrix in [data-model.md §12](data-model.md).

**Status:** test cases only. In Phase 1 they become runnable tests using `@firebase/rules-unit-testing` against the Emulator Suite. They run in **GitHub Actions** on every push (`firebase emulators:exec` with a `demo-` project, Java 21 on the runner; decisions D-36), not on this computer. Nothing needs installing locally.

## Fixtures

Users (custom claim `role`):

| uid | role | assigned to |
|---|---|---|
| `owner1` | owner | — (sees all) |
| `acct1` | accountant | — |
| `pm1` | pm | `projA` |
| `sup1` | supervisor | `projA` |
| `sup2` | supervisor | `projB` |
| `view1` | viewer | — |
| `ca1` | ca | — |
| `anon` | (no auth) | — |
| `noclaim` | signed in, no `role` claim | — |

Data: `projA` (assignedUsers `[pm1, sup1]`), `projB` (`[sup2]`); `projects/projA/roster/w1` active, `projects/projA/roster/w2` inactive, no roster entry for `w3`; `settings/operations.attendanceLockDays = 3`; `period_locks/2026-09` exists (September locked), October open; `accounts/acc1` with openingDate 2026-09-01 (a locked month), `accounts/acc2` with openingDate 2026-10-01. "Today" = 2026-10-25 (server time). Expenses `expA1` (projA, enteredBy `sup1`, pending), `expA2` (projA, enteredBy `pm1`, approved), `expB1` (projB, enteredBy `sup2`).

Outcome: ✅ allowed, ❌ denied. "q:" marks a list query; the exact query shape is part of the test, because rules are evaluated against queries, not results.

## 1. First test: D-21 query shape (run before anything else)

| ID | Role | Operation | Expected | Why |
|---|---|---|---|---|
| T-001 | sup1 | q: `expenses where projectId == projA and enteredBy == sup1 and isDeleted == false order by date desc` | ✅ | assignment checked via `get(/projects/projA)` keyed on the pinned field |
| T-002 | sup1 | q: same with `projectId == projB` | ❌ | not assigned |
| T-003 | sup1 | q: `expenses where enteredBy == sup1` (no projectId) | ❌ | rule can't prove assignment |
| T-004 | pm1 | q: `attendance where projectId == projA and date == 2026-10-25` | ✅ | |
| T-005 | pm1 | q: `rollups where projectId == projA and scope == project` | ✅ | |

**If T-001/T-004/T-005 fail:** switch to the `projects` custom-claim fallback (D-21) and re-run this section first.

## 2. Authentication and roles

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-010 | anon | get `projects/projA` | ❌ |
| T-011 | noclaim | get `projects/projA` | ❌ |
| T-012 | sup1 | update `users/sup1` field `role` | ❌ |
| T-013 | sup1 | update `users/sup1` fields `language`, `theme` (+ stamps) | ✅ |
| T-014 | sup1 | get `users/pm1` | ❌ |
| T-015 | acct1 | get `users/pm1` | ✅ |
| T-016 | owner1 | create `users/x` | ❌ (callable only) |

## 3. Projects and restricted subdocuments (D-28)

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-020 | sup1 | get `projects/projA` | ✅ |
| T-021 | sup1 | get `projects/projB` | ❌ |
| T-022 | sup1 | q: `projects where assignedUsers array-contains sup1` | ✅ |
| T-023 | sup1 | q: `projects` (all) | ❌ |
| T-024 | view1, ca1 | get `projects/projB` | ✅ |
| T-025 | pm1 | update `projects/projA` `progressPct`, `status` (+ stamps) | ✅ |
| T-026 | pm1 | update `projects/projA` `assignedUsers` | ❌ |
| T-027 | acct1 | update `projects/projA` `assignedUsers` | ❌ |
| T-028 | owner1 | update `projects/projA` `assignedUsers` | ✅ |
| T-029 | owner1 | update `projects/projA` `code` | ❌ |
| T-030 | any | create / delete `projects/x` | ❌ (callable only) |
| T-031 | pm1 | get `projects/projA/private/budget` | ✅ |
| T-032 | pm1 | get `projects/projA/private/commercial` | ❌ |
| T-033 | sup1 | get `projects/projA/private/budget` | ❌ |
| T-034 | view1, ca1 | get `projects/projA/private/commercial` | ✅ |
| T-035 | pm1, sup1 | get `projects/projA/project_milestones/m1`, `project_units/u1`, `boq_rates/b1` | ❌ |
| T-036 | sup1 | get `projects/projA/boq_items/b1` | ✅ |
| T-037 | sup1 | create `projects/projA/dpr/2026-10-25` with `date: 2026-10-25` | ✅ |
| T-038 | sup1 | create `projects/projA/dpr/2026-10-25` with `date: 2026-10-24` | ❌ (ID ≠ date) |
| T-039 | sup2 | create `projects/projA/dpr/2026-10-25` | ❌ |
| T-040 | pm1 | update `eot_requests/e1` status to `approved` | ❌ (callable only) |

## 4. Attendance (D-13, D-25)

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-050 | sup1 | create `attendance/projA_w1_2026-10-25` (status present, markedBy sup1, monthKey 2026-10, fy 2026-27) | ✅ |
| T-051 | sup1 | create `attendance/projA_w1_2026-10-25` with `date: 2026-10-24` | ❌ (ID mismatch) |
| T-052 | sup1 | create with `rateSnapshotPaise` set | ❌ (server field) |
| T-053 | sup2 | create `attendance/projA_w1_2026-10-25` | ❌ (not assigned) |
| T-054 | sup1 | create `attendance/projA_w1_2026-10-21` (5 days old) | ❌ (lock window) |
| T-055 | sup1 | create `attendance/projA_w1_2026-10-23` (2 days old) | ✅ |
| T-056 | owner1 | create `attendance/projA_w1_2026-10-10` (15 days old) | ✅ (owner past lock window) |
| T-057 | owner1 | create `attendance/projA_w1_2026-09-30` | ❌ (period lock beats owner) |
| T-058 | sup1 | update existing doc: status absent → present (+ markedBy) | ✅ |
| T-059 | sup1 | update existing doc: `workerId` | ❌ |
| T-060 | sup1 | update existing doc: `earnedPaise` | ❌ |
| T-061 | sup1 | update existing doc with `markedBy: pm1` | ❌ |
| T-062 | any | delete attendance | ❌ |
| T-063 | ca1 | get attendance | ❌ |
| T-064 | view1 | get attendance | ✅ |
| T-065 | sup1 | create with status `holiday` | ❌ (enum) |

## 5. Expenses (D-07, D-30)

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-070 | sup1 | create expense, projA, pending, cash, accountId, billPaths, enteredBy sup1, source manual | ✅ |
| T-071 | sup1 | create the same with `approvalStatus: approved` | ❌ |
| T-072 | sup1 | create with `voucherNo` / `categoryPath` / `paidStatus` set | ❌ |
| T-073 | sup1 | create with `source: wage` | ❌ |
| T-074 | sup1 | create without bill photo and without `noBillReason` | ❌ |
| T-075 | sup1 | create with `noBillReason` and no bill photo | ✅ |
| T-076 | sup1 | create paid expense without `accountId` | ❌ |
| T-077 | sup1 | create with `mode: credit`, no accountId | ✅ |
| T-078 | sup1 | create with `amountPaise: 12.5` (float) | ❌ |
| T-079 | sup1 | create with `amountPaise: 0` | ❌ |
| T-080 | sup1 | create with date 2026-09-15 (locked month) | ❌ |
| T-081 | sup1 | create with `monthKey` not matching `date` | ❌ |
| T-082 | sup1 | create with `enteredBy: pm1` | ❌ |
| T-083 | sup1 | create with no projectId | ❌ (overheads: finance only) |
| T-084 | acct1 | create with no projectId | ✅ |
| T-085 | sup1 | get `expA1` (own) | ✅ |
| T-086 | sup1 | get `expA2` (entered by pm1) | ❌ |
| T-087 | pm1 | get `expA1` | ✅ |
| T-088 | pm1 | get `expB1` | ❌ |
| T-089 | sup1 | update own pending `expA1` amount (+ stamps) | ✅ |
| T-090 | sup1 | update own `expA1` after it is approved | ❌ |
| T-091 | sup1 | update `expA1` setting `approvalStatus: approved` | ❌ |
| T-092 | pm1 | update `expA1` setting `approvalStatus` | ❌ (callable only, D-30) |
| T-093 | owner1 | update `expA1` setting `approvalStatus` | ❌ (callable only) |
| T-094 | acct1 | update approved `expA2` description (+ stamps) | ✅ |
| T-095 | acct1 | update `expA2` moving date into September | ❌ (locked) |
| T-096 | acct1 | update an expense dated September (locked) | ❌ |
| T-097 | acct1 | soft delete `expA2` with deletedBy, deletedAt, deleteReason | ✅ |
| T-098 | acct1 | soft delete without `deleteReason` | ❌ |
| T-099 | acct1 | restore a soft-deleted expense | ❌ |
| T-100 | owner1 | restore a soft-deleted expense | ✅ |
| T-101 | any | delete expense | ❌ |
| T-102 | acct1 | update generated expense (`source: wage`) | ❌ |
| T-103 | ca1 | get `expB1` | ✅ |
| T-103a | view1 | get `expB1` | ❌ (I3 default: totals only) |
| T-104 | ca1 | create expense | ❌ |

## 6. Money postings are server-only (D-07, D-08)

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-110 | owner1 | create / update `account_transactions/x` | ❌ |
| T-111 | owner1 | write `rollups/co_2026-10`, `finance_rollups/co_2026-10` | ❌ |
| T-112 | owner1 | read / write `postings/expenses_expA2` | ❌ |
| T-113 | owner1 | read / write `counters/invoice_2026-27` | ❌ |
| T-114 | owner1 | update `accounts/acc1` `balancePaise` | ❌ |
| T-115 | owner1 | write `worker_balances/*`, `stock_balances/*`, `vendor_balances/*` | ❌ |
| T-116 | owner1 | write `period_locks/2026-10` | ❌ (callable only) |
| T-117 | sup1 | get `period_locks/2026-09` | ✅ (app shows lock state) |

## 7. Rollup audiences (D-28)

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-120 | pm1 | get `rollups/p_projA_2026-10` | ✅ |
| T-121 | pm1 | get `rollups/co_2026-10` | ❌ (company-wide) |
| T-122 | pm1 | get `rollups/p_projB_2026-10` | ❌ |
| T-123 | pm1 | get `finance_rollups/p_projA_2026-10` | ❌ |
| T-124 | sup1 | get `rollups/p_projA_2026-10` | ❌ |
| T-125 | view1, ca1 | get `finance_rollups/co_2026-10` | ✅ |

## 8. Labour payments and thekedars (D-16, D-29)

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-130 | pm1 | create `worker_payments` projA, pending, gross 100000, recovered 20000, tds 0, net 80000, mode cash, accountId | ✅ |
| T-131 | pm1 | same with net 90000 (doesn't add up) | ❌ |
| T-132 | pm1 | create `type: thekedar_bill`, gross 500000, tds 5000, net 495000, mode bank, accountId | ✅ |
| T-133 | pm1 | create with `approvalStatus: approved` | ❌ |
| T-134 | sup1 | get / create `worker_payments` | ❌ |
| T-135 | sup1 | get `worker_balances/w1_projA` | ❌ |
| T-136 | pm1 | get `worker_balances/w1_projA` | ✅ |
| T-137 | sup1 | get `workers/w1` | ❌ (supervisors use the roster, D-33) |
| T-137a | sup1 | q: `projects/projA/roster where active == true order by workerName` | ✅ |
| T-137b | sup2 | get `projects/projA/roster/w1` | ❌ |
| T-138 | sup1, pm1 | get `workers/w1/private/kyc` | ❌ |
| T-139 | acct1 | get `workers/w1/private/kyc` | ✅ |
| T-140 | ca1 | get `workers/w1` | ❌ |
| T-141 | sup1 | get `thekedar_contracts/t1` (projA) | ❌ |
| T-142 | pm1 | update `thekedar_contracts/t1` `paidPaise` | ❌ |

## 9. Billing and finance documents

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-150 | pm1, sup1 | get `invoices/i1`, `quotations/q1`, `ra_bills/r1`, `payments_received/p1` | ❌ |
| T-151 | pm1, sup1 | get `accounts/acc1`, `account_transactions/x`, `vendor_bills/v1`, `vendor_payments/v1` | ❌ |
| T-152 | acct1 | create invoice draft without `number` / `totals` | ✅ |
| T-153 | acct1 | create invoice with `number` set | ❌ |
| T-154 | acct1 | create invoice with `status: sent` | ❌ |
| T-155 | acct1 | update a sent invoice (any field) | ❌ (locked, §8.3) |
| T-156 | acct1 | update draft invoice setting `status: sent` | ❌ (issue callable) |
| T-157 | acct1 | create `payments_received` without `accountId` | ❌ |
| T-158 | acct1 | create `payments_received` with `receiptNo` | ❌ |
| T-159 | ca1 | create / update any finance document | ❌ |
| T-160 | view1 | get `account_transactions/x` | ❌ |
| T-161 | view1 | get `accounts/acc1` | ✅ |
| T-162 | pm1 | get `vendors/v1` | ✅ |
| T-163 | pm1 | get `vendors/v1/private/bank`, `vendor_balances/v1` | ❌ |
| T-164 | acct1 | update a signed agreement | ❌ |
| T-165 | acct1 | update `agreement_clauses/k/versions/1` | ❌ (versions immutable) |
| T-166 | acct1 | create `adjustments` dated in an open month with reason | ✅ |
| T-167 | acct1 | create `adjustments` dated in a locked month | ❌ |

## 10. Procurement and stock

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-170 | sup1 | create `stock_ledger` kind consumption, projA | ✅ |
| T-171 | sup1 | create `stock_ledger` kind grn | ❌ |
| T-172 | sup1 | create kind damage, pending, with reason | ✅ |
| T-173 | sup1 | create kind damage without `reason` | ❌ |
| T-174 | sup1 | create with `ratePaise` | ❌ (server sets weighted average) |
| T-175 | any | update / delete `stock_ledger` | ❌ |
| T-176 | sup2 | update `stock_transfers/s1` (from projA to projB) sent → received | ✅ |
| T-177 | sup1 | update `stock_transfers/s1` sent → received | ❌ (not receiving site) |
| T-178 | sup2 | update received transfer's `qtySentMilli` | ❌ |
| T-179 | sup1 | create `material_requests` projA, pending, requestedBy sup1 | ✅ |
| T-180 | sup1 | update own request status to `approved` | ❌ |
| T-181 | pm1 | update projA request status to `approved` | ✅ |
| T-182 | sup1 | get `purchase_orders/po1` | ❌ |

## 11. Leads, tasks, events, documents

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-190 | any | create `leads/x` | ❌ (createLead callable) |
| T-191 | pm1 | get lead assigned to pm1 | ✅ |
| T-192 | pm1 | get lead assigned to owner1 | ❌ |
| T-193 | pm1 | update own lead `assignedTo` | ❌ |
| T-194 | pm1 | update own lead `phone` | ❌ |
| T-195 | ca1, view1 | get any lead | ❌ |
| T-196 | pm1 | create `lead_activities` on own lead, type call, by pm1 | ✅ |
| T-197 | pm1 | create `lead_activities` type `web_enquiry` | ❌ (server only) |
| T-198 | any | read `lead_phones/*`, `lead_webhook_logs/*` (non-owner) | ❌ |
| T-199 | sup1 | get task assigned to sup1 | ✅ |
| T-200 | sup1 | update task assigned to sup1 `assignedTo` | ❌ |
| T-201 | sup1 | get event with projectId projA | ✅ |
| T-202 | sup1 | update a system event (`source` set) | ❌ |
| T-203 | sup1 | get `documents/d1` (projA, not restricted) | ✅ |
| T-204 | sup1 | get `documents/d2` (projA, restricted) | ❌ |
| T-205 | ca1 | get `documents/d3` (type `bill`) | ✅ |
| T-206 | ca1 | get `documents/d4` (type `id_proof`) | ❌ |

## 12. Settings and masters

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-210 | sup1 | get `settings/operations` | ✅ |
| T-211 | sup1 | get `settings/bank` | ❌ |
| T-212 | acct1 | update `settings/bank` | ✅ |
| T-213 | acct1 | update `settings/numbering` | ❌ |
| T-214 | owner1 | update `expense_categories/c1` `parentId` | ❌ (moveCategory callable) |
| T-215 | owner1 | update `expense_categories/c1` `name` | ✅ |
| T-216 | sup1 | write `materials/*` | ❌ |
| T-217 | ca1 | get `clients/c1` | ✅ |
| T-218 | pm1 | get `clients/c1` | ❌ |

## 13. Storage

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-230 | sup1 | upload `projects/projA/expenses/e1/bill.jpg`, image/jpeg, 2 MB | ✅ |
| T-231 | sup1 | same, 11 MB | ❌ |
| T-232 | sup1 | same, `application/zip` | ❌ |
| T-233 | sup1 | upload under `projects/projB/...` | ❌ |
| T-234 | sup1 | overwrite an existing bill photo | ❌ (write-once) |
| T-235 | sup1 | read `workers/w1/kyc/aadhaar.jpg` | ❌ |
| T-236 | acct1 | read `workers/w1/kyc/aadhaar.jpg` | ✅ |
| T-237 | acct1 | write `generated/invoice/i1/x.pdf` | ❌ (server only) |
| T-238 | ca1 | read `exports/x/master_ledger.csv` | ✅ |
| T-239 | pm1 | read `exports/x/master_ledger.csv` | ❌ |
| T-240 | anon | read anything | ❌ |
| T-241 | sup1 | read `projects/projA/finance/d1/x.pdf` | ❌ |
| T-242 | view1 | read `projects/projA/expenses/e1/bill.jpg` | ❌ (I3 default) |
| T-243 | ca1 | read `projects/projA/expenses/e1/bill.jpg` | ✅ |

## 14. Milestone 2 review fixes

### Fix 1: period-lock bypass (D-13)

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-260 | acct1 | create expense dated 2026-09-15 with `monthKey: ".*"`, `fy: "2026-27"` | ❌ (monthKey ≠ date's month) |
| T-261 | acct1 | create expense dated 2026-09-15 with `monthKey: "2026-0."` | ❌ |
| T-262 | acct1 | create expense dated 2026-09-15 with `monthKey: "2026-10"` (open month) | ❌ (lock checked on the date's month) |
| T-263 | acct1 | create expense dated 2026-10-20 with `monthKey: "2026-10"`, `fy: "2025-26"` | ❌ (wrong FY) |
| T-264 | acct1 | create expense dated 2026-03-31 with `fy: "2025-26"` | ✅ (March belongs to the FY starting the previous April) |
| T-265 | acct1 | create expense dated 2026-04-01 with `fy: "2026-27"` | ✅ |
| T-266 | acct1 | create expense with `date: "2026-13-01"` | ❌ (not a calendar date) |
| T-267 | acct1 | update an October expense, changing `date` to 2026-09-20 and `monthKey` to "2026-10" | ❌ |
| T-268 | acct1 | update a September (locked) expense's description only | ❌ (old date's month locked) |
| T-269 | sup1 | create attendance dated 2026-09-30 with `monthKey: ".*"` | ❌ |
| T-270 | acct1 | create `payments_received`, `vendor_payments`, `worker_payments`, `account_transfers` each with `monthKey: ".*"` | ❌ all four |

### Fix 2: creates that read `resource`

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-271 | acct1 | create `emd_records/x` (amountPaise 50000000, stamps) | ✅ |
| T-272 | acct1 | create `emd_records/x` with `refundAccountTxnId` | ❌ |
| T-273 | acct1 | update `emd_records/x` setting `paymentAccountTxnId` | ❌ |
| T-274 | acct1 | create `guarantees/x` (amountPaise, bankChargesPaise, stamps) | ✅ |
| T-275 | acct1 | create `guarantees/x` with `renewalTaskId` | ❌ |
| T-276 | sweep | every collection: one valid **create** by an allowed role succeeds | ✅ (catches any other create rule that reads `resource`) |

### Fix 3: generated-expense sources are pending (D-30)

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-277 | sup1 | create `machinery_fuel_logs` projA, pending, litres, rate, amount, accountId | ✅ |
| T-278 | sup1 | create the same with `approvalStatus: approved` | ❌ |
| T-279 | sup1 | create the same without `approvalStatus` | ❌ |
| T-280 | sup1 | update own pending fuel log setting `approvalStatus` | ❌ |
| T-281 | pm1 | create `machinery_maintenance`, pending, costPaise, vendorId | ✅ |
| T-282 | pm1 | create `machinery_maintenance` with `approvalStatus: approved` | ❌ |
| T-283 | owner1 | create `machinery_maintenance` with `approvalStatus: approved` | ❌ (owner auto-approve is server-side) |
| T-284 | sup1 | create `stock_transfers` with `transportCostPaise` | ❌ (record as a pending expense) |

### Fix 4: worker payments need a paid-from account

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-285 | pm1 | create `worker_payments` net 80000, no `accountId` | ❌ |
| T-286 | pm1 | create with `mode: credit` | ❌ |
| T-287 | pm1 | create net 0 (advance fully recovered), no `accountId` | ✅ |
| T-288 | pm1 | update pending payment removing `accountId` | ❌ |

### Fix 5: damage and theft always pending with a reason

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-289 | acct1 | create `stock_ledger` kind damage, no `approvalStatus` | ❌ |
| T-290 | owner1 | create kind theft, pending, `reason: ""` | ❌ |
| T-291 | owner1 | create kind theft, pending, with reason | ✅ |
| T-292 | sup1 | create kind return | ❌ (finance only) |
| T-293 | sup1 | create consumption with `qtyOutMilli: -500` | ❌ |

### Fix 6: wage rates (D-32)

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-294 | pm1 | update `workers/w1` `defaultRatePaise` | ❌ |
| T-295 | pm1 | update `workers/w1` `phone` (+ stamps) | ✅ |
| T-296 | pm1 | create a worker with `defaultRatePaise` | ❌ |
| T-297 | pm1 | create a worker without rate fields | ✅ |
| T-298 | pm1 | write `workers/w1/project_terms/projA` | ❌ |
| T-299 | pm1 | create `rate_change_requests` for w1 on projA, pending, with reason | ✅ |
| T-299a | pm1 | create `rate_change_requests` on projB | ❌ |
| T-299b | pm1 | update own `rate_change_requests` to approved | ❌ |
| T-299c | acct1 | update `workers/w1` `defaultRatePaise` | ✅ |

### Fix 7: shape checks on update

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-310 | acct1 | update approved `expA2` with `amountPaise: -5000` | ❌ |
| T-311 | acct1 | update `expA2` (mode cash) deleting `accountId` | ❌ |
| T-312 | acct1 | update `expA2` with `mode: barter` | ❌ |
| T-313 | acct1 | update `expA2` removing bill photo and no-bill reason | ❌ |
| T-314 | sup1 | create attendance status overtime, `otHoursMilli: -2000` | ❌ |
| T-315 | sup1 | update attendance `otHoursMilli: -1` | ❌ |
| T-316 | acct1 | update `payments_received` `amountPaise: 0` | ❌ |
| T-317 | acct1 | update `vendor_payments` deleting `accountId` | ❌ |

### Fix 8: viewers see totals only
Covered by T-103a and T-242 (no raw expenses or bill photos for `view1`), and T-125 (finance rollups still visible).

### Item 9: site roster (D-33)

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-318 | sup1 | create attendance for w2 (inactive on projA's roster) | ❌ |
| T-319 | sup1 | create attendance for w3 (not on the roster) | ❌ |
| T-320 | pm1 | create `projects/projA/roster/w3` (active, addedBy pm1, addedAt now) | ✅ |
| T-321 | pm1 | create a roster entry with `workerName` set | ❌ (server snapshot) |
| T-322 | sup1 | create a roster entry | ❌ |
| T-323 | pm1 | update roster entry `workerRole` | ❌ |

### Low-priority items

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-324 | acct1 | delete `materials/m1` | ❌ |
| T-325 | pm1 | delete `projects/projA/boq_items/b1` | ❌ |
| T-326 | owner1 | update `accounts/acc1` `openingBalancePaise` (opening month 2026-09 locked) | ❌ |
| T-327 | owner1 | update `accounts/acc2` `openingBalancePaise` (opening month open) | ✅ |
| T-328 | acct1 | update `accounts/acc2` `openingBalancePaise` | ❌ (owner only) |

### Enquiry contract v2.1: "Needs checking" (D-31)

Rules cases (Firestore emulator):

| ID | Role | Operation | Expected |
|---|---|---|---|
| T-330 | owner1 | q: `lead_webhook_logs where result == "rejected" and reviewStatus == "open" order by receivedAt desc` ("Needs checking") | ✅ |
| T-331 | acct1, pm1, view1, ca1 | the same query | ❌ (owner-only) |
| T-332 | owner1 | update `lead_webhook_logs/x` `reviewStatus` directly | ❌ (`createLead` / `dismissEnquiry` callables only) |

Function cases (`submitEnquiry` in the Functions emulator; these run in Phase 3 with `tests\functions\`):

| ID | Request | Expected response | Firestore | Cloud Logging |
|---|---|---|---|---|
| T-333 | Valid enquiry, new phone | `200 {success:true}` | lead created, `lead_phones` doc, follow-up task, log `created` | — |
| T-334 | Valid enquiry, known phone | `200 {success:true}` (identical to T-333) | note on the existing lead, log `noted`; **no new lead** | — |
| T-335 | **"Needs checking":** consent `yes`, phone `98765 43210`, `location` empty | `200 {success:false, message}` | log `rejected`, `reviewStatus: "open"`, payload and reason stored; appears in the T-330 query | — |
| T-336 | **No consent → nothing stored:** consent missing, otherwise valid | `200 {success:false, message}` | **no document in any collection** | reason only; the log line contains no name, phone, email or message |
| T-337 | Unusable phone (`0522 2345678`), consent `yes` | `200 {success:false, message}` | **nothing** | reason only, no personal data |
| T-338 | Body of 11 KB | `413` or `200 {success:false}` | nothing | reason and hash, no form contents |
| T-339 | 6th submission from one IP within an hour | `429` | nothing | reason and hash |
| T-340 | Honeypot `botcheck: "on"` | `200 {success:true}` | nothing | reason and hash |
| T-341 | Origin not in the allow-list | CORS refusal | nothing | reason and hash |
| T-342 | The T-333 body sent again | `200 {success:true}` | no second lead; `retryCount` 1 | — |
| T-343 | Owner dismisses the T-335 entry | — | `reviewStatus: "dismissed"`, **`rawPayload` null** | — |
| T-344 | Owner converts the T-335 entry with the location filled in | — | lead created through `createLead` (de-dup applies), `reviewStatus: "converted"`, `leadId` set | — |

## 15. Rules-language checks (Phase 1 note P1-04)

Run first, with T-001: if the rules don't compile, nothing else matters.

| ID | Check | Expected |
|---|---|---|
| T-300 | Emulator loads `firestore.rules` and `storage.rules` with no compile errors | ✅ |
| T-301 | `fyOf("2026-04-01")` via an expense create with `fy: "2026-27"` | ✅ |
| T-302 | `fyOf("2027-01-15")` → `"2026-27"` | ✅ |
| T-303 | `fyOf("2099-06-01")` → `"2099-00"` (two-digit wrap) | ✅ |
| T-304 | `fyOf("2008-05-01")` → `"2008-09"` (zero padding) | ✅ |
| T-305 | Storage `firestore.get()` cross-service lookup works for an assigned supervisor (T-230) | ✅ |

## 16. Rule limits to watch

- `get()`/`exists()` budget: 10 per single-document request, 20 per batch or transaction. The attendance create path uses four unique documents (project, roster entry, period lock, settings); the expense update path uses up to three (project, two period locks). In a 50-worker "mark all present" **batch** every document needs the same three lookups. I believe repeated lookups of the same document within one request are de-duplicated, but I haven't confirmed how they count against the limit. **Phase 1 test T-250:** a batch of 50 attendance writes by sup1. If it fails on the limit, the mobile app writes attendance in chunks of 5 (3 lookups each, under 20), or the bulk action moves to a callable.
- `request.time` vs `serverTimestamp()`: tests must write `createdAt`/`updatedAt` with `serverTimestamp()` to pass `stampedCreate()`, as the app will.

## 17. Role scope and rates (M1.2: QA F1, F6, F7; D-42, D-43)

Fixtures: `pm1` has the claim `projects: ["projShivNagar", "projSharma"]`; worker `wA` has `siteIds: ["projShivNagar"]`, worker `wB` has `siteIds: ["projGomti"]`. The demo read matrix (`core/roles.canRead`) mirrors these and is tested in `packages/core/test/roles.test.ts` (RL-01…RL-06).

| ID | Case | Expected |
|---|---|---|
| T-350 | pm1 gets `workers/wA` | ✅ |
| T-351 | pm1 gets `workers/wB` (not on any of the PM's sites) | ❌ |
| T-352 | pm1 lists `workers` with `where('siteIds', 'array-contains-any', ['projShivNagar', 'projSharma'])` | ✅ |
| T-353 | pm1 lists `workers` with no site filter | ❌ (query can't be proved safe) |
| T-354 | pm1 gets `workers/wA/private/pay` | ❌ |
| T-355 | pm1 gets `workers/wA/project_terms/projShivNagar` | ❌ (rule A: PMs never see rates) |
| T-356 | owner writes `workers/wA` with `defaultRatePaise` on the master | ❌ (rates only in `private/pay`) |
| T-357 | accountant writes `workers/wA/private/pay` `{ defaultRatePaise: 50000 }` | ✅ |
| T-358 | accountant writes `workers/wA/private/pay` `{ defaultRatePaise: -1 }` | ❌ |
| T-359 | pm1 updates `workers/wA` `siteIds` | ❌ (function-maintained) |
| T-360 | sup1 gets `workers/wA` | ❌ (supervisors use the roster) |
| T-361 | viewer gets `clients/clSharma` | ❌ (D-42) |
| T-362 | viewer gets `projects/projShivNagar` and `projects/projShivNagar/private/budget` | ✅ ✅ |
| T-363 | viewer gets `projects/projShivNagar/private/commercial`, `invoices/x`, `attendance/x`, `projects/projShivNagar/roster/w001` | ❌ ❌ ❌ ❌ |
| T-364 | viewer gets `rollups/co_2026-10` and `finance_rollups/co_2026-10` | ✅ ✅ |
| T-365 | ca gets `expenses/x`, `invoices/x`, `payments_received/x`, `account_transactions/x`, `vendor_bills/x`, `vendor_payments/x` | ✅ for each |
| T-366 | ca gets `clients/x`, `agreements/x`, `purchase_orders/x`, `stock_ledger/x`, `quotations/x`, `projects/p/roster/w`, `projects/p/private/commercial`, `vendors/v/private/bank` | ❌ for each (D-43) |
| T-367 | ca gets `projects/projShivNagar` (name and code for report filters) | ✅ |

## 18. Labour (M1.3: D-45, D-46, QA N10)

Fixtures as §17. `uOwner` unlocked `projShivNagar_2026-10-20` (`untilTs` = now + 24 h). Contract `tcShivNagarCC` on `projShivNagar`.

| ID | Case | Expected |
|---|---|---|
| T-370 | pm1 gets `worker_payments/x` on an assigned project | ❌ (D-45) |
| T-371 | pm1 creates `worker_payments` | ❌ (D-45) |
| T-372 | pm1 gets `worker_balances/w001_projShivNagar` | ❌ |
| T-373 | pm1 gets `thekedar_contracts/tcShivNagarCC` | ❌ |
| T-374 | pm1 gets `contract_scopes/tcShivNagarCC` | ✅ (QA N10) |
| T-375 | sup1 gets `contract_scopes/tcShivNagarCC` | ❌ |
| T-376 | pm1 gets `workers/wMohanLal` (crewSiteIds has projShivNagar) | ✅ (QA N10) |
| T-377 | pm on projGomti only gets `workers/wMohanLal` | ❌ |
| T-378 | accountant creates `contract_measurements` for an existing contract with valuePaise > 0 | ✅ |
| T-379 | pm1 creates `contract_measurements` | ❌ |
| T-380 | sup1 writes attendance for `projShivNagar` dated 4 days ago | ❌ (lock, D-25) |
| T-381 | same, after the owner's unlock (`untilTs` in the future) | ✅ |
| T-382 | same, after `untilTs` has passed | ❌ |
| T-383 | sup1 creates `attendance_checkins/projShivNagar_<date>_<sup1 uid>` with `by` = sup1 | ✅ |
| T-384 | sup1 creates a check-in with someone else's uid in the ID | ❌ |
| T-385 | anyone writes `attendance_unlocks` or `contract_scopes` from a client | ❌ (functions only) |
| T-386 | owner writes `workers/wMohanLal.crewSiteIds` from a client | ❌ (function-maintained) |
| T-387 | ca gets `worker_payments/x` and `thekedar_contracts/tcShivNagarCC` | ✅ ✅ (accounting records, D-43) |

## 19. Roles from the users document, the first owner, server-only collections, Setup & integrations (M1.6: D-48, D-49, D-52)

These run on the Firebase emulators in CI (`emulator-tests/rules.test.ts`, `npm run test:emulator`). Roles are read from each person's `users/{uid}` document (D-52); the tests seed no sign-in claims.

| ID | Check |
|---|---|
| PARITY | For each of the six roles and a sample of every seeded collection (including project detail records and the private pay, budget and commercial documents), the rules allow a read exactly when core's `canRead` says so |
| T-300 | No signed-in role, not even the owner, can write `rollups`, `finance_rollups`, `postings`, `counters`, `account_transactions`, `worker_balances`, `audit_log`, `command_requests`, `private_config`, `processed_events` from a browser |
| T-301 | Signed out: nothing is readable, including `system/owner` |
| T-302 | A signed-in account with no users document reads nothing except its own (missing) document and `system/owner` |
| T-303 | A person who is switched off (`active: false`) reads nothing, but can read their own document |
| T-304 | `command_requests` and `private_config` are closed to everyone, a super user included |
| T-370 | `integrations` is readable only by an owner whose document says superUser (not a plain owner, accountant, PM, supervisor, viewer or CA) |
| T-371 | `integrations` cannot be written, updated or deleted from a client, a super user included |
| T-372 | `system_probe` (the Firestore Test) is read and written only by a super user |
| T-373 | A super-user flag on a non-owner opens nothing |
| T-380 | A person changes only their own language and theme, stamped by the server clock |
| T-381 | Nobody changes their own role, status, projects or super-user flag (the owner included) |
| T-382 | An owner manages OTHER people's role, on/off and projects; an accountant cannot; an unknown role is refused; only a super user changes the super-user flag |
| T-383 | A site role reads only their own user document; owner and accountant read all; the CA does not |
| T-384 | Nobody creates another person's document or deletes one from a browser |
| T-390 | The verified owner address (any capitals) creates its users document and `system/owner` in one batch, then works as a super user; the marker can never change or be removed |
| T-391 | An unverified email is refused |
| T-392 | Any other address (including a one-letter typo) and an account with no email are refused |
| T-393 | Once an owner exists, nobody can do it again, even the same address |
| T-394 | The document must be exactly a first owner: role owner, super user, on, no projects, no extra fields, the owner address |
| T-395 | Both documents or neither: one alone is refused |
| T-396 | The documents must be the signer's own: not another person's id, and not a marker naming someone else |

The functions tests (`emulator-tests/functions.test.ts`, FN-01…FN-35) cover the transaction runner and the Setup and sample-data logic that will run inside the Netlify Function (D-51).
