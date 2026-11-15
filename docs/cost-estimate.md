# Ambika Group CRM: monthly running-cost estimate (Firebase Blaze)

Phase 0 deliverable (spec §3.1 rule 17). Draft 2, 25 Oct 2026 (adds §10, Staying at ₹0, after the user's ₹0 rule).

**User rule (25 Oct 2026): everything should cost ₹0.** §10 shows how the Phase 1 pilot stays inside Google's free allowances, and at what scale each one would run out (from about 8–10 sites). The figures below are the **long-term estimate** for full scale.

**Long-term bottom line:** at the spec's full scale (50+ live projects, 2,000+ workers), the production system should cost roughly **₹500–1,500 a month in year 1, rising to ₹2,000–3,500 a month by year 5** as stored data grows. Dev and staging add under ₹300 a month together. Three optional items can add more: a warm PDF server (~₹1,200), daily full exports instead of managed backups (up to ~₹18,000 by year 5, so not recommended), and a paid Web3Forms plan if webhooks need one.

**Budget alert (user's answer to I8):** ₹100/month on each of the three projects, with alerts at 50%, 90% and 100%. A Google Cloud budget alert notifies; it does **not** stop spending.

> **Pricing caveat.** §1–§9 use list prices rounded *up* and are order-of-magnitude. The free allowances in §10 were checked against the official pages on 25 Oct 2026 (decisions D-34); the verified `asia-south1` paid prices (Firestore reads $0.035, writes $0.104 per 100k, storage $0.104/GiB-month) are lower than §4 assumed, so §4 errs high. Exchange rate used: ₹88 = US$1.

---

## 1. Volume assumptions (§15 scale)

| Driver | Assumption | Basis |
|---|---|---|
| Live projects | 50 | §15 |
| Workers marked daily | 2,000 | §15 |
| Working days | 26 / month | |
| App users | ~10 office (owner, accountant, PMs), ~60 supervisors | §19 Q6 unanswered: guess |
| Expenses | 7,500 / month (150 per project) | scaled from §17 test data |
| Wage payments | 8,700 / month (weekly payouts) | 2,000 workers × 4.33 |
| Stock consumption entries | 6,500 / month | 50 sites × 5 materials × 26 days |
| Invoices, receipts, quotations | ~300 / month | |
| Photos | ~10,000 / month at ~150 KB after compression (bills, DPR, challans) | §4 compress on upload |
| Attendance selfies | off by default (§19 Q5). If on: 52,000 / month at ~80 KB | |
| PDFs generated | ~600 / month | invoices, quotations, receipts, payout sheets, DPRs |

## 2. Firestore operations per month (production)

| Source | Writes | Reads |
|---|---|---|
| Attendance: 52,000 docs + posting (worker balance, project rollup, posting doc) | ~210,000 | ~160,000 (rules lookups) + ~160,000 (posting re-reads) |
| Expenses: create, approve, posting (3 cost rollups, finance rollup, account row, account balance, posting, audit, voucher) | ~100,000 | ~40,000 |
| Wage payments incl. generated Labour expense and its posting | ~120,000 | ~50,000 |
| Stock, machinery, DPR, leads, tasks, notifications, invoices | ~50,000 | ~60,000 |
| Dashboards: ~10 users × 20 loads/day × ~35 docs | — | ~180,000 |
| Supervisor screens: 60 × 3 sessions/day × ~100 docs (offline cache cuts this) | — | ~470,000 |
| Lists, reports, search (paginated 25–50) | — | ~300,000 |
| CA exports (monthly + ad hoc) | ~1,000 | ~60,000 |
| **Total** | **~0.6 million** | **~1.5 million** |

Firestore's daily free quota (50,000 reads, 20,000 writes, 20,000 deletes, 1 GiB storage) applies per project and covers roughly **1.5 M reads and 0.6 M writes a month**. Production sits right at the free line, so operations cost **₹0–300 / month**. Even at 3× these volumes, operations stay under ~₹600.

## 3. Stored data growth

| Year | Firestore documents (approx.) | Firestore storage incl. indexes | Cloud Storage (photos, PDFs, exports) |
|---|---|---|---|
| 1 | 2–3 million | 5–8 GiB | 20–25 GB (+50 GB if selfies on) |
| 3 | 7–8 million | 15–20 GiB | 60–75 GB (+150 GB) |
| 5 | 12–13 million | 25–35 GiB | 100–125 GB (+250 GB) |

The biggest collections are attendance (~52,000/month), its posting docs (another ~52,000), account transactions and audit entries. Index exemptions on large map fields (firestore.indexes.json) keep the index share down.

**Optional saving:** attendance could hold its posted effect in a server-only field on the attendance doc itself instead of a separate posting doc. That removes about 3 million documents and 52,000 writes a month by year 5, roughly ₹40–80 a month. It isn't worth the extra complexity at launch; revisit in Phase 4.

## 4. Line-by-line monthly estimate (production)

| Item | Year 1 | Year 5 | Notes |
|---|---|---|---|
| Firestore operations | ₹0–300 | ₹100–500 | §2 |
| Firestore storage | ₹100–150 | ₹450–650 | ~US$0.18 / GiB-month assumed |
| Backups: managed daily + weekly backups, PITR | ₹100–300 | ₹500–1,000 | §5 |
| Cloud Functions (2nd gen) | ₹0–200 | ₹0–300 | postings, triggers, PDFs, exports; mostly inside the free tier |
| Cloud Storage + egress | ₹50–200 | ₹250–600 | ~US$0.023 / GB-month storage, egress for photo viewing |
| Front-end hosting: Netlify (D-36) | ₹0 | ₹0 (hard cap) | Free plan, 300 credits a month; at full scale bandwidth may need care (§10). If it ever isn't enough, the paid plan is a user decision |
| Phone OTP (Firebase Auth SMS) | ₹0 | ₹0 | Google sign-in for site staff (D-35); SMS only as a fallback, about ₹6 each |
| Secret Manager, Scheduler, Logging, FCM | ₹0–50 | ₹0–50 | FCM is free; logging stays under the free 50 GiB |
| **Total (production)** | **≈ ₹500–1,500** | **≈ ₹2,000–3,500** | |
| Dev + staging (both) | ₹0–300 | ₹0–300 | small data; emulator does most testing |

## 5. Backups: a deviation that needs your approval

Spec §3.1 rule 16 asks for a **daily Firestore export** to Cloud Storage with 30-day retention. An export is billed as **one read per document**, every day:

| | Year 1 | Year 5 |
|---|---|---|
| Docs read per export | ~2.5 M | ~12.5 M |
| Reads per month (30 exports) | ~75 M | ~375 M |
| Cost per month | ~₹4,000 | ~₹18,000 |

That would be 5–10× everything else combined. **Recommendation:**
1. **Firestore managed backups** (scheduled by Firestore itself, billed on backup storage, not reads): a daily backup kept for 7 days and a weekly backup kept for 5 weeks, which covers 30+ days.
2. **Point-in-time recovery** enabled: any minute in the last 7 days can be recovered.
3. A **monthly export** to Cloud Storage (the spec's "data must be exportable at any time" and an off-system copy), kept for 12 months: ~₹200–600 / month.
4. The **restore test** before go-live still happens, as the spec requires.

This meets the spec's intent (30 days of recovery points, tested restore) at a fraction of the cost. **Needs user approval**, because it changes the letter of §3.1 rule 16. (Managed backup retention limits should be checked against current docs before setup.)

## 6. Things that could raise the bill

| Risk | Effect | Control |
|---|---|---|
| A listener on a large collection (§3.1 rule 17) | One open dashboard re-reads thousands of docs | Code review rule: listeners only on single docs or ≤50-row queries |
| Attendance selfies turned on for every project | +50 GB/year storage | Storage lifecycle: move selfies to Nearline after 90 days, delete after 1 year (needs user approval) |
| A runaway trigger loop (a function writing the doc that triggers it) | Unbounded writes | Delta posting writes nothing on zero delta (D-08); budget alert catches it within hours |
| Abuse of the public webhook URL | Function invocations, logging | Token checked first; unauthorized calls write no Firestore docs (D-31); App Check on app endpoints |
| Hot rollup documents | Contention and retries, not cost | §7 |

## 7. Hot documents

Firestore handles about **1 sustained write per second per document**; bursts above that cause contention and retries.

- **`co_YYYY-MM` rollups** (company month): every approved expense, payment and receipt touches them. Normal traffic is a few writes a minute. The risk is a **bulk action**: approving 50 expenses at once, or "mark paid" on a 50-worker payout sheet. Plan: the `approveRecords` callable and the payout callable **post directly**, summing the deltas per target across a group of records (up to ~20 records per transaction, under the 500-write limit) and writing each rollup once per group. The triggers that follow see zero deltas and write nothing (D-08). A 50-record approval is then about 3 transactions instead of 50 contending ones.
- **Attendance**: the morning rush (2,000 writes between about 9 and 11 am) touches only per-project rollups and per-worker balances, so about 40 writes per project per morning. No hot spot.
- **`voucher_{fy}` counter:** taken out of posting transactions (D-12). The batch job writes it once per batch of up to 400.
- **Document counters** (invoice, quotation): a few writes a day. No issue.

No distributed (sharded) counters are needed at this scale.

## 8. PDF engine (D-27)

| | Puppeteer (headless Chrome) | @react-pdf/renderer |
|---|---|---|
| Hindi (Devanagari) | Correct shaping of conjuncts and matras (Chrome's text engine) | Weak conjunct shaping; Hindi names can render wrongly |
| Fidelity to the HTML design | Same HTML and CSS as the approved mockups (§8.4) | Separate layout code |
| Memory | 1–2 GiB per instance | 256–512 MiB |
| Cold start | 5–10 s | 1–2 s |
| Cost at ~600 PDFs/month | inside the free tier | inside the free tier |

**Recommendation: Puppeteer** (a serverless Chromium build on a 2 GiB, 2nd-gen function in `asia-south1`, IBM Plex Sans + IBM Plex Sans Devanagari bundled as files, per brand.md v2). Hindi is required in the UI (§4A.11), client and worker names are often in Devanagari, and an invoice that mangles a client's name isn't acceptable. Cost isn't the deciding factor at this volume. A 5–10 s cold start on the first PDF after idle is acceptable at launch. If users find it slow, set **1 minimum instance**, about **₹1,000–1,500 / month** extra (needs user approval).

## 9. Third-party items (not Firebase)

| Item | Cost | Status |
|---|---|---|
| Web3Forms | ₹0: email-only free plan until Phase 3, then dropped | Resolved by enquiry contract v2 (the website posts to `submitEnquiry`) |
| Domain | ~₹800–1,500 / year | User |
| Email sending (Resend or SMTP, §13.2) | free tier likely enough for invoices and alerts | Phase 2 |
| e-sign provider (later, §8A.5) | per-signature pricing | Phase 4 |
| WhatsApp Business API (Phase 4) | per-conversation charges from Meta | Phase 4 |
| e-invoicing (if turnover > ₹5 crore) | government IRP is free; a GSP may charge | open question D17 |

## 10. Staying at ₹0 (user rule, decisions D-34)

The user's rule from Phase 0 sign-off: **everything should cost ₹0**. That means the Blaze plan kept inside its free allowances, with a ₹100 budget alert on each project. The figures above (§4, ₹500–1,500/month in year 1 at full scale) remain the **long-term estimate** for when the business grows past the free allowances. This section shows the **Phase 1 pilot** against each free limit, and the scale at which each limit would be crossed.

Allowances were verified on 25 Oct 2026 against the official pages (decisions D-34). Usage figures are my estimates, worked from the same per-record costs as §2, and get replaced by real billing data after the pilot's first month.

**Pilot assumptions:** 1 site, about 50 workers marked daily, about 5 users (owner, accountant, 1 PM, 1–2 supervisors), 26 working days a month, about 8 expenses a day, weekly wage payouts, about 250 photos a month.

| Free allowance | Limit | Pilot usage (estimate) | Share used | Crossed at about |
|---|---|---|---|---|
| Firestore writes | 20,000 / day | ~550 / day | 3% | **~1,700 workers marked daily** (~35 sites); writes run at about 11 per worker-day including postings |
| Firestore reads | 50,000 / day | ~4,000 / day | 8% | **~60 active users** at full-scale habits; reads follow people using screens more than workers. §2's full-scale figure (~1.5 M/month) sits right at the limit |
| Firestore deletes | 20,000 / day | < 100 / day (nightly clean-up of processed-event markers (no Firestore TTL on the free plan)) | < 1% | not in sight |
| Firestore stored | 1 GiB | ~0.15 GiB after year 1 | 15% / year | **~6 years at pilot size**, or within one year at ~8–10 sites (~400 workers). The first limit a growing business will cross |
| Firestore egress | 10 GiB / month | ~0.2 GiB | 2% | far beyond full scale |
| Cloud Run (functions) | 2 M requests, 180,000 vCPU-s, 360,000 GiB-s / month | ~25,000 requests, ~10,000 vCPU-s, ~10,000 GiB-s | ~6% (vCPU) | well beyond full scale, **unless a minimum instance is set**: one always-on instance alone uses up the free vCPU time in about 2 days, which is why there are none |
| Cloud Scheduler | 3 jobs / billing account | 2 (one dispatcher each in prod and staging) | 67% | fixed by design; a 4th job would cost about ₹9 a month |
| Artifact Registry | 0.5 GB / billing account | ~0.2–0.4 GB with the 1-day cleanup policy (estimate) | ~60% | **the tightest limit**; measure the Puppeteer image in Phase 2 |
| Cloud Storage, us-central1 | 5 GB-months | ~50 MB added a month (~0.6 GB / year) | ~12% after a year | **~8 years at pilot size**; ~1 year at ~8 sites; **~3 months at full scale** |
| Cloud Storage, asia-south1 | none | same data | billed | about ₹1 a month at pilot; ₹40–50 a month at full scale (~20–25 GB/year) |
| Phone OTP (SMS) | none (≈ ₹6 each) | 0: site staff use Google sign-in (D-35) | — | only if someone uses the SMS fallback |
| Resend email | 100 / day, 3,000 / month | ~10 / day (alerts as a daily digest, documents, monthly CA email) | 10% | ~10 sites if each alert is sent separately; the digest keeps it well clear |
| Netlify (front end, D-36) | 300 credits / month, **hard cap** (no overage: everything on the team pauses) | ~5 production deploys (75 credits) + ~1 GB bandwidth (20) + ~50,000 requests (10) ≈ **105 credits** | ~35% | **~20 production deploys** alone, or **~15 GB** bandwidth alone. The app is cached after first load, so ~100 daily users stay well inside. Deploy previews and branch deploys are free |
| GitHub Actions (CI, D-36) | 2,000 minutes / month (private repo, Free plan); 500 MB artifact storage | ~6 min per run × ~150 pushes ≈ **900 min** | ~45% | ~330 runs a month. With no payment method, Actions simply stops when the quota is used: no charge |
| Secret Manager | 6 versions / billing account | 2 (Resend key × staging, prod) | 33% | fixed by design |
| Cloud Build | 2,500 min / month | ~200 min (~40 deploys) | 8% | not in sight |
| Cloud Logging | 50 GiB / month | < 1 GiB | 2% | not in sight |
| Web3Forms | 250 submissions / month, no webhooks | email-only until Phase 3 | — | dropped in Phase 3 (contract v2). `submitEnquiry` then runs on Cloud Run's free tier with `maxInstances: 2` and a rate limit, so a flood can't raise costs |
| Backups / PITR | none | DB < 0.1 GiB → under ₹1 / month | billed | open question I6, decided before go-live |

### The photo-storage choice (decided: us-central1, I10)

| | us-central1 (US) | asia-south1 (Mumbai) |
|---|---|---|
| Cost at pilot | **₹0** for years | about ₹1 a month |
| Cost at full scale | ₹0 for ~3 months, then about ₹2/GB-month beyond 5 GB | about ₹40–50 a month |
| Speed for site phones | slower first load (photos are small after compression) | faster |
| Where data lives | US (includes worker ID proofs) | India |
| Changeable later | hard: a bucket's location is fixed, so moving means copying everything to a new bucket | same |

Firestore (all business data) stays in Mumbai either way. **Decided by the user: us-central1**, to meet the ₹0 rule. Because ID proofs are then stored in the US, only masked Aadhaar copies are accepted (D-22).

### What keeps it at ₹0
- `(default)` Firestore database only; rollups and pagination; no listeners on large collections.
- No minimum instances; smallest memory per function; `maxInstances` on every function.
- One Scheduler dispatcher per environment (none in dev).
- Artifact Registry cleanup policy in every project.
- Google sign-in for site staff (I9, D-35); SMS only as a fallback, limited to India.
- Photos compressed on the phone; storage in us-central1 (I10).
- Daily email digests.
- ₹100 budget alerts; optionally, Google's Preview spend caps on Functions and Run.
- Netlify: production deploys only on release (≤ ~8 a month); staging on a free branch deploy; the website on a separate Netlify team (D-36).
- GitHub Actions: no payment method on the account, so CI stops rather than bills; CI runs on pushes, not on a schedule.

### When it will stop being ₹0
At roughly **8–10 active sites** (about 400 workers) the first allowances run out: Firestore storage, and photo storage in us-central1. Expect tens of rupees a month at first, rising towards the §4 long-term estimate at 50 sites. The ₹100 budget alert gives the warning.

## 11. Recommendations summary

1. Blaze plan on all three projects, designed to stay at **₹0** inside the free allowances (§10, D-34); **₹100 budget alert on each project** (50 / 90 / 100%).
2. **Managed backups + PITR + monthly export** instead of daily exports: deferred by the user to before go-live (I6). They have no free quota, but cost under ₹1 a month at pilot size.
3. **Puppeteer** for PDFs, no minimum instance (I7 answered no).
4. **Google sign-in** for site staff instead of SMS codes (I9, D-35), and photo storage in **us-central1** (I10): both approved.
5. Attendance selfies off unless needed; if on, a storage lifecycle rule.
6. Re-estimate after one month of live use in Phase 1, using the real billing report.
