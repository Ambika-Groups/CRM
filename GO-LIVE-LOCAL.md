# Sign in as the owner on your own database (GO-LIVE-LOCAL.md)

This is the shortest path to see **your own** Firebase project working in the CRM: you sign in as the owner and the CRM opens on
your real, empty database. It works on the free Firebase plan (Spark) with **no payment method** and **no server**.
Allow 20 minutes. Commands are typed in **PowerShell**, inside the `CRM` folder.

Your project is **`ambikagroupscrm`** and its settings are already in `web\.env.local` (private, never uploaded).
Your owner address is **`business@ambikagroups.tech`** (it is written in `firestore.rules`; see "If the address is different" below).

## The 6 steps

**1. Publish the security rules.** Do it either way:

- *In the console (no tools needed):* open <https://console.firebase.google.com/project/ambikagroupscrm/firestore/rules>, delete what is there, paste the whole of the file `firestore.rules` from this folder, press **Publish**.
- *Or with the command line:*
  ```powershell
  npm ci
  npx firebase-tools@15.34.1 login
  npx firebase-tools@15.34.1 use ambikagroupscrm
  npx firebase-tools@15.34.1 deploy --only firestore
  ```
  (This also sends the search indexes. With the console way, if a list ever says "an index is needed", press the link in that message once.)

**2. Add your sign-in.** Console > **Authentication > Users > Add user**. Email `business@ambikagroups.tech`, and a password you will remember.
(Email/Password sign-in must be turned on under Sign-in method; it already is.)

**3. Start the CRM and sign in.**
```powershell
npm run dev:live
```
Open <http://localhost:3100>. Type the email and password and press **Sign in**. You will see **"Your account isn't set up yet"**.

**4. Verify your email.** Press **Send verification email**, open the email we sent to `business@ambikagroups.tech`, press the link, come back to the page and press **Check again**.
(This step is what stops anyone else from claiming the owner address before you.)

**5. Press "Set up as the first owner".** The CRM opens on your real database. You are the **owner and the super user**. It is empty, and Home says what to add first.
This works once, and only for that verified address.

**6. Switch off open sign-up.** Console > **Authentication > Settings > User actions**: untick **Enable create (sign-up)** and save.
Now nobody can make an account on their own; the owner adds people. (The owner address is already taken by your account, so nobody can register it first.)

At any point, `npm run golive` checks what is switched on in your project and prints what is still missing.

## What works now, and what is next

- **Works now:** signing in, the owner and super-user screens, Home with its empty states, Settings, the Setup page's checks that need no server.
- **Not yet:** *saving* records (clients, projects, attendance, payments) and adding staff sign-ins. Those need the CRM's server part, which cannot run on the free Firebase plan as Cloud Functions. It is being built as a Netlify Function (free), and until then a save says plainly: "Saving this change needs the CRM's server part, which is not connected yet."
- **Not on the free plan, ever:** phone-code sign-in, server-made PDFs, Firebase's own backups. See `docs/SPARK-PLAN.md`.

## If something looks wrong

| What you see | What to do |
|---|---|
| "The CRM can't read its database yet ... rules are not deployed" | Step 1, then press **Check again**. |
| "... create the (default) database" | Console > Firestore Database > Create database (asia-south1, production mode), then step 1. |
| "This way of signing in isn't turned on" | Console > Authentication > Sign-in method: turn on Email/Password (and Google). |
| "That email or password isn't right" | The email must be the one you added in step 2. Check for a typo (for example `bussiness`). |
| "This account is not the owner address..." | Your sign-in email is not the owner address. It must match exactly (capital letters do not matter), and the email must be verified (step 4). |
| "New accounts are switched off here" | That is step 6 working. The owner adds people. |

## If the address is different

The owner address is written in two places that must match: `ownerEmail()` near the top of `firestore.rules`, and (optionally) `NEXT_PUBLIC_OWNER_EMAIL` in `web\.env.local` (it only lets the screen show a typo hint; the rules decide). To use another address, change `ownerEmail()`, publish the rules again (step 1), and add that address in step 2.

## Trying it from the demo

Opening **Settings > Setup & integrations** on the demo site and pasting your Firebase settings there stores them in that one browser and switches it to your project (the sign-in page appears). To go back to the demo on that device press **Forget this device's settings** on the sign-in page. Settings that come from Netlify are not affected.

When this works on your computer, put the same site on the internet: see `DEPLOY.md` (the Netlify section).

## Notes on the free plan

- The security rules and the indexes can both be published on the free plan. The indexes file must not contain a "TTL" (auto-delete) setting: Google allows that only on the paid plan, and publishing fails with "billing disabled". The file in this repository has none.
- Publish with: `npx firebase-tools@15.34.1 deploy --only firestore --project <your project id>` (rules and indexes). Do not deploy functions or storage; they need the paid plan.
