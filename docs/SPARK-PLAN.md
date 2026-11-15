# Running the CRM on Firebase Spark (no card): assessment and plan

Draft 1, 16 Nov 2026. Proposes **D-51 "Spark-only"**, which overrides D-34 (Blaze accepted) and the Cloud Functions and Cloud Storage parts of D-36. Nothing built so far is thrown away: the core code, the rules, the demo and the UI carry over.

## The hard facts (checked on the official pages, 16 Nov 2026)

| Fact | Source |
|---|---|
| Spark has Firestore, Authentication, FCM and App Check. **Cloud Functions, Cloud Storage and phone-code (SMS) sign-in are "not applicable" on Spark.** | firebase.google.com/pricing |
| Firestore free: 1 GiB stored, **50,000 reads/day**, 20,000 writes/day, 20,000 deletes/day, 10 GiB/month egress, **max document 1 MiB**; one free database per project. | firebase.google.com/docs/firestore/quotas |
| A security-rule `get()` costs **one read** per dependent document per request (repeats in one request are free). `count()` costs one read per 1,000 index entries (minimum one). | firebase.google.com/docs/firestore/pricing |
| Spark email limits per day: verification **1,000**, password reset **150**, **email-link sign-in only 5**. | firebase.google.com/docs/auth/limits |
| Netlify Free: **300 credits a month, a hard limit: when they are used up the site is paused** until the next cycle. A production deploy costs **15**, compute **10 per GB-hour**, bandwidth 20 per GB, requests 2 per 10,000. Previews and branch deploys cost 0. | docs.netlify.com (how credits work) |
| Netlify Functions: synchronous **60 s**, scheduled **30 s**, 6 MB payload (4.5 MB binary), 1 GB memory, scheduled functions on **all plans** (run only on the published deploy, UTC cron). Function region cannot be changed on Free (default Ohio). | docs.netlify.com (functions) |
| Netlify env var value up to 5,000 characters; functions "should fall within AWS's environment limits" (4 KB total, not confirmed on the page). | docs.netlify.com (env vars) |

Not confirmed from a page: the 4 KB total for function variables on Free; custom-claims size (1,000 bytes, from memory); real latency Ohio to Mumbai. Each is marked below.

## Recommendation: A, Netlify Functions with the Firebase Admin SDK

**A (recommended).** The same server code (command runner, posting, numbering, audit, claims, super-user and setup logic, sample data, enquiry endpoint) runs in **one Netlify Function**, behind a check of the caller's Firebase ID token. The browser still reads Firestore directly (so dashboards are as fast as today); only writes and setup go through the function. The function holds a **dedicated, least-privilege service account** (Firestore, Auth, FCM only), created by the wizard and stored **only** in a Netlify environment variable, never in the repository or the browser. Money integrity (D-07, D-08), gapless numbering, audit and super-user rules are **unchanged**.

**B (no server at all): rejected.** Clients would write rollups, postings, numbers and audit themselves; rules cannot enforce "this delta equals that expense" across documents, so a bug or a modified browser could corrupt money totals (weakens D-07/D-08). Without the Admin SDK nobody can create staff sign-ins, set claims (roles would cost one extra read per request via `get()`), keep secrets server-only (email key, website key) or send push. B saves a deployment step and costs the properties the PRD cares about most.

## What changes (everything else stays)

| Was (Blaze) | Spark-only |
|---|---|
| Cloud Functions callables | One Netlify Function (`/.netlify/functions/api`, ID token in the header) plus `submit-enquiry`; `FirebaseSource` calls it with `fetch`; same error shape (refusal, reauth, field errors) |
| Cloud Storage | **Storage adapter**; first adapter keeps compressed images in Firestore (`files/{id}` metadata + thumbnail, `file_blobs/{id}` bytes under 1 MiB, aim 80 to 150 KB); Cloudinary or Cloud Storage can be swapped in later without touching screens. Aadhaar stays masked (D-22). |
| Phone-code sign-in (D-35) | **Dropped.** Site staff use Google (if they have it) or **email and password set by the owner** (a phone-only worker gets a pseudo-email such as 9876543210@staff.ambika and a password); the owner creates the account in Settings > Users, the function creates the sign-in. |
| Email link sign-in | Kept **only for the first owner** (5 emails a day); everyone else password or Google |
| Scheduled jobs | **Netlify scheduled function nightly** (reminders, recurring expenses, voucher batch) **plus a catch-up** when the owner opens the app if the last run is over 24 h old |
| Server PDFs (Phase 2) | Generated in the browser (client PDF library) |
| Firestore backups/export | **Not available on Spark.** Plan: owner-run "Download backup" (JSON) from Settings, monthly, and the weekly scheduled export to the owner's email (size permitting). No point-in-time recovery. |
| `npm run setup` | Firestore database + Authentication + rules + indexes through the Firebase CLI and REST (all work on Spark), the least-privilege service account and its key (created by the wizard, set straight into Netlify, never written to disk), the Netlify site, variables and deploy, then `verify:live` |
| First owner | Same bootstrap, in the Netlify Function: the user adds `business@ambikagroups.tech` (Email/Password) in the console, signs in, presses **Verify email** (a console-added address is not verified), then **Set up as the first owner** |

## The numbers (assumptions stated; these are estimates, not measurements)

- **Reads/day (50,000 free).** A dashboard open is about 40 to 80 reads (about 15 rollups, counts, one page of rows, plus one read per rule lookup). Pilot (5 people, 30 screens a day each): about 6,000 a day. **Full scale (30 people): about 36,000 a day, close to the limit.** Mitigations in the plan: cache-first reads (a cache hit is free), dashboard results kept 5 minutes, no live listeners except the user's own document, and a read meter on the Setup page.
- **Writes/day (20,000).** Pilot under 500; full scale under 3,000. Sample data: about 6,000 writes to load and 6,000 deletes to remove, within one day's limit (loaded in parts to stay under the 60 s function limit).
- **Photos (1 GiB shared with all records, about 100 to 200 MB for records at full scale).** At 100 KB per photo, about **8,000 photos**. Pilot, 10 bills a day, about 10 months. **Full scale, 120 a day, about 2 months.** That is the real Spark ceiling. Plan: the usage meter on the Setup page, "download and archive photos older than N months" for the owner, and Cloudinary's no-card free plan as the first swap-in. The adapter makes either a settings change.
- **Netlify credits (300 a month, hard limit).** Each save runs about 1 to 3 seconds (Ohio to Mumbai round trips; region not changeable on Free). Pilot 50 saves a day: about 2 credits a month. Full scale 300 saves a day at 2 s: about 50 credits. Requests and bandwidth for 30 people: about 10. **Production deploys are the main cost: 15 each.** Six a month is 90, so the total stays near 150, but **20 deploys exhaust the plan and pause the site.** The wizard deploys previews first (0 credits) and `verify:live` warns when credits are low. Cold start about 1 to 2 s on the first save after idle.

## What cannot work on Spark (said plainly)

Phone-code sign-in; server-built PDFs; point-in-time recovery and managed backups; push from a Firebase function (push is sent by the Netlify Function instead); "photos kept forever" at full scale (archive needed after about 2 months, or a free Cloudinary plan); more than 5 email-link sign-ins a day; any save that must finish in under a second.

## Risks I would flag

1. The service-account key in Netlify is powerful: if it leaks, the whole database is open. Mitigated by a least-privilege account, one variable, rotation by `npm run setup -- --rotate-key`, and the key never touching the repository or the browser. Org policy on some Google accounts blocks key creation; the wizard then gives the manual route.
2. The 4 KB environment limit (unconfirmed): the key is trimmed to its two needed fields (about 1.8 KB); the wizard measures the total and warns above 3.5 KB.
3. 36,000 reads a day at full scale is thin; the meter and caching are not optional.
4. Credits are a hard stop. A paused site is the worst failure here, so deploy discipline matters.

## Code changes and ETA

Netlify adapter and handler routing with token verification (4 h); `FirebaseSource`, auth, setup and sample calls moved from callables to the function, `netlify dev` for local use (3 h); storage adapter with the Firestore implementation, rules, size and quota checks, tests (5 h); scheduled function and backup export skeleton (2 h); rules, `firebase.json`, archive `storage.rules`, drop phone sign-in (1 h); wizard rework for Spark with the service account and Netlify env, `verify:live`, mocked tests (5 h); decisions D-51, data model, traceability, cost estimate, DEPLOY and GO-LIVE (4 h); regression, builds and measurements (3 h). **About 27 working hours, three and a half days.** The email-link and owner-sign-in work already written stays.

## TTL: not available on Spark (confirmed 2026-11-16)

Deploying the index file with a TTL field override failed on the real project with "403 Project ambikagroupscrm has billing disabled". Firestore TTL policies are Blaze-only. So firestore.indexes.json has no TTL override, and old `command_requests` documents (field `expireAt`, 7 days) are removed by the nightly clean-up run by the Netlify scheduled function (and by the catch-up when the owner opens the app). Until that exists they simply stay; they are small and counted in the usage meter.
