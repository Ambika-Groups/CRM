# CRM checkpoint — 26 Oct 2026

M1.3 is accepted, pending QA. Work paused part-way into **M1.6** (Firebase mode, the user's own data). The demo build is unaffected: it builds, and every test passes.

| Check | Result |
|---|---|
| `npm test` (core) | 118 / 118 pass (11 files; SV-01…SV-22 are new) |
| `npm run typecheck` | 0 errors (core and web) |
| `npm run build:web` | builds; demo static export in `web/out` |

## Where M1.6 stands

### Done
- **Owner-dashboard fixes**, the supervisor's 5 items, all checked by `tools/jobs/make-m1.6.mjs`:
  1. **No KPI truncates.** The figure scales with its card in the short form (−₹37.26 L), and the full amount is in its tooltip. Checked at 360, 390, 768, 1024, 1280 and 1440, in light and dark, and in Hindi.
  2. **GST.** When input exceeds output, the card shows "GST credit ₹…": positive, in plain words. Wages paid ahead are never shown as a negative "to pay".
  3. **Donut.** Slices under 3% get no label; the legend and the table carry them. Labels never overlap, and the legend arrows use the theme colours.
  4. **Spending.** The card reads "Up 114.9% on last month" (or "Down …"), with an arrow, and no ₹ on a percentage.
  5. **Workers today.** When nothing is marked, it shows "No attendance marked yet today", with the per-site links.
- **Accessibility at 1440.** The search button's visible text now matches its name, which clears axe's `label-content-name-mismatch`.
- **Lazy dashboard cards (performance, part 1).**
  - Cards below the KPIs mount, read their data and load ECharts only as they scroll near the view, and only after the KPI figures have arrived (2.5 s at most). This is `Later` in `web/src/components/dashboard/Chart.tsx`.
  - KPI links to a chart (#chart-…) still work.
  - The UI harness scrolls the lazy cards into view before its checks; `noReveal` turns that off for timing jobs.
- **Core server runner** (`packages/core/src/runner.ts`, `server.ts`), free of any Firebase import:
  - `MemoryStore` journal and rollback: a command changes everything or nothing.
  - `runCommand`: one audit entry for every command that doesn't write its own. Demo mode already uses it.
  - `LoadingStore` and `runWithLoads`: run a command, load what it missed in one batch, and run again.
    - Parity tests show the same documents as the demo, to the paisa, for posting, numbering, attendance, payments, contracts and assignments.
    - Hinted lists read only the matching documents.
  - `claimsFor` and `usersToResync`: role and projects claims.
  - `firstOwnerDocs`: the first-owner bootstrap. It creates the user, the settings and the expense heads, and no sample data.
- **List hints** on the larger `store.list` calls: worker_payments and contract_measurements by contract; expenses and invoices by project; projects by client; owners by role.

### In progress: nothing half-written
The server pieces stop at core. No Firebase file exists yet; `web/src/data/firebase/firebaseSource.ts` is still the stub.

### Not started
- The `functions/` workspace
- `FirebaseSource` and the sign-in screens
- `firebase.json`, `firestore.indexes.json`, `storage.rules`
- App Check
- `.env.example`
- `DEPLOY.md`
- CI (`.github/workflows`)
- The M1.6 progress folder and SUMMARY

## Next 5 steps to resume
1. **`functions/` workspace.**
   - Pin `firebase-functions` 7.4.0, `firebase-admin` 14.5.0 and `esbuild` 0.28.2. esbuild bundles `@ag/core` into `lib/index.js`, because Cloud Build can't resolve workspace packages.
   - Callables:
     - `command`: `runWithLoads` inside `db.runTransaction`, with the loader using `tx.getAll` and `tx.get(query)`. It then writes the journal, with `ignoreUndefinedProperties`, and re-syncs claims for `usersToResync`.
     - `createUser`: creates the Auth user with uid = users doc id.
     - `bootstrapOwner`: gated by the `OWNER_EMAIL` param and a verified email, runs once while `meta/bootstrap` is absent, and writes `firstOwnerDocs`.
   - Region asia-south1.
2. **`FirebaseSource`.**
   - Firestore with `persistentLocalCache` and the multi-tab manager.
   - Translate `QuerySpec` into where, orderBy, limit and cursor; use `getCountFromServer`.
   - A permission-denied read returns null, or "denied" from `docStatus`.
   - Session from the ID-token claims plus the user's own document. Refresh the token when `users/{uid}.claimsAt` changes.
   - `run` goes through the `command` callable.
   - Load each source with a dynamic `import()`, so a Firebase build never ships the demo seed and a demo build never ships the Firebase SDK.
3. **Sign-in screens.**
   - Google (redirect through the `/__/auth` proxy), email and password, and phone OTP with India-only SMS (D-35).
   - An "account not set up" screen, with "Set up as the first owner".
   - App Check with reCAPTCHA v3 when `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` is set (D-41); add those domains to the CSP.
4. **Configuration.**
   - `firebase.json` covering Firestore (default) in asia-south1, the rules, the indexes, functions and storage, with no hosting.
   - `firestore.indexes.json`, derived from the query specs the screens run.
   - `storage.rules`.
   - `web/.env.example`: the six `NEXT_PUBLIC_FIREBASE_*` plus the reCAPTCHA site key, each with where to find it in the console.
   - `.github/workflows/ci.yml`: typecheck, core tests, build, and the rules and functions tests on the emulator.
5. **`DEPLOY.md`** for a non-specialist, from creating the project, Blaze and the ₹100 alert through to the first owner, Netlify and a smoke test. Then the M1.6 progress folder, SUMMARY and traceability rows, and the 4G timing measured on real Firebase.

## Open items

### Performance (PRD §11.1: KPIs under 2 s, the dashboard under 3 s on 4G)
Measured on the demo with throttled 4G (1.6 Mbps, 150 ms, 4× CPU, cold):

| Dashboard | Measured | Target |
|---|---|---|
| Owner, KPIs | 2.8–4.3 s (one 6.2 s outlier) | under 2 s |
| Supervisor, site card | 3.4–4.3 s | under 3 s |

- **Still failing.** The app shell itself becomes ready at about 2 s.
- **Main cause:** about 320 KB of gzipped JS downloads before the KPIs. The largest chunk carries core, both languages' strings and the demo seed. At 1.6 Mbps that alone is about 1.6 s.
- **Plan:**
  - Load the data source by mode (step 2). `sideEffects: false` is already set on core.
  - Ship only the active language's strings.
  - In Firebase mode, read only the rollup docs (D-09): about 15 small reads, no collection scans.
  - Measure on real Firebase with `perf-4g-*` in `tools/jobs/make-m1.6.mjs`.
- Until then, R11.1-P, R4A-11 and R15-2 stay **partial**.

### Dashboard fixes
All 5 are done (see "Done"). Their screenshots and progress-folder evidence come with the M1.6 report.

## QA not yet run
- **The frozen M1.3 build** at `progress\crm-qa\builds\2026-10-26_m1.3\` is waiting for the QA pass: labour, dashboards and the N1–N13 fixes.
- **Not in that build:** the 5 dashboard fixes, the lazy cards and the search-button fix. They are only in the current tree.

## Changed since the M1.3 freeze
- **Core:**
  - `store.ts`: journal, rollback, list hints
  - new: `runner.ts`, `server.ts`, `test/server.test.ts`
  - list hints in `commands/clients.ts`, `labour.ts`, `projects.ts`, `people.ts`
  - `index.ts` exports
  - `package.json`: `sideEffects: false`
- **Web:**
  - `components/dashboard/`: `Chart.tsx` (`Later`, the KPI gate), `Dashboard.tsx`, `Widgets.tsx`
  - `components/shell/AppShell.tsx` (search button)
  - `components/shell/Icon.tsx` (trend arrows)
  - `styles/dashboard.css`, `styles/ag.css`
  - `i18n/strings.ts`
  - `data/demo/demoSource.ts` (uses `runCommand`)
- **Tools:**
  - `tools/ui-check.mjs`: reveals lazy cards; `noReveal` option
  - new: `tools/jobs/make-m1.6.mjs`
