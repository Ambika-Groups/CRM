# Defaults applied

Updated at M1.3, 25 Oct 2026. The user asked for the CRM to be built without waiting on answers. Every open question with a documented default uses that default, listed here. Each one becomes **editable in Settings** where the spec puts it. Settings is built (M1.2): Company details, Users and roles, Worker roles, Rules and limits (the "Operations" rows below) and Numbering. Numbering is shown read-only until invoices arrive in Phase 2, so a format can't be changed before it can be checked against issued numbers. Each setting is used from the milestone in the last column. Nothing here is final until the user (or their CA or advocate) confirms it.

| Ref | Question | Default applied | Where it lives | Editable in Settings | First used |
|---|---|---|---|---|---|
| B1 | Legal name | "Ambika Group [legal name to be confirmed]" | `settings/company.legalName` | Company details (owner) | M1.2 |
| B2 | GSTIN, PAN, address, state | Placeholders `[GSTIN to be confirmed]`…; state code **09** (Uttar Pradesh, from the Lucknow sites in the spec's context) | `settings/company` | Company details | M1.2 (invoices Phase 2) |
| B3 | Bank and UPI for invoices | Placeholders | `settings/bank` | Bank details (owner, accountant) | Phase 2 |
| B4 | Logo, signature, stamp | "AG" text mark; no signature or stamp | `settings/company` paths | Company details (uploads) | Phase 2 |
| B5 | Brand colour | **Red** (answered) | `settings/company.brandColor = #C62828` | Company details | M1.1 |
| C1 | Users at launch | Demo: one user per role (7 users, 2 supervisors) | `users` | Users and roles (owner) | M1.2 |
| C2 | Worker roles | Spec §6.1 list (Mistri, Labour, Helper, Operator, Driver, Electrician, Plumber, Carpenter, Bar-bender, Supervisor, Other) + Thekedar | `settings/operations.workerRoles` | Worker roles | M1.2 |
| C3 | Daily rates, overtime | Demo rates: mistri ₹800–850, labour ₹500, helper ₹450, operator ₹700. **Overtime = daily rate ÷ 8 per hour** when no OT rate is set. Half-day = 50% (spec §6.2) | worker `defaultRatePaise`, `otRatePaise`; `core/wages.defaultOtRatePaise` | Worker and project pay terms (finance only, D-32) | M1.1 (seed), M1.3 |
| C4 | Thekedar structure | Thekedar is a worker record; their crew is linked by `thekedarId`; paid by weekly thekedar bill (D-29) | `workers` | — | M1.1 (seed), M1.3 |
| C5 | Selfie / GPS at attendance | **Off** for every project | `projects.attendanceRequiresSelfie/Gps = false` | Per project | M1.3 |
| C6 | Attendance lock window | **3 days** | `settings/operations.attendanceLockDays` | Operations | M1.3 |
| C8 | Monthly salary | Monthly staff earn **salary ÷ 26 working days** for each day present (half a day for a half day). Leave and absence are unpaid, and monthly staff get no overtime | `wages.ts` `MONTHLY_WORKING_DAYS` | Per worker or per site (pay terms) | M1.3 |
| C9 | Overtime | Either a fixed rate per hour, or a **multiple of the hourly rate** (daily ÷ 8), e.g. 1.5×. With neither set: daily ÷ 8 per hour (C3) | `workers/{id}/private/pay`, `project_terms` | Pay on each site (finance) | M1.3 |
| C10 | Advance recovery on a payout | Up to **₹1,000 per worker per payout**, never more than the advance outstanding or the wages due; editable on the sheet | `payoutSheet(recoverCapPaise)` | Per row on the payout sheet | M1.3 |
| C11 | Attendance unlock | The owner unlocks a locked day for **24 hours**, with a reason (audited) | `attendance_unlocks` | — | M1.3 |
| C12 | Payment approvals | Owner and accountant entries up to **₹25,000** are approved at once; above that, and any thekedar bill above its contract value, the owner approves (D-45) | `settings/operations.autoApproveLimitPaise` | Rules and limits | M1.3 |
| C7 | Website enquiry alerts | Owner is the default follow-up person | `users.defaultSalesUser` | Users | Phase 3 |
| D1 | Cash, bank, UPI accounts | Demo: Cash in hand, SBI current, HDFC current, with opening balances | `accounts` | Accounts (owner, accountant) | M1.1 (seed), M1.5 |
| D6 / D-15 | GST rounding | **Per line**, half-up to the paisa; totals are sums of lines; grand total rounded to the rupee with a Round off line; deductions rounded to the rupee | `core/gst.ts` | Not a setting (CA to confirm) | M1.1 (core), Phase 2 |
| D7 / D-16 | Advances and wage recognition | Advance is **not** an expense until recovered or written off; wages are expensed **when paid** (gross), cash moves the net; **Wages due** shown beside expense | `core/posting.ts`, `core/actions.ts` | Not a setting (CA to confirm) | M1.1 (core), M1.3 |
| D8 / D-12 | Number formats | `AG/{fy}/0001` invoices, `CN/` `DN/` `RV/` GST notes and vouchers, `AG/PF/` proforma, `AG/R/` receipts, `AG/Q/` quotations, `AG/C/` agreements, `AG-P-0001` projects, `V/{fy}/00001` vouchers | `core/numbering.ts`, `settings/numbering` | Numbering (owner); GST formats checked ≤16 characters | M1.1 (core) |
| D12 | Bill-photo threshold | **₹2,000**: above it, an expense needs a bill photo or a "no bill" reason | `settings/operations.missingBillThresholdPaise` | Operations | M1.4 |
| D13 / I2 | Approval limits | Everything a **supervisor** enters needs approval. A **PM** approves on assigned projects up to **₹25,000**; above that, the **owner**. Owner and accountant entries under **₹25,000** are auto-approved (D-30) | `settings/operations.expenseApprovalThresholds` | Approvals | M1.4 |
| D14 | Total expense incl./excl. GST | Per project `itcEligible`: **government projects true** (shown excl. GST), **residential false** (incl. GST) | `projects.itcEligible` | Per project | M1.4, M1.5 |
| D15 | TDS on thekedars (194C) | **1%** individual/HUF, **2%** others, **20%** without PAN | `workers/{id}/private/kyc.tdsRateBp` | Per thekedar (finance) | M1.3 |
| D16 | GST on client advances | Receipt voucher `RV/` with GST on the advance (D-16c) | — | — | Phase 2 |
| E3 | Delay penalty | Recorded per project and contract when entered; no default rate | `private/commercial.ldRatePerDayPaise` | Per project | Phase 2/3 |
| E4 | EMD refund alert | **30 days** after the tender result | `settings/operations.emdRefundAlertDays` | Operations | Phase 2 |
| G1 | Reorder levels | None set (no alerts until entered) | `materials.reorderLevels` | Materials | Phase 3 |
| I1 | Share-link expiry | **30 days**, revocable | `settings/operations.shareLinkDays` | Operations | Phase 2 |
| I3 | Viewer access | **Totals and reports only**: no individual expenses, no bill photos (rules fix 8) | `firestore.rules`, `storage.rules`, `core/roles.canRead` | Not a setting (rules) | M1.1 |
| I4 | Company overheads with no project | **Yes**, recorded under a "Head office" view (finance roles only) | expenses with `projectId: null` | — | M1.4 |
| I6 | Backups | Deferred to before go-live (answered); nothing scheduled in the build | DEPLOY.md | — | Before go-live |
| I7 | Warm PDF server | **No** (answered) | functions config | — | Phase 2 |
| I8 | Budget alerts | **₹100 per project** (answered) | DEPLOY.md step | — | Setup |
| I9 | Sign-in | Google for site staff, email for office, SMS fallback limited to India (answered, D-35) | Auth settings | — | M1.6 |
| I10 | Storage location | us-central1; masked Aadhaar only (answered, D-22) | DEPLOY.md, KYC upload hint | — | M1.2, M1.6 |
| — | Language default | English; each user can switch to Hindi; Western digits in Hindi | `users.language`, `ag-lang` | Profile | M1.1 |
| — | Theme default | Follows the device; switch in the top bar (⋮ menu on phones); Light / Dark / System in the profile | `users.theme`, `ag-theme` | Profile | M1.1 |
| — | Working week (demo) | Sundays off: the 30 days of attendance are 30 working days | `core/demo/seed.ts` | — | M1.1 |
| — | Cash limit in the demo | Expenses over ₹10,000 aren't paid in cash (Income Tax Act s.40A(3)) | `core/demo/seed.ts` | — | M1.1 |
