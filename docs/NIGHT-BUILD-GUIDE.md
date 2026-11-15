# Night build guide: how to build one feature here

For every builder (lane leads and their subagents). Read `C:\GRIND\AmbikaGroups\docs\crm-plans\00-NIGHT-BUILD.md` first (the contract). This file is the how.

## 1. Rules for a feature builder (subagent)

1. **Plan first, short.** Write `C:\GRIND\AmbikaGroups\docs\crm-plans\<feature>.md` (at most 80 lines): the PRD requirements in scope with section numbers (`docs/PRD-text.md`, read only your sections), data and commands, screens, tests, and the shared-file changes you need. Then build to it.
2. **You own only your own new files** (section 2). You never edit a shared file (section 4): you write the exact change as a patch block in your final report and the lane lead applies it.
3. **No git commands that change anything** (no add, commit, stash, checkout, reset). No `npm install`, no `npm ci`, no production build, no UI job run, no dev server. You run only your own unit tests and a typecheck.
4. **Never use backticks or `${}` inside a shell command string** (they execute). Write files with the Write/Edit tools.
5. Money is integer paise; quantities are integer thousandths; dates are IST `YYYY-MM-DD` strings (`packages/core/src/money.ts`, `dates.ts`). Clients never write totals, numbers, postings or balances: only commands do.
6. Words on screen are plain (no "§", "M1.", "TODO", no developer terms), in English and Hindi, with Indian number and date formats (`web/src/lib/fmt.ts`). Confirm before delete and before money moves.
7. **Honesty:** if something is not finished, say so in your report. Do not fake data or claim a test you did not run.

## 2. The module pattern (files you create)

| What | Where | Pattern to copy |
|---|---|---|
| Pure logic and types | `packages/core/src/<feature>.ts` | `wages.ts`, `categories.ts` |
| Commands (validate, check role, write through the store, post) | `packages/core/src/commands/<feature>.ts`, exporting ONE map: `export const <FEATURE>_COMMANDS = { ... } satisfies Record<string, CommandFn>` | `commands/labour.ts`, `commands/common.ts` (`CommandCtx`, `CommandError`, `requireRole`, `requireAssigned`, `stampCreate`, `stampUpdate`) |
| Unit tests (vitest, ids like `EX-01`) | `packages/core/test/<feature>.test.ts` | `test/m13.test.ts` |
| Demo data | `packages/core/src/demo/<feature>.ts` exporting `seed<Feature>(ctx: FeatureSeedCtx)` | `demo/features.ts` explains the rules |
| Screens | `web/src/components/<feature>/*.tsx` (export the page components) | `components/labour/PaymentsPage.tsx`, `PaymentForm.tsx` |
| Strings | `web/src/i18n/features/<feature>.en.ts` (`export const en = {...}`) and `<feature>.hi.ts` (`export const hi = {...}`, same keys). Read as `t("<feature>.key")` | `i18n/features/index.ts` |
| Styles, only if the shared ones are not enough | `web/src/styles/<feature>.css` | `styles/setup.css` |
| Browser checks | `tools/jobs/make-<feature>.mjs` (writes `tools/jobs/<feature>.json`) | `tools/jobs/make-m1.3.mjs` |
| Server-only code (rare) | `functions/src/<feature>.ts`, tests in `functions/test/<feature>.test.ts` | `functions/src/maintenance.ts` |

A command changes data only through the `MemoryStore` it is given (`store.get/list/set/merge/delete/increment`, `await store.post(entity, id, nowIso)` for money). The same function runs in the demo (browser) and on the live database (the Netlify Function loads what the command reads, runs it, and writes the changes in one transaction). So: no `Date.now()` (use `ctx.nowIso`), no random ids except through the helpers already used in `commands/*.ts`, no network, no globals.

Screens use what exists: `AppShell`, `DataTable`, `Dialog`, `ConfirmDialog`, `useForm` + `Field`/`TextField`/`MoneyField`/`DateField`/`SelectField`/`CheckField`, `EmptyState`, `Skeleton`, `StatusBadge`, `useToast` (`web/src/components/ui/*`), and the data hooks in `web/src/data/DataProvider.tsx`: `useSession`, `useDoc`, `useDocs`, `useSmall`, `useCount`, `usePaged`, `useRead`, `useRun` (runs a command: `const run = useRun(); await run("createExpense", args)`), `useOnline`. Read through the hooks only (they work the same in demo and live mode and respect roles). Lists of more than a few hundred rows must page (`usePaged`), never load a whole collection.

Run your own checks from `C:\GRIND\AmbikaGroups\CRM`:
- `npx vitest run test/<feature>.test.ts` inside `packages/core` (or `functions`).
- `npx tsc --noEmit -p packages/core` and `npx tsc --noEmit -p web`: there must be no errors in YOUR files (other builders' files may be mid-edit; ignore those and say so).

## 3. Your final report (this is all the lead sees)

1. Files created (paths). 2. Test names and counts, with the command you ran and its last lines. 3. **Shared-file patches**, each as: file, where (the marked block or the nearby line), the exact lines to add. Typical ones: the command map spread and import (`commands/registry.ts`), the core export line (`packages/core/src/index.ts`), the seed (`demo/features.ts`), the two strings lines (`i18n/features/index.ts`, `index-hi.ts`), the route page (`web/src/app/<route>/page.tsx`: which component it should render), the css import, collections and who may read them (`roles.ts` `canRead`, `firestore.rules`), indexes (`firestore.indexes.json`), small collections (`web/src/data/types.ts`), menu entries. 4. What is partial or not done, plainly. 5. Which PRD items are covered by which test or UI job (for the traceability table).

## 4. Shared files (lane lead only)

`packages/core/src/commands/registry.ts`, `model.ts`, `roles.ts`, `index.ts`, `posting.ts`, `store.ts`, `runner.ts`, `demo/seed.ts`, `demo/features.ts`, `integrations.ts`; `firestore.rules`, `firestore.indexes.json`, `netlify.toml`, every `package.json`; `web/src/app/**` (routes), `web/src/components/shell/*`, `web/src/components/ui/*`, `web/src/components/projects/ProjectView*`, `web/src/components/dashboard/*`, `web/src/components/setup/*`, `web/src/data/*`, `web/src/i18n/strings*.ts`, `web/src/i18n/features/index*.ts`, `web/src/styles/{ag,app,v4}.css`; `functions/src/{api,admin,netlify,command}.ts`; `tools/ui-check.mjs`. If a shared type in `model.ts` lacks a field you need, define your own type in your feature file and name the `model.ts` change in your report.

## 5. Cross-feature interfaces (code to these exact names)

Both lanes agreed these on 16 Nov. The signatures live in `packages/core/src/lanea-interfaces.ts` (read it; it is short) and `web/src/components/shared/`. They started as thin working versions; the owning feature replaces the BODY and keeps the SIGNATURE. Never copy one into your feature: import it.

| Need | Use | Owner (replaces the body) |
|---|---|---|
| A file or photo on a record | type `FileRef { id, name, mime, sizeBytes, path, thumb? }`; records keep `files: FileRef[]` (or a named field such as `billFiles`); never image bytes on a business record. Screen: `<FileAttach value={refs} onChange={setRefs} accept="image/*" max={3} label="Bill photo" />` from `web/src/components/shared/FileAttach.tsx` | files (group A) |
| Tell people something | `notify(store, ctx, { toUserIds?, toRoles?, projectId?, dedupeKey, title, body?, link?, level? })` inside a command; the same `dedupeKey` never notifies twice | notifications (group A) |
| An expense caused by another record | `await postGeneratedExpense(store, ctx, { source, sourceRef: { entity, id }, key?, projectId, date, categoryId, description, amountPaise, payee…, mode?, paidStatus?, accountId?, gstRateBp?, taxablePaise?, approvalStatus?, billNo?, billDate? })` and `removeGeneratedExpense(store, ctx, source, ref, key?)`. Deterministic id, safe to call again | expenses (group B) |
| Money leaving or entering an account | set `accountId` and `mode` on your own record and call `await store.post(entity, id, ctx.nowIso)`: the posting engine (`posting.ts`) writes the account row and the totals. Never write `account_transactions` or a balance yourself. Screen: `<AccountPicker value={accountId} onChange={setAccountId} label="Paid from" required />` from `web/src/components/accounts/AccountPicker.tsx` | accounts (group B) |
| A locked month | `assertMonthOpen(store, date, what)` in every money command (throws a plain-words CommandError) | month lock (group D); until it exists, the accounts feature provides it |
| A simple printable document | `PrintDocSpec { title, subtitle?, meta?, sections: text / pairs / table, footerNote? }` and `openPrintDoc(spec)` from `web/src/components/shared/printDoc.ts`. Invoices and quotations get a richer template on top | PDFs (group C) |
| Share a document | `shareDocument({ entity: { collection, id }, phone?, text, file?, fileName? })` from `web/src/components/share/` (wa.me or the phone's share sheet; writes the share log) | sharing (group C) |
| A date on the calendar | `registerDeadline(store, ctx, { entity, id, kind, title, date, projectId?, attendees?, location? })`, `clearDeadline(store, entity, id, kind?)` in `calendar.ts` | Lane B |
| A follow-up task | `createTask(store, ctx, { title, assignedTo, projectId?, leadId?, dueDate?, priority?, source?, sourceRef?, dedupeKey? })` | Lane B |
| Vendors, vendor bills, payables, stock in | Lane B's modules (`docs/crm-plans/STATUS-lane-b.md`) | Lane B |

In Lane A's tree `calendar.ts` arrives when Lane B's branch is merged; until then, note the call you would make in your report and the lead adds it at the merge.

**Already in core, use them:** numbering (`numbering.ts`: `allocate`, `formatDocNumber`), GST split (`gst.ts`), categories (`categories.ts`: `CategoryTree`), rollups (`rollups.ts`), posting (`posting.ts`: effects for expenses, worker payments, invoices, receipts, transfers), CSV (`csv.ts`: `toCsv`, `MASTER_COLUMNS`), roles (`roles.ts`: `canRead`, `navFor`, `isFinanceRole`), dates (`dates.ts`), money (`money.ts`), the existing types in `model.ts` (`Expense`, `Account`, `AccountTransfer`, `Invoice`, `PaymentReceived`, `AccountTxn`, `Vendor`), amount formatting (`web/src/lib/fmt.ts`).

## 6. What the lead does with your work

Applies your patches, adds the route, runs `npm test`, `npm run typecheck`, the demo build and your UI job, fixes or sends back what fails, commits, rebuilds `web/out` and tells the supervisor, who tests it in a browser. Interim preview builds use `AG_SKIP_TYPES=1` (files no page imports yet may be half written); the final build is strict.
