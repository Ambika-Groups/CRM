# Ambika Group CRM: decisions log

Phase 0 and build decisions. Draft 12, 16 Nov 2026 (adds D-51 Spark-only and D-52 roles from the users document; draft 11 added D-48 super user, D-49 secrets and D-50 where the connection settings live for M1.6; draft 10 added D-47 role dashboards; brand.md v4.1 recorded in D-26; draft 9 added D-45 money on workers and D-46 attendance writes; draft 8 added D-42 viewer, D-43 CA, D-44 menu labels and the rule A change to D-32; draft 7 added D-41 App Check; draft 6 added D-37 to D-40 for the Phase 1 build; draft 5 added D-36).

Each entry names the spec conflict or gap it resolves, the rule we settled on, and the reason. "Supervisor" marks a ruling from the coordinating session. Anything marked **needs user** or **needs CA** is also in [open-questions.md](open-questions.md).

| ID | Topic | Status |
|---|---|---|
| D-01 | Money, rates and quantities as integers; BigInt helper | settled |
| D-02 | Naming: snake_case collections, camelCase fields | settled (supervisor) |
| D-03 | Display formats: dates and numbers | settled (supervisor) |
| D-04 | Business dates stored as IST strings | settled |
| D-05 | Roles, including the CA role | settled |
| D-06 | Project access: `assignedUsers`, not `user_projects` | settled (supervisor) |
| D-07 | Offline clients never move money | settled (supervisor) |
| D-08 | Delta posting with re-read and per-target deltas | settled (supervisor) |
| D-09 | Rollup layout | settled |
| D-10 | Category tree, re-parenting and `categoryPath` | settled (supervisor, with conditions) |
| D-11 | Dashboard KPI list | settled (supervisor) |
| D-12 | Gapless numbering, GST 16-character limit, voucher numbers | settled; formats **need user** |
| D-13 | Deterministic IDs for attendance and period locks | settled (supervisor) |
| D-14 | Residential / government data as maps on the project | settled |
| D-15 | GST calculation and rounding: per line | proposed, **needs CA** |
| D-16 | Wage, advance, thekedar and vendor money flows | proposed, **needs CA** |
| D-17 | Quotation numbering and versions | settled |
| D-18 | One tender register | settled (supervisor) |
| D-19 | "Thekedar contracts" vs "Agreements" | settled |
| D-20 | Definitions: total expense, income, billed, profit | settled; GST basis **needs CA** |
| D-21 | Site-role queries are single-project; claim fallback | settled, first emulator test |
| D-22 | Worker KYC: restricted subdocument; masked Aadhaar only | settled (user, via I10) |
| D-23 | Share links served by a function | settled |
| D-24 | Proforma invoices and credit/debit notes | settled |
| D-25 | Attendance lock measured on server time | settled |
| D-26 | Design direction: brand.md v4.1 (new palette, rounded shapes, sharp Inter Tight and Inter fonts, calm motion), replacing v2 | settled (user, via supervisor) |
| D-27 | PDF engine: Puppeteer | proposed |
| D-28 | Documents split by audience (rules can't hide fields) | settled (supervisor change A) |
| D-29 | Thekedars are worker records | settled (supervisor change F) |
| D-30 | Approvals only through callables | settled (supervisor change H) |
| D-31 | Enquiry endpoint `submitEnquiry` (contract v2): logging and idempotency | settled (contract v2) |
| D-32 | Wage rates are finance-controlled; PMs propose | settled (supervisor fix 6) |
| D-33 | Site roster | settled (supervisor item 9) |
| D-34 | Free tier first (₹0 running cost) | settled (user); I9 and I10 answered |
| D-35 | Sign-in: Google for site staff, email for office, SMS as fallback; Google sign-in through a Netlify proxy of `/__/auth/` | settled (user, I9); spec deviation |
| D-36 | Front end on Netlify (static export); emulator tests in GitHub Actions; nothing installed locally | settled (user); spec deviation |
| D-37 | Two data modes (Firebase / demo) behind one data-access layer | settled (user mandate) |
| D-38 | i18next for English/Hindi | settled |
| D-39 | Static export routing (query-string detail pages) | settled |
| D-40 | shadcn/ui pattern on the approved mockup styles | settled |
| P1-01 – P1-04 | Phase 1 implementation notes | see end of file |

---

### D-01 Money, rates and quantities as integers
**Spec:** §3.1 rule 4 (money in paise). Silent on rates and quantities.
**Rule:** money is integer paise in fields ending `Paise`. Percentages are integer basis points (`Bp`, 1800 = 18%). Quantities are integer thousandths (`Milli`), because brass, cubic metre and tonne need decimals. All arithmetic goes through one shared helper, `mulDivRound(a, b, c)`, which multiplies and divides in **BigInt**, rounds half-up (D-15), and converts back to a Number only after checking `Number.isSafeInteger`. Stored values stay Numbers.
**Why:** integers remove floating-point drift, so "matches to the paisa" (§7.4) is achievable. BigInt is needed for intermediates: 50,000 cum × ₹2,000 rate × a discount factor of 10,000 is about 1e17, past `Number.MAX_SAFE_INTEGER` (~9e15) (supervisor change D). Every stored amount is far below that limit.

### D-02 Naming
**Spec:** §12 lists snake_case tables and fields (`project_id`); §3.1 uses camelCase fields (`projectId`, `categoryPath`, `assignedUsers`).
**Rule:** collection names stay snake_case as in §12 (`account_transactions`, `period_locks`, `audit_log`). Field names are camelCase as in §3.1. §12's `project_id` becomes `projectId`, and so on.
**Why:** supervisor ruling. camelCase fields match TypeScript; snake_case collections match the spec's vocabulary.

### D-03 Display formats
**Spec:** §4 says dates DD/MM/YYYY; §4A.7 says DD MMM YYYY; §11A.2 says CSV YYYY-MM-DD.
**Rule:** on screen and in PDFs: `25 Oct 2026` (Hindi: `25 अक्टू 2026`). In input fields: DD/MM/YYYY. In CSV export: ISO `YYYY-MM-DD`, with the DD/MM/YYYY option §11A.2 allows. Currency on screen is `₹1,25,000`, showing paise only where an amount isn't whole rupees; invoices always show paise (`₹1,25,000.00`). CSV amounts have two decimals and no separators.
**Why:** supervisor ruling.

### D-04 Business dates as IST strings
**Rule:** the day a transaction belongs to is stored as `YYYY-MM-DD` in Asia/Kolkata, plus `monthKey` and `fy`. Timestamps are used only for system times.
**Why:** a phone offline at 11:50 pm with a wrong clock or timezone would otherwise post attendance to the wrong day. String dates also make the attendance ID and the period-lock check exact.

### D-05 Roles
**Spec:** §2 table lists Owner/Admin, Accountant, PM/Site Engineer, Supervisor, Viewer. §3.1 and §11A.6 add a CA role that §2 omits.
**Rule:** six roles in the custom claim `role`: `owner`, `accountant`, `pm`, `supervisor`, `viewer`, `ca`. `ca` is read-only on accounting data and exports, with no access to leads or worker ID documents. `viewer` is read-only on reports and rollups, with no KYC, leads or document files. Each user has exactly one role. Only an owner can change roles, through a callable function that sets the claim and the `users` mirror together. The full read matrix is data-model §12.
**Why:** fills the §2 gap. One role per user keeps rules readable.

### D-06 Project access
**Spec:** §3.1 rule 1 uses an `assignedUsers` array on the project; §12 lists a `user_projects` join table.
**Rule:** `projects.assignedUsers` (uids) is the single source of truth. `user_projects` is dropped. A function mirrors it into `users.projectIds` for "my projects" lists. `owner`, `accountant`, `viewer` and `ca` see all projects without assignment; `pm` and `supervisor` see only assigned projects.
**Why:** supervisor ruling. Rules can `get()` the project and test membership; a join table would need a second lookup.

### D-07 Offline clients never move money
**Spec:** §3.1 rule 5 (transaction, account row and rollup written together) conflicts with rule 11 (offline writes queue and sync later), because an offline client can't run a server transaction.
**Rule:** clients write only the source record (expense, attendance, payment, bill), always as `pending` where the record is approvable (D-30). Cloud Functions write `account_transactions`, rollup increments, balances and the `postings` record **in one Firestore transaction** once the record is approved. Clients can never write `account_transactions`, rollups, `postings`, balances or counters.
**Why:** supervisor ruling. Cash book, bank book, dashboard and CSV stay in agreement because only one code path writes them.

### D-08 Delta posting
**Spec:** gap. Firestore triggers are delivered at least once and in no guaranteed order.
**Rule (supervisor-approved, with correction):** the posting function runs one transaction per event:
1. **Re-read the source document inside the transaction** and compute its effect from that current state. The event's `after` snapshot is never treated as current, because a late, older event would otherwise revert a newer posting.
2. Express the effect as **per-target amounts**: each target is one counter (rollup doc + field path, account balance, vendor payable, worker balance). A change of date, project, category or account then *moves* the amount between targets instead of netting it out.
3. Read `postings/{entity}_{docId}`; for each target in the union of old and new, delta = new − old.
4. **If every delta is zero, write nothing**: no rollup, account or posting write. Replays, and changes to system-only fields (`categoryPath`, `searchKeywords`), end here.
5. Check `period_locks` only for months with a non-zero delta.
6. Apply the increments, upsert the `account_transactions/{entity}_{docId}` row, overwrite the posting doc.

Whatever order and however many times events arrive, every posting converges on the source's current state. Non-arithmetic side effects (notifications, follow-up tasks) record the CloudEvent ID in `processed_events` inside their transaction. The highest-risk path, wage payment → Labour expense, uses the deterministic expense ID `wage_{paymentId}`, so it can exist only once.
**Why:** supervisor ruling; idempotent and order-independent by construction.

### D-09 Rollup layout
**Rule:** monthly rollup docs per company (`co_YYYY-MM`) and per project (`p_{id}_YYYY-MM`), plus a lifetime doc per project (`p_{id}_all`). They are split by audience into `rollups` (cost side) and `finance_rollups` (D-28). FY and custom ranges are summed on read from up to 12 monthly docs. Category totals are keyed by the posted category ID, with `gstPaise` per category alongside the gross amount (D-20). Filters that rollups can't answer (payment mode, entered-by, partial months) use Firestore `sum()`/`count()` aggregation queries.
**Why:** a dashboard load reads about 30 small documents (§3.1 rule 3; §11.1 asks for under 3 s). Month granularity matches the period lock and the CA export, and spreads writes across documents. Load on the hottest rollup document (`co_YYYY-MM`) is assessed in cost-estimate.md.

### D-10 Category tree, re-parenting and `categoryPath`
**Spec:** §7.4 says changing a category's parent re-rolls totals without data loss; §3.1 rule 2 stores `categoryPath` on expenses; rule 8 wants an index on project + categoryPath + date.
**Rule:**
- Rollups are keyed by category ID and `categoryPath` holds IDs. A parent's total is computed on read as its own posted amount plus all its descendants', using the category tree (about 35 docs, cached in the client). Re-parenting changes only the category's `parentId`, so **no rollup and no amount is rewritten**.
- `categoryPath` on expenses would go stale after a move and break the "entries under this node" list, so a background job rewrites that one field. Conditions (supervisor):
  - (a) The posting function sees a zero delta for a path-only change and **writes nothing** (D-08 step 4), so the rewrite doesn't touch the hot rollup docs.
  - (b) **One audit entry per move, on the category** (requested and finished), not one per expense. The expense audit trigger ignores system-only fields (`categoryPath`, `searchKeywords`).
  - (c) The rewrite **is allowed in locked months**, because it changes no financial field. The lock re-check applies only to non-zero deltas.
  - (d) It runs as a **resumable, paged job**: `category_moves/{id}` holds status and a cursor, pages of 400, resumed from the cursor after a timeout or crash.
- Expenses are posted to the category chosen at entry, which must be a leaf at that time. If an admin later adds a child under a used leaf, its existing expenses stay on the now-parent node and are shown as "Other" under it. A category with posted expenses can be deactivated but not deleted.
- The CSV export derives its level 1/2/3 columns from the live tree at export time.

### D-11 Dashboard KPIs
**Spec:** §4A.6 and §11.1 list different KPI cards.
**Rule:** §11.1 wins (§4A says functional sections decide content): Active projects, Completed projects, Delayed projects, Total expense (month / FY), Total billed, Total received, Total outstanding, Net profit. The §11.1a additions (cash and bank balances, money to pay this week, spend tracker, books readiness, GST snapshot) are cards or widgets, not top KPIs. The §4A.6 items missing from §11.1 appear as widgets: supplier payables in "To pay", labour in "Workers today", margin in the project P&L, plus "Wages due" next to expense (D-16).
**Why:** supervisor ruling.

### D-12 Numbering
**Spec:** §3.1 rule 6. GST law (CGST Rules 46(b) invoices, 50 receipt vouchers, 53 credit/debit notes) requires serial numbers of **at most 16 characters**, only letters, digits, `-` and `/`, unique per financial year.
**Rule:**
- Document numbers come from `counters/{docType}_{fy}` inside the same transaction that writes the numbered document, run by a callable function. Numbered documents can't be created offline. Drafts have no number; the number is allocated when the document is issued. An issued document is never deleted; it is cancelled and keeps its number.
- Sequences and formats:

| Document | Format | Length | GST doc? |
|---|---|---|---|
| Tax, RA and milestone invoice | `AG/2026-27/0001` | 15 | yes |
| Credit note | `CN/2026-27/0001` | 15 | yes |
| Debit note | `DN/2026-27/0001` | 15 | yes |
| Receipt voucher for client advances | `RV/2026-27/0001` | 15 | yes |
| Proforma | `AG/PF/2026-27/0001` | 18 | no |
| Payment receipt (against invoice) | `AG/R/2026-27/0001` | 17 | no |
| Quotation | `AG/Q/2026-27/0001` | 17 | no |
| Agreement | `AG/C/2026-27/0001` | 17 | no |
| Project code | `AG-P-0001` | 9 | no |
| Voucher (CA export) | `V/2026-27/00001` | 15 | no |

- The numbering function **rejects** a GST document number longer than 16 characters or containing other characters. Five-digit serials still fit (`AG/2026-27/10000` is 16).
- **Voucher numbers** are not allocated inside posting transactions, which would make `voucher_{fy}` the hottest document (supervisor change I). A scheduled job (every 5 minutes, and on demand before a CA export) assigns numbers to posted records with an empty `voucherNo`, in `date, postedAt, id` order, in batches of up to 400 with one counter write per batch. It only fills empty fields, so reruns are no-ops.
**Needs user:** confirm the formats, and whether any series already in use this FY must be continued.

### D-13 Deterministic IDs and period locks
**Rule (supervisor):** attendance `{projectId}_{workerId}_{YYYY-MM-DD}`; period lock `YYYY-MM`. Full list in data-model §8.
**Lock key is derived, never trusted:** rules compute the month from `date` (`monthKeyOf(date)`) and check `period_locks` on that key, for both the old and the new date on update. They also require the stored `monthKey` and `fy` to equal the values derived from `date`, and `date` itself must be calendar-shaped (month 01–12, day 01–31). Posting functions likewise derive month and FY from `date`. (Draft 1 built a regex from the client's `monthKey`, so `".*"` bypassed the lock; supervisor fix 1.)
**Why:** the attendance ID makes "one doc per worker per project per day" structural; the lock ID lets rules call `exists()` directly.

### D-14 Residential / government data
**Spec:** §12 lists `project_residential` and `project_government` tables.
**Rule:** the non-money fields are stored as `residential` and `government` maps on the project document. Money fields go to `private/commercial` and `private/budget` (D-28). List-type children (units, milestones, approvals, BOQ, MB, EOT, hindrance) are subcollections.
**Why:** 1:1 data that is always read with the project, which saves a read per project view.

### D-15 GST calculation and rounding (proposed, needs CA)
**Spec:** gap. "Matches to the paisa" (§7.4, §11A.7) needs one rule. If turnover exceeds ₹5 crore, e-invoicing applies, and the e-invoice schema carries tax per item (supervisor change C).
**Proposal, per line:**
1. Line taxable = `mulDivRound(qtyMilli × ratePaise, 10000 − discountBp, 1000 × 10000)`, half-up to the paisa.
2. For each line: intra-state (company state = place of supply) gives CGST = SGST = `mulDivRound(taxable, rateBp, 20000)`; inter-state gives IGST = `mulDivRound(taxable, rateBp, 10000)`. Half-up to the paisa.
3. Invoice totals are the **sum of the lines**. The rate-wise and HSN summary tables are sums of lines too, so every table on the PDF adds up.
4. Grand total is rounded to the nearest rupee with an explicit "Round off" line (±₹0.50), which the e-invoice schema also allows (`RndOffAmt`).
5. Deductions (TDS, GST-TDS, retention, labour cess) are computed on the stated basis (taxable value by default, configurable per head), rounded half-up to the rupee, and can be overridden per invoice with a reason.
6. Half-up on integers: `floor((2n + d) / (2d))` for non-negative n; negative amounts (credit notes) are rounded on their absolute value and the sign is restored.
7. Expenses: GST fields are entered as printed on the supplier bill. The system warns if taxable + tax differs from total by more than ₹1, but never recomputes a supplier's figures.
**Why per line:** valid whether or not e-invoicing applies, and it avoids reworking invoices if Ambika crosses the threshold.
**Needs CA:** confirm per-line tax and rupee round-off; whether e-invoicing applies (turnover over ₹5 crore); the deduction basis.

### D-16 Money flows (proposed, needs CA)
**Spec:** §6.5 says all wage payments create Labour expense entries; §11A.4 says advances are kept separate from expense and income. These conflict for worker advances.
**Proposal:**
- **Wage settlement:** records the gross wages being settled, the advance recovered and the net cash paid. It generates one Labour expense `wage_{paymentId}` for the **gross**, categorised by the worker role's Labour sub-category (`settings/operations.workerRoles`). One `account_transactions` row records the **net** cash. The worker's outstanding advance drops by the amount recovered.
- **Thekedar bill payment** (`type: thekedar_bill`): the gross is the work value being paid, posted as Labour > Thekedar payments. **TDS under s.194C** is deducted (`tdsPaise`), the account row is the net, and TDS deducted is tracked in `finance_rollups.tdsDeductedPaise` as payable to government.
- **Worker advance:** account row only, and the worker's outstanding advance goes up. It is not an expense until recovered through a wage settlement, or written off by the owner (which creates a Labour expense).
- **Bonus:** expense plus account row, like a wage.
- **Vendor bill:** creates the Materials (or other) expense, unpaid, with the payable increased. **Vendor payment:** account row, payable decreased, no expense; TDS deducted where it applies. **Vendor advance:** account row, vendor advance increased, adjusted against later bills.
- **Generated expenses never write their own account row.** Only the source payment does. This is what prevents cash being counted twice.
- **(a) Wages due** (supervisor): because wages become expense when paid (§6.5), wages earned from attendance but not yet settled are shown as **Wages due** next to expense in the project P&L and on the dashboard (`rollups.wagesEarnedPaise − wagesExpensedPaise`). Whether labour cost should instead be recognised when earned is a CA question.
- **(b) Client advances** (supervisor): an advance received but not yet adjusted against an invoice is **not income and not part of Net profit**. It is shown as a separate "Advances received (unadjusted)" line. Cash and bank cards include it naturally, because the money is in the account. When an invoice is issued, adjusting the advance moves it to received.
- **(c) GST on advances** (supervisor): for works contracts (a service), GST is due when an advance is received, which needs a receipt voucher (`RV/…`, D-12) with tax on the advance, adjusted against the final invoice. Modelled in `payments_received.advanceGst`; confirmed with the CA.
**Needs CA:** advance treatment; labour cost recognised when earned or when paid; GST on client advances; TDS rates and the 194C thresholds.

### D-17 Quotation numbering
**Spec:** §8.2 shows both "Q-0001 v1, v2" and "AG/Q/2026-27/0001".
**Rule:** the number is `AG/Q/2026-27/0001`. Revisions keep the number and increment `version`, displayed as `AG/Q/2026-27/0001 (Rev 2)`; version 1 has no suffix. Each version is its own document; older versions become read-only and keep their status.
**Why:** "Q-0001" reads as shorthand for the full format, and one format avoids two sequences.

### D-18 One tender register
**Spec:** the §10.1 tender tracker (to bid, submitted, won, lost) duplicates the §5.4 tender register.
**Rule:** one `tenders` collection with the §5.4 statuses. The Leads area shows a "Tenders" view filtered from it. The tracker statuses map as follows: to bid → spotted or preparing; submitted → submitted, technically qualified or financially opened; won; lost (plus cancelled).
**Why:** supervisor ruling.

### D-19 Thekedar contracts vs agreements
**Spec:** §12 has a `contracts` table for labour contract scope and rates, and §8A has agreements; the nav item "Contracts" means agreements.
**Rule:** the collection is renamed `thekedar_contracts`, with the UI label "Thekedar contracts" (Hindi: "ठेकेदार अनुबंध") under Labour & Attendance. The nav item "Contracts" and the `agreement_*` collections are the §8A legal agreements. A thekedar contract may link to a signed agreement (`agreementId`).
**Why:** the supervisor asked for distinct names; one word for two things would confuse users and code.

### D-20 Definitions
**Rule:** from §11.1a, applied everywhere (dashboard, reports, CSV):
- **Total expense** = approved, non-deleted expenses, paid and unpaid (toggle: paid only). Pending and rejected entries never count. Rollups store the gross amount and the GST inside it per category, so both "incl. GST" and "excl. GST" views are exact. The default view follows the project's `itcEligible` flag: excl. GST where input credit is claimed (GST isn't a cost), incl. GST where it isn't (e.g. residential sold at no-ITC rates). Company-wide figures sum each project on its own basis and say so on the card. **Needs CA:** confirm the basis per project type.
- **Income / received** = receipts against invoices (cash basis; toggle: billed). **Unadjusted client advances are excluded** and shown separately (D-16b).
- **Billed** = issued tax, RA and milestone invoices, minus credit notes, plus debit notes. Proforma and cancelled invoices are excluded.
- **Outstanding** = billed − received − TDS and retention deducted, which are tracked as separate receivable heads (§8.6).
- **Wages due** = wages earned − wages settled (D-16a).
- **Net profit** (KPI) = received − total expense by default; toggle: billed − total expense (§5.6). Wages due is shown beside it, not subtracted.
- **Delayed project** = in progress and today is past the expected end date (for government work, the stipulated end date including approved EOT).

### D-21 Site-role queries are single-project
**Rule:** for `pm` and `supervisor`, every list query on a project-scoped collection carries `where('projectId', '==', X)` for an assigned project, and the rules check membership with `get(/projects/X)`.
**Status:** this is the **first emulator test** in Phase 1, run in GitHub Actions (D-36). I expect rules that `get()` the project named by a field the query pins with `==` to be accepted, but I haven't confirmed that.
**Fallback if it fails (supervisor):** mirror `assignedUsers` into a `projects` custom claim (an array of project IDs; about 35 IDs fit the 1,000-byte claim limit), maintained by the same function that maintains `users.projectIds`, with a forced token refresh when assignments change. Rules then use `resource.data.projectId in request.auth.token.projects`. This also lets a PM run cross-project `in` queries (up to 30 values), for example pending approvals. `assignedUsers` stays the source of truth.

### D-22 Worker KYC
**Rule:** address, ID proof, bank/UPI details and thekedar PAN/GSTIN live in `workers/{id}/private/kyc` and, in Storage, under `workers/{id}/kyc/*`, readable only by owner and accountant. Supervisors don't read the worker master at all (D-33).
**Masked Aadhaar only** (user, via I10): ID-proof uploads accept only a masked Aadhaar copy, with the first 8 digits hidden, as UIDAI recommends. The record stores only the last 4 digits (`idProofNumberMasked`). The upload hint says: "Upload a masked Aadhaar: the first 8 digits must be hidden. You can download one from the UIDAI website." The owner or accountant confirms the copy is masked before it is saved; an unmasked copy is rejected with that message. This matters more because Storage is in the US (D-34 row 5).
**Why:** §15 compliance, §11A.6 (the CA sees no worker ID documents), and the lower risk of masked copies wherever the files are stored.

### D-23 Share links
**Rule:** PDFs are never public in Storage. `share_links/{token}` (a 128-bit random token) points at the file. A public HTTPS function checks expiry and revocation, counts the view, sets quotation status `viewed` on first open, and streams the PDF. Default expiry is 30 days (a setting); the owner can revoke a link.
**Why:** §3.1 rule 14 and §15 (private storage). A function also lets us track "Viewed" (§8.2).

### D-24 Proforma and notes
**Rule:** proforma invoices are documents only: no billed amount, no GST liability, their own sequence. A proforma can be converted into a tax invoice. Credit and debit notes reference the original invoice and post negative or positive billed and GST amounts in the month they are issued. A sent invoice is locked; changes go through a credit note, or a cancel-and-reissue with audit (§8.3).

### D-25 Attendance lock timing
**Rule:** the lock window (default 3 days, §6.3) is measured from the attendance `date` to the **server** time of the write, not the phone's clock. If an offline supervisor syncs after the window, the write is rejected, and the app shows "Needs admin unlock" with the queued values kept rather than silently lost.
**Why:** otherwise the phone's clock decides the lock.

### D-26 Design direction: brand.md version 4 (was version 2)
**Updated 26 Oct 2026: brand.md version 4 replaces version 2 and everything below it in this entry.** The user chose a new palette (#F12136, #B23A48, #FCB9B2, #FED0BB) and a UI in the style of clio.praxistence.com for both apps, kept minimal with some animation. For the CRM, motion is calm.

| Spec | Version 2 (below) | **Now (version 4)** |
|---|---|---|
| §4A.2 radius | 0 everywhere | **Pill buttons and chips, 20 px cards and dialogs, 12 px inputs and menus, 6 px badges**, round avatars |
| §4A.3 palette | red #C62828 and white, grey neutrals | **#F12136** red (fills; small red text #D7192C / #FF4A5C), **#B23A48** rose (secondary), peach #FED0BB and pink #FCB9B2 (tints, ink text only), warm white #FFFDF9 and black #0B0B0C pages |
| Primary button | red fill, white label | **#F12136 with a #0B0B0C label** (white fails at 4.19:1); hover #D7192C with a white label |
| §4A.7 typeface | IBM Plex Sans | **Inter Tight** headings (brand.md 4.1 sharp fonts; Noto Sans Devanagari for Hindi), **Inter** body with tabular figures (Noto Sans Devanagari Hindi), **JetBrains Mono** only for small labels and IDs |
| Surfaces | flat, shadow only on floating elements | soft large shadows in light; border plus a deep shadow in dark; **glass only on the top bar, the phone bottom bar and the phone sheet** |
| Motion | 150–200 ms | **calm:** 150 ms hover and focus, 300 ms menus and dialogs, a 600 ms reveal and spotlight glow on dashboard KPI cards only; none on tables, forms or attendance; all off under reduced motion |
| §4A.8 status badges | square | 6 px corners, outlined, icon and text |
| Charts | red, navy, sky, teal, grey | red, deep rose, peach (outlined in light), warm grey, slate; validated for colour blindness (design-tokens §4) |

Unchanged: the PRD's content and function rules (§4A.5–§4A.12), plain words, the visible Dark mode switch, 48 px tap targets, Indian formats, and contrast rules. Details: design-tokens.md draft 2, tokens.css, web/src/styles/v4.css.

**Version 2 record (superseded):**
**Source:** the user's design direction, relayed by the supervisor as docs\brand.md **version 2** (25 Oct 2026), which replaces version 1 (and with it the version 1 rules on text-safe blues and dark button labels).
**The user's direction supersedes these spec items:**

| Spec | Was | Now |
|---|---|---|
| §4A.2 radius | 10–12 px cards, 8 px inputs and buttons | **0 everywhere** (radio buttons and spinners excepted); shadcn `--radius: 0` |
| §4A.3 palette | blue accent, teal secondary | **red and white**: brand red #C62828 (light) / #FF6B6B text and #D32F2F button fill (dark), neutral greys. This is allowed by §4A.3's own clause that the brand colour chosen in Settings may replace the blue |
| §4A.7 typeface | Inter / Geist / Manrope + Noto Sans Devanagari / Hind / Mukta | **IBM Plex Sans + IBM Plex Sans Devanagari** |
| §4A.8 status badges | pill-shaped | **square**, outlined, with icon and text |

Also from version 2:
- Dark-theme primary buttons are #D32F2F with **white** labels (4.98).
- Body and input text is 16 px, tables are 14 px, and nothing is smaller than 12 px.
- Tap targets are 48 px on phones and controls 40 px tall on desktop.
- Material Design 3 is the behaviour reference: bottom navigation below 600 px, a rail with labels from 600 to 1023 px, and the sidebar from 1024 px.
- Cards are flat; shadow is used only for floating elements, in light mode.
- The chart palette is led by red and checked for colour blindness, with no red-against-green pairs.

**Theme switch:** a visible "Dark mode" switch with its text label: in the top bar on tablet and desktop, and as the first row of the ⋮ menu on phones (brand.md v2.2), in addition to the spec §4A.4 Light / Dark / System choice, which stays in the profile menu. The choice is saved to `users.theme` and cached in `localStorage`. An inline `<head>` script sets `data-theme` before first paint, so there is no flash of the wrong theme.

**PDFs:** brand red is the single accent on invoices, quotations and contracts (§8.4), always in a light layout.

**Answered:** open question B5 (brand colour) is **red**.
Details: design-tokens.md and tokens.css.

### D-27 PDF engine
**Rule (proposed):** Puppeteer (serverless Chromium on a 2 GiB 2nd-gen function), because @react-pdf/renderer shapes Devanagari conjuncts poorly and client and worker names are often in Hindi. No minimum instance at launch; the 5–10 s cold start is accepted until users say otherwise (open question I7). Weighed in cost-estimate.md §8.

### D-28 Documents split by audience
**Spec:** §2 and §3.1 rule 1: supervisors never see invoices, payments or accounts. Firestore rules work per document and can't hide individual fields (supervisor change A).
**Rule:** any field a role must not see lives in a separate document:
- Rollups are split into `rollups` (cost side: expense, GST on expense, wages, attendance) and `finance_rollups` (billed, received, advances, GST output and input, TDS, retention, vendor flows, account flows).
- Project money fields move to `projects/{id}/private/budget` (readable by an assigned `pm`) and `projects/{id}/private/commercial` (finance roles only). `project_units`, `project_milestones` and the new `boq_rates` are finance-only; `boq_items` keeps only quantities.
- Vendor bank details move to `vendors/{id}/private/bank`, and payable balances to `vendor_balances/{vendorId}`.
- Attendance rate snapshots are set by a trigger, never by the client.
- The principle and the full matrix are in data-model §12: site roles see the **cost side** of their own projects; they never see the revenue side, company money, payables ledgers, or personal and bank data.
**Why:** supervisor change A. Splitting documents is the only way rules can enforce field-level privacy.

### D-29 Thekedars are worker records
**Spec:** §6.1 lists thekedar on the worker master; §6.4 pays "worker (or thekedar)"; §9.1 vendors are material and machinery suppliers.
**Rule:** `thekedarId` always points to a `workers` document with `isThekedar: true`. A thekedar's PAN, GSTIN and TDS settings live in that worker's restricted `kyc` doc. Thekedar payments are `worker_payments` with `type: thekedar_bill`, carrying `tdsPaise` and `tdsSection: 194C`.
**Why:** the spec puts thekedars in the Labour module, with their labour linked to them, their ledger beside workers' (§6.4) and their attendance. A single collection keeps the ledger, the TDS field and the payout sheet in one place (supervisor change F).

### D-30 Approvals only through callables
**Rule:** clients always create approvable records with `approvalStatus: "pending"`. Rules forbid any client change to `approvalStatus`, `approvedBy` or `approvedAt`. The callables `approveRecords` and `rejectRecords` check the approver's role, their project assignment and the thresholds in `settings/operations`, write the audit entry, and set the status. A server trigger auto-approves an owner's or accountant's own entries under their threshold after sync, so their offline entries need no second step.

**Every source of money is approvable.** No client can create a record that moves money or books expense without passing through approval. Generated expenses **inherit their source's approval**: the expense is created only when the source is approved, and it is born approved.

| Source (created pending) | Who may create | Generated expense |
|---|---|---|
| `expenses` (manual) | finance, assigned PM or supervisor | — (is the expense) |
| `worker_payments` (wage, bonus, thekedar bill) | finance only (D-45, M1.3) | `wage_{paymentId}` (Labour); advances generate none |
| `vendor_bills` | finance | `vb_{billId}_{categoryId}` |
| `machinery_fuel_logs` | finance, assigned PM or supervisor | `fuel_{id}` (Machinery > Fuel) |
| `machinery_maintenance` | finance, PM | `maint_{id}` (Machinery > Repair) |
| `machinery_rent_statements` | generated by a function; approved by callable | `mrs_{statementId}_{projectId}` (Machinery > Hire) |
| `stock_ledger` damage / theft | finance, assigned site roles (with reason) | none (stock value write-down) |
| `stock_counts` | finance, assigned site roles | none (adjustment rows on approval) |
| `adjustments` | finance | posts as a delta into an open month |
| `rate_change_requests` | finance, assigned PM | none (changes future wages, D-32) |

Other paths that book expense are finance-only and follow the auto-approve threshold: guarantee bank charges (`gchg_{guaranteeId}`) and recurring templates (`expense_templates` create **pending** expenses). **Stock transfer transport cost** is no longer a field on the transfer; it is entered as an ordinary pending expense linked to the transfer.
**Why:** supervisor change H and fix 3. Thresholds and audit are simpler and safer in one function than spread across rules, and no record a site role creates can move money unapproved.

### D-31 Enquiry endpoint (`submitEnquiry`, contract v2)
**History:** draft 1 planned a Web3Forms webhook with a URL token. Web3Forms' free plan has no webhooks, so `docs\enquiry-form-contract.md` **version 2** replaces it: in Phase 3 the website posts its JSON straight to a public CRM function, and Web3Forms is dropped. Until then (stage 1), enquiries reach the owner by email only. The webhook token and its Secret Manager slot are gone.
**Rule (Phase 3):** `submitEnquiry` is a public 2nd-gen HTTPS function in `asia-south1` with:
1. **CORS** allowing only the website's origins (production, staging, localhost for development). **No shared secret**, since anything the browser holds is public.
2. **Size cap:** bodies over 10 KB are rejected.
3. **Rate limit:** about 5 submissions per IP per hour, counted in memory, with **`maxInstances: 2`**, so a flood is turned away cheaply instead of scaling up costs. In-memory counts are per instance, so the effective limit is up to 10 per IP per hour. That's acceptable: it's a cost guard, not an exact quota.
4. **Honeypot** (`botcheck`): answered as accepted, nothing created.
5. **Full validation** of every field, as in the contract, including the shared phone rule.
6. **Logging (contract v2.1):**
   - **CORS and steps 2–4** (wrong origin, over 10 KB, rate limit, honeypot): Cloud Logging only, with the reason and a hash of the body. **No form contents, no Firestore write.**
   - **Validation failure where the visitor can be contacted** (`consent` is `"yes"` and `phone` passes the phone rule): stored in `lead_webhook_logs` as `rejected`, with the payload and the reason, and shown to the owner as **"Needs checking"**.
   - **Any other validation failure** (no consent, or no usable phone): Cloud Logging only, with the reason. **No personal data is kept anywhere.**
   - Accepted enquiries (`created`, `noted`) are stored in `lead_webhook_logs`. The ID is the sha256 of the **canonical contract fields** (trimmed, keys sorted), so an identical resubmission is a no-op.

   **"Needs checking" is a view over `lead_webhook_logs`, not a lead stage.** It lists entries where `result == "rejected"` and `reviewStatus == "open"`, at the top of the leads list (owner only, as the logs are owner-read). The owner either:
   - **Creates the lead** from it, after correcting the field: the `createLead` callable runs the normal de-dup through `lead_phones` and sets `reviewStatus: "converted"` and `leadId`; or
   - **Dismisses** it: `reviewStatus: "dismissed"`, and the callable **clears the payload** (keeping only the reason and timestamps).
   Open entries older than 90 days are cleared the same way by the dispatcher.
   *Why a view and not a lead stage:* an unverified submission never enters `leads`. Pipeline counts, "leads by source" and the phone de-dup stay clean, and personal data that the owner dismisses is deleted rather than kept as a lost lead.
7. **Same answer** whether the phone is new or known (`200 {"success": true}`), so the endpoint can't reveal who has enquired; `200 {"success": false, "message"}` on validation failure; `429` when rate-limited.
8. **Owner email** for each accepted enquiry, through the free email tier (Resend, D-34 row 7).
9. A new phone creates a lead (`lead_phones` de-dup) and a follow-up task; a known phone adds a note.
**Why:** contract v2 and the ₹0 rule. Draft 1's principle carries over: nothing that fails the cheap checks touches Firestore.

### D-32 Wage rates are finance-controlled
**Spec:** gap. The worker master is company-wide, and a worker's default rate and per-project terms decide every wage paid.
**Rule:** only owner and accountant write rate fields: `defaultPayType`, `defaultRatePaise`, `otRatePaise`, `otMultiplierBp` and `isThekedar` on `workers`, and everything in `workers/{id}/project_terms`. A PM can add and edit workers without those fields, and proposes a rate through `rate_change_requests` (created pending, approved by `approveRecords`, which writes the rate and audits it). Attendance snapshots the approved rate on the server (D-28), so a pending proposal never affects pay. A worker with no approved rate earns ₹0 and is flagged "Rate missing" in Books readiness.
**Why:** supervisor fix 6. A rate is a money lever just like an expense, so it goes through the same approval path.
**Changed at M1.2 (QA F1, rule A):** PMs no longer read rates either. Rates live in `workers/{id}/private/pay` (owner and accountant only), and `project_terms` is finance-only. See the note after D-44.

### D-33 Site roster
**Spec:** §6.3 (attendance marked per project per day, one-screen list) and §6.5 (site workforce view) need the list of workers on a site; nothing in draft 2 provided it, and supervisors couldn't read `project_terms`.
**Rule:** `projects/{pid}/roster/{workerId}` holds membership (`active`, who added it, when), written by finance or the assigned PM, plus name, role, photo, thekedar and pay-type snapshots filled by a function. It holds **no rates**. Supervisors read the roster instead of the worker master; their read access to `workers` is removed. Attendance rules require an active roster entry for the worker.
**Why:** supervisor item 9. A subcollection keeps the attendance screen to one small query (`active == true`, ordered by name; about 40 docs per site, not 2,000) and lets rules confirm the worker belongs to the site. I chose it over a `workers.projectIds` array because it carries display snapshots without rates and narrows what supervisors can see.

### D-34 Free tier first (₹0 running cost)
**Source:** the user's rule at Phase 0 sign-off (25 Oct 2026): everything should cost ₹0. The Blaze plan with a card on file is accepted, but the design must stay inside the free allowances, with a ₹100 budget alert on each project (open question I8).
**Verified:** 25 Oct 2026 against the official pricing and docs pages (Firestore, Cloud Run, Cloud Scheduler, Artifact Registry, Cloud Storage, Identity Platform, Firebase Hosting and App Hosting, Secret Manager, Resend, Web3Forms). Prices in USD; **re-check before go-live**, as allowances change. Pilot usage against each limit is in cost-estimate.md §10.

| # | Area | Free allowance (verified) | Rule |
|---|---|---|---|
| 1 | Firestore | Per project: 50,000 reads, 20,000 writes, 20,000 deletes a day; 1 GiB stored; 10 GiB egress a month. Exactly one free database per project. The docs disagree on whether a *named* database can be the free one | Use **only the `(default)` database**, in `asia-south1` (the free quota applies there). Rollups, cursor pagination, the cached category tree and no listeners on large collections keep reads small (§3.1 rules 9 and 17) |
| 2 | Cloud Scheduler | **3 free jobs per billing account** (paused jobs still count); dev, staging and prod share one account | **One dispatcher job per environment** (`dispatchPeriodic`, every 5 minutes), which fans out by time of day to: voucher numbering, recurring expenses, reminders and alerts, missing-photo checks, the overdue-invoice job and the monthly CA email. Prod and staging get one each; **dev gets none** (run tasks by hand or in the emulator). 2 of 3 used, 1 spare. Firestore managed backups don't use Scheduler |
| 3 | Cloud Functions (2nd gen = Cloud Run) | Per billing account: 2 M requests, 180,000 vCPU-seconds, 360,000 GiB-seconds a month; `asia-south1` is Tier 1, so the full allowance applies. **No free allowance for minimum instances**; idle time draws down the shared allowance | **No min instances anywhere** (I7 answered no). Smallest memory that works: 256 MiB for triggers and callables; Puppeteer measured in Phase 2 (start at 1 GiB, raise only if it fails). `maxInstances` capped on every function so a loop can't run away. Optional extra: Google's Preview "spend caps" can pause Functions, Run and App Hosting at a cap, but they don't cover Firestore or Storage |
| 4 | Artifact Registry | 0.5 GB storage per billing account | Run `firebase functions:artifacts:setpolicy` in each project (default deletes images older than 1 day; CLI v14+). Measure the Puppeteer image in Phase 2; it is the one that could fill 0.5 GB |
| 5 | Cloud Storage | Always Free 5 GB-months, 5,000 Class A and 50,000 Class B operations, only in **us-central1, us-east1, us-west1** (combined). Blaze required for Firebase Storage since Feb 2026. `asia-south1` is billed from the first byte (about $0.020/GiB-month) | **Decided (I10): the default bucket in us-central1**, with photos compressed hard on the phone (longest side 1600 px, JPEG/WebP about quality 0.6, target ≤150 KB). Firestore stays in Mumbai. Trade-off in cost-estimate.md §10 |
| 6 | Phone OTP (SMS) | **No reliable free SMS.** About $0.07 (≈ ₹6) per SMS to India. The Identity Platform page mentions 10 free a day, but the Firebase pricing page doesn't, so treat every SMS as billable | Restrict SMS to India (SMS region policy, allowlist `IN` only), which also blocks SMS-pumping fraud. Sessions stay signed in for long periods. **Decided (I9, D-35): Google sign-in for site staff, email + password for office users, phone OTP as a fallback only** |
| 7 | Email | Resend free plan: 3,000 emails a month, 100 a day, 3 domains | Use Resend for alerts, documents and the monthly CA email. Batch alerts into a daily digest per user so the 100-a-day cap holds |
| 8 | Hosting | Superseded by **D-36**: the front end is hosted on **Netlify** (free plan, 300 credits a month), not Firebase Hosting or App Hosting | Static export of Next.js on Netlify; see D-36 and cost-estimate §10 |
| 9 | Web3Forms | Free plan: 250 submissions a month, **no webhooks** (Starter: 1 integration; Pro: webhooks) | **Resolved by contract v2** (D-31): stage 1 uses Web3Forms for email only; from Phase 3 the website posts to the CRM function `submitEnquiry` and Web3Forms is dropped |
| 10 | Secret Manager | 6 active secret versions, 10,000 access operations a month, per billing account | Secrets only in staging and prod: the Resend API key (2 versions; the webhook token is gone with contract v2); dev uses local emulator secrets; old versions destroyed on rotation |
| 11 | Other | Cloud Build 2,500 build-minutes a month (per billing account); Cloud Logging 50 GiB a month (per project); FCM free | Keep log levels quiet in prod; no per-request debug logging |
| 12 | Backups and PITR | **No free quota**: backup storage about $0.035/GiB-month, PITR about $0.17/GiB-month | Open question I6 (deferred to before go-live). At pilot size (well under 0.1 GiB) this is under ₹1 a month, so it isn't literally ₹0. The user decides; the tested restore before go-live is still required |
| 13 | Budget alerts | Budget currency follows the billing account (INR accounts get INR budgets). Alerts warn and **do not cap spending** | ₹100 budget alert on each project, at 50%, 90% and 100% |

**User answers (25 Oct 2026):**
- **I9:** Google sign-in for site staff, email + password for office staff, phone OTP only as a fallback with SMS limited to India (D-35).
- **I10:** Storage in **us-central1**, free up to 5 GB. ID proofs are stored in the US, and only masked Aadhaar copies are accepted (D-22).
- **Web3Forms:** resolved by contract v2 (D-31); no webhook is needed.

**Why:** the user's instruction. Each limit is designed for up front, rather than discovered on the first bill.

### D-35 Sign-in methods (spec deviation)
**Spec:** §3.1 says phone OTP for supervisors and site staff, and email + password for owner, accountant and CA.
**Rule (user, I9):**
- **Site staff (supervisors, PMs on site): "Sign in with Google".** Every Android phone already has a Google account, so there is nothing new to remember.
- **Office staff (owner, accountant, CA, viewer): email + password**, as the spec says. Optional two-factor authentication for the owner (§15).
- **Phone OTP (SMS): fallback only**, for someone with no Google account. The SMS region policy allows **India (IN) only**, which also blocks SMS-pumping fraud. Sessions stay signed in for long periods so codes are rare.
- In every case the role comes from the custom claim set by the owner's callable (D-05). A Google account the owner hasn't added gets no access, even though it can authenticate.
**Why the spec changes:** each SMS costs about ₹6 (US$0.07 to India, with no free allowance that can be relied on), and the user's rule is ₹0 running cost (D-34). Google sign-in is free.

**How Google sign-in works off Firebase Hosting (with D-36).** Checked against Firebase's "Best practices for using signInWithRedirect on browsers that block third-party storage" (page updated 21 Oct 2026). When the app's domain differs from `authDomain`, `signInWithRedirect` breaks on browsers that block third-party storage (Safari, and Chrome as it phases out third-party cookies). Of the five options on that page, the CRM uses **option 3, a transparent reverse proxy**:
- In `netlify.toml`, rewrite `/__/auth/*` to `https://<project>.firebaseapp.com/__/auth/:splat` with **status 200, forced**. That is a server-side proxy, not a redirect, so it meets the page's "a 302 won't work" condition. A matching rule proxies `/__/firebase/init.json`.
- Set `authDomain` to the app's own domain (e.g. `crm.<company domain>`), per environment.
- Add `https://<app-domain>/__/auth/handler` to the Google OAuth client's authorized redirect URIs, and the domain to Firebase Auth's authorized domains. One entry per stable domain: production, and the staging branch-deploy domain.
- Use **`signInWithRedirect`** on phones and in the installed PWA, and **`signInWithPopup`** on desktop. Popups are blocked or awkward in installed home-screen apps, especially on iOS. Firebase's page doesn't cover PWAs; that point rests on older community reports.
- **Test on a real Android phone and an iPhone, in the browser and as an installed PWA, in the first week of Phase 1 (step 4).** If the proxy fails anywhere, fall back to option 4 (self-hosting the helper files) or popup-only on that platform.
- Netlify's custom headers (our CSP) don't apply to proxied responses; `/__/auth/*` keeps Firebase's own headers, which is what Firebase expects.
- Email/password and phone sign-in don't use the handler and work on any domain that is authorized.
- Netlify **deploy previews** have changing URLs that can't all be authorized, so Google sign-in is tested on the stable staging branch-deploy domain, not on previews.

### D-36 Front end on Netlify; tests in GitHub Actions; nothing installed locally (spec deviation)
**Source:** the user's direction, 25 Oct 2026, relayed by the supervisor: "Don't use Java"; "JavaScript, HTML, CSS, and Next.js for the CRM"; "deploy fully on Netlify; the back end is Google, free".
**Spec:** §3 lists Firebase Hosting / App Hosting for the web app and PWA; §3.1 rule 1 requires automated Security Rules tests in the Emulator Suite.
**Rule:**
1. **Front end on Netlify.** The CRM is a **static export** of Next.js (`output: "export"`): HTML, CSS and JavaScript only, using the client-side Firebase SDK. Netlify config in `CRM\netlify.toml`:
   - **SPA-style fallbacks** for dynamic routes (e.g. `/projects/*` → the exported project page, status 200), with a final `/* /index.html 200` rule. Existing files aren't overridden.
   - **Security headers** on `/*`: Content-Security-Policy (allowing the Firebase, Google sign-in and Google Fonts domains), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (camera and geolocation on our own origin only, for bill photos and the optional attendance GPS), `Strict-Transport-Security`.
   - The `/__/auth/*` proxy for Google sign-in (D-35).
   - **Production** = the `main` branch, connected to the `prod` Firebase project. **Staging** = a `staging` branch deploy (stable `staging--<site>.netlify.app` URL), connected to the `staging` Firebase project. **Deploy previews** (free, unmetered) are for reviewing screens only.
2. **Back end unchanged:** Cloud Functions, Firestore, Auth and Storage stay on Google (Blaze plan, free allowances, ₹100 alerts; D-34).
3. **Language:** JavaScript, HTML, CSS and Next.js, written in **TypeScript**. TypeScript is JavaScript with type checks; it compiles to plain JavaScript, and the spec requires typed code (§3, §15). The supervisor has told the user; if they object, this is revisited.
4. **No Java, nothing installed on the user's computer.** Java was only the runtime the Firestore and Storage emulators need; it is not part of the CRM. Tests that need those emulators (all Security Rules tests, and function tests with Firestore triggers) run in **GitHub Actions** on every push:
   - `firebase emulators:exec --project demo-ambika-crm "npm test"`. A `demo-` project needs **no Firebase login and no secrets** in CI.
   - **Java 21 is set explicitly** with `actions/setup-java` (firebase-tools v15 and later refuse older Java; the Ubuntu 24.04 runner defaults to 17).
   - The runner is **pinned to `ubuntu-24.04`**, because `ubuntu-latest` moves to 26.04 (default Java 25) in November 2026.
   - Each run uploads its raw output as an artifact (7-day retention). I copy it into `progress\crm\<milestone>\tests\`.
   - The test order is unchanged: T-300 → T-001 → T-260 → T-276 → T-250 → the rest (phase-1-plan §4).
5. **Local development on this machine uses Node only:** unit tests (shared package), the Next.js dev server, and the web app pointed at the real `dev` Firebase project (free tier). Anything that needs the Firestore or Storage emulator runs in CI.
6. **Netlify's 300-credit limit is a hard cap** (D-34, cost-estimate §10). Running out **pauses every site on the Netlify team** until the next month, with no overage bill. So:
   - production deploys are releases, not every commit (each costs 15 credits); at most about 8 a month;
   - staging and review use the branch deploy and previews, which are free;
   - the website must **not share the CRM's Netlify team** (flagged to the supervisor), or one site's traffic could pause the other.
**Why:** the user's direction and the ₹0 rule. Netlify hosts static files for free, GitHub Actions gives free minutes and has Java, and the back end is unchanged.

### D-37 Two data modes behind one data-access layer
**Source:** the user's mandate (25 Oct 2026, via the supervisor): build the complete CRM now, without waiting for any accounts.
**Rule:** the web app reads and writes only through one `DataSource` interface (`web/src/data/types.ts`), as spec §4A.12 asks.
- **Firebase mode:** active when any `NEXT_PUBLIC_FIREBASE_*` variable is present at build time. A partial config is an error screen, **never a fallback to demo**. Built in M1.6.
- **Demo mode:** active only when none is present. It runs entirely in the browser:
  - an in-memory store persisted to IndexedDB;
  - seeded with the spec §17 test data (3 projects, 50 workers, 30 working days of attendance, 200 expenses, 10 invoices);
  - every money effect through the **same `packages/core`** posting, numbering, rollup, wage and approval code that Cloud Functions run;
  - reads filtered with the same role matrix as the Firestore rules (`core/roles.canRead`);
  - a role switcher covering all six roles, and a permanent "Demo — sample data, not saved to a database" banner.
- The seed is deterministic, with dates relative to the day it is generated.
**Why:** the user can review the real behaviour on Netlify straight away, with the PRD's own test data, and the numbers behave exactly as they will in production.

### D-38 i18next for English/Hindi
**Spec:** §3 allows next-intl or i18next.
**Rule:** i18next + react-i18next, with the language switched on the client (no URL change) and saved on the user and the device. Strings in `web/src/i18n/strings.ts`; Hindi drafts await native review (I5).
**Why:** a static export has no server to negotiate locales, and next-intl's static mode needs a `[locale]` route segment per language. A client-side switch keeps one set of URLs and switches instantly, including offline.

### D-39 Static export routing
**Rule:** the app is a Next.js static export with `trailingSlash: true`. Module pages are fixed routes (`/projects/`, `/labour/attendance/` …). Record detail pages use a query parameter (`/projects/view/?id=…`) rather than dynamic segments, so every URL exists as a file and Netlify needs no rewrite rules beyond the auth proxy. Netlify's 404 page handles unknown paths.
**Why:** records are created at run time, so their IDs can't be pre-rendered; query-string detail pages work in a static export with no server.

### D-40 Components: shadcn/ui pattern on the approved mockup styles
**Rule:** components follow the shadcn/ui pattern: copied into `web/src/components/ui/`, built on Radix primitives (dialog, dropdown, slot) and `class-variance-authority`. Their look comes from the approved mockup stylesheet, ported as `web/src/styles/ag.css`, on `tokens.css`. Tailwind 4 provides layout utilities, with tokens mapped as `ag-*` colours, so no Tailwind theme variable shadows a token name such as `--color-primary`. Icons are `lucide-react`.
**Why:** the approved mockups stay the visual source of truth, and the spec's stack (Tailwind + shadcn/ui) is kept without regenerating a different look.

### D-41 App Check: reCAPTCHA v3, enforced on Firestore, Storage and Functions
**Rule:** Firebase App Check (spec §3) uses the reCAPTCHA v3 provider, which is free. It is enforced on Firestore, Cloud Storage and the callable Functions, so requests that don't come from the CRM web app are refused. The site key is a public `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` build variable; the secret stays in the Firebase console. Local development and CI use App Check debug tokens. Demo mode never initialises App Check, because it never talks to Firebase. It is wired in M1.6; after the user registers the app (a DEPLOY.md step), it first runs in monitor mode for a few days, then enforcement is switched on, so real users aren't locked out by a wrong key.
**Why:** spec §3 requires App Check. reCAPTCHA v3 is invisible to users and free at this volume (I8, everything ₹0). Monitoring before enforcing avoids an outage from a misconfigured key.

### D-42 Viewer: totals and project progress only
**Spec:** §2 Viewer, "Read-only reports"; open question I3 (default applied). QA finding F6.
**Rule:**
- **Menu:** Home (read-only totals), Projects and Reports.
- **Projects:** the list and each project's Overview, with progress and budget against spent. Not billed or received, and no client contact details. The project's other tabs aren't shown.
- **Reads:** project documents, the budget document, cost totals (`rollups`) and money totals (`finance_rollups`).
- **No access to:** clients, leads, invoices, payments, accounts, expenses, attendance, rosters, BOQ and other project records, workers, contracts or any document file.
- **Where it's enforced:** NAV, `canRead` and `firestore.rules` agree, with tests RL-01 and RL-03 and rules cases T-361 to T-364.

**Why:** the supervisor's decision on QA F6. A viewer reads reports; a client contact list is not a report.

### D-43 CA: accounting records and reports only
**Spec:** §11A.6, "Optional CA role: read-only login limited to accounting reports and exports (no leads, no worker ID documents)". QA finding F7.
**Rule:**
- **Menu:** Accounts (Accounting & CA Export) and Reports, plus Home as the landing page with the same read-only accounting totals. Every login needs a first screen, and this one shows nothing beyond the totals.
- **Reads, for drill-down from those screens:** expenses, invoices and RA bills, payments received, vendor bills and payments, vendors (names and GSTIN, not bank details), worker payments (wages and TDS under section 194C), account transactions, transfers and adjustments, accounts, client balances, EMD and guarantee records, the audit log, cost and money totals, the budget (budget against actual), and bill files of the accounting document types.
- **Project documents:** readable for names and codes only, so reports can be filtered by project. There are no project pages.
- **No access to:** clients or leads, contracts, purchase orders and goods receipts, stock, machinery, quotations, tenders, properties, workers or their KYC and pay, rosters, attendance, project commercial details, or project detail records.
- **Where it's enforced:** NAV, `canRead` and `firestore.rules` agree, with tests RL-01 and RL-04 and rules cases T-365 to T-367.

**Why:** the supervisor's decision on QA F7, keeping §11A.6's limits.

### D-44 Plain-language menu labels
**Spec:** §4A.5 names the 14 sidebar items. QA finding F11.
**Rule:** the menu uses plain words for non-technical users (brand.md, "plain words"), as in the approved mockups. The order and the count (14) are unchanged.

| §4A.5 name | Label (English) | Label (Hindi) |
|---|---|---|
| Overview | Home | होम |
| Projects & Sites (including Tenders) | Projects | प्रोजेक्ट |
| Labour & Attendance | Workers & attendance | मज़दूर और हाज़िरी |
| Expenses & Payments | Expenses | खर्च |
| Procurement & Inventory | Purchases & stock | ख़रीद और स्टॉक |
| Clients & CRM (including Leads) | Clients & enquiries | ग्राहक और पूछताछ |
| Quotations & Invoices | Quotes & bills | कोटेशन और बिल |
| Contracts | Contracts | अनुबंध |
| Accounting & CA Export | Accounts | हिसाब-किताब |
| Calendar & Tasks | Calendar & tasks | कैलेंडर और काम |
| Machinery & Equipment | Machines | मशीनें |
| Real Estate & Properties | Properties | प्रॉपर्टी |
| Reports & Documents | Reports | रिपोर्ट |
| Settings | Settings | सेटिंग्स |

**Why:** the user's "non-technical users" rule and the approved mockups. Recorded as the supervisor asked for F11.

**Rule A change to D-32 (QA F1):** a PM no longer reads rates either. Wage rates moved off the worker master into `workers/{id}/private/pay`, readable by the owner and accountant only, and `project_terms` is finance-only too. A PM's worker list is built from the rosters of their assigned projects, and a PM can open a worker only if that worker is on one of those rosters (`siteIds` has any of the PM's projects). PMs still propose rates through `rate_change_requests`.

### D-45 Money on workers is for finance only
**Spec:** §2 (the PM's and supervisor's scope), §6.4–§6.5; the supervisor's M1.3 brief ("the daily rate and money columns only for finance roles; the PM and supervisor see the list without money"); rule A. QA findings F1 and N10.
**Rule:** wage, advance, bonus and thekedar payments, worker balances, payout sheets, thekedar contracts and their measurements are read and written by the owner and accountant. The CA reads them as accounting records (D-43). The PM and supervisor:
- mark attendance and see the site workforce without money (name, role, pay type, today's status);
- never see a rate, an amount paid, a balance or a contract value.

A PM can open a thekedar whose crew is on one of their sites (`crewSiteIds`), and that thekedar's contracts on their projects through a money-free copy, `contract_scopes`. The copy holds the scope, unit, quantity and the quantity measured. It is written with the contract and with every measurement.

This replaces the D-30 table entry that let an assigned PM create `worker_payments`.

**Approvals (D-30, D13):**
- Payments are created pending.
- The owner's own entries are approved at once. So are the accountant's, up to the auto-approve limit (₹25,000 by default).
- Anything larger waits for the owner. The accountant may approve another person's entry within the limit.
- A thekedar bill that takes its contract above the contract value always waits for the owner, even when the owner entered it (§8A.6).

**Why:** rule A and the supervisor's brief; one money boundary for every labour screen.

### D-46 Attendance writes: offline queue, last write wins, owner unlock
**Spec:** §6.3 (offline, conflicts, lock after N days with owner unlock); D-25.
**Rule:**
- **Conflicts:** every mark is written with **last write wins**. Each change appends an `audit_log` entry with the before and after status, who and when. When the mark was changed by someone else after this person loaded the day, the entry names the overwritten change and the saver is told how many.
- **The lock:** a day older than `attendanceLockDays` (3) is locked, measured on the server's date. The owner can change a locked day directly, or unlock it for the site for 24 hours with a reason (`attendance_unlocks/{projectId}_{date}`, audited). In Firebase mode the unlock carries `untilTs`, a timestamp the rules compare with `request.time`.
- **Offline:** a save made offline is queued on the device with its values and shown in the top bar as waiting. It is sent in order when the connection returns. A queued save the server refuses, for example because the day locked meanwhile, stays with its reason until the person discards it or the owner unlocks the day (D-25: never silently lost). In Firebase mode Firestore's offline persistence takes over the queue (M1.6), and the indicator stays the same.
- **Check-in:** with the project's selfie or GPS setting on (default off, C5), the person marking attendance checks in first: a selfie (downscaled to 320 px) and/or the phone's location, saved as `attendance_checkins/{projectId}_{date}_{uid}`. Demo mode keeps the photo on the device; Firebase mode stores it in Storage (M1.6).

**Why:** §6.3 asks for all four. The behaviour is the same in both data modes, so the offline UI tested now is the one the field will use.

### D-47 Role dashboards brought forward; ECharts
**Source:** the user, via the supervisor, 26 Oct 2026. Home felt empty. Each role should get its own designed dashboard of graphs and summaries (§11.1, §11.1a), built in M1.3 instead of M1.5.
**Rule:**
- **Six dashboards, one per role, each designed for it:**
  - **Owner:** everything.
  - **Accountant:** money in and out, ageing, GST, cash and bank, approvals and payments; Books readiness comes with accounts in M1.5.
  - **PM:** their projects' cost side and attendance, approvals within their limit, deadlines; no billing.
  - **Supervisor:** today's site; no ₹.
  - **Viewer:** totals and charts (D-42).
  - **CA:** accounting totals and exports (D-43).
- **Data:** every figure comes from what the role may read (`canRead` and the rules), through rollups, counts and limited queries (rule 9). The calculations are pure functions in `core/dashboard.ts`, tested against the core totals (DB-001…DB-007).
- **Charts:**
  - ECharts 6.0.0 (R3-3), imported through `echarts/core` with only bar, line and pie, rendered as SVG.
  - The chart code loads after the first paint, so it never holds up the first screen.
  - Every chart has a text label, a "Show as table" view and a CSV download (colour is never the only cue). The palette is design-tokens §4.
- **Click-through:** each KPI opens its records (lists accept `?f.<filter>=` in the URL).
- **Empty states:** lead pipeline and client agreements show a plain empty state until those modules hold data. No figures are invented.
- **Motion:** KPI and chart cards get the 600 ms first-load reveal; KPI cards get the spotlight glow. Charts animate once; nothing animates under reduced motion.

**Why:** the user asked for analytics of everything on Home; §11.1a already specifies role dashboards.

---

### D-48 Super user and the Setup & integrations page
**Source:** the user, via the supervisor, 15 Nov 2026. A small deviation from the PRD's six roles: the PRD has no "super user".
**Rule:**
- A **super user** is an **owner** whose users document says `superUser: true`. The first-owner step makes the first one. Super users can grant or revoke it for other **active owners** (core command `setSuperUser`), and there is always at least one (the last cannot be revoked, switched off or demoted; changing someone's role away from owner clears the flag).
- It is mirrored as the sign-in claim `superUser` (D-05), set with the role claim by the server, and only for owners.
- **Settings > Setup & integrations** (`/settings/setup/`) is for super users only: the menu item is hidden from everyone else, and the address shows "You don't have access". It is enforced in the **rules** (`isSuperUser()`: `integrations` read, `system_probe`) and in the **callables** (the users document is checked, not just the token).
- **Every change** (save, clear, make a new key) needs a sign-in within the last **5 minutes** (`auth_time`), checked on the server; the page asks the person to sign in again and then retries. **Every change writes an audit entry** (who, what, when; field names only, never values).
- **Every item has its own Test** (a Pass or Fail, one plain sentence, a fix hint, and the time it last passed). The page shows "N of M verified" (items whose latest Test passed; WhatsApp does not count).
**Why:** the user wants everything set up from the front end, protected, without editing files or the console for each key.
**Consequence:** the PM, supervisor, accountant, viewer and CA, and an owner who is not a super user, never see or open it. In the demo the owner is a super user and the page runs as a labelled **simulation** (no real secret is stored).

### D-49 Secrets are write-only, in a server-only Firestore document
**Source:** the user, via the supervisor, 15 Nov 2026.
**Rule:**
- Secret values (the Resend key, later the WhatsApp token) are saved by a callable into `private_config/{id}`, which **no client can read or write** (rules `if false`; only the Admin SDK in the functions). A client reads only `integrations/{id}`: the status, a **masked tail** (`••••1234`), the public values and the last Test result. **Secrets are never returned, logged, put in the audit log, or put in the build.**
- The website's inbound key is made by the server, **shown once**, and only its **SHA-256 hash** is kept; the endpoint compares hashes.
- Public values (reCAPTCHA site key, push web key, Maps key, the from-address) may be read by a super user's page.
**Alternatives rejected:** Secret Manager's free tier is **6 active secret versions**, and each rotation adds a version, so six integrations plus rotations would leave the free plan; Firestore costs ₹0 and is encrypted at rest.
**Consequence (I6):** **Firestore backups and exports contain these values.** They must never be written to the CA export or to any client-readable document, and the backup decision (open question I6) must say that backups are sensitive: kept private, never emailed or shared.

### D-50 Where the Firebase web config lives, and what the no-config build does
**Source:** the user, via the supervisor, 15 Nov 2026.
**Rule:**
- The Firebase web config (six public values) cannot be stored in Firestore, because it is needed to connect. **Netlify's Environment variables stay the source of truth** (D-36). The Setup page also lets a super user **paste the config block** (or fill the six fields), validates it, saves it on **this device only** (localStorage), and prints the exact `NEXT_PUBLIC_FIREBASE_*` lines to paste into Netlify for everyone else. The App Check site key works the same way.
- Order of use: the build's variables, then this device's saved config, then none. **Demo mode never activates once any config is present** (D-37). A build with no config at all stays the **demo** (so the owner can open a Netlify demo before any account exists), with a prominent "Connect your own Firebase project" link to the Setup page. "Forget this device's config" is the explicit way back on a device with no build config.
- App Check's enforce switch is **runtime**: the callables read `integrations/appCheck` and refuse calls without a valid App Check token when it is on (Firestore and Storage enforcement is switched in the console, DEPLOY.md).

**Correction to D-46:** the offline queue **stays** in Firebase mode. Callables need a connection, so an offline attendance save is queued on the device, then sent with its own request id, so a retry can never save twice.

### D-51 Spark-only (no payment method): overrides D-34 (Blaze accepted) and the Cloud Functions and Cloud Storage parts of D-36
**Source:** the user, via the supervisor, 16 Nov 2026: the project `ambikagroupscrm` is on the Spark plan and will stay there.
**Facts (official pages, 16 Nov 2026; docs/SPARK-PLAN.md):** Cloud Functions, Cloud Storage and phone-code (SMS) sign-in are not available on Spark. Firestore free: 1 GiB, 50,000 reads and 20,000 writes a day, 1 MiB per document. Email-link sign-in is limited to 5 emails a day.
**Rule (approved architecture A):**
- **Server part:** one Netlify Function running the SAME server code (command runner, posting, numbering, audit, super-user and setup logic, sample data, enquiry endpoint) behind an ID-token check, with the Firebase Admin SDK and a least-privilege service account held only in a Netlify environment variable. Reads stay direct from the browser to Firestore under the rules. Money integrity (D-07, D-08) is unchanged. A "no server at all" design was rejected: browsers would write money postings, numbers and audit.
- **Files:** a storage adapter; the first implementation keeps compressed images in Firestore (under 1 MiB each, aim 80 to 150 KB); Cloudinary or Cloud Storage can replace it later. Aadhaar stays masked (D-22).
- **Sign-in:** phone codes are dropped (supersedes the SMS part of D-35). Staff use Google or email and password set by the owner (a phone-only worker gets a pseudo-email). The email link is for the first owner only.
- **Scheduled jobs:** a Netlify scheduled function nightly plus a catch-up when the owner opens the app. **Backups:** an owner-run JSON download (no managed export or point-in-time recovery on Spark).
- **First owner, two paths:** (1) **rules-based (D-52), no server at all** and the fallback; (2) the Netlify bootstrap, which replaces it later.
- **Also required:** a usage meter for the free limits (reads and writes a day, document count, photos against about 8,000) with warnings at 70% and 90%; cache-first reads; saves shown at once as pending, with confirmation later (the server is in Ohio and the database in Mumbai); a "Download backup" reminder after 7 days.
**Netlify Free** has 300 credits a month as a hard limit (the site is paused at zero); a production deploy costs 15, so the wizard deploys previews first.

### D-52 Roles come from the person's users document (no sign-in claims); the first owner is created by the rules
**Source:** the user, via the supervisor, 16 Nov 2026: make the database work and sign in as admin, with no function.
**Rule:**
- **Roles:** the security rules read the caller's own `users/{uid}` document (role, active, superUser, projectIds) once per request, instead of custom sign-in claims (which need a server to set). Cost: one extra document read per request, counted once however many rules use it. The app reads the same document, so the screen and the rules always agree. `projectIds` replaces the "projects" claim. A switched-off person (`active: false`) is refused everywhere, but can read their own document so the app can say so.
- **First owner, no server:** a person whose **verified** email equals `ownerEmail()` in `firestore.rules` (currently business@ambikagroups.tech, case ignored) writes, in ONE batch, their own users document (role owner, superUser true, active, no projects, no other fields) and the marker `system/owner`. The rules allow it only while `system/owner` does not exist, so it happens once. The client then writes the company placeholders.
- **Why "verified":** an account the owner adds in the console starts unverified; pressing the emailed link verifies it. Requiring this means nobody else can claim the owner address first, even if sign-up is open before the console account exists. After the owner exists, switch off "Enable create (sign-up)" in Authentication > Settings.
- **Owners manage others:** an owner can change another person's role, on/off, projects and contact details, but nobody changes their own role, status, projects or super-user flag (no self lock-out); only a super user changes the super-user flag.
- **Not available without a server:** creating other people's sign-in accounts, all posted records, numbering, rollups and audit (those stay server-only, D-07/D-08, and say plainly that the server part is not connected yet). The built-in expense heads live in the code, so none need to be written first.
**Tests:** docs/rules-test-matrix.md §19 (T-300 to T-396), run on the emulator in CI. Verified so far: the rules text was reviewed and the client is type-checked and built; the real browser job checks the sign-in screen against the real project; the first-owner write itself is verified only on the user's first run.

## Phase 1 notes

Implementation rules that need no rule or model change, but must not be missed when the code is written.

**P1-01 Attendance writes use merge.** The client writes attendance with `set(..., { merge: true })` (or `update`), never a plain `set`. After the trigger stamps `rateSnapshotPaise`, `earnedPaise` and the other server fields, a plain `set` from an offline re-mark would delete them; `untouched()` would then fail and the write would be rejected. The same applies to every document that carries server-written fields.

**P1-02 Offline bill photos.** Cloud Storage doesn't queue uploads offline. The client:
- generates the file name up front (`projects/{pid}/expenses/{expenseId}/{uuid}.jpg`)
- writes that path into `billPaths` in the expense (which Firestore queues)
- keeps the compressed image in IndexedDB until the upload succeeds, retrying when online
A scheduled function flags any `billPaths` entry whose file hasn't arrived 48 hours after the expense synced. The flag feeds the Books readiness card ("Bill photo not uploaded") and the pre-export checks.

**P1-03 `get()` limits on batches.** Repeated `get()`/`exists()` calls on the same document within one request should be de-duplicated. So a one-project "Mark all present" batch should cost four unique lookups (project, roster entry, period lock, settings), plus one roster lookup per worker. Test T-250 confirms how this counts against the 20-lookup batch limit. If it fails, the client writes attendance in chunks, or the bulk action moves to a callable.

**P1-04 Rules expressions to confirm in the emulator.** `fyOf()` uses a conditional expression, integer `%` and `string(int)` inside a function with `let` bindings. All are documented rules features, but this is the first thing the emulator compiles; T-300 to T-305 cover it.
