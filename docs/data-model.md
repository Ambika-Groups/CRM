# Ambika Group CRM: Firestore data model

Phase 0 deliverable (spec §3.1, §12). Draft 6, 25 Oct 2026. Status: signed off; draft 6 (M1.3) adds the labour collections and D-45; draft 5 (M1.2) applies D-42 (viewer), D-43 (CA) and rule A (rates in `workers/{id}/private/pay`) to the read matrix. Draft 4 updates `lead_webhook_logs` for enquiry contract v2 and adds masked Aadhaar to KYC.

Read with [decisions.md](decisions.md); decision IDs (D-xx) are cited inline.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Database | Cloud Firestore, Native mode, `asia-south1` (Mumbai). One database per Firebase project (dev, staging, prod). |
| Collection names | `snake_case`, as listed in spec §12 (D-02). |
| Field names | `camelCase` (`projectId`, `categoryPath`, `assignedUsers`) (D-02). |
| Document IDs | Auto IDs, except where §8 lists a deterministic ID. |
| Money | Integer **paise**, field name ends in `Paise` (`amountPaise`). Never floats (§3.1 rule 4). Negative values allowed only where stated (adjustments, credit notes, rollup deltas). |
| Rates / percentages | Integer **basis points**, suffix `Bp` (`gstRateBp: 1800` = 18%). |
| Quantities | Integer **thousandths**, suffix `Milli` (`qtyMilli: 2500` = 2.5 brass). Unit stored alongside (`unit`). |
| Arithmetic | One shared helper `mulDivRound(a, b, c)` does multiply-then-divide in **BigInt** with half-up rounding and returns a Number after checking it is a safe integer. Products like `qtyMilli × ratePaise × (10000 − discountBp)` reach ~1e17, beyond `Number.MAX_SAFE_INTEGER` (~9e15). Stored values stay Numbers (D-01). |
| Business dates | String `YYYY-MM-DD` in IST, field `date` (or `dueDate`, `startDate`…). Avoids timezone drift on offline phones (D-04). Derived `monthKey` `YYYY-MM` and `fy` `2026-27` stored on every dated financial record. |
| System times | Firestore `Timestamp` (`createdAt`, `updatedAt`, `approvedAt`…), set with `serverTimestamp()`. |
| Common fields | Every document: `createdAt`, `createdBy` (uid), `updatedAt`, `updatedBy`. Every financial / master document also: `isDeleted` (bool, default false), `deletedAt`, `deletedBy`, `deleteReason`. Soft delete only for financial records (§3.1 rule 12). |
| References | Fields ending in `Id` hold a document ID. A reference is usually paired with a **name snapshot** (`projectName`, `clientName`, `payeeName`) taken at write time (§3.1 rule 2). Snapshots are marked **(snap)** below. |
| Search | `searchKeywords: string[]`: lowercase prefixes (min 2 chars) of name words, phone digits (last 10 and last 4), bill / document number. Written by Cloud Function on create/update, max ~60 entries (§3.1 rule 10). |
| Language | Master data that users see in both languages carries `name` + optional `nameHi`. |
| Writer column | **C** = client may write (subject to rules); **S** = server only (Cloud Functions / Admin SDK); **C→S** = client sets on create, then read-only. |

### Roles (custom claim `role`)
`owner`, `accountant`, `pm` (project manager / site engineer), `supervisor`, `viewer`, `ca` (D-05). Claim set only by a callable admin function. Project access: `projects/{id}.assignedUsers` (D-06). If the D-21 emulator test fails, a second claim `projects` (array of assigned project IDs) is mirrored from `assignedUsers` by a function, with a forced token refresh on change.

Who may read what is in §12 (read-access matrix). Rules work per document and cannot hide fields, so any field a role must not see lives in a separate document (D-28).

### Enumerations (shared)
- `paymentMode`: `cash` | `upi` | `bank` | `cheque` | `credit`
- `approvalStatus`: `pending` | `approved` | `rejected`
- `fy`: `"2026-27"` (April–March)

---

## 2. Identity, settings and system

### `users/{uid}` — doc ID = Firebase Auth uid
| Field | Type | Writer | Notes |
|---|---|---|---|
| name, phone, email | string | S | phone `+91XXXXXXXXXX` |
| role | string | S | mirror of custom claim, for listing; the claim is authoritative |
| active | bool | S | inactive users have claim revoked |
| language | `en`\|`hi` | C (self) | created as `en` by the user-creation callable |
| theme | `light`\|`dark`\|`system` | C (self) | §4A.4 and the top-bar switch (D-26); created as `system` |
| projectIds | string[] | S | mirror of every `assignedUsers` containing this uid, for "my projects" UI |
| defaultSalesUser | bool | S | receives website-lead follow-ups (§13.1) |

Subcollections: `users/{uid}/devices/{tokenHash}` (FCM token, platform, lastSeen; C self), `users/{uid}/notifications/{id}` (title, body, link, type, read, createdAt; S create, C self may set `read`).

### `settings/{docId}` — fixed IDs
| Doc | Contents |
|---|---|
| `company` | legalName, tradeName, address, stateCode, gstin, pan, phone, email, logoPath, signaturePath, stampPath, brandColor, gstScheme (`regular`\|`composition`) |
| `bank` | accounts shown on invoices: [{bankName, accountName, accountNo, ifsc, branch, upiId}] |
| `numbering` | formats per doc type (D-12), e.g. `{invoice: "AG/{fy}/{seq4}", credit_note: "CN/{fy}/{seq4}", debit_note: "DN/{fy}/{seq4}", advance_receipt: "RV/{fy}/{seq4}", proforma: "AG/PF/{fy}/{seq4}", receipt: "AG/R/{fy}/{seq4}", quotation: "AG/Q/{fy}/{seq4}", agreement: "AG/C/{fy}/{seq4}", project: "AG-P-{seq4}", voucher: "V/{fy}/{seq5}"}`. GST document types are validated to ≤16 characters of `[A-Za-z0-9/-]` |
| `templates` | WhatsApp message templates {en, hi} per doc type; T&C templates; invoice template choice |
| `operations` | workerRoles [{key, label, labelHi, expenseCategoryId, active}] (§6.1 editable role list; maps each role to its Labour sub-category), attendanceLockDays (3), expenseApprovalThresholds by role, missingBillThresholdPaise, leadFollowUpHours (2), emdRefundAlertDays, fuelOverusePctBp, stockRunoutDays |
| `deductionHeads` | [{key, label, labelHi, defaultRateBp, appliesTo}] — TDS, GST-TDS, labour cess, retention, royalty, other |

Writer: owner only (accountant may edit `bank`, `templates`).

### `counters/{counterId}` — server only (D-12)
Deterministic ID: `{docType}_{fy}` (`invoice_2026-27`, `quotation_2026-27`, `agreement_2026-27`, `voucher_2026-27`, `receipt_2026-27`) or `{docType}` for non-FY sequences (`project`).

```ts
{ docType: "invoice", fy: "2026-27", next: 42, updatedAt: Timestamp }
```
Document numbers (invoice, notes, receipts, quotations, agreements, project codes) are allocated only inside the callable function's transaction that also writes the numbered document; no number is ever taken and abandoned. For GST document types the function rejects any formatted number longer than 16 characters or outside `[A-Za-z0-9/-]` (CGST Rules 46(b), 50, 53).

**Voucher numbers are the exception** (D-12): they are not allocated inside posting transactions, which would make `voucher_{fy}` the hottest document in the system. A scheduled function (every 5 minutes, and on demand before a CA export) takes posted `account_transactions` and generated records that have `voucherNo == null`, orders them by `date, postedAt, id`, and assigns consecutive numbers in batches of up to 400 with **one** counter write per batch. Assignment only fills empty `voucherNo` fields, so a rerun is a no-op.

### `audit_log/{autoId}` — server only, append-only
`entity` (collection), `entityId`, `action` (`create`|`update`|`soft_delete`|`restore`|`approve`|`reject`|`lock_override`), `userId`, `userName` (snap), `oldValue` (map, changed fields only), `newValue` (map), `projectId`, `timestamp`, `eventId` (trigger event id; idempotency). Written by triggers on every financial collection (§3.1 rule 12). Indexes: entity+entityId+timestamp, projectId+timestamp, userId+timestamp.

### `postings/{entity}_{docId}` — server only (D-08)
The last effect of a financial document that was applied to rollups, balances and `account_transactions`. The effect is a flat map of **targets**: each key names one counter (a document plus a field path), and each value is the amount this record contributes to it.

```ts
{
  entity: "expenses", docId: "abc",
  targets: {
    "rollups/p_p1_2026-10|expense.approvedPaise.cat_gitti":  1250000,
    "rollups/p_p1_2026-10|expense.gstPaise.cat_gitti":         190678,
    "rollups/p_p1_2026-10|expense.paidPaise.cat_gitti":      1250000,
    "rollups/p_p1_2026-10|expense.count.cat_gitti":                 1,
    "rollups/co_2026-10|expense.approvedPaise.cat_gitti":    1250000,
    "finance_rollups/co_2026-10|accounts.acc_cash.outPaise": 1250000,
    "finance_rollups/co_2026-10|gstInputPaise":               190678,
    "accounts/acc_cash|balancePaise":                       -1250000
  },
  accountTxn: { id: "expenses_abc", exists: true },   // the account_transactions row this record owns
  postedAt: Timestamp
}
```

Posting algorithm, run inside **one** transaction for every trigger event:
1. **Re-read the source document** inside the transaction. Never use the event's `after` snapshot as current: Firestore doesn't guarantee event order, so a late, older event would otherwise revert a newer posting. With the re-read, every event (any order, any number of retries) converges on the current state.
2. Compute the current targets from the source (an empty map if the record is pending, rejected or deleted). `monthKey` and `fy` are **derived from the source's `date`**, never read from its stored fields (rules also require them to match, D-13).
3. Read the posting doc. For every key in the union of old and new targets, delta = new − old. Because the deltas are per target, a change of date, project, category or account **moves** the amount between counters instead of netting it out.
4. If every delta is zero (and the account row needs no change), **write nothing** and stop. A replay and a system-only field change (`categoryPath`, `searchKeywords`) both end here.
5. Check `period_locks` for every month that has a non-zero delta. A locked month aborts the posting and sets `postingError` on the source record (D-10c, D-13).
6. Apply `FieldValue.increment(delta)` to each target, upsert or soft-delete the `account_transactions` row, and overwrite the posting doc.

### Rollups — server only (D-09, D-28)
Split by audience, because rules can't hide fields: **`rollups`** holds cost-side figures that project managers may see; **`finance_rollups`** holds billing, receipts, tax and account figures that only finance roles see. Both use the same deterministic IDs:
- `co_{YYYY-MM}`: company, month
- `p_{projectId}_{YYYY-MM}`: project, month
- `p_{projectId}_all`: project, lifetime (project list, P&L)

FY and custom ranges are summed from monthly docs at read (≤12 reads per scope and collection).

#### `rollups/{rollupId}` (cost side)
```ts
{
  scope: "company" | "project", projectId: string | null, period: "2026-10" | "all", fy: "2026-27" | null,
  expense: {                          // keyed by POSTED category ID (any level); parent totals are summed on read from the category tree
    approvedPaise: { [categoryId]: number },   // Total expense = approved, paid + unpaid, gross of GST (§11.1a)
    gstPaise:      { [categoryId]: number },   // GST inside approvedPaise, so "excl. GST" = approved − gst (D-20, question D14)
    paidPaise:     { [categoryId]: number },   // "paid only" toggle
    count:         { [categoryId]: number }
  },
  expenseTotalPaise: number, expensePaidPaise: number, expenseGstPaise: number,
  wagesEarnedPaise: number,            // from attendance (accrual)
  wagesExpensedPaise: number,          // gross wages settled = Labour expense (D-16)
  // wages due = wagesEarnedPaise − wagesExpensedPaise, shown beside expense (D-16a)
  attendance: { present: number, half: number, absent: number, leave: number, otHoursMilli: number },  // project-month only
  updatedAt: Timestamp
}
```

#### `finance_rollups/{rollupId}` (finance side)
```ts
{
  scope, projectId, period, fy,                          // as above
  billedPaise: number,                 // tax, RA and milestone invoices, net of credit/debit notes; excludes proforma
  receivedPaise: number,               // receipts against invoices (cash basis)
  clientAdvanceReceivedPaise: number, clientAdvanceAdjustedPaise: number,   // not income until adjusted (D-16b)
  gstOutputPaise: number, gstInputPaise: number,
  tdsHeldPaise: number, retentionHeldPaise: number,      // receivable heads (§8.6)
  tdsDeductedPaise: number,            // TDS we deducted on contractor/vendor payments (194C), payable to government
  vendorBilledPaise: number, vendorPaidPaise: number,
  accounts: { [accountId]: { inPaise: number, outPaise: number } },  // company-month only
  updatedAt: Timestamp
}
```
Maps keyed by category ID stay small (seed tree ≈ 35 nodes). Filters that rollups cannot answer (payment mode, entered-by, date range inside a month) use Firestore `sum()`/`count()` aggregation queries on `expenses` (§3.1 rule 9). An owner-only callable `rebuildRollups` recomputes every rollup, posting and balance from raw data.

### `category_moves/{id}` — owner create via callable; server updates (D-10)
Resumable background job that rewrites `categoryPath` on expenses after a category is re-parented.
```ts
{ categoryId, fromParentId, toParentId, requestedBy, requestedAt,
  status: "queued" | "running" | "done" | "failed",
  cursor: string | null,             // last expense ID processed (ordered by __name__)
  processed: number, error: string | null, finishedAt: Timestamp | null }
```
The job pages through `expenses where categoryPath array-contains categoryId`, 400 at a time, saving `cursor` after each page; a crash or timeout resumes from the cursor. It writes only `categoryPath`, which the posting function treats as a zero delta (writes nothing) and the audit trigger ignores. One `audit_log` entry is written on the category itself when the move is requested and one when it finishes. The rewrite is allowed in locked months because it changes no financial field.

### `processed_events/{eventId}` — server only
For non-posting side effects that are not naturally idempotent (sending a notification, creating a follow-up task): `{ handler, createdAt, expireAt }`, created in the same transaction; a Firestore TTL policy on `expireAt` (createdAt + 30 days) deletes old markers.

---

## 3. Masters

### `clients/{id}`
name, company, phone, whatsapp, email, address, stateCode, gstin, pan, type (`individual`|`builder`|`government`), notes, searchKeywords (S). Server-maintained: `outstandingPaise` (S). Linked projects via query `projects where clientId ==`.

### `vendors/{id}`
name, type (`cement`|`steel`|`aggregate`|`transporter`|`machinery_owner`|`other`), phone, gstin, pan, address, stateCode, searchKeywords (S). Bank details in `vendors/{id}/private/bank` {bankName, accountNo, ifsc, upiId} (finance roles only). Payable and advance balances live in `vendor_balances/{vendorId}` (S; finance roles only: payablePaise, advancePaise, tdsDeductedPaise), not on the vendor doc, so a PM can read the vendor list for purchase orders without seeing what we owe (D-28).

### `workers/{id}`
| Field | Type | Writer | Notes |
|---|---|---|---|
| name, phone, photoPath | string | C | |
| role | string | C | key into editable role list (`settings/operations.workerRoles`) |
| thekedarId, thekedarName (snap) | string\|null | C | always a `workers` document with `isThekedar: true` (D-29) |
| isThekedar | bool | C | a thekedar is a worker record; their pay, contracts, ledger and TDS all go through the Labour module |
| defaultPayType | `daily`\|`contract`\|`monthly` | C | |
| otMultiplierBp | int | C | rates are **not** on the master (rule A; see private/pay) |
| joiningDate, active, emergencyContact | | C | |
| siteIds | string[] | S | projects whose roster the worker is on; maintained from the rosters (D-33). A PM reads a worker only if this has one of their projects (QA F1) |
| searchKeywords | string[] | S | |

**Private** `workers/{id}/private/pay` (owner + accountant only, M1.2): defaultRatePaise, otRatePaise (null = daily rate ÷ 8). Moved off the master because Firestore rules can't hide single fields and rule A says PMs and supervisors never see rates.

**Private subcollection** `workers/{id}/private/kyc` (owner + accountant only; §15 compliance): address, idProofType, idProofNumberMasked (last 4 digits only), idProofPath (**masked Aadhaar copies only**, first 8 digits hidden, confirmed by the uploader; D-22), bank {accountNo, ifsc}, upiId, and for thekedars: pan (TDS rate depends on it, s.194C), gstin, tdsSection (default `194C`), tdsRateBp (default 100 individual/HUF, 200 others; 2000 without PAN — rates confirmed by CA, question D15). Keeps ID documents away from supervisors, who need the worker list for attendance.

Per-project pay terms: `workers/{id}/project_terms/{projectId}` — payType, ratePaise, otRatePaise, effectiveFrom (§6.2 "different pay types on different projects"). **Owner and accountant only** (D-32, rule A from M1.2).

Pay fields on the worker (`defaultPayType`, `otMultiplierBp`, `isThekedar`) are written only by owner or accountant; rates live in `private/pay`. A PM may create and edit workers without those fields and proposes rates through `rate_change_requests` (D-32). Supervisors don't read `workers`; they read the site roster (D-33).

### `rate_change_requests/{id}` (D-32)
workerId, workerName (snap), projectId (null = default rate), proposedPayType, proposedRatePaise, proposedOtRatePaise, effectiveFrom, reason, requestedBy, approvalStatus (created `pending`). The `approveRecords` callable writes the approved values to the worker or its `project_terms` and audits the change. A worker added by a PM with no rate yet earns ₹0 per attendance, and the record shows "Rate missing" in Books readiness until the rate is approved.

### `expense_categories/{id}`
name, nameHi, parentId (null for level 1), level (1–n, S), sortOrder, active, isSystem (seed nodes for Labour/Materials/Machinery/Commission used by automatic postings; cannot be deleted). Seed tree from spec §7.1 with readable IDs (`cat_labour`, `cat_materials_aggregate_gitti`…). Admin-editable; re-parenting changes only `parentId`/`level` (D-10).

### `materials/{id}`
name, nameHi, categoryId (expense category), unit (`bag`|`tonne`|`brass`|`cum`|`trolley`|`nos`|`kg`|`rmt`|`sqft`), defaultVendorId, reorderLevels { [projectId]: qtyMilli }.

### `machinery/{id}`
name, type, ownership (`own`|`hired`), make, regNo, purchaseDate, purchaseValuePaise, insuranceExpiry, fitnessExpiry, pucExpiry, defaultOperatorId; hired: vendorId, vendorName (snap), rateType (`hour`|`day`|`month`|`trip`), ratePaise, minHoursMilli, fuelIncluded (bool); own: internalCostPerHourPaise. Server: avgFuelPerHourMilli, hoursSinceService.

### `accounts/{id}` (§12 v1.1)
name, type (`cash`|`bank`|`upi`), bankName, last4, openingBalancePaise, openingDate, active. Server: `balancePaise` (incremented in the same transaction as its `account_transactions` row).

### `item_library/{id}` (§8.2 item and rate library)
group (`earthwork`|`base`|`surface`|…), description, descriptionHi, unit, ratePaise, gstRateBp, hsnSac.

### `agreement_templates/{id}`, `agreement_clauses/{clauseKey}/versions/{n}`
Templates: name, side (`client`|`contractor`), type, clauseKeys[], bodyHtml, active, reviewedBy (advocate name), reviewedOn. Clauses are versioned; a new version never overwrites an old one (§8A.4). Owner-only write.

---

## 4. Projects

### `projects/{id}`
| Field | Type | Writer | Notes |
|---|---|---|---|
| code | string | S | `AG-P-0001`, allocated by `createProject` callable |
| name, type (`residential`\|`government`), subtype | | C | |
| clientId, clientName (snap) | | C | |
| address, city, location {lat, lng} | | C | |
| startDate, expectedEndDate, actualEndDate | date str | C | |
| status | `planned`\|`in_progress`\|`on_hold`\|`completed`\|`cancelled` | C | |
| isArchived | bool | C (owner) | no delete if expenses/invoices exist (§5.6) |
| managerId, managerName (snap) | | C | |
| **assignedUsers** | string[] uid | C (owner) | manager + supervisors + staff; rules source of truth (D-06) |
| progressPct | int 0–100 | C | |
| attendanceRequiresSelfie, attendanceRequiresGps | bool | C | §6.3 |
| itcEligible | bool | C (owner) | whether input GST on this project's expenses is claimed as credit; drives the default "excl. GST" expense view (D-20, question D14) |
| residential | map\|null | C | §5.3, non-money fields: units, floors, builtUpAreaSqft, plotAreaSqft, reraNo, reraValidity, contractType (`lump_sum`\|`per_sqft`\|`cost_plus`), defectLiabilityMonths, handoverDate |
| government | map\|null | C | §5.4, non-money fields: department, division, engineerInCharge {name, phone}, tenderId, tenderNo, nitRef, workOrderNo, workOrderDate, agreementNo, stipulatedStartDate, stipulatedEndDate (S-updated on EOT approval) |
| searchKeywords | string[] | S | |

`project_residential` / `project_government` from §12 become the `residential` / `government` maps (1:1 data, always read with the project) (D-14). **Money and commercial terms are not on the project document** (D-28); they live in two restricted subdocuments:

| Subdocument | Fields | Read |
|---|---|---|
| `projects/{id}/private/budget` | budgetPaise, budgetByCategory { [categoryId]: paise } (optional, for budget-vs-actual per head) | finance roles + assigned `pm` (budget vs actual is a cost view, §5.5) |
| `projects/{id}/private/commercial` | contractValuePaise; government: agreementValuePaise, tenderPremiumBp (signed), ldRatePerDayPaise, ldCapBp, securityDepositPaise, retentionBp; residential: paymentTerms | finance roles only (owner, accountant, viewer, ca) |

Subcollections (project-scoped, §3.1 rule 7):

| Subcollection | Fields |
|---|---|
| `roster/{workerId}` | **Site roster** (D-33): active, addedBy, addedAt, removedBy, removedAt (written by finance or the assigned PM); workerName, workerRole, photoPath, thekedarId, thekedarName, payType (`daily`\|`contract`\|`monthly`) as **snapshots filled by a function**, refreshed when the worker or project terms change. **No rates.** Read by everyone who can read the project except `ca`. Drives the supervisor attendance screen (§6.3) and the §6.5 site workforce list; rules allow attendance only for active roster members |
| `project_units/{id}` | unitNo, floor, areaSqft, status (`available`\|`booked`\|`sold`\|`handed_over`), customerId, customerName (snap), pricePaise — **finance roles only** (customer and price) |
| `project_milestones/{id}` | name, sortOrder, pctBp, amountPaise, dueDate, status (`pending`\|`invoiced`\|`paid`), invoiceId — **finance roles only** (payment schedule) |
| `project_approvals/{id}` | kind (`map`\|`noc`\|`electricity`\|`water`\|other), status, appliedDate, approvedDate, expiryDate, documentId |
| `boq_items/{id}` | itemNo, description, unit, qtyMilli, sorRef — quantities only, readable on site for MB and consumption variance |
| `boq_rates/{boqItemId}` | ratePaise, amountPaise — **finance roles only**; the agreement rate is what the client pays, so it stays off the site-visible BOQ (D-28) |
| `measurement_book/{id}` | boqItemId, boqItemName (snap), date, qtyMilli, mbPage, remarks, measuredBy |
| `dpr/{YYYY-MM-DD}` | **ID = date** (one per day): workDone, quantities [{boqItemId, qtyMilli}], manpowerCount (S-filled from attendance; C override), weather, machineryUsed [], issues, photoPaths [] — offline-capable |
| `eot_requests/{id}` | reason, appliedDate, periodRequestedDays, periodApprovedDays, authority, orderNo, orderDate, status (`applied`\|`pending`\|`approved`\|`rejected`), letterPaths[], hindranceIds[] |
| `hindrance_register/{id}` | type (`site_not_handed`\|`drawings_delayed`\|`rain`\|`payment_delay`\|`scope_change`\|`other`), fromDate, toDate, notes |

---

## 5. Labour

### Labour additions (M1.3: D-45, D-46)
- `workers/{id}/private/pay` also holds `otMultiplierBp` (overtime as a multiple of the hourly rate) and `monthlySalaryPaise` (pay type monthly: salary ÷ 26 per day present, C8).
- `workers/{id}/project_terms/{projectId}`: payType, ratePaise, otRatePaise, otMultiplierBp, monthlySalaryPaise, effectiveFrom. Finance only.
- `workers.crewSiteIds` (thekedars): the sites where the crew is on the roster; function-maintained (QA N10).
- `thekedar_contracts/{id}`: thekedarId, projectId, scope, basis (`lumpsum` | `per_unit`), unit, ratePaise, qtyMilli, valuePaise, milestones [{name, amountPaise}], status. Finance only.
- `contract_measurements/{id}`: contractId, projectId, thekedarId, date, qtyMilli (per unit) or pctBp (lump sum), valuePaise, note. Finance only.
- `contract_scopes/{contractId}`: the contract without money (scope, unit, quantity, measured quantity or share, milestone names) for the project's PM; written by functions.
- `worker_payments` adds contractId, needsOwnerApproval and ownerApprovalReason (a bill above the contract value, §8A.6), and rejectReason.
- `attendance_unlocks/{projectId}_{date}`: until (ISO) and untilTs (timestamp, Firebase), reason, by. Written by the owner's unlock callable.
- `attendance_checkins/{projectId}_{date}_{uid}`: selfie (Storage path in Firebase mode; a small data URL in the demo), lat, lng, accuracyM, at.
- `audit_log`: one entry for every attendance change (before, after, who, when, and `overwrote` when it replaced someone else's later change), unlock, payment approval and rejection.

### `attendance/{projectId}_{workerId}_{YYYY-MM-DD}` — deterministic ID (D-13)
| Field | Type | Writer |
|---|---|---|
| projectId, projectName (snap) | | C→S |
| workerId, workerName (snap), workerRole (snap), thekedarId | | C→S |
| date, monthKey, fy | | C→S |
| status | `present`\|`half_day`\|`absent`\|`overtime`\|`leave` | C |
| otHoursMilli | int | C |
| payType (snap), rateSnapshotPaise, otRateSnapshotPaise | | S (trigger copies from `project_terms` or the worker default on first write; a client can't set its own rate) |
| earnedPaise | int | S (computed by trigger) |
| location {lat, lng, accuracyM}, selfiePath | | C |
| markedBy, markedAt (client time), syncedAt (server) | | C / S |

One write per worker per day; offline marking writes the same ID, so a re-sync overwrites instead of duplicating ("last write wins with audit trail", §6.3). Lock: rules reject writes when `date` is older than `settings/operations.attendanceLockDays` unless owner, and always when `period_locks/{monthKey}` exists. Trigger posts `earnedPaise` delta to `worker_balances` and to the project-month rollup `attendance` counters.

### `worker_payments/{id}`
workerId, workerName (snap), projectId, projectName (snap), thekedarId (if paid through one), thekedarContractId, date, monthKey, fy, type (`wage`|`advance`|`bonus`|`advance_writeoff`|`thekedar_bill`), grossPaise (wage earned or thekedar work value being settled, D-16), advanceRecoveredPaise, tdsPaise, tdsSection (`194C` for thekedar payments; null for direct wages), netPaidPaise (= gross − advance recovered − TDS), mode, accountId (paid-from), reference, remarks, payoutBatchId, approvalStatus (client creates `pending`; D-30). Server: `voucherNo`, `expenseId` (the generated Labour expense).

### `worker_balances/{workerId}_{projectId}` — server only
earnedPaise, paidPaise (gross settled), advanceGivenPaise, advanceRecoveredPaise, balanceDuePaise, advanceOutstandingPaise, lastAttendanceDate. Feeds worker ledger, payout sheet and §6.5 site workforce view.

### `thekedar_contracts/{id}` (spec §12 `contracts`, renamed — D-19)
thekedarId (a `workers` doc, D-29), thekedarName (snap), projectId, projectName (snap), scope, unit, ratePaise (per unit), qtyMilli, valuePaise, milestones [{name, amountPaise, status}], agreementId (optional link to a signed agreement). Server: measuredValuePaise, paidPaise, balancePaise.

---

## 6. Expenses, procurement, stock, machinery

### `expenses/{id}`
| Field | Type | Writer | Notes |
|---|---|---|---|
| projectId, projectName (snap) | | C | null project allowed only for company overheads (owner/accountant) |
| date, monthKey, fy | | C | |
| categoryId | string | C | category chosen at entry (a leaf at that time) |
| categoryPath | string[] IDs | S | root→posted node, e.g. `["cat_materials","cat_materials_aggregate","cat_materials_aggregate_gitti"]`; maintained by function, rewritten on re-parent (D-10) |
| description, qtyMilli, unit, ratePaise | | C | optional |
| amountPaise | int | C | total incl. GST |
| taxablePaise, gstRateBp, cgstPaise, sgstPaise, igstPaise | int | C | §12 v1.1 |
| tdsPaise | int | C | |
| payeeType (`worker`\|`vendor`\|`other`), payeeId, payeeName (snap), partyGstin | | C | |
| mode | paymentMode | C | `credit` ⇒ unpaid, posts to vendor payable |
| paidStatus | `paid`\|`unpaid`\|`part` | S | derived: `paid` unless mode is `credit`; credit purchases then follow vendor payments |
| accountId | string\|null | C | paid-from account; required when paid (§11A.4) |
| billNo, billDate, billPaths[] | | C | |
| noBillReason | string\|null | C | required when no bill ("voucher without bill") |
| approvalStatus | approvalStatus | C→S | client always creates `pending`; only the `approveRecords` / `rejectRecords` callables change it, or the auto-approve trigger for owner/accountant entries under threshold (D-30) |
| approvedBy, approvedAt, rejectReason | | S | |
| postingError | string\|null | S | set when posting is refused (locked month, negative stock) |
| source | `manual`\|`wage`\|`purchase`\|`machinery_rent`\|`stock_transfer`\|`bank_charge` | C→S | non-manual created by functions only |
| sourceRef { entity, id } | | S | for generated expenses |
| voucherNo | string | S | allocated at posting |
| recurringTemplateId | | C | |
| enteredBy, enteredByName (snap) | | C→S | |
| searchKeywords | | S | |

Posting (D-07, D-08): only `approved`, non-deleted expenses count. Function writes rollup increments (`rollups` for cost, `finance_rollups` for GST input and account flows), `account_transactions/expenses_{id}` (only for `source == manual` and paid; generated expenses never move money themselves — D-16), vendor payable delta (credit), and `postings/expenses_{id}` in **one transaction**.

### `expense_templates/{id}` — recurring
name, projectId, categoryId, amountPaise, payee*, mode, accountId, frequency (`monthly`|`weekly`), dayOfMonth, active, nextRunDate. Scheduled function creates **pending** expenses from due templates.

### `material_requests/{id}`
projectId, projectName (snap), requestedBy, date, items [{materialId, materialName (snap), qtyMilli, unit, neededBy}], status (`pending`|`approved`|`rejected`|`ordered`), approvedBy, poId.

### `purchase_orders/{id}` (items as array, §3.1 rule 7)
poNo, vendorId, vendorName (snap), projectId, projectName (snap), date, items [{materialId, materialName (snap), qtyMilli, unit, ratePaise, gstRateBp}], totals {taxablePaise, gstPaise, totalPaise}, status (`draft`|`issued`|`part_received`|`received`|`closed`|`cancelled`), materialRequestId.

### `goods_receipts/{id}`
poId, vendorId, vendorName (snap), projectId, date, challanNo, vehicleNo, challanPaths[], items [{materialId, qtyOrderedMilli, qtyReceivedMilli, ratePaise}]. Trigger writes `stock_ledger` in-rows.

### `vendor_bills/{id}` (purchase bills; source of material expenses)
vendorId, vendorName (snap), partyGstin, projectId, billNo, billDate, monthKey, fy, poId, grnIds[], items [{materialId, categoryId, qtyMilli, ratePaise, taxablePaise, gstRateBp}], taxablePaise, cgst/sgst/igstPaise, totalPaise, billPaths[], approvalStatus (client creates `pending`, D-30). Server: paidPaise, paidStatus, expenseIds[] (one generated expense per category on the bill, ID `vb_{billId}_{categoryId}`), matchStatus (PO vs GRN vs bill, §9.2).

### `vendor_payments/{id}`
vendorId, vendorName (snap), projectId (optional), date, monthKey, fy, amountPaise, tdsPaise, mode, accountId, reference, allocations [{vendorBillId, amountPaise}], isAdvance (bool). Server: voucherNo. Moves money: `account_transactions/vendor_payments_{id}`; reduces vendor payable; no expense (the bill already booked it).

### `stock_ledger/{id}`
projectId, materialId, materialName (snap), date, monthKey, qtyInMilli, qtyOutMilli, ratePaise (weighted average at time of movement), valuePaise, kind (`grn`|`consumption`|`transfer_in`|`transfer_out`|`return`|`damage`|`theft`|`count_adjust`|`opening`), ref {entity, id}, workItem (boqItemId, optional), reason, approvalStatus (damage/theft need owner approval), enteredBy. Consumption entries are created offline-capable by supervisors (C); all others S or owner.

### `stock_balances/{projectId}_{materialId}` — server only
qtyMilli, valuePaise, avgRatePaise, last7DayUseMilli, lastConsumptionDate, belowReorder (bool). Negative balance blocked by the posting function unless the ledger row carries `overrideReason` set by owner (§9.3).

### `stock_transfers/{id}`
fromProjectId, toProjectId (+ names snap), materialId, materialName (snap), qtySentMilli, qtyReceivedMilli, date, vehicleNo, sentBy, receivedBy, status (`sent`|`received`), shortageMilli (S), transportExpenseId (S link). Transport cost is **not** a field here: it is recorded as an ordinary pending expense (Transport and Loading) on either site with `sourceRef: {entity: "stock_transfers", id}`, so it goes through approval like any other spend (D-30).

### `stock_counts/{id}`
projectId, date, lines [{materialId, systemQtyMilli, countedQtyMilli}], status (`draft`|`approved`), approvedBy. Approval creates `count_adjust` ledger rows.

### `machinery_logs/{id}`
machineryId, machineryName (snap), projectId, projectName (snap), date, monthKey, meterStartMilli, meterEndMilli (or startTime/endTime), hoursMilli (S computed), trips, operatorId, operatorName (snap), isBreakdown, remarks, meterPhotoPath. Offline-capable.

### `machinery_fuel_logs/{id}`
machineryId, projectId, date, monthKey, fy, litresMilli, ratePaise, amountPaise, source (`own_stock`|`pump`|`vendor`), accountId, approvalStatus (created `pending`, D-30). Fuel bought by Ambika posts a Machinery > Fuel expense (`fuel_{id}`) only once the log is approved.

### `machinery_maintenance/{id}`
machineryId, projectId, date, monthKey, fy, issue, costPaise, accountId or vendorId (credit), downtimeDays, nextServiceDate, nextServiceHoursMilli, approvalStatus (created `pending`, D-30). Cost posts a Machinery > Repair expense (`maint_{id}`) only once approved.

### `machinery_rent_statements/{machineryId}_{YYYY-MM}` — deterministic
vendorId, projectAllocations [{projectId, hoursMilli, daysMilli, trips, amountPaise}], minHoursAdjustmentPaise, breakdownDaysExcluded, fuelDeductionPaise, totalPaise, status (`draft`|`approved`). Approval posts Machinery > Hire expenses (ID `mrs_{statementId}_{projectId}`) and vendor payable.

---

## 7. Billing, agreements, tenders, sales, accounting

### `quotations/{id}`
number (S, `AG/Q/2026-27/0001`; null while draft), version (int), rootQuotationId (first version's ID), projectId?, leadId?, clientId?, partyName (snap), date, validUntil, sections [{title, items [{itemLibraryId, description, unit, qtyMilli, ratePaise, discountBp, gstRateBp, hsnSac, taxablePaise}]}], totals {taxablePaise, gstByRate [{rateBp, taxablePaise, cgstPaise, sgstPaise, igstPaise}], roundOffPaise, totalPaise}, terms, paymentTerms, inclusions, exclusions, status (`draft`|`sent`|`viewed`|`accepted`|`rejected`|`expired`), pdfPath, shareLinkId, convertedTo {projectId, agreementId, invoiceId}. Revisions create a new doc with version+1 and the same number (D-17).

### `invoices/{id}`
| Field | Notes |
|---|---|
| number | S. `AG/2026-27/0001`; allocated by `issueInvoice` callable (online only, D-12). Drafts have `number: null`. Credit/debit notes use their own sequences (`credit_note_{fy}`) — see D-12 |
| type | `proforma`\|`tax`\|`ra`\|`milestone`\|`credit_note`\|`debit_note` |
| projectId, projectName (snap), clientId, clientName, clientGstin, clientStateCode (snap) | |
| raBillId, milestoneId, quotationId, againstInvoiceId (notes) | |
| date, dueDate, monthKey, fy, placeOfSupply (state code) | |
| items | [{description, hsnSac, unit, qtyMilli, ratePaise, discountBp, gstRateBp, taxablePaise}] (invoice_items as array) |
| totals | {taxablePaise, gstByRate [...], cgstPaise, sgstPaise, igstPaise, roundOffPaise, totalPaise} — computed by function, D-15 |
| deductions | [{head, basisPaise, rateBp, amountPaise}] (TDS, GST-TDS, retention, labour cess, advance adjustment) |
| netReceivablePaise | total − deductions |
| amountInWords | S |
| status | `draft`\|`sent`\|`partially_paid`\|`paid`\|`overdue`\|`cancelled` |
| lockedAt | S, set on first send/issue; after it, only status/payment fields change (§8.3) |
| templateKey, pdfPath, shareLinkId | |
| paidPaise, tdsReceivedPaise, retentionHeldPaise | S |

Proforma invoices don't count in `billedPaise` and use the sequence `proforma_{fy}`.

### `ra_bills/{id}` (top-level for cross-project register)
projectId, projectName (snap), raNo (int per project), periodFrom, periodTo, mbEntryIds[], grossPaise, deductions [{head, rateBp, amountPaise}], netPaise, submittedDate, passedDate, passedAmountPaise, paidDate, status (`draft`|`submitted`|`passed`|`paid`), invoiceId, isFinal.

### `payments_received/{id}`
invoiceId?, raBillId?, milestoneId?, projectId, projectName (snap), clientId, clientName (snap), date, monthKey, fy, amountPaise (money actually received), tdsPaise, retentionPaise, otherDeductionsPaise, mode, accountId, reference, covers, receivedBy, proofPaths[], isAdvance (client advance, D-16b), advanceGst {taxablePaise, gstRateBp, cgstPaise, sgstPaise, igstPaise} (advance only, if GST is payable on receipt — question D16). Server: receiptNo (`receipt_{fy}`, `AG/R/…`), advanceReceiptVoucherNo (`advance_receipt_{fy}`, `RV/2026-27/0001`, GST receipt voucher under CGST Rule 50, advances only), receiptPdfPath, adjustedAgainst [{invoiceId, amountPaise}] (advances). Posts `account_transactions/payments_received_{id}` and, in `finance_rollups`, `receivedPaise` (receipts against invoices) or `clientAdvanceReceivedPaise` (advances), invoice `paidPaise`/status, client outstanding.

### `share_links/{token}` — doc ID = unguessable token (≥128-bit, base62)
documentType, documentId, storagePath, expiresAt (nullable), revoked, createdBy, viewCount (S). Served by an HTTPS function that streams the PDF; public read is never granted on the collection or the bucket (§3.1 rule 14).

### `share_logs/{id}`
documentType, documentId, channel (`whatsapp`|`web_share`|`email`|`download`|`print`), phone, sentBy, sentAt. Append-only.

### `agreements/{id}` (§8A; client and contractor agreements)
number (S, `AG/C/2026-27/0001`), side, type, templateId, templateVersion, projectId, projectName (snap), party {kind (`client`|`vendor`|`worker`), id, name, address, pan, gstin, phone} (snap), contractDate, effectiveDate, scopeText, scopeItems [], valuePaise, gstPaise, paymentSchedule [{milestoneId, name, amountPaise}], advancePaise, retentionBp, securityDepositPaise, startDate, completionDate, penalty {ratePaise, per (`day`|`week`), capBp}, defectLiabilityMonths, supplies {materials, labour, equipment: `ambika`|`party`}, variationRateText, terminationText, jurisdictionCity, specialConditions, clauses [{clauseKey, version, textOverride?}], attachmentPaths[], status (`draft`|`under_review`|`approved`|`sent`|`signed_by_party`|`signed_by_ambika`|`active`|`completed`|`terminated`|`expired`), approvedBy, pdfPath, shareLinkId, lockedAt (S on fully signed).
Subcollections: `agreement_signatures/{id}` (signer, signedDate, witnessNames[], stampType, stampNumber, stampValuePaise, stampCertPath, scanPath), `agreement_amendments/{id}` (amendmentNo, date, summary, changes, pdfPath, status). Signed records cannot be deleted (§8A.7).

### `tenders/{id}` — single register (D-18)
tenderNo, nitRef, department, workName, estimatedCostPaise, publishDate, docPurchaseLastDate, preBidDate, submissionDeadline (Timestamp, has a time), openingDate, tenderFeePaise, emdAmountPaise, emdMode, quotedRateBp (signed: + above / − below), l1RateBp, link, status (`spotted`|`preparing`|`submitted`|`technically_qualified`|`financially_opened`|`won`|`lost`|`cancelled`), resultDate, projectId (after conversion), searchKeywords.
Subcollection `tender_documents/{id}`: docType (`registration`|`gst`|`pan`|`solvency`|`experience`|`affidavit`|other), documentId, expiryDate, ready (bool). Company-level standing documents live in `documents` and are linked, so one expiry date drives every tender's checklist.

### `emd_records/{id}`
tenderId, tenderNo (snap), projectId?, amountPaise, mode (`dd`|`bg`|`fdr`|`online`), instrumentNo, bank, datePaid, validUntil, status (`held`|`refunded`|`converted_to_sd`|`forfeited`), expectedRefundDate, actualRefundDate, paymentAccountTxnId, refundAccountTxnId.

### `guarantees/{id}`
kind (`performance_guarantee`|`security_deposit`), instrumentType (`bg`|`fdr`|`dd`|`cash`), instrumentNo, bank, amountPaise, issueDate, expiryDate, claimPeriodEnd, projectId, projectName (snap), status (`active`|`released`|`invoked`), releaseDate, bankChargesExpenseId, renewalTaskId.

### `leads/{id}`
name, phone (`+91XXXXXXXXXX`), whatsapp, email, source (`website`|`referral`|`tender_portal`|`walk_in`|`whatsapp`|`other`), workType (`house`|`apartment`|`road`|`interlocking`|`other` — contract keys), location, sizeOrBudget, estimatedValuePaise, stage (`new`|`contacted`|`site_visit`|`quotation_sent`|`negotiation`|`won`|`lost`), assignedTo, assignedToName (snap), nextFollowUpAt (Timestamp), lostReason, lang (`en`|`hi`), web {formId, sourceUrl, utm {source, medium, campaign, term, content}} (website leads only), convertedTo {clientId, projectId}, searchKeywords.
Subcollection `lead_activities/{id}`: type (`call`|`visit`|`message`|`note`|`web_enquiry`|`stage_change`), notes, date, by.

### `lead_phones/{+91XXXXXXXXXX}` — server only, deterministic
`{ leadId }`. Created in the same transaction as the lead, so two concurrent enquiries from one phone can't create two leads (§13.1 de-dup). Manual lead creation also goes through a callable that checks this doc.

### `lead_webhook_logs/{submissionHash}` — server only, deterministic (D-31, enquiry contract v2.1)
Log of website enquiries received by the public function `submitEnquiry` (Phase 3). The collection name is kept from the contract, although there is no longer a webhook: the website posts straight to the function. Owner-read only (rules); every write is by functions.

| Field | Notes |
|---|---|
| result | `created` \| `noted` \| `rejected` |
| reason | why it was rejected (e.g. `location missing`, `message over 2,000 characters`) |
| rawPayload | the submitted JSON, capped at 10 KB (the body limit); **set to null** when a `rejected` entry is dismissed or expires |
| receivedAt, lastAttemptAt, retryCount | retryCount counts identical resubmissions |
| formId, lang | copied for reporting |
| leadId | the lead created or noted (for `rejected`, set on conversion) |
| reviewStatus | `rejected` only: `open` \| `converted` \| `dismissed` |
| reviewedBy, reviewedAt | set by the `createLead` / `dismissEnquiry` callables |

- **ID:** sha256 of the **canonical contract fields** (`name`, `phone`, `email`, `work_type`, `location`, `size_or_budget`, `message`, `consent`, `source_url`, `utm_*`, `form_id`, `lang`), trimmed, keys sorted, joined as JSON. An identical resubmission hashes the same and is a no-op.
- **What is stored (contract v2.1):**
  - accepted enquiries (`created`, `noted`);
  - validation failures **only when the visitor can be contacted** (`consent == "yes"` and the phone passes the phone rule), as `rejected` with `reviewStatus: "open"`.
- **Never stored in Firestore:** wrong origin, body over 10 KB, rate-limited, honeypot (Cloud Logging: reason and a hash only, no form contents), and validation failures without consent or without a usable phone (Cloud Logging: reason only, no personal data).
- **"Needs checking"** in the leads list is a query over this collection: `result == "rejected" && reviewStatus == "open"`, newest first (index in `firestore.indexes.json`). Converting creates a normal lead through `createLead`; dismissing clears `rawPayload`. Open entries older than 90 days are cleared by the dispatcher.

### `events/{id}`, `tasks/{id}`
Events: title, type (`meeting`|`site_visit`|`deadline`|`other`), start, end (Timestamp), allDay, location, attendees [uid], projectId?, leadId?, reminderMinutes, source {entity, id} (S for system deadlines), colorKey.
Tasks: title, projectId?, leadId?, assignedTo, assignedToName (snap), dueAt, priority (`low`|`normal`|`high`), status (`open`|`in_progress`|`done`|`cancelled`), source (`manual`|`web_lead`|`guarantee_renewal`|…); subcollection `comments/{id}`.
System deadlines (project end, tender submission, EMD/guarantee/document expiry, payment due, machinery service) are **computed into `events`** by triggers with deterministic IDs `{entity}_{id}_{kind}` so the calendar reads one collection.

### `documents/{id}`
projectId?, ownerEntity {entity, id} (tender, worker, machinery, company), type, title, filePath, expiryDate, restricted (bool: ID proofs), uploadedBy.

### `account_transactions/{entity}_{docId}` — server only, deterministic (D-08)
accountId, accountName (snap), date, monthKey, fy, type (`receipt`|`payment`|`transfer`|`drawing`|`capital`|`loan_in`|`loan_out`|`adjustment`), directionSign (+1 in / −1 out), amountPaise (positive), linkedEntity, linkedId, projectId, partyName (snap), narration, voucherNo, isDeleted. One row per money movement (§12 v1.1). A transfer between own accounts writes two rows: `transfers_{id}_out` and `transfers_{id}_in`.

### `account_transfers/{id}`
Client-entered movements that aren't expenses or receipts: kind (`transfer`|`drawing`|`capital`|`loan_in`|`loan_repay`), fromAccountId, toAccountId, amountPaise, date, narration. Owner/accountant only. Posts to `account_transactions`.

### `period_locks/{YYYY-MM}` — deterministic (D-13)
lockedBy, lockedAt, note. Existence = locked. Rules `exists()` this doc for every dated financial write; posting functions re-check inside their transaction (§3.1 rule 13).

### `adjustments/{id}`
date (in an open month), lockedMonthKey (the month being corrected), entity, entityId, amountPaise (signed), categoryId?, accountId?, reason, approvedBy. Posted like an expense/receipt delta into the open month.

### `export_logs/{id}`
userId, userName (snap), filters {from, to, projectIds, output}, filePath, controlTotals {expensePaise, receivedPaise, billedPaise, rowCount…}, warningsAtExport {byType: count}, status (`running`|`done`|`failed`), createdAt.

---

## 8. Deterministic document IDs (summary)

| Collection | ID | Purpose |
|---|---|---|
| users | Auth uid | rules lookup |
| attendance | `{projectId}_{workerId}_{YYYY-MM-DD}` | one per worker/project/day; offline re-sync overwrites |
| period_locks | `YYYY-MM` | rules `exists()` |
| counters | `{docType}_{fy}` / `{docType}` | gapless numbering |
| rollups, finance_rollups | `co_{YYYY-MM}`, `p_{projectId}_{YYYY-MM}`, `p_{projectId}_all` | few-doc dashboard reads, split by audience |
| projects (sub) private | `budget`, `commercial` | restricted money fields |
| workers (sub) private | `kyc` | restricted personal data |
| boq_rates (sub) | same ID as its `boq_items` doc | restricted rates |
| postings | `{entity}_{docId}` | delta posting, idempotency |
| account_transactions | `{entity}_{docId}` (+ `_in`/`_out` for transfers) | retry overwrites, never duplicates |
| worker_balances | `{workerId}_{projectId}` | ledger |
| vendor_balances | `{vendorId}` | payable, advance, TDS (finance only) |
| stock_balances | `{projectId}_{materialId}` | stock on hand |
| expenses (generated) | `wage_{paymentId}`, `vb_{billId}_{categoryId}`, `mrs_{statementId}_{projectId}`, `fuel_{fuelLogId}`, `maint_{id}`, `gchg_{guaranteeId}` | one generated expense per source |
| machinery_rent_statements | `{machineryId}_{YYYY-MM}` | one statement per machine-month |
| dpr (sub) | `YYYY-MM-DD` | one per project-day |
| roster (sub) | `{workerId}` | one membership per worker per site; rules `exists()` it for attendance |
| lead_phones | `+91XXXXXXXXXX` | de-dup |
| lead_webhook_logs | sha256 of canonical form fields | idempotent webhook |
| share_links | random token | tokenised PDF links |
| events (system) | `{entity}_{id}_{kind}` | calendar deadlines without duplicates |
| settings | fixed names | |

---

## 9. Composite indexes

Committed in `firestore.indexes.json` (Milestone 2). Minimum set (spec §3.1 rule 8 in **bold**), all with `isDeleted ==` as the leading equality where lists exclude deleted rows:

| Collection | Fields |
|---|---|
| **expenses** | **projectId ASC, date DESC** |
| **expenses** | **projectId ASC, categoryPath ARRAY_CONTAINS, date DESC** |
| expenses | categoryPath ARRAY_CONTAINS, date DESC (company-wide drill-down) |
| expenses | approvalStatus ASC, date DESC; projectId ASC, approvalStatus ASC, date DESC (pending approvals) |
| expenses | projectId ASC, mode ASC, date DESC; enteredBy ASC, date DESC (Total Spendings filters) |
| expenses | searchKeywords ARRAY_CONTAINS, date DESC |
| **attendance** | **projectId ASC, date ASC** |
| **attendance** | **workerId ASC, date ASC** |
| attendance | projectId ASC, monthKey ASC, workerId ASC (monthly sheet) |
| **invoices** | **clientId ASC, status ASC, date DESC** |
| invoices | projectId ASC, date DESC; status ASC, dueDate ASC (overdue job) |
| **payments_received** | **projectId ASC, date DESC** |
| payments_received | clientId ASC, date DESC; invoiceId ASC, date ASC |
| worker_payments | projectId ASC, date DESC; workerId ASC, date DESC |
| account_transactions | accountId ASC, date ASC (cash/bank book); monthKey ASC, date ASC (export paging) |
| vendor_bills | vendorId ASC, billDate DESC; vendorId ASC, billNo ASC (duplicate-bill check) |
| vendor_payments | vendorId ASC, date DESC |
| stock_ledger | projectId ASC, materialId ASC, date ASC |
| machinery_logs | machineryId ASC, date DESC; projectId ASC, date DESC |
| leads | stage ASC, nextFollowUpAt ASC; assignedTo ASC, nextFollowUpAt ASC; source ASC, createdAt DESC |
| tasks | assignedTo ASC, status ASC, dueAt ASC; projectId ASC, status ASC, dueAt ASC |
| events | start ASC (range) + projectId ASC, start ASC |
| tenders | status ASC, submissionDeadline ASC |
| emd_records / guarantees | status ASC, expiryDate/validUntil ASC |
| audit_log | entity ASC, entityId ASC, timestamp DESC; projectId ASC, timestamp DESC |
| projects | assignedUsers ARRAY_CONTAINS, status ASC, name ASC |

Single-field `searchKeywords` (array-contains) is automatic. Large text/map fields (`rawPayload`, `oldValue`, `newValue`, rollup `expense.*` maps, `items`, `sections`) get **single-field index exemptions** to cut index write cost.

---

## 10. Offline and online-only writes

| Offline-capable (Firestore persistence, queued writes) | Online-only (callable function, needs a connection) |
|---|---|
| attendance, expenses, worker payments, vendor bills (all created `pending`), dpr, stock_ledger consumption, machinery_logs, machinery_fuel_logs, lead activities | **approve / reject** (`approveRecords`, `rejectRecords`), issuing invoice / note / receipt / quotation / agreement numbers, project creation (code), period lock/unlock, attendance unlock, role and assignment changes, category moves, exports, PDF generation, share links |

**Approvals are callables only** (D-30). Clients always create approvable records with `approvalStatus: "pending"`, and rules forbid any client change to `approvalStatus`, `approvedBy` or `approvedAt`. Entries by an owner or accountant are auto-approved by a server trigger after sync when they are under that user's threshold, so the owner's own offline entries still need no second step. Posting to `account_transactions`, rollups and balances is always done by functions, after sync (D-07).

---

## 11. Storage paths (for storage.rules, Milestone 2)

`projects/{projectId}/expenses/{expenseId}/{file}`, `projects/{projectId}/attendance/{date}/{workerId}.jpg`, `projects/{projectId}/dpr/{date}/{file}`, `projects/{projectId}/site/{kind}/{file}` (challans, meter photos), `projects/{projectId}/documents/{docId}/{file}` (site-visible), `projects/{projectId}/finance/{docId}/{file}` (finance only), `workers/{workerId}/photo.jpg`, `workers/{workerId}/kyc/{file}` (owner/accountant only), `vendors/{vendorId}/bills/{file}`, `clients/{clientId}/{file}`, `finance/{kind}/{docId}/{file}` (payment proofs, signed agreements, stamp certificates, tender documents), `generated/{docType}/{docId}/{file}.pdf` (server write only), `exports/{exportId}/{file}` (server write only), `company/{file}` (logo, signature, stamp). All private; public access only through `share_links` function. Max 10 MB, images and PDF only (§4).

---

## 12. Read-access matrix (D-28)

Rules work per document, so every document is either fully visible to a role or not at all. The principle: **site roles (`pm`, `supervisor`) see the cost side of their own projects** (expenses, wages, attendance, materials, stock, machinery use, budget for `pm`). They never see the **revenue side** (contract and agreement values, BOQ rates, unit prices and customers, payment schedules, quotations, invoices, RA bills, receipts), **company money** (accounts, balances, cash and bank books, account transactions, finance rollups), **payables ledgers** (vendor bills, vendor payments, vendor balances, rent statements), or **personal and bank data** (KYC, vendor bank).

Legend: **R** read, **W** create/update through rules, **A** assigned projects only, **own** records the user created or is assigned to, **—** no access, **fn** server only.

**M1.2:** the viewer and CA columns follow D-42 and D-43. The viewer reads project documents, the budget and totals only. The CA reads accounting records and totals, plus project names. `firestore.rules` draft 3 and `core/roles.canRead` are the authority, tested by RL-01…RL-06 and rules cases T-350…T-367.

| Collection | owner | accountant | pm | supervisor | viewer | ca |
|---|---|---|---|---|---|---|
| users | RW | R | own | own | own | own |
| settings/company, operations | RW | R | R | R | R | R |
| settings/bank, templates, numbering, deductionHeads | RW | RW (bank, templates) | — | — | — | R |
| projects | RW | RW | R A | R A | R | R |
| projects/private/budget | RW | RW | R A | — | R | R |
| projects/private/commercial | RW | RW | — | — | — | — |
| project_units, project_milestones, boq_rates | RW | RW | — | — | — | — |
| boq_items, measurement_book, project_approvals, eot_requests, hindrance_register | RW | R | RW A | R A | — | — |
| dpr | RW | R | RW A | RW A | — | — |
| clients | RW | RW | — | — | — | — |
| workers | RW | RW | RW on their sites (no pay fields)¹ | — | — | — |
| workers/private/pay | RW | RW | — | — | — | — |
| workers/project_terms | RW | RW | — | — | — | — |
| rate_change_requests | RW (fn approves) | RW (fn approves) | own (create pending) | — | — | — |
| projects/roster | RW | RW | RW A (membership only) | R A | — | — |
| workers/private/kyc | RW | RW | — | — | — | — |
| attendance | RW | RW | RW A | RW A | — | — |
| worker_payments | RW | RW | — (D-45) | — | — | R |
| worker_balances | R fn | R fn | — (D-45) | — | — | R |
| thekedar_contracts | RW | RW | — (D-45) | — | — | R |
| contract_measurements | RW | RW | — | — | — | — |
| contract_scopes (no money) | R fn | R fn | R A (QA N10) | — | — | — |
| attendance_unlocks | R (owner writes via fn) | R | R A | R A | — | — |
| attendance_checkins | R | R | own | own | — | — |
| expense_categories, materials | RW | R | R | R | R | R |
| expenses | RW | RW | RW A | RW A own² | —⁷ | R |
| expense_templates | RW | RW | — | — | — | — |
| material_requests | RW | RW | RW A | RW A | — | — |
| vendors | RW | RW | R | — | — | R |
| vendors/private/bank, vendor_balances, vendor_bills, vendor_payments, machinery_rent_statements | RW | RW | — | — | R (balances) | R |
| purchase_orders | RW | RW | RW A | — | — | R |
| goods_receipts | RW | RW | RW A | RW A | — | R |
| stock_ledger, stock_transfers, stock_counts | RW | RW | RW A | RW A³ | R | R |
| stock_balances | R fn | R fn | R A | R A | R | R |
| machinery | RW | RW | R | R | R | — |
| machinery_logs, machinery_fuel_logs (fuel: created pending⁸) | RW | RW | RW A | RW A | R | — |
| machinery_maintenance (created pending⁸) | RW | RW | RW | — | R | R |
| item_library | RW | RW | — | — | — | — |
| quotations, invoices, ra_bills, payments_received | RW | RW | — | — | R | R |
| share_logs | R | R | — | — | — | — |
| agreements (+ signatures, amendments) | RW | RW | — | — | — | R |
| agreement_templates, agreement_clauses | RW | R | — | — | — | — |
| tenders (+ tender_documents) | RW | RW | — | — | R | — |
| emd_records, guarantees | RW | RW | — | — | R | R |
| leads (+ lead_activities) | RW | — | own⁴ | — | — | — |
| events | RW | RW own | RW own/A | R own/A | R | — |
| tasks | RW | RW own | RW own | RW own | — | — |
| documents | RW | RW | RW A⁵ | R A⁵ | — | R⁵ |
| accounts, account_transactions, account_transfers, adjustments | RW (fn for transactions) | RW (fn for transactions) | — | — | R (accounts) | R |
| period_locks | R (W via callable) | R | R | R | R | R |
| export_logs | R | R | — | — | — | R |
| rollups | R | R | R A (project docs only) | — | R | R |
| finance_rollups | R | R | — | — | R | R |
| audit_log | R | R | — | — | — | R |
| users/notifications, users/devices | own | own | own | own | own | own |
| counters, postings, processed_events, lead_phones, lead_webhook_logs, category_moves, share_links | fn (owner may read category_moves, lead_webhook_logs) | — | — | — | — | — |

Notes:
1. `pm` may add and edit workers but not their rate fields, and proposes rates through `rate_change_requests` (D-32). `supervisor` doesn't read the worker master at all: the site roster gives names, roles, photos and pay type, with no rates (D-33). Neither sees KYC.
2. A supervisor reads expenses on assigned projects that they entered (`enteredBy == uid`), and may edit them only while `pending`.
3. Supervisors create consumption, transfer-receipt and damage entries; damage/theft and count adjustments then need owner approval (callable).
4. Leads: the owner sees all; other users see leads assigned to them. Only users the owner marks as sales (`users.defaultSalesUser` or assigned) get leads. `ca` and `viewer` never see leads (§11A.6).
5. Documents marked `restricted` (ID proofs) are owner and accountant only; `ca` reads only accounting document types.
6. System calendar events must never carry money amounts in their titles, so a project member can see "Guarantee expiry" without seeing the value.
7. Viewers see expense totals through rollups and reports, not individual expenses or bill photos (open question I3 default). If the user answers I3 differently, this row and the Storage rule for `projects/{pid}/expenses/` change together.
8. Machinery fuel logs and maintenance records, like every other source of a generated expense, are created `pending` (D-30).

`viewer` reads reports, rollups and lists, but no KYC, leads or document files. `ca` is read-only on accounting data and exports, with no leads and no worker ID documents (§11A.6).

## 19. Collections added in M1.6 (D-48, D-49)

| Collection | Holds | Read | Write |
|---|---|---|---|
| `integrations/{id}` (id: firebaseConfig, firestore, storage, signIn, functions, appCheck, push, email, websiteLink, maps, whatsapp) | `enabled`, public `values`, `masked` (last four of each secret), `enforce` (App Check), `test` {ok, message, hint, at}, `lastOkAt`, `updatedAt`, `updatedBy` | super user (owner with the `superUser` claim) | server only (the setup callables) |
| `private_config/{id}` | `secrets` {key: value} (the website key stores only `apiKeyHash`) | **no client** | **no client** (Admin SDK only) |
| `system_probe/{id}` | one throwaway document per Firestore Test, deleted at once | super user | super user |
| `command_requests/{requestId}` | `uid`, `name`, `at`, `result`, `expireAt` (plain timestamp, 7 days; no automatic TTL on the free plan, the nightly clean-up deletes expired ones, D-51): makes a retried command safe | no client | server only |
| `users/{id}` gains `superUser` (owners only) and `claimsAt` (set when claims change; open sessions refresh their token) | | | server only |

Storage: `system_probe/{file}` (the Storage Test, under 1 KB, super user only).

Sign-in claims: `role`, `projects` (assigned project IDs; Firebase allows about 1,000 bytes of claims, so about 40 projects per site person), and `superUser` (owners only).

## 20. Roles in the users document and the first-owner marker (D-52)

- `users/{uid}` carries `role`, `active`, `superUser` (owners only), `projectIds`, `name`, `email`, `phone`, `language`, `theme`. The rules and the app read the role from here (one read per request); sign-in claims are no longer used.
- `system/owner` {uid, email, at}: the one-time first-owner marker, created in the same batch as the owner's users document, readable by any signed-in account, never changed or deleted.
- Expense heads: the built-in tree lives in the code (`core/categories.ts`); stored `expense_categories` documents only add or override.
