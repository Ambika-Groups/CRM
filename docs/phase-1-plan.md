# Ambika Group CRM: Phase 1 plan

25 Oct 2026. Phase 0 (documents and mockups) is signed off. Phase 1 is the **Core MVP** from spec §16: auth and roles, clients, projects (both types), workers, attendance, wages, the expense pyramid and Total Spendings screen, and a basic dashboard. Spec v1.1 also places cash and bank accounts, a paid-from account on every entry, and a basic master CSV in Phase 1. **Exit criterion:** used live on one real site for 2–3 weeks.

Coding starts when the items in §1 are in place. Everything follows the Phase 0 documents: [data-model.md](data-model.md), [decisions.md](decisions.md), [rules-test-matrix.md](rules-test-matrix.md), [design-tokens.md](design-tokens.md), [cost-estimate.md](cost-estimate.md) §10 (₹0 rule).

---

## 1. What I need from you to start

### Blocking: needed before any code

Nothing gets installed on your computer: no Java (decisions D-36).

| # | What | Details |
|---|---|---|
| 1 | **GitHub repository** owned by the company (spec §18) | A private repository under the company's GitHub account. It holds the code, runs the free automated tests (GitHub Actions) and feeds Netlify. Leave the account **without a payment method**, so Actions stops rather than charges if its free minutes run out. I make no commits until you say so |
| 2 | **Three Firebase projects** on the Blaze plan, under the company's Google account | Suggested IDs: `ambika-crm-dev`, `ambika-crm-staging`, `ambika-crm-prod`. In each: Firestore **(default)** database in **asia-south1 (Mumbai)** (don't create a named database); Cloud Storage default bucket in **us-central1** (I10); add the developer's Google account as a member |
| 3 | **₹100 budget alert** on each project | Billing → Budgets & alerts, alerts at 50%, 90% and 100% (I8). It only warns; it doesn't stop spending |
| 4 | **Sign-in providers** in each project's Authentication settings | Turn on **Google** and **Email/Password**. Phone: turn on, then set the SMS region policy to allow **India only** (D-35). The Netlify addresses are added to the authorized domains at the first deploy |
| 5 | **Firebase CLI login** | You run `npx firebase-tools login` once on this computer. It uses Node, which is already installed, and opens a browser for your Google account. I can't do that step for you |
| 6 | **Netlify account** linked to the GitHub account (free plan), needed at the first deploy | Use a Netlify team for the CRM only, not shared with the company website: the free plan's 300 credits are per team, and running out pauses every site on it (D-36) |

### Needed during Phase 1 (I'll ask when I reach them)

| When | What | Open question |
|---|---|---|
| Users step | Names, emails or phones and roles of the first users: you, the accountant, the PM, the pilot site's supervisor(s) | C1 |
| Workers step | Worker roles in use, daily rates, overtime rule, how thekedars work | C2, C3, C4 |
| Accounts step | Cash, bank and UPI accounts, with opening balances and the start date | D1 |
| Expenses step | Bill-photo threshold (default ₹2,000), approval limits (default: owner above ₹25,000) | D12, D13 |
| Expenses step | Whether each pilot project claims GST input credit (sets the incl./excl. GST view) | D14 (CA) |
| Wages step | Advances and wage recognition (D7); TDS rates for thekedars (D15) | CA |
| Before the pilot | The pilot site, its workers (Excel is fine), and whether attendance needs selfie or GPS (default off) | H2, C5 |
| Before the pilot | Hindi label check by a team member | I5 |
| Before go-live | Backups decision (I6) and a tested restore | I6 |
| First deploy | Netlify account (blocking item 6) and, optionally, a domain for the CRM; until then a free `*.netlify.app` address | H1, A7 |

Nothing from Phase 2 (company GSTIN, bank details on invoices, CA format) is needed yet.

---

## 2. Repository layout

The app lives in `CRM\`; the Phase 0 files stay where they are.

```
CRM\
  .github\workflows\ci.yml          GitHub Actions: Java 21 + firebase emulators:exec on every push (D-36)
  netlify.toml                      static export publish dir, SPA fallbacks, security headers, /__/auth proxy
  firebase.json  .firebaserc        dev / staging / prod aliases; emulator config (demo-ambika-crm for CI)
  firestore.rules  storage.rules  firestore.indexes.json   (from Phase 0)
  tokens.css                        (from Phase 0; imported by the web app)
  packages\shared\                  TypeScript used by both app and functions:
                                      money (mulDivRound in BigInt), GST per line (D-15),
                                      dates (monthKeyOf, fyOf, IST), phone rule (contract v2),
                                      Indian number formatting, enums, zod schemas per collection
  functions\                        Cloud Functions, 2nd gen, Node + TypeScript, asia-south1
  web\                              Next.js (static export, output: "export") + TypeScript + Tailwind + shadcn/ui (radius 0), next-intl
  tests\rules\                      @firebase/rules-unit-testing: the rules-test-matrix cases
  tests\functions\                  emulator tests for posting, approvals, numbering
  tools\                            seed data (§17 test data), UI check harness, screenshots
  docs\  mockups\                   (Phase 0)
```

---

## 3. Build order

Each step ends with its tests green and a progress folder (§5). A step doesn't start until the one before it is green.

| Step | Build | Done when |
|---|---|---|
| **0. Tooling and CI** | Workspace, TypeScript, lint. **GitHub Actions workflow** (`ci.yml`): `ubuntu-24.04`, `actions/setup-java` Java 21, Node, `firebase emulators:exec --project demo-ambika-crm "npm test"`, raw output uploaded as an artifact. Locally: Node only (unit tests, Next.js dev server against the `dev` project) | The first push runs an empty suite green in Actions; the artifact downloads into `progress\crm\` |
| **1. Rules first** | Load the Phase 0 rules into the emulator, **in CI**. Run **T-300 to T-305** (the rules compile, `fyOf` cases, cross-service Storage lookup), then **T-001 to T-005** (D-21 query shape). If D-21 fails, switch to the `projects` custom-claim fallback and re-run before anything else. Then the rest of the matrix (~265 cases) | All rules tests pass in Actions, or every failure is fixed in the rules and re-tested |
| **2. Shared package** | Money helper, per-line GST, dates, phone rule, formatting, schemas | Unit tests: rounding half-up at the boundaries, BigInt overflow case (~1e17), Indian grouping, FY boundaries (31 Mar / 1 Apr), phone-rule table from the contract |
| **3. Core functions** | User and role callables (claims, `users` mirror, `assignedUsers` → `projectIds`), `createProject` (code counter), category seed, **posting engine** (D-08: re-read source, per-target deltas, zero-delta writes nothing, lock check), rollups and `account_transactions`, `approveRecords` / `rejectRecords` + auto-approve, audit trigger, attendance rate-snapshot trigger, roster snapshots, the single Scheduler dispatcher (D-34), voucher batch | Emulator tests: replayed and out-of-order events converge; moving date, project, category or account moves the amount; a locked month refuses posting; approval thresholds; gapless counters under concurrent calls |
| **4. App shell** | Tokens, component library from the mockups, no-flash theme script and switch (⋮ on phones), navigation by width, sign-in (Google through the `/__/auth` proxy with redirect on phones and the PWA, popup on desktop; email; SMS fallback, D-35), role-based routing, offline persistence, i18n scaffolding (EN/HI). First **staging deploy on Netlify** (branch deploy) to test sign-in for real | UI checks: no overflow at 360 / 768 / 1280 in both themes. **Google sign-in works on a real Android phone and iPhone, in the browser and as an installed PWA** (D-35); if not, the fallback is chosen then |
| **5. Masters** | Users, clients, projects (residential and government, private budget/commercial docs, tabs), workers with KYC (masked Aadhaar only), site roster, rate change requests | Role tests in the UI match the read matrix (data-model §12) |
| **6. Attendance and wages** | Mobile attendance (Mark all present, 3 taps max, offline, merge writes, P1-01), lock window, monthly sheet, worker payments, advances, payout sheet, worker ledger, site workforce view | T-250 batch test; offline mark → sync → posting; wages due on the dashboard |
| **7. Expenses** | Expense entry (offline, bill photos queued in IndexedDB, P1-02), approvals, Total Spendings tree and drill-down chart, category admin and the category-move job | Tree totals equal rollups to the paisa; re-parenting moves totals without rewriting amounts |
| **8. Accounts** | Cash, bank and UPI accounts, opening balances, transfers, cash and bank book, basic master CSV | **Test: CSV totals equal rollup totals** for the same filters (spec §11A.7) |
| **9. Dashboard** | Phase 1 subset: KPIs (D-11), workers today, expense donut, money in hand and bank, approvals, books readiness | Loads from rollups only; under 3 s with the §17 seed data |
| **10. Pilot** | Seed script (§17: 3 projects, 50 workers, 30 days of attendance, 200 expenses), `netlify.toml` finalised (SPA fallbacks, headers, auth proxy), production deploy on Netlify and functions deploy to `prod` (each only with your OK), Netlify domains added to Firebase authorized domains and the OAuth client, Artifact Registry cleanup policy in each project | Running on one real site; the first month's Firebase billing report, Netlify credits and Actions minutes checked against cost-estimate §10 |

---

## 4. Emulator tests: what runs first

All of these run in **GitHub Actions on every push** (D-36); nothing runs on Java locally. Each run's raw output is copied into the milestone's `progress\crm\…\tests\` folder.

1. **T-300 to T-305:** the rules compile; `fyOf` gives `2026-27` for 1 Apr 2026, `2026-27` for 15 Jan 2027, `2099-00` for 2099, `2008-09` for 2008 (zero padding); Storage's cross-service `firestore.get()` works.
2. **T-001 to T-005:** a supervisor's and a PM's single-project queries are allowed through `get()` on the pinned `projectId` (D-21). **Decision point:** if these fail, switch to the `projects` claim fallback before writing any screen that queries.
3. **T-260 to T-270:** period-lock bypass attempts (`monthKey: ".*"`, wrong FY, moving a date into a locked month).
4. **T-276:** one valid create for every collection, to catch any create rule that reads `resource`.
5. **T-250:** a 50-worker attendance batch (the `get()` limit).
6. The rest of the matrix, section by section.

Function tests follow the rules: posting idempotency and ordering first, because everything financial depends on it.

---

## 5. Progress reporting

For every milestone, a new folder `C:\GRIND\AmbikaGroups\progress\crm\<YYYY-MM-DD>_<milestone>\` holds:
- `tests\`: the raw output of every test run (rules, functions, unit, UI checks)
- `ui\`: screenshots named `<screen>-<width>-<theme>[-<state>].png`
- `SUMMARY.md`: what was tested, pass/fail counts, and links to failures

Earlier milestone folders are never changed. `CRM\.screenshots\` is scratch only.

---

## 6. Risks to watch

| Risk | Check | Fallback |
|---|---|---|
| Rules can't prove single-project queries (D-21) | T-001 to T-005 on day one | `projects` custom claim |
| `get()` limit on bulk attendance | T-250 | chunked writes, or a callable |
| Puppeteer image fills Artifact Registry's free 0.5 GB | measured when PDFs arrive (Phase 2) | smaller Chromium build, or render PDFs in a separate project |
| Firestore free quota at pilot | first month's usage report | cost-estimate §10 shows ~3% writes, ~8% reads |
| Hindi strings overflow | UI check harness runs in Hindi too | shorter labels from the I5 review |
| Google sign-in off Firebase Hosting fails on some phone or PWA | step 4 test on real Android and iPhone, browser and installed | Firebase option 4 (self-hosted helper files), or popup on that platform (D-35) |
| Netlify credits run out and pause the site | credits checked monthly; production deploys only on release | wait for the monthly reset, or a paid plan (user decision) |
| Slower feedback: rules tests only in CI | run on every push; unit tests stay local | keep pushes small; failures link to the raw output |
