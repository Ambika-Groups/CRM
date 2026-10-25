# PRD traceability: Ambika Group CRM

Every requirement in *Ambika Group CRM – Product Requirements & Developer Specification* v1.4 (the PDF), section by section from §2 to §19, with its phase (§16), its status and its evidence. Updated at every milestone; this version is **M1.3 (25 Oct 2026)**.

**Status** (supervisor's rule from the M1.1 QA): **tested**: an automated or QA check exercises the PRD behaviour in the UI as well as in core. **built**: it is in the UI. **partial**: some of it is built or proven (for example core logic tested, screen to come); the row says what is missing. **planned**: not started. **done (approved)**: a document or design the user signed off. **Evidence:** a file, a test ID (C-/P-/S-/M-/R9-/R17-/RT-/RL- = `packages/core/test`, T- = `docs/rules-test-matrix.md`, U- = a UI check in the milestone's progress folder; U-qa = an interactive check with an `expect`) or a screenshot. Acceptance criteria and §17 have their own rows, marked **AC**.

Rows are numbered by spec section. Sub-rows (for example R4A-8.T3) split a spec item into separately testable parts. Where a row's work belongs to a later milestone, the milestone is named in the status. M1.2 evidence is in `progress/crm/2026-10-25_m1.2-masters` and M1.3 evidence in `progress/crm/2026-10-25_m1.3-labour` (U-, U-qa: `tools/jobs/make-m1.3.mjs`), which the project supervisor keeps outside this repository.

Spec deviations approved by the user are noted with their decision (D-26 design, D-34 ₹0, D-35 sign-in, D-36 Netlify).

## §2 Users and roles

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R2-1 | Roles: Owner/Admin, Accountant, PM/Site Engineer, Supervisor, Viewer (+ CA, §11A.6) | 1 | built | `core/src/model.ts` ROLES; `core/src/roles.ts`; D-05 |
| R2-2 | Role-based access enforced server-side (Security Rules) | 1 | built (rules), CI tests M1.6 | `firestore.rules`, `storage.rules`; `docs/rules-test-matrix.md` |
| R2-3 | Per-project assignment | 1 | tested | `projects.assignedUsers`; `core/roles.canRead`; M-006 (PM assigned on create), M-022 (roster on assigned sites only) |
| R2-4 | Supervisor: assigned site only, mobile-first; never invoices, payments or accounts | 1 | tested | S-020, RL-01, RL-06; U-qa qa-f9-supervisor-tabs (no Bills or Profit tabs), qa-f10-supervisor-overview (no ₹ figures, the site's day instead), qa-f12-bell |
| R2-5 | Audit log for all financial records | 1 | planned (M1.6) | `audit_log` in data-model; functions trigger |
| R2-6 | Users and roles screen: list; owner-only role change through the `setRole` callable (D-05); demo mode switches role with "Viewing as" | 1 | partial (demo UI tested; the setRole callable is wired with the Firebase adapter in M1.6) | M-030; `components/settings/SettingsPage.tsx` UsersTab; U- settings-users |
| R2-7 | Viewer: read-only reports; Home totals, Projects (progress and budget vs spent, no client contacts), Reports (D-42) | 1 | tested | RL-01, RL-03; rules T-361…T-364; U-qa qa-f6-viewer-menu, qa-f6-viewer-clients, qa-f9-viewer-tabs, qa-f8-viewer-workers, qa-f4-viewer-scope, projects-1280-light-viewer |
| R2-8 | CA: accounting reports and exports only; no leads, no worker ID documents (§11A.6, D-43) | 1 | partial (menu and reads tested; Accounts and Reports screens M1.5) | RL-01, RL-04; rules T-365…T-367; U-qa qa-f7-ca-menu, qa-f7-ca-projects, qa-f7-ca-clients, qa-f8-ca-workers |
| R2-9 | PM: assigned projects only; never rates (rule A); workers limited to their sites' rosters (QA F1) | 1 | tested | M-020, M-023, RL-05; rules T-350…T-360; U-qa qa-f1-pm-workers, qa-f1-pm-other-site-worker, qa-f1-pm-worker, qa-f9-pm-menu, qa-f9-pm-tabs, qa-f9-pm-billing-url, qa-f4-pm-scope |

## §3 Tech stack

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R3-1 | Next.js (React) + TypeScript | 1 | built | `web/` (Next 16, TS), `web/next.config.ts` |
| R3-2 | Tailwind CSS + shadcn/ui | 1 | built | `web/src/app/globals.css` (Tailwind 4 on tokens), `web/src/components/ui/` (shadcn pattern: Radix + cva), D-40 |
| R3-3 | Charts: Recharts or ECharts, sunburst / drill-down donut | 1 | tested | ECharts 6.0.0 via `echarts/core` (bar, line, pie only; loaded after first paint); drill-down donut with breadcrumb; every chart has a table view and CSV; palette validated for colour blindness (design-tokens §4); U-qa dash-drilldown, dashboard-* light and dark |
| R3-4 | Firebase: Firestore, Auth (phone OTP + email), Storage, Functions, Rules | 1 | built (rules, model); adapter M1.6 | D-35 (Google sign-in for site staff instead of OTP) |
| R3-5 | PDF generation in a Cloud Function (Puppeteer) | 2 | planned | D-27 |
| R3-6 | Mobile: installable PWA, offline persistence, FCM push | 1 | built (manifest, service worker); offline data M1.3; FCM M1.6 | `web/public/manifest.webmanifest`, `web/public/sw.js` |
| R3-7 | Hosting: separate dev, staging, prod; daily backups | 1 | built (plan) | D-36 (Netlify front end); I6 backups deferred to before go-live |
| R3-8 | Forms: Web3Forms with webhook to CRM | 3 | planned | Contract v2.1: `submitEnquiry` (D-31) |
| R3-9 | i18n: next-intl or i18next, English/Hindi | 1 | tested | `web/src/i18n/` (i18next, D-38); U- Hindi screenshot |
| R3-10 | Data exportable at any time | 1 | planned (M1.5 CSV) | — |
| R3-11 | App Check: reCAPTCHA v3 provider (free), enforced on Firestore, Storage and Functions; never in demo mode | 1 | planned (M1.6) | D-41 |
| R3-11a | The CSP allows the reCAPTCHA and App Check domains (`www.google.com/recaptcha/`, `www.gstatic.com/recaptcha/` in script-src; `www.google.com/recaptcha/` in frame-src) | 1 | planned (M1.6, with D-41) | `netlify.toml` |

### §3.1 Firebase architecture: mandatory design rules

| ID | Rule | Phase | Status | Evidence |
|---|---|---|---|---|
| R3.1-1 | Access control = Security Rules; role from claim; `assignedUsers`; supervisors never see invoices/payments/accounts; CA read-only; rules tested in the Emulator Suite | 1 | partial (rules draft 3 written; demo matrix tested; emulator tests in CI M1.6) | `firestore.rules` draft 3; `core/roles.canRead`; RL-01…RL-06; rules-test-matrix (T-001…T-367) |
| R3.1-2 | Denormalise: projectId, projectName, party names, categoryPath, rate snapshot | 1 | built | `core/model.ts`; `core/actions.snapshotAttendance`; S-003 |
| R3.1-3 | Expense pyramid via rollups; admin "rebuild rollups" | 1 | partial (rollups tested in core; drill-down screens M1.4, rebuild M1.6) | P-001…P-008, S-010, S-011 |
| R3.1-4 | Money as integers in paise; Indian display | 1 | tested | C-001…C-005 |
| R3.1-5 | Money integrity: transaction, account row and rollup together | 1 | partial (tested in core; entry screens M1.4) | P-001, P-003, S-012 |
| R3.1-6 | Gapless numbering per FY | 1 | partial (format and order tested in core; project codes in the UI; invoice numbers Phase 2) | C-030, S-004; counter transaction M1.6 |
| R3.1-7 | Collection layout (top-level with projectId; small project children as subcollections) | 1 | built | `docs/data-model.md` |
| R3.1-8 | Composite indexes committed | 1 | built | `firestore.indexes.json` (58) |
| R3.1-9 | Aggregates via rollups and count/sum; cursor pagination (25–50) | 1 | tested | `core/query.ts` runQuery/runCount; M-040; R9-01; `usePaged` (25 or 50 per page) in `web/src/data/DataProvider.tsx` |
| R3.1-9a | Rule 9: no page may download a whole collection; every list query has a limit of 1–50; only bounded collections are read whole | 1 | tested | R9-01 (runtime refusal), R9-02 (every `.query(` in pages has a literal limit ≤ 50), R9-03 (whole reads only on SMALL_COLLECTIONS and small project children), R9-04 (no direct store or SDK reads in pages) |
| R3.1-10 | Search via `searchKeywords` | 1 | built (clients, projects, workers) | `core/search.ts`; seed keywords; DataTable search box; roster worker search; U- clients, workers |
| R3.1-11 | Offline persistence for attendance, expenses, DPR | 1 | partial (attendance: offline queue with indicator and sync tested in the demo; Firestore offline persistence M1.6; expenses M1.4, DPR Phase 3) | `lib/queue.ts`, `SyncState.tsx`, D-46; U-qa m13-offline-queued, m13-offline-synced |
| R3.1-12 | Audit log trigger; financial records soft-deleted only | 1 | built (soft delete in posting P-005); trigger M1.6 | P-005 |
| R3.1-13 | Month lock in Rules and Functions (`period_locks`) | 2 | partial (core refusal tested; lock screen Phase 2) | P-006; rules T-260…T-270 |
| R3.1-14 | PDF + tokenised share link | 2 | planned | D-23 |
| R3.1-15 | CA export function; export totals = rollup totals test | 2 | planned (basic CSV M1.5) | — |
| R3.1-16 | Daily backups, PITR, restore test | go-live | planned | I6 |
| R3.1-17 | Cost control: budget alert, small listeners, aggregation queries; cost estimate | 0 | done (approved) | `docs/cost-estimate.md`, D-34 |
| R3.1-17a | Rule 17: small listeners only (single documents or limited queries, never a whole collection) | 1 | partial (static check: no listeners in pages; Firebase listeners M1.6) | R17-01 (no listeners in pages), R17-02 (data-layer listeners are on a doc or a `limit()` query) |
| R3.1-18 | Separate dev, staging, prod projects owned by the client | setup | planned | DEPLOY.md (M1.6) |
| R3.1-P0 | Phase 0: projects, data model sheet, draft rules, cost estimate approved | 0 | done (approved) | `docs/` (approved 25 Oct 2026) |

## §4 Global requirements

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R4-1 | INR, Indian number format, DD/MM/YYYY (inputs), FY April–March | 1 | tested | C-003, C-010, C-012; D-03 |
| R4-2 | Mobile-first supervisor screens, low-end Android, slow networks | 1 | built (shell) | U- 360 px screenshots |
| R4-3 | Search, filter, sort, pagination, Excel/CSV export on every list | 1 | tested (clients, projects, workers, MB); later lists per module | `components/ui/data-table.tsx`; U- clients, projects, workers, project-gov-schedule |
| R4-4 | Uploads: images and PDFs, ≤10 MB, compressed | 1 | built (rules) | `storage.rules`; compression M1.4 |
| R4-5 | Soft delete only for financial records; edits to approved records logged | 1 | partial (soft delete tested in core; expense screens M1.4) | P-005 |
| R4-6 | Light and dark themes fully designed | 1 | tested | U- light and dark screenshots |
| R4-7 | Notifications (§14) | 1–3 | planned | — |

## §4A UI/UX design system (user's direction, brand.md 2.2, D-26)

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R4A-1 | Minimalist, premium; avoid gradients, glow, emoji, clutter | 1 | built | `web/src/styles/ag.css` (approved mockup styles) |
| R4A-2a | Command palette (Ctrl/Cmd+K) | 1 | tested (search and quick actions; more actions arrive with their modules) | `shell/CommandPalette.tsx`; U-qa qa-f4-search, qa-f4-ctrl-k, qa-f4-pm-scope, qa-f4-viewer-scope |
| R4A-2b | Skeleton loaders while data loads | 1 | built | `components/ui/feedback.tsx` Skeleton, on every M1.2 screen |
| R4A-2c | Toast confirmations | 1 | built | `feedback.tsx` ToastProvider (success 4 s, error 8 s, `aria-live`) |
| R4A-2d | Bottom-sheet forms on mobile | 1 | built (dialogs dock to the bottom under 600 px) | `styles/app.css` `.dialog-fixed`; U- project-house-overview-390-light-delete |
| R4A-2e | Initial-based avatars | 1 | built | `AppShell.tsx` `initials()` |
| R4A-2 | One main accent (red, D-26), square corners (D-26), 4/8 grid, line icons (Lucide), tabular figures | 1 | built | `tokens.css`; `web/src/components/shell/Icon.tsx` (lucide-react) |
| R4A-3 | Colour tokens, contrast checks | 1 | tested | `tokens.css`; brand.md measured pairs; axe colour-contrast in U- checks |
| R4A-4 | Light/Dark/System, saved per user, default follows device; visible switch (user) | 1 | tested | `shell/ProfileMenu.tsx`, `ThemeSwitch.tsx`, `lib/theme.ts`; U-qa qa-f2-profile-menu, qa-f2-choose-system (System chosen again after Dark), qa-f2-phone-profile |
| R4A-5 | Sidebar (14 items, role visibility, collapsible to icons), top bar, mobile bottom bar + quick add | 1 | partial (sidebar, collapse, search, bell, profile tested; floating quick add M1.4) | `core/roles.ts`, `AppShell.tsx`; S-020, RT-01, RT-02, RT-03, RL-01; U-qa qa-f3-collapse, qa-f3-collapsed-remembered, qa-f4-*, qa-f12-bell, qa-f2-*; labels D-44 |
| R4A-5a | Top bar: project/site selector | 1 | planned (M1.3, with attendance) | — |
| R4A-5b | Top bar: quick-create button | 1 | partial (quick actions in the command palette; a top-bar button M1.4) | `CommandPalette.tsx` |
| R4A-5c | Top bar: notifications list | 1 | partial (the bell lists what is waiting: approvals, rate proposals, own pending entries; §14 alerts later) | `shell/Notifications.tsx`; U-qa qa-f12-bell |
| R4A-5d | Top bar: profile with role | 1 | tested | `ProfileMenu.tsx` (name, role, theme, language, sign out or switch person in the demo); U-qa qa-f2-profile-menu |
| R4A-6 | Dashboard design: KPI cards, widgets, real data only | 1 | tested | `components/dashboard/` (six role dashboards), every figure from rollups, counts and limited queries; DB-001…DB-007; U-qa dash-consistency, dash-click-*, dash-scope-* |
| R4A-7 | Typography: IBM Plex Sans + Devanagari (D-26), sizes, tabular numerals | 1 | tested | `tokens.css`, `layout.tsx`; plex check in U- |
| R4A-8 | Components: cards, buttons, tables (→ cards on phones), forms, badges, feedback (split below) | 1 | built | `ag.css`, `components/ui/` |
| R4A-8.T1 | Tables: sticky headers | 1 | built | `ag.css` `table.data th { position: sticky }` |
| R4A-8.T2 | Tables: search, filters, sort | 1 | tested | `data-table.tsx`; U- clients, projects (type, status, FY, manager), workers (role, site, thekedar, working) |
| R4A-8.T3 | Tables: server-side pagination, 25–50 per page | 1 | tested | `usePaged`; M-040; R9-02 |
| R4A-8.T4 | Tables: column visibility | 1 | built | `data-table.tsx` Columns menu (Radix DropdownMenu) |
| R4A-8.T5 | Tables: status badges | 1 | built | `StatusBadge` in projects, workers, settings |
| R4A-8.T6 | Tables: row-action menu | 1 | built | `data-table.tsx` rowActions (clients: Edit) |
| R4A-8.T7 | Tables: currency and date formatting | 1 | tested | C-001…C-012; `lib/fmt.ts` |
| R4A-8.T8 | Tables: export | 1 | built | CSV export pages through the query (50 at a time, BOM); `core/csv.ts` C-004 |
| R4A-8.T9 | Tables: cards on phones | 1 | tested | U- clients-360, projects-360, workers-360 |
| R4A-8.F1 | Forms: labels and grouping | 1 | tested | `components/ui/form.tsx` Field; axe label checks in U- |
| R4A-8.F2 | Forms: inline validation | 1 | tested | M-005 (field-by-field messages); U- client-new-1280-light-errors, project-new-1280-light-errors, worker-new-1280-light-errors |
| R4A-8.F3 | Forms: entered data kept on failure | 1 | built | `useForm` keeps values when a command throws |
| R4A-8.F4 | Forms: multi-step only for new project, contract and tender | 1 | built (project); contract Phase 3; tender Phase 2 | `ProjectForm.tsx` (3 steps); every other form is one page |
| R4A-8.F5 | Forms: double-submit protection | 1 | built | `useForm.submit` ignores a second submit while one is running; buttons disabled while saving |
| R4A-8.B1 | Badges: Active, Completed, Delayed, Pending Approval, Paid, Partially Paid, Overdue, Draft, Signed | 1 | built | `feedback.tsx` StatusBadge (14 kinds incl. the nine) |
| R4A-8.FB1 | Feedback: skeletons | 1 | built | see R4A-2b |
| R4A-8.FB2 | Feedback: success and error toasts | 1 | built | see R4A-2c |
| R4A-8.FB3 | Feedback: confirmation dialogs for destructive actions | 1 | tested | `ConfirmDialog` (project delete, archive); U- project-house-overview-1280-light-delete |
| R4A-8.FB4 | Feedback: empty states | 1 | built | `EmptyState`; later project tabs show a plain "coming soon" |
| R4A-9 | Motion 150–200 ms, reduced motion respected | 1 | built | `tokens.css` |
| R4A-10 | Responsive: desktop, tablet, mobile; attendance in under 3 taps per worker | 1 | tested | U- 360/390/768/1280; U-qa m13-three-taps (1 tap per worker for an exception, 2 for overtime plus hours; 2 shared taps) |
| R4A-11 | Accessibility: 4.5:1 contrast, keyboard, labels, no colour-only meaning, full Hindi labels; first screen under 2 s on 4G | 1 | partial | axe on every UI job; contrast table design-tokens §1; U-qa n12-4g-home, n12-4g-attendance (cold load, 150 ms latency, 1.6 Mbps, CPU 4×): cold load with 150 ms latency, 1.6 Mbps and the CPU slowed 4×: Home first screen 1.1–4.2 s across runs (owner and supervisor), attendance 2.1–2.9 s, supervisor dashboard 3.15–3.9 s, owner dashboard with all six charts 4.4–7.3 s. In the demo every query runs in the browser on the slowed CPU; the measurement is repeated against Firebase in M1.6 |
| R4A-12 | One component library on tokens; UI / logic / auth / data separate; role-driven navigation | 1 | built | `packages/core`, `web/src/data/` (DataSource), `components/ui` |
| R4A-13 | Phase 0 designs approved before the component library | 0 | done (approved) | `mockups/` approved 25 Oct 2026 |
| R4A-14 | No developer jargon on screen: no "§" or milestone names; unbuilt parts say "coming soon"; none left at the end of Phase 1 | 1 | tested (every UI job) | `tools/ui-check.mjs` jargon grep over text, labels, titles, placeholders; U- "Jargon hits: 0" |
| R4A-15 | A branded "page not found" in English and Hindi, inside the app shell (QA F13) | 1 | tested | `app/not-found.tsx` → `404.html`; U-qa qa-f13-not-found (EN 1280, HI 390) |
| R4A-16 | Every menu item and tab shown can be opened by that role; a restricted page opened by URL says "You don't have access" in plain words, never a misleading empty state (QA F8, F9) | 1 | tested | `core/roles.canOpen`, `projectTabsFor`; RL-01, RL-02; U-qa qa-f8-*, qa-f9-* |
| R4A-17 | No false zeros: a figure a role can't read is not shown (QA F10) | 1 | tested | `ProjectView.tsx` SiteDay, `HomePage.tsx` summary; U-qa qa-f10-supervisor-overview |
| R4A-18 | A missing record says "Not found"; "You don't have access" only for a real permission block (QA note after N1) | 1 | tested | `DataSource.docStatus`; U-qa nf-missing-client, nf-missing-project, nf-denied-project |
| R4A-19 | Look: brand.md v4.1 (palette #F12136, #B23A48, #FCB9B2, #FED0BB; rounded; Inter Tight, Inter, JetBrains Mono; calm motion) in both themes | 1 | tested (axe contrast in light and dark on every job) | `tokens.css`, `styles/v4.css`, `styles/dashboard.css`, design-tokens.md draft 2, D-26 |

## §5 Module 1: Projects

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R5.1 | Project list: name, type, client, location, status, progress, budget, spent, billed, received, manager; filters | 1 | tested | `ProjectsPage.tsx` (filters type, status, FY, manager; billed and received for finance only, budget and spent also for the PM and the viewer); U- projects-*, projects-1280-light-pm, projects-1280-light-viewer. The "Coming soon" QA saw was the older M1.1 preview build |
| R5.2 | Create project step 1: common fields; code AG-P-0001 | 1 | tested | M-004…M-007; QA N1 re-test (save → reload); U-qa n1-project-create, n1-project-edit, n1-project-delete, n7-not-entered |
| R5.3 | Step 2A residential fields | 1 | partial (fields tested; approval file uploads M1.4) | M-001; units with status, RERA, approvals checklist with dates, milestone schedule, contract type, DLP, handover; U- project-apt-*, project-house-* |
| R5.4 | Step 2B government fields | 1 | partial (fields tested; insurance and compliance documents with expiry dates and §14 alerts come with uploads in M1.4) | M-001, M-008; U- project-gov-* |
| R5.4-T | Tender register, EMD, guarantees, EOT and hindrance (v1.3) | 2 | planned | — |
| R5.5 | Project detail tabs (12) and Overview | 1 | partial (12 tabs; Overview has "Workers today" (M1.3); "Recent activity" on the project comes with the activity feed in M1.5) | `ProjectView.tsx`; U- project-overview-1280-light-workers-today |
| AC5.6-1 | Selecting a project type shows only that type's fields | 1 | tested | M-001; wizard step 2 shows the type's form only |
| AC5.6-2 | A project with expenses or invoices can't be deleted (archive only) | 1 | tested | M-002; U- project-house-overview-1280-light-delete |
| AC5.6-3 | Project profit = received (or billed) − total expense, live | 1 | tested | M-003; P&L tab toggle; U- project-house-pnl |

## §6 Module 2: Workforce, attendance and wages

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R6.1 | Worker master fields; thekedar; KYC | 1 | partial (fields, KYC and saving tested; photo and ID-proof upload come with uploads in M1.4, QA N3) | M-020, M-021, M-023; QA N1 re-test; U-qa n1-worker-create, n1-worker-edit |
| R6.2 | Pay types: daily (half-day 50%, OT), contract/thekedar, monthly; per-project pay type | 1 | built (core tested; the pay-terms dialog and contract screens are built, contracts UI-checked) | L-001 (OT per hour or multiplier, half day), L-002 (per-project terms, monthly ÷ 26), L-003, L-025 (lump sum and per unit with milestones); U-qa m13-contract-new; defaults C8, C9 |
| R6.3 | Attendance per project per day; bulk mark; offline; lock window; monthly sheet | 1 | partial (marking, mark all, lock and owner unlock, offline queue, last-write-wins audit and the monthly sheet tested; the selfie and GPS capture flow is built and checked on a real phone in M1.6) | L-010…L-013, D-46; `AttendancePage.tsx`, `AttendanceSheet.tsx`; U-qa m13-three-taps, m13-attendance-saved, m13-offline-*, m13-locked, m13-owner-unlock, m13-unlocked-sup; U- sheet-* |
| R6.4 | Wages auto-calculation; payments; advances ledger; per-worker ledger; payout sheet; thekedar ledger | 1 | partial (all tested; the payout sheet prints now, its PDF and WhatsApp share are Phase 2) | L-020…L-026, D-45; `PaymentsPage`, `PaymentForm`, `PayoutPage`, `WorkerMoney`; U-qa m13-payment-pending, m13-payment-approve, m13-mark-paid, m13-contract-new |
| R6.5 | Site workforce view; wage payments create Labour expenses automatically | 1 | tested | L-030 (money only for finance), L-031 (every approved wage, bonus and thekedar bill is one Labour expense for its gross, no second cash entry); `SiteWorkforce.tsx`; U-qa m13-workforce-summary, m13-no-money-* |

## §7 Module 3: Expenses (pyramid)

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R7.1 | Self-referencing category tree, ≥4 levels, admin-editable, §7.1 seed | 1 | partial (tree tested in core; category screen M1.4) | C-050, C-051, C-052; `core/categories.ts` |
| R7.2 | Expense entry fields; approval workflow; recurring templates; credit purchases to vendor ledger | 1 | partial (posting tested in core; expense screens M1.4) | P-005, P-008; screens M1.4 |
| R7.3 | Total Spendings: tree, drill-down chart, summary tabs, filters, export | 1 | planned (M1.4) | mockup `expenses.html` |
| AC7.4-1 | Totals roll up at every level and match to the paisa | 1 | partial (tested in core; drill-down screen M1.4) | C-051, S-010, S-011 |
| AC7.4-2 | Changing a category's parent re-rolls totals without data loss | 1 | partial (tested in core; category screen M1.4) | P-020 |
| AC7.4-3 | Wage and vendor payments appear without re-entry | 1 | partial (wages tested in core; vendor payments Phase 3) | P-010, S-013 |

## §8 Module 4: Billing

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R8.1 | Client master | 1 | tested | M-010, M-011, L-040 (sample data valid, landlines accepted); QA N1 re-test; U-qa n1-client-create, n1-client-edit, n2-sample-client-saves |
| R8.2 | Quotations: items, library, sections, terms, versions, convert, PDF | 2 | built (numbering) | C-030 (`quotationLabel`) |
| R8.3 | Invoices: types, gapless FY numbers, GST CGST/SGST/IGST, deductions, words, status, lock | 2 | partial (tested in core; invoice screens Phase 2) | C-020…C-023, S-004, S-014 |
| R8.4 | Invoice and quotation design (A4, brand accent, templates) | 2 | built (mockup) | mockup `invoice.html` |
| R8.5 | WhatsApp share (wa.me + tokenised link), Web Share API, templates, share log | 2 | planned | D-23 |
| R8.6 | Payments received; receipt PDF; billed/received/outstanding/overdue with ageing; retention and TDS heads | 2 | partial (posting tested in core; payment screens Phase 2) | S-014 |

## §8A Contract generator

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R8A.1–6 | Types, creation flow, fields, clause library, signature workflow, tracking | 3 | planned | data-model `agreements`; mockup `contract.html` |
| AC8A.7-1 | Contract PDF from a template in under 10 seconds | 3 | planned | — |
| AC8A.7-2 | Sharing through the same WhatsApp flow, tokenised link | 3 | planned | — |
| AC8A.7-3 | Contracts searchable by project, party, type, status | 3 | planned | — |
| AC8A.7-4 | Signed contracts, amendments and stamp records stored and undeletable | 3 | built (rules) | `firestore.rules` agreements |

## §9 Purchases, vendors, stock, machinery

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R9.1 | Vendors and vendor ledger | 3 | built (model, payable posting) | P-008 |
| R9.2 | Material request → PO → GRN → bill → payment; bill matching; rate history | 3 | planned | — |
| R9.3 | Stock: per site, transfers, wastage, low stock, consumption; v1.3 rules | 3 | planned | rules (fix 5) |
| R9.4 | Machinery: register, usage, maintenance; v1.3 rules incl. rent calculation | 3 | planned | rules (fix 3) |

## §10 Sales, leads, calendar, tasks

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R10.1 | Leads pipeline, kanban, activities, convert to client + project; tender tracker (D-18) | 3 | planned | contract 2.1 |
| R10.2 | Calendar views and deadlines | 3 | planned | — |
| R10.3 | Tasks | 3 | planned | — |
| R10.4 | DPR | 3 | planned | — |

## §11 Dashboard and reports

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R11.1-KPI | KPIs: active, completed, delayed, total expense, billed, received, outstanding, net profit | 1 | tested | `Dashboard.tsx`; each opens its records (projects filtered by status or delay, clients, payout, the expense chart); U-qa dash-consistency, dash-click-active, dash-click-delayed, dash-period |
| R11.1-W | Widgets 1–11 | 1 | tested (lead pipeline and client agreements show a plain empty state until those modules have data) | `dashboard/Widgets.tsx`: projects, workers today, to receive / to pay, cash and bank, pay this week, spend tracker, top 5, GST, approvals, deadlines, activity, contracts; U- dashboard-* |
| R11.1-P | Dashboard under 3 s using rollups; global filters | 1 | partial | period selector (today, week, month, FY, custom), FY and project filters; U-qa dash-period, dash-4g-owner, dash-4g-supervisor: cold load with 150 ms latency, 1.6 Mbps and the CPU slowed 4×: Home first screen 1.1–4.2 s across runs (owner and supervisor), attendance 2.1–2.9 s, supervisor dashboard 3.15–3.9 s, owner dashboard with all six charts 4.4–7.3 s. In the demo every query runs in the browser on the slowed CPU; the measurement is repeated against Firebase in M1.6 |
| R11.1a | Definitions; To receive / To pay; clickable KPIs; cash/bank cards; spend tracker; top 5; books readiness; GST snapshot; quick actions; role dashboards; period selector; mobile layout | 1 | partial (all built and tested except Books readiness, which comes with accounts in M1.5) | six designed role dashboards (owner, accountant, PM, supervisor, viewer, CA), each from what the role may read; U-qa dash-scope-pm, dash-scope-supervisor (no ₹), dash-scope-viewer, dash-scope-ca; U- dashboard-<role>-390/1280-light/dark |
| R11.2 | Reports list (P&L, budget vs actual, registers, ledgers, ageing, GST, TDS, stock, machinery, RA/MB, DPR, leads) | 1–4 | planned | — |

## §11A CA export pack

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R11A.1 | Export screen, inputs, warnings, export log | 2 | planned | — |
| R11A.2 | Master CSV columns and rules (BOM, decimals, ISO dates) | 1 (basic) | built | `core/csv.ts` MASTER_COLUMNS, C-004 |
| R11A.3 | ZIP package | 2 | planned | — |
| R11A.4 | Data captured: paid-from account, GST, TDS, bills, cash/bank book, advances, month lock | 1–2 | built (model, posting) | S-012 |
| R11A.5 | Pre-export checks | 2 | planned | — |
| R11A.6 | CA role | 2 | built (role, nav) | S-020 |
| AC11A.7-1 | Export totals equal dashboard totals, to the rupee | 1 (basic) | planned (M1.5) | — |
| AC11A.7-2 | Every expense, wage, payment, invoice and receipt appears in the master CSV exactly once | 1 (basic) | planned (M1.5) | `core/csv.parseCsv` ready for the test |
| AC11A.7-3 | Opens in Excel and Google Sheets with Hindi intact | 1 (basic) | built (BOM) | `core/csv.ts` |
| AC11A.7-4 | The CA reviews a sample month | 2 | planned | — |
| AC11A.7-5 | One-year export of 20,000 rows within 30 s or in background | 2 | planned | — |

## §12 Data model

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R12-1 | Collections and key fields (incl. v1.1 accounting and v1.3 additions) | 0 | done (approved) | `docs/data-model.md`; `core/model.ts` |

## §13 Integrations

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R13.1 | Website enquiry → lead with follow-up task; dedup by phone; spam protection; retries; HTML snippet | 3 | built (phone rule) | C-040; contract 2.1 |
| R13.1a | Inbound API: the website's own back end forwards accepted enquiries to the CRM (`submitEnquiry` called server to server; same fields, phone rule and lead creation as §13.1; contract version 3) | 3 | planned | `docs/shared/enquiry-form-contract.md` v3 |
| R13.1b | Outbound API: the website can ask the CRM which projects exist and which are completed (for its portfolio) | 3 | planned | supervisor note, 26 Oct 2026 |
| R13.2 | WhatsApp, Excel/CSV import/export, Tally (Ph4), UPI QR, email, Maps | 1–4 | planned | — |

## §14 Notifications

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R14-1 | The alert list incl. v1.3 additions; in-app and email in v1 | 1–3 | planned | Scheduler dispatcher (D-34) |

## §15 Non-functional

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R15-1 | Security: HTTPS, rules per role/project, private storage, rate limiting | 1 | built | rules; `netlify.toml` headers |
| R15-1a | Netlify: no failed requests on page loads (prefetch files flattened, QA F5); Next pinned to 16.4.3; Node pinned; Next.js plugin off | 1 | tested | `web/scripts/flatten-segment-prefetch.mjs` (copied from the website); `netlify.toml`; every UI job fails on any 4xx/5xx or failed request; U-qa qa-f5-home-requests |
| R15-1b | Saved data is durable: every create, edit, delete and approve survives an immediate reload (QA N1) | 1 | tested | `core/persist.ts` (PS-01…PS-04); every demo command awaits the save; client-side navigation; U-qa n1-*, m13-attendance-saved, m13-payment-*, m13-mark-paid, m13-contract-new, m13-owner-unlock |
| R15-2 | Performance: pages under 2 s on 4G; dashboard under 3 s; server-side pagination | 1 | partial | U-qa n12-4g-*, dash-4g-*: cold load with 150 ms latency, 1.6 Mbps and the CPU slowed 4×: Home first screen 1.1–4.2 s across runs (owner and supervisor), attendance 2.1–2.9 s, supervisor dashboard 3.15–3.9 s, owner dashboard with all six charts 4.4–7.3 s. In the demo every query runs in the browser on the slowed CPU; the measurement is repeated against Firebase in M1.6 |
| R15-3 | Reliability: backups, restore test, uptime monitoring | go-live | planned | I6 |
| R15-4 | Offline: attendance, expense drafts, DPR | 1 | partial (attendance offline queue tested; expense drafts M1.4; DPR Phase 3) | `web/public/sw.js`, `lib/queue.ts`, D-46 |
| R15-5 | Scalability: 50+ projects, 2,000+ workers, 5 years | 1 | built (design) | cost-estimate §2–§3 |
| R15-6 | Compatibility: latest browsers, Android 9+, iOS 14+ | 1 | planned (device test M1.6) | — |
| R15-7 | Compliance: GST fields; worker ID data restricted | 1 | built | D-22, rules |
| R15-8 | Maintainability: typed code, migrations, README, setup guide, API docs, seed script | 1 | built (typed, seed); docs M1.6 | `packages/core/src/demo/seed.ts` |

## §16 Phased delivery

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R16-0 | Phase 0 exit: signed-off wireframes and spec | 0 | done (approved) | approved 25 Oct 2026 |
| R16-1 | Phase 1 exit: used live on one site for 2–3 weeks | 1 | planned | — |
| R16-2…4 | Phases 2–4 exits | 2–4 | planned | — |

## §17 Acceptance and testing

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| AC17-1 | Each module: user stories, manual test cases, automated tests for calculations (wages, GST, roll-up) | all | tested (core calcs) | C-, P-, S-, M-, L-, DB-, PS-, R9-, R17-, RT-, RL- tests (106 at M1.3) |
| AC17-2 | Test data: 3 projects (2 residential, 1 government), 50 workers, 30 days of attendance, 200 expenses, 10 invoices | 1 | tested | S-001, S-002; demo mode |
| AC17-3 | UAT with owner, accountant, one supervisor before each release | all | planned | — |
| AC17-4 | Known-issues list; 30-day warranty | all | planned | — |

## §18 Deliverables

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R18-1 | Source in a client-owned Git repo | setup | built (repo-ready, no commits) | `CRM\` |
| R18-2 | Staging and production deployed | setup | planned | DEPLOY.md (M1.6) |
| R18-3 | Data model sheet, rules with tests, indexes, seed scripts | 1 | built | docs, rules, indexes, `core/demo/seed.ts` |
| R18-4 | Admin and user guide (EN/HI), training videos | 4 | planned | — |
| R18-5 | API/technical docs, setup guide | 1 | planned (M1.6) | — |
| R18-6 | Backup and restore procedure | go-live | planned | — |
| R18-7 | Design files and templates | 0 | done (approved) | `mockups/` |

## §19 Open questions

| ID | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|
| R19-1 | All §19 questions answered or defaulted | 0 | tested (defaults editable) | `docs/open-questions.md`, `docs/defaults-applied.md`; Settings → Rules and limits, Worker roles, Company details (placeholders B1–B5); U- settings-* |

---

## Changed at M1.1
Rows moved from planned to built or tested: R2-1, R2-3, R2-4, R3-1, R3-2, R3-6, R3-9, R3.1-2…R3.1-6, R3.1-12, R3.1-13, R4-1, R4-2, R4-5, R4-6, R4A-1…R4A-12, R5.2, AC5.6-3, R6.1…R6.5, R7.1, R7.2, AC7.4-1…AC7.4-3, R8.1, R8.2, R8.3, R8.6, R9.1, R11.1-KPI, R11.1-P, R11.1a, R11A.2, R11A.4, R11A.6, AC11A.7-3, R13.1, R15-1, R15-2, R15-4, R15-5, R15-8, AC17-1, AC17-2, R18-1, R18-3, R19-1.

## Changed at M1.2
- **Status rule:** tested now means a UI check as well as core (supervisor, after the M1.1 QA). Rows proven only in core are now **partial** with the missing screen named: R3.1-3, R3.1-5, R3.1-6, R3.1-13, R3.1-17a, R4-5, R6.2, R6.4, R6.5, R7.1, R7.2, AC7.4-1…3, R8.3, R8.6, R2-6, R4A-10, R5.3, R15-2. Signed-off documents are **done (approved)**.
- **Corrected after QA:** R4A-4 was "tested" but failed (F2); now built and tested. R4A-5 was "tested" but the sidebar didn't collapse and search did nothing (F3, F4); now tested, except the floating quick add (partial).
- **New rows:** R2-6…R2-9, R3-11 (App Check, D-41), R3-11a (CSP for App Check, M1.6), R3.1-9a (rule 9), R3.1-17a (rule 17), R4A-2a…R4A-2e, R4A-5a…R4A-5d, R4A-8.T1…T9, F1…F5, B1, FB1…FB4 (R4A-8 split), R4A-14 (no jargon), R4A-15 (404), R4A-16 (no menu item or tab a role can't open), R4A-17 (no false zeros), R15-1a (Netlify requests).
- **Moved to built or tested:** R2-3, R2-4, R3.1-9, R3.1-10, R4-3, R4A-4, R4A-5d, R5.1, R5.2, R5.4, R5.5, AC5.6-1…3, R6.1, R8.1, AC17-1, R19-1.
- **Still open from M1.2:** approval file uploads (with Storage uploads, M1.4); the role-change callable and the emulator rules tests run with the Firebase adapter and CI (M1.6).

## Changed at M1.3
- **Labour (§6.2–§6.5):** R6.2 built; R6.3 partial (check-in capture checked on a phone in M1.6); R6.4 partial (payout PDF share Phase 2); R6.5 tested. Decisions D-45 (money on workers is finance-only) and D-46 (attendance writes).
- **Dashboard brought forward from M1.5 (§11.1, §11.1a):** R3-3, R4A-6, R11.1-KPI and R11.1-W tested; R11.1a partial (Books readiness M1.5); R11.1-P per the 4G result.
- **QA N1–N13:** R5.2 and R8.1 tested again after the N1 re-test; R6.1 partial (uploads M1.4, N3); R5.4 partial (government documents M1.4); R5.5 partial (recent activity on the project M1.5, N4); R4A-10 tested (3 taps); R4A-11 and R15-2 per the 4G result (N12).
- **New:** R15-1b (durable saves), R4A-18 (Not found), R4A-19 (brand v4.1).
