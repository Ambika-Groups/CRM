# Ambika Group CRM: questions for you

Phase 0. Draft 4, 25 Oct 2026. Phase 0 documents and mockups signed off; answers to A4, A6, I6–I10 recorded; new CA question D18.

These are the things we need from you (and, where marked, your CA or advocate) before or during the build. Each answer changes what gets built, so the "Needed by" column says when it starts to block work. Write your answer under the question, or reply in chat. Where we've proposed a default, you can simply say "default is fine".

**Who to ask:** most questions are for the owner. Questions marked **CA** are best answered by your chartered accountant, and those marked **Advocate** by your lawyer.

---

## A. Things only you can do (accounts and setup)

| # | Action | Needed by |
|---|---|---|
| A1 | **Create three Firebase projects** (development, staging, production) on the Blaze plan, owned by the company's Google account, and add the developer as a member. Suggested IDs: `ambika-crm-dev`, `ambika-crm-staging`, `ambika-crm-prod`. Choose `asia-south1` (Mumbai) for Firestore. | Phase 1 start |
| A2 | **Set a ₹100 budget alert** on each of the three Firebase projects (your answer to I8). | Phase 1 start |
| A3 | ~~Install Java~~ **Not needed** (your decision, 25 Oct 2026). Java was only the runtime for the Firebase test emulator, not part of the CRM. Those tests now run on GitHub's servers (GitHub Actions) on every push, so nothing is installed on your computer (decisions D-36). | — |
| A4 | ~~Web3Forms webhook plan~~ **Resolved:** the free plan has no webhooks, so the enquiry contract (version 2) has the website post to a CRM function from Phase 3. Web3Forms stays as email-only until then; nothing to buy. | — |
| A5 | **Create a GitHub repository** owned by the company (spec §18). It holds the code, runs the free automated tests (GitHub Actions) and feeds the Netlify deploys. I make no commits until you say so. | Phase 1 start |
| A6 | ~~Approve the Phase 0 documents and the HTML mockups~~ **Both approved, 25 Oct 2026** (mockups with the supervisor's fixes). | — |
| A7 | **Create a Netlify account** linked to the GitHub account (free plan). The CRM's screens are hosted there; Google (Firebase) stays the back end (decisions D-36). Needed at the first deploy. | First deploy |

## B. Company details (spec §19 Q1)

| # | Question | Needed by |
|---|---|---|
| B1 | Exact **legal name** for invoices: "Ambika Group" or "Ambika Groups"? Is it a proprietorship, partnership or company? | Phase 2 |
| B2 | **GSTIN**, PAN, registered address and **state** (the state decides CGST+SGST vs IGST). | Phase 2 |
| B3 | Bank account(s) and UPI ID to print on invoices. | Phase 2 |
| B4 | Logo file, signature image, company stamp image. | Phase 2 (mockups can use placeholders) |
| B5 | ~~Brand colour~~ **Answered: red and white** (brand.md version 2). | — |

## C. People and roles (§19 Q2, Q6)

| # | Question | Needed by |
|---|---|---|
| C1 | How many users of each kind at launch: owner/admin, accountant, project manager / site engineer, supervisor, viewer, CA? Names and phone numbers when ready. | Phase 1 |
| C2 | Final list of **worker roles** (spec lists Mistri, Labour, Helper, Operator, Driver, Electrician, Plumber, Carpenter, Bar-bender, Supervisor, Other). Add or remove any? | Phase 1 |
| C3 | Typical **daily rates** for mistri and labour, and how overtime is paid (per hour, or a multiple of the daily rate)? | Phase 1 |
| C4 | How do you work with **thekedars** today: do they bring their own labour and get paid per job, or do you pay their workers directly? | Phase 1 |
| C5 | Should marking attendance require a **selfie and/or GPS** location? (Can be set per project.) Default: off. | Phase 1 |
| C6 | Attendance locks after how many days? Default: 3. | Phase 1 |
| C7 | Who gets **website enquiry** alerts, and who is the default person to follow up? | Phase 3 |

## D. Money and accounts (§19 accounts and CA questions)

| # | Question | Needed by |
|---|---|---|
| D1 | How many **cash, bank and UPI accounts** do you use? Opening balances and the date to start from. | Phase 1 |
| D2 | **CA:** What format does your CA accept today (Tally, Busy, Zoho Books, Excel)? Please get a sample file or column list. | Phase 1 (basic CSV) |
| D3 | **CA:** Is the company on **regular GST or the composition scheme**? | Phase 2 |
| D4 | **CA:** On which invoices is **TDS** deducted, and at what rates? | Phase 2 |
| D5 | **CA:** Government bills: which deductions apply and at what % (income-tax TDS, GST-TDS, labour cess, retention, royalty)? (§19 Q4) | Phase 2 |
| D6 | **CA:** GST rounding. We propose: GST calculated on **each line** and rounded to the paisa, invoice totals as the sum of the lines, and the grand total rounded to the nearest rupee with a "Round off" line. OK? (decisions D-15) | Phase 2 |
| D7 | **CA:** Labour cost, two parts. (a) Worker **advances**: we propose an advance is *not* an expense when given, only when it's recovered from wages (or written off). (b) The spec counts wages as expense **when paid**; wages earned but not yet paid are shown separately as "Wages due". Should labour cost instead be recognised **when earned** (from attendance)? (decisions D-16) | Phase 1 |
| D8 | Document number formats. GST law limits invoice, credit note, debit note and receipt voucher numbers to **16 characters**. We propose: invoices `AG/2026-27/0001` (from the spec), credit notes `CN/2026-27/0001`, debit notes `DN/2026-27/0001`, receipt vouchers for advances `RV/2026-27/0001`. Non-GST documents can be longer: proforma `AG/PF/2026-27/0001`, payment receipts `AG/R/2026-27/0001`, quotations `AG/Q/2026-27/0001` and contracts `AG/C/2026-27/0001` (both from the spec). OK? Is there an existing series this financial year we must continue from? (decisions D-12) | Phase 2 |
| D9 | Is **Tally** used by your accountant? (§19 Q8; Tally export is Phase 4.) | Phase 4 |
| D10 | **CA:** Does the CA want bill photos in the export ZIP? | Phase 2 |
| D11 | Who is the accountant user, and who reviews the CA export each month? | Phase 2 |
| D12 | Above what amount must an expense have a bill photo (or a written "no bill" reason)? Default: ₹2,000. | Phase 1 |
| D13 | Above what amount must a supervisor's expense be approved by the owner rather than the project manager? Default: everything a supervisor enters needs approval; owner approval above ₹25,000. | Phase 1 |
| D14 | **CA:** Should "Total expense" include or exclude GST? Where you claim input tax credit (usually government and works-contract jobs), GST isn't a cost; on projects where you can't claim it (e.g. residential units sold at the no-credit GST rates), it is. We store both, so this sets the default per project. Which of your projects claim input credit? (decisions D-20) | Phase 1 |
| D15 | **CA:** TDS on payments to thekedars and contractors (section 194C): confirm the rates you apply (we've assumed 1% for individuals, 2% for firms, 20% without PAN) and the thresholds below which you don't deduct. Do any vendors also need TDS? (decisions D-16) | Phase 1 |
| D16 | **CA:** GST on **client advances**. For works contracts, GST is usually due when an advance is received, which needs a receipt voucher with tax on it, adjusted against the final invoice. Do you issue these today? (decisions D-16) | Phase 2 |
| D18 | **CA:** Which **GST rate** applies to each type of work you bill: private construction, government works, and real estate (flat or house) sales? The mockups use 18% only as a sample. | Phase 2 |
| D17 | **CA:** Is the company's **aggregate turnover above ₹5 crore**? If so, every B2B and government tax invoice needs an e-invoice reference number (IRN) and signed QR code from the government portal, which changes how invoices are issued. (decisions D-15) | Phase 2 |

## E. Government work and tenders (§19 Q3, Q4, v1.3)

| # | Question | Needed by |
|---|---|---|
| E1 | Do Nagar Nigam / PWD require their own **formats for RA bills and the Measurement Book** that we must match exactly? Please share samples. | Phase 2 |
| E2 | Which departments use their own **EOT or hindrance** formats? | Phase 2 |
| E3 | Standard **delay penalty** (liquidated damages) rate and cap on your government work? | Phase 2 |
| E4 | After how many days without an EMD refund should we alert you? Default: 30 days after the tender result. | Phase 2 |

## F. Contracts (§19 v1.3)

| # | Question | Needed by |
|---|---|---|
| F1 | **Advocate:** who will draft or approve the contract templates? Please share any agreement formats you use today. | Phase 3 |
| F2 | Is a printed, signed and scanned copy enough at launch, or do you need **Aadhaar e-sign**? | Phase 3 |
| F3 | How is stamp paper handled in your state (physical or e-stamp)? | Phase 3 |
| F4 | Your usual **delay penalty and retention** terms with clients and with contractors? | Phase 3 |

## G. Stock and machinery

| # | Question | Needed by |
|---|---|---|
| G1 | Reorder levels for cement, steel, gitti and balu on your sites? | Phase 3 |
| G2 | Which units do you use for gitti and balu: brass, cubic metre, tonne, or trolley? | Phase 3 |
| G3 | List of your own machines and the machines you usually hire, with hire rates. | Phase 3 |

## H. Website, hosting and data (§19 Q7, Q9)

| # | Question | Needed by |
|---|---|---|
| H1 | Domain name for the CRM (e.g. `crm.<your domain>`) and the website. Until then the CRM runs on a free `*.netlify.app` address. Each address is added to Firebase sign-in's authorized domains at the first deploy. | First deploy |
| H2 | Any data to bring in from Excel or notebooks: workers, vendors, clients, opening balances, running projects? | Phase 1 |
| H3 | Monthly budget you're comfortable with for hosting (the cost estimate in Milestone 2 will give a figure). | Milestone 2 |

## I. New questions from the design work

| # | Question | Needed by |
|---|---|---|
| I1 | WhatsApp PDF links: how long should a shared invoice link work? Default: 30 days, and you can cancel a link any time. | Phase 2 |
| I2 | Should a project manager be able to approve expenses, or only the owner and accountant? Default: the PM approves on their own projects up to a limit (D13). | Phase 1 |
| I3 | Should **viewers** see money totals (dashboard and reports), or only progress and attendance? Default: totals and reports, no individual bills. | Phase 1 |
| I4 | Company-wide expenses that belong to no project (office rent, owner's vehicle): record them in the CRM? Default: yes, under a "Head office" view. | Phase 1 |
| I5 | Please have a Hindi-speaking team member check the Hindi screen labels and hints (design-tokens.md §5.1), e.g. "मिला पैसा" for Money received and "देना है" for To pay. Are these the words your supervisors use? | Mockups |
| I6 | Backups: the spec asks for a daily full export, which would cost about ₹4,000/month in year 1 and ₹18,000/month by year 5. We recommend Firestore's own daily and weekly backups plus 7-day point-in-time recovery and a monthly export, for a few hundred rupees. OK? (cost-estimate.md §5) **Your answer: decide later, before go-live.** A tested restore is still required before go-live. | Before go-live |
| I7 | ~~Keep the PDF server warm?~~ **Answered: no.** Start without it; the first PDF after a quiet spell may take 5–10 seconds. | — |
| I9 | ~~Sign-in for site staff~~ **Answered:** Google sign-in for site staff, email and password for office staff, SMS codes only as a backup (India only). This changes the spec, because each SMS costs about ₹6 (decisions D-35). | — |
| I10 | ~~Where photos and PDFs are stored~~ **Answered: US (us-central1), free up to 5 GB.** Worker ID proofs are stored in the US, so **only masked Aadhaar copies** (first 8 digits hidden) are accepted (decisions D-22). | — |
| I8 | ~~Monthly budget~~ **Answered: everything should cost ₹0.** Blaze plan with a card on file, designed to stay inside the free allowances (decisions D-34), with a **₹100 budget alert** on each project. The alert only warns; it doesn't stop spending. | — |
