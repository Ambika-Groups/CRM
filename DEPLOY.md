# Putting the CRM on your own data (DEPLOY.md)

This guide takes you from nothing to a working CRM on your own Firebase project, step by step. You do not need to be
a programmer. Follow the steps in order and tick each one off. Allow about two hours the first time.

**What you will end up with**

- The CRM website on Netlify (it is only the pages; free).
- The data and the server part on Google Firebase, in India (Mumbai), inside the free allowances.
- You as the owner and the one **super user**, who can finish all the setup from the app itself.

**Cost.** Everything is set up to cost ₹0 at the size of one company. Firebase needs a billing account (the "Blaze"
plan) because the server functions require it, but the free allowances cover normal use. Step 2 sets a ₹100 alert so
nothing surprises you.

**Things you need before you start**

- A Google account you will use as the owner (a normal Gmail is fine).
- A payment card for Google's billing account (you will not be charged within the free allowances).
- Node.js 24 installed on your computer (nodejs.org, the "LTS or Current 24" installer).
- This project's folder on your computer, called `CRM` in this guide.
- A Netlify account and your GitHub account (both free).

Commands in this guide are typed in **PowerShell** (search "PowerShell" in the Start menu), inside the `CRM` folder.

## Read this first: you are on the free Firebase plan (Spark)

The project uses Firebase's free plan with no payment method (decision D-51, docs/SPARK-PLAN.md). That changes this guide:

- **Use GO-LIVE-LOCAL.md first.** It gets you signed in as the owner on your real database with no server and no card.
- **Do not do** the steps below about the pay-as-you-go plan (step 2), file storage (step 4), phone sign-in, App Check enforcement, and "deploy the functions" (steps 10 and 11): they need a paid plan. Photos will be kept inside the database; the server part will be a free Netlify Function.
- **Still valid:** creating the project and database (1 and 3), turning on sign-in (5), the web settings (6), authorized domains (7), and putting the site on Netlify (13, written out below).
- The one-command wizard (npm run setup) is being reworked for the free plan; until then use the steps.

## Put the CRM on Netlify (plain words)

1. Open Netlify and press **Add new project > Import from Git**. Choose GitHub and the repository **Ambika-Groups/CRM**, branch **main**.
2. **Base directory:** leave it empty. The **build command** and **publish directory** are read from `netlify.toml` in the repository (build: `npm ci && npm run build:web`, publish: `web/out`). Do not change them.
3. Open **Site configuration > Environment variables** and add these six, with the values from the Firebase console (Project settings > Your apps > the web app). The names must be exactly:
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`

   **The quick way:** open `web\.env.local` in Notepad, copy only the lines that start with `NEXT_PUBLIC_`, and paste them into Netlify's **Import from a .env file** box. Then check three things for each of them: **"Contains secret values" is NOT ticked** (these six are public by design: they are inside every page the site sends, and the security rules protect the data); the scope is **All scopes**; and the value is the same in every deploy context.
   **Netlify's dashboard variables replace both `.env` files.** `web\.env.local` and `functions\.env` never reach GitHub (they are ignored on purpose), so the site only knows what you type into Netlify. When the free-plan server part is added, its service-account key is the ONE thing you tick as secret, as a separate single variable.
4. Press **Deploy**. Netlify gives the site an address like `something.netlify.app`.
5. Add that address to Firebase: **Authentication > Settings > Authorized domains > Add domain**. Without this, sign-in on the Netlify site will not work.
6. A production site can **never silently open as the demo**: `netlify.toml` sets `NEXT_PUBLIC_REQUIRE_FIREBASE=1` for production, so if any of the six values is missing the build **stops** with a plain message telling you which. Previews and branch deploys do not set it, so they stay demos.
7. **Cost on Netlify Free:** every **production deploy uses 15 of your 300 monthly credits**, and at zero the site is paused until next month. Deploy previews and branch deploys cost nothing. Publish to production only when you mean to (a few times a month is fine).
8. **If the build stops saying "secrets scanning found secrets":** Netlify's scanner can mistake the Firebase API key (it starts with `AIza`) inside the site's scripts for a secret. The repository already tells Netlify to skip the six public names (`SECRETS_SCAN_OMIT_KEYS` in `netlify.toml`). If it still stops and names that key, add one more Netlify variable, `SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES`, whose value is the API key itself (not ticked as secret), and deploy again. Do not turn scanning off: it protects the real secret later.

The numbered steps below are the same work done by hand. Use them if you prefer, or when something needs a second look.

---

## 1. Create the Firebase project

1. Open <https://console.firebase.google.com> and sign in with the owner's Google account.
2. Press **Create a project**. Name it, for example, `ambika-crm`. Write down the **Project ID** it shows (like `ambika-crm-1a2b3`).
3. When it asks about Google Analytics, switch it **off** (not needed). Press **Create project**.

## 2. Switch to Blaze and set the ₹100 alert

1. In the console, bottom left, press **Upgrade** (or the gear > **Usage and billing** > **Modify plan**). Choose **Blaze** and add your card.
2. Open <https://console.cloud.google.com/billing> > your billing account > **Budgets & alerts** > **Create budget**.
3. Name it `ambika-crm alert`, choose your project, set the amount to **₹100**, and keep the alerts at 50%, 90% and 100%. Save.

An alert is an email, not a stop. If one ever arrives, open the console's **Usage and billing** and see what grew.

## 3. Create the database (Firestore)

1. Console > **Build** > **Firestore Database** > **Create database**.
2. Database ID: leave **(default)**.
3. Location: **asia-south1 (Mumbai)**. This cannot be changed later.
4. Start in **production mode** (the CRM sends its own rules in step 11).

## 4. Create file storage (Storage)

1. Console > **Build** > **Storage** > **Get started**.
2. Choose **production mode**.
3. Location: **us-central1**. This is the region with Google's free allowance.

## 5. Turn on sign-in

Console > **Build** > **Authentication** > **Get started** > **Sign-in method**. Turn on:

1. **Google**: enable it, choose a support email, save.
2. **Email/Password**: enable **both** switches: Email/Password and **Email link (passwordless sign-in)**, then save. The email link is how an owner whose address is not a Google account signs in the first time.
3. **Phone**: enable.

Then open **Authentication** > **Settings** > **SMS region policy** > **Allow** and tick **only India (IN)**, so no text message can go abroad.

## 6. Register the web app and copy its settings

1. Console > the gear > **Project settings** > **General** > **Your apps** > press the web button `</>`.
2. Nickname: `Ambika CRM web`. Do **not** tick "Firebase Hosting". Press **Register app**.
3. The page shows a block starting `const firebaseConfig = {`. Keep this page open: its six values are what the CRM needs.
4. **On your computer (to try it locally):** in the `CRM\web` folder, copy `.env.example` to a new file named `.env.local`
   (`Copy-Item web\.env.example web\.env.local`), open it in Notepad, and paste the six values in. Each line in the file
   says where its value comes from. This file stays on your computer.
5. **For the live site:** you will paste the same six lines into Netlify in step 13.

> Shortcut: you can also paste the whole `firebaseConfig` block on the app's setup page (**Settings > Setup & integrations**),
> which keeps it on that one device. Netlify's variables are what give every device the same connection.

## 7. Authorized domains

Console > **Authentication** > **Settings** > **Authorized domains**. `localhost` is already there. Press **Add domain**
and add your Netlify address (you will get it in step 13, like `ambika-crm.netlify.app`) and your own domain if you use one.
You can come back and do this after step 13; sign-in on the live site will not work until it is done.

## 8. App Check (recommended)

App Check proves that calls come from your real app. You do it in two parts: monitor first, enforce later.

1. Open <https://www.google.com/recaptcha/admin> > **Create**. Type: **reCAPTCHA v3**. Domains: your Netlify address, your own domain if any, and `localhost`.
2. It shows a **Site key** (public) and a **Secret key**. Copy both.
3. Console > **Build** > **App Check** > **Apps** > your web app > **reCAPTCHA** > paste the **Secret key** there and save.
4. Put the **Site key** into `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` (in `.env.local` now, and in Netlify later). Or save it on the setup page after step 14; it shows the exact line to copy.
5. Leave enforcement **off** for now. After a few days of normal use, the App Check page in the console will show your app's calls as verified. Then press **Enforce** for Firestore and Storage there, and tick **Refuse calls that fail the check** on the app's setup page for the server functions.

## 9. Sign in to Firebase from your computer

```powershell
cd CRM
npm ci
npx firebase-tools@15.34.1 login
npx firebase-tools@15.34.1 use --add
```

`login` opens a browser. In `use --add`, pick your project and give it the alias `default`.

## 10. Say who the first owner is

```powershell
Copy-Item functions\.env.example functions\.env
notepad functions\.env
```

Set `OWNER_EMAIL=` to the Google address of the person who will be the first owner (you), for example `OWNER_EMAIL=you@gmail.com`. Save. This file is never committed.

## 11. Deploy the rules, indexes and functions

```powershell
npx firebase-tools@15.34.1 deploy --only firestore,storage,functions
```

This sends the security rules, the search indexes and the server functions. The first time takes several minutes.
If it asks to **enable APIs**, answer yes. If it asks about a **cleanup policy** for container images, answer yes and
choose **1 day**, so old copies do not use storage.

If something fails, see "When something goes wrong" below.

## 12. Create the first owner

Run the CRM on your computer, connected to your project:

```powershell
npm run dev
```

1. Open <http://localhost:4320> and press **Continue with Google**. Use the account whose address you put in `OWNER_EMAIL`.
2. You will see "Your account isn't set up yet" with a button **Set up as the first owner**. Press it.
3. You are now the owner **and** the super user. The sign-in page closes and the CRM opens, empty and ready.

This works once, and only for that address. It sets up your user, the company placeholders, the expense heads and the
working defaults. No sample data is added.

## 13. Put the site on Netlify

1. Netlify > **Add new site** > **Import an existing project** > GitHub > pick the CRM repository.
2. The build settings come from the project (`netlify.toml`). Do not change them.
3. Before deploying: **Site configuration** > **Environment variables** > add the six `NEXT_PUBLIC_FIREBASE_*` lines (and `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` if you use App Check). The setup page prints the exact block for you to paste.
4. Deploy. Note the address Netlify gives (`something.netlify.app`).
5. Go back to step 7 and add that address to **Authorized domains**. Also add it to the reCAPTCHA site's domains (step 8).

Optional: use your own address like `crm.yourcompany.in` (Netlify > Domain management), and set `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to it, so Google sign-in stays on your domain.

## 14. Finish the setup inside the CRM

Sign in on your live site and open **Settings > Setup & integrations**. This page is only for the super user (you). It asks you to sign in again before any change.

Each of the 12 items has its own settings and its own **Test** button, and shows **Passed** or **Failed** in plain words with what to do about it. The row at the top ("7 of 10 verified") counts the ones whose last test passed.

1. **Firebase web config**: shows what the site is using. Test checks that the project answers.
2. **Firestore**, 3. **Storage**, 4. **Sign-in**, 5. **Server functions**: nothing to type; press Test.
6. **App Check**: save the reCAPTCHA site key; Test gets a token.
7. **Push notifications**: paste the web push key from Firebase console > Project settings > **Cloud Messaging** > Web Push certificates > **Generate key pair**. Test asks the browser for permission and sends a real notification.
8. **Email (Resend)**: at <https://resend.com> create an API key and verify your company domain; paste the key and the from-address. Test sends a real email to you.
9. **Website link**: press **Make a new key**, copy it once, and paste it with the address shown into the website's admin settings. Test sends a sample enquiry (checked, not saved as a lead, until the leads module arrives).
10. **Google Maps** (optional): a key with the Geocoding API turned on. Test looks up one address.
11. **WhatsApp**: coming in a later phase.
12. **Company profile**: opens **Settings > Company**; fill in your real name, GSTIN, PAN and address.

Secret keys are write-only: after you save one, the page shows only the last four characters, never the key.

## 15. Smoke test (tick each box)

On the live site, signed in as the owner:

- [ ] The page opens and asks you to sign in; Google sign-in works and returns you to the CRM.
- [ ] Settings > Setup & integrations opens, and Test passes for Firestore, Storage, Sign-in and Server functions.
- [ ] Add a client, then a project for that client; reload the page; both are still there.
- [ ] Settings > Users: add an accountant (email) and a supervisor (phone). Each can sign in (the accountant by "Email me a link", the supervisor by phone code).
- [ ] As the supervisor on a phone: mark attendance. Turn on aeroplane mode, mark again: it says "waiting to send", and syncs when the internet returns.
- [ ] As the accountant: record a wage payment; the Home dashboard figures change.
- [ ] Sign in as the supervisor: no ₹ amounts anywhere, and no Setup & integrations (the menu item is hidden; the address shows "You don't have access").
- [ ] Sign out: the next person to open the app on that phone sees no data from you.
- [ ] The CRM dashboard shows its first figures in under 2 seconds on a good phone connection.

## Optional: a test copy (dev and staging)

You can keep a second, separate Firebase project for trying things, so your real data is never touched.
Repeat steps 1 to 11 for it, then add it with `npx firebase-tools@15.34.1 use --add` (alias `dev`) and deploy with
`--project dev`. In Netlify, give that project's values to a branch deploy (Site configuration > Environment variables >
choose the "Branch deploys" scope). Staging works the same way. You do not need either to start.

## Backups

Before you rely on the CRM, take a backup (Google Cloud console > Firestore > **Import/Export** > Export to a Cloud Storage bucket).
**Treat backups as sensitive**: they contain the saved secret keys (email, website). Keep them private, never attach one to
an email, and never hand one to the CA (the CA export from the app is separate and has none of them).

## When something goes wrong

| What you see | What to do |
|---|---|
| "The CRM can't start. The Firebase settings are incomplete" | One of the six values is missing. Check Netlify's Environment variables (or `web\.env.local`) and deploy again. |
| Google sign-in says the address "isn't allowed" | Add the site's address to Authentication > Settings > **Authorized domains** (step 7). |
| "Your account isn't set up yet" and no owner button | The email you signed in with is not the one in `functions\.env` (`OWNER_EMAIL`), or the owner was already set up. Fix the file and run the deploy command again. |
| "The server part of the CRM isn't deployed yet" | Run the deploy command in step 11 and read its last lines for the reason. |
| Deploy says billing is needed | Finish step 2 (Blaze). |
| Storage Test fails | Open Console > Storage and press **Get started** (step 4). |
| Firestore Test says the database is in another region | Firestore's region cannot be changed. Create a new project and follow the steps again with asia-south1. |
| Test email fails with "refused the from-address" | In Resend, verify your company domain, or use `onboarding@resend.dev` until you have (it only emails your Resend login address). |
| A permission error after you changed someone's role | Ask them to sign out and in once; the new role is picked up within a minute on its own. |

## Automatic deploys of the security rules from GitHub (optional)

`.github/workflows/deploy-firebase.yml` can publish the Firestore rules and indexes every time they change on `main`. It does nothing until you add two settings, so you can ignore it. To switch it on:

1. Google Cloud console > IAM & Admin > Service accounts > **Create**. Name: `github-deploy`. Roles: **Firebase Rules Admin** and **Cloud Datastore Index Admin** (enough to publish rules and indexes; nothing else).
2. On that account open **Keys > Add key > JSON**. A file downloads. Open it in Notepad and copy **all** of it.
3. In GitHub: the repository > **Settings > Secrets and variables > Actions**:
   - New repository **secret** `FIREBASE_SERVICE_ACCOUNT` = the whole text you copied (put it nowhere else).
   - New repository **variable** `FIREBASE_PROJECT_ID` = your project id.
4. Delete the downloaded JSON file from your computer.

This only publishes rules and indexes (the free plan has no Cloud Functions). The website itself is deployed by Netlify. Push-to-deploy for it: Netlify's **Import from Git** (above) already connects the repository, so every push to `main` builds the site. Remember each production deploy uses 15 Netlify credits.

## A production site can never open as the demo

In `netlify.toml` the production build sets `NEXT_PUBLIC_REQUIRE_FIREBASE=1`. If the six `NEXT_PUBLIC_FIREBASE_*` settings are missing,
the build **stops** with a plain message instead of publishing a site that would open as the demo. Previews and branch deploys do not
set it, so demo previews still work.
