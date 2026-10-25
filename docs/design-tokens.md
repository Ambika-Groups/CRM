# Ambika Group CRM: design tokens and UI rules

Phase 0 deliverable (spec §4A.13 token sheet). Draft 2, 26 Oct 2026: **brand.md version 4.1** (4.1: sharp Inter Tight headings). Draft 1 (25 Oct) followed version 2.

**Source:** [`docs/shared/brand.md`](shared/brand.md) **version 4**: the palette #F12136, #B23A48, #FCB9B2 and #FED0BB, in the style of clio.praxistence.com. It is rounded and minimal, with calm motion in the CRM. Version 4 **replaces** versions 1–3, including the square corners, the red-and-white palette and the "no glow" rule. That file is shared with the website and owned by the supervisor. This document adds the CRM's type scale, sizes, chart palette and UI rules. The values live in [`tokens.css`](../tokens.css). Where the user's direction overrides the spec, see decision **D-26**.

---

## 1. Colour

brand.md v4 measured every text pair (WCAG 2.x). The three pairs the CRM adds (the selected background and the attendance toggles) are measured here too. Light is the default.

| Token (`tokens.css`) | Light | Dark | Use |
|---|---|---|---|
| `--color-page` | #FFFDF9 warm white | #0B0B0C | page background |
| `--color-surface` | #FFFFFF | #161416 | cards, tables, forms |
| `--color-elevated` | #FFFFFF + shadow | #211D20 | menus, dialogs |
| `--color-tint` / `--color-tint-2` | #FED0BB peach / #FCB9B2 pink | #211D20 | tint bands and highlights. **Ink text only** on them |
| `--color-divider` | ink at 10% | #F5F3EF at 12% | decorative lines only |
| `--color-input-border` | #8C7F78 (3.81) | #6E676B (3.03+) | every form field |
| `--color-text` (ink) | #1A1206 (18.24) | #F5F3EF (15.02+) | |
| `--color-text-secondary` | #6B5E57 (6.14) | #A9A2A6 (6.66+) | **never on peach or pink** |
| `--color-brand` | #D7192C (5.09) | #FF4A5C (5.06–5.98) | red as small text: links, icons, active item, focus ring |
| `--color-brand-on-tint` | #BE1428 (4.50 on peach) | #FF4A5C | red text on a peach band |
| `--color-accent` | #F12136 | #F12136 | fills, large type, active markers |
| `--color-primary` / `--color-on-primary` | #F12136 / **#0B0B0C** (4.69) | same | primary button. White on #F12136 is only 4.19, so it isn't used |
| `--color-primary-hover` / `--color-on-primary-hover` | #D7192C / white (5.17) | #FF4A5C / #0B0B0C (5.98) | hover and pressed |
| `--color-secondary` / `--color-on-secondary` | #B23A48 rose / white (5.85) | #211D20 / #FED0BB peach | secondary buttons (see §5.2) |
| `--color-selected` | #FFEFEA (red text 4.62, ink 16.58) | #2A1C1F (red text 4.97, ink 14.75) | selected nav item, row, filter |
| `--color-success` | #1E7B34 | #81C995 | |
| `--color-warning` | #8F5B00 | #FDD663 | |
| `--color-error` | #D7192C | #FF4A5C | always with an icon and words |
| `--color-glow` | #F12136 at 12% | #FED0BB at 12% | focus halo; spotlight on dashboard KPI cards |
| `--color-glass` | warm white at 78% + 16 px blur | #161416 at 72% | **only** the top bar, the phone bottom bar and the phone sheet |

**Attendance toggles (pressed):** the label uses the surface colour on the status fill:
- light: white on success 5.33, on warning 5.73, on error 5.17, on secondary 6.24;
- dark: #161416 on success 9.36, on warning 13.07, on error 5.57, on secondary 7.34.

**Status badges** have 6 px corners, a 1 px border and text in the status colour on the surface, with an icon. There are no tinted fills.

| Status | Colour | Icon (Lucide) |
|---|---|---|
| Active, Signed, Paid, Approved | success | `check-circle` |
| Partially paid, Pending approval, Draft | warning (Draft: secondary text) | `clock` / `file` |
| Overdue, Delayed, Rejected | error | `alert-triangle` / `x` |
| Completed | secondary text | `check` |

## 2. Typography

- **Headings:** **Inter Tight** 600, sentence case, tracking −0.02 em (brand.md 4.1: sharp fonts). Hindi headings use **Noto Sans Devanagari** 600.
- **Body and UI:** **Inter** 400 for body, 500 for labels and buttons, 600 for emphasis. Hindi body text uses **Noto Sans Devanagari**.
- **Small labels, IDs and keyboard hints:** **JetBrains Mono**. That covers the sample-data tag and the Ctrl K hint.
- **Money and quantities:** Inter with `tabular-nums` in every table, KPI and figure. Inter has the `tnum` feature, so columns line up. Never the mono font.
- **Loading:** fonts load from Google Fonts with `display=swap`. Only the weights used are loaded. The Devanagari faces are fetched only when a Devanagari character appears (`unicode-range`).

| Role | Size / line | Weight |
|---|---|---|
| Caption (minimum anywhere) | 12 / 16 | 400 |
| Small, secondary text | 14 / 20 | 400 |
| **Table cells** | **14 / 20** | 400; header 500 |
| **Body and all inputs** | **16 / 24** | 400 |
| Labels, buttons | 16 / 24 (14 / 20 in dense tables) | 500 |
| Card title | 18 / 24 Inter Tight | 600 |
| Section heading | 22 / 28 Inter Tight | 600 |
| Page title | 28 / 36 on phone and tablet, 32 / 40 on desktop, Inter Tight | 600 |
| KPI value | 28 / 36 on phone, 32 / 40 on desktop, Inter tabular | 600 |

The Hindi UI uses Western digits, so amounts read the same in both languages.

## 3. Shape, surfaces, spacing, motion

- **Radius:**
  - buttons, chips, segmented controls and the language toggle: pill (999 px)
  - cards, panels, KPI cards and dialogs: 20 px
  - inputs, selects, menus, table wraps, banners and toasts: 12 px
  - badges: 6 px
  - avatars and icon buttons: round
  - on phones the dialog is a bottom sheet with a 20 px top radius
- **Surfaces:**
  - light: a 1 px ink-at-8% border and the soft large shadow `0 30px 60px -35px rgba(60,40,10,.35)`
  - dark: a 1 px off-white-at-10% border plus `0 30px 70px -35px rgba(0,0,0,.9)`
- **Glass:** only the top bar, the phone bottom bar and the phone sheet. Warm white at 78% (dark: #161416 at 72%), 16 px backdrop blur and a thin peach border.
- **Spacing:** 4/8 px grid. Page gutters are 16, 24 and 32 px. Card padding is 16 px on phones and 24 px from 600 px. The CRM stays compact (§4A.6).
- **Active navigation:** a 3 px pill marker in #F12136 and the selected background, with 12 px rounded items.
- **Tap targets:** 48 px on phones and controls 40 px tall on desktop.
- **Icons:** Lucide line icons, 20 px, 1.75 px stroke, each with a text label.
- **Focus:** a 2 px brand-red outline, a 2 px offset, and a 6 px glow halo.
- **Motion (CRM: calm):**
  - **Hover and focus:** 150 ms on colour, background, border and shadow.
  - **Menus and dialogs:** 300 ms opening (opacity plus an 8 px rise; the dialog fades on desktop), with ease-out `cubic-bezier(0.16, 1, 0.3, 1)`.
  - **Dashboard KPI cards only:** a 600 ms staggered reveal on first load and the spotlight glow that follows the pointer.
  - **None** on tables, forms or attendance: no movement, magnetic effects, marquee or scroll reveal.
  - **Reduced motion:** `prefers-reduced-motion` turns every transition and animation off, and the spotlight too. Nothing is hidden without JavaScript.

## 4. Charts

A fixed series order, so a category keeps its colour across every chart and both themes. Labour, Materials, Commission, Machinery and Other map to the five summary tabs (§7.3).

| # | Series | Light | Dark |
|---|---|---|---|
| 1 | Labour | #F12136 red | #FF4A5C |
| 2 | Materials | #6E1B26 deep rose | #FED0BB peach |
| 3 | Commission | #FED0BB peach, **1 px ink outline** | #B23A48 rose |
| 4 | Machinery | #8C7F78 warm grey | #F5F3EF off-white |
| 5 | Other | #2F4858 slate | #7FA3C2 steel |

**Checked 26 Oct 2026** with `cvd.js`: WCAG contrast, and the minimum CIEDE2000 distance between every pair after simulating colour-vision deficiency (Machado et al. 2009, full severity).

| | Light (on #FFFFFF) | Dark (on #161416) |
|---|---|---|
| Contrast (graphics need ≥3:1) | 3.87 to 11.37; peach 1.40, so it is outlined | 3.13 to 16.54 |
| Min ΔE, normal vision | 26.8 | 16.4 |
| Min ΔE, protanopia | 17.3 | 11.2 |
| Min ΔE, deuteranopia | 19.7 | 12.0 |
| Min ΔE, tritanopia | 26.2 | 12.1 |

**What was rejected:** a palette using only brand hues (red, rose, peach and pink companions, warm grey). Red against the orange-peach companion falls to **ΔE 4.3** under deuteranopia and protanopia, and in dark mode pink against peach to 3.7. A warm-only palette can't be told apart by colour-blind users, so the series vary in **lightness**, and the "neutral" is a cool slate (steel in dark). A ΔE above about 10 is clearly distinguishable side by side.

**Chart rules:**
- **Never red against green alone.** Success green is a status colour, never a chart series.
- **Direct labels:** slices carry their name and percentage, and bar series have end labels or an ordered legend. Colour is never the only cue.
- **Gaps and outlines:** slices and bars are separated by a 2 px surface-coloured gap. Light peach slices also get a 1 px `--chart-outline`.
- **Grid and values:** grid lines use the divider colour and axes the secondary text. Values use Inter tabular figures in Indian format.
- **Table view:** every chart has a "View as table" toggle.
- **Income against expense:** slate or steel for money in, red for money out.

## 5. UI rules (CRM specifics; brand.md v4 for the look)

### 5.1 Plain-language labels

The UI uses these words, not the spec's internal names. Hindi strings are drafts for review by a native speaker (open question I5).

**Navigation** (spec §4A.5 items, role visibility applies):

| Spec item | English label | Hindi label |
|---|---|---|
| Overview | Home | होम |
| Projects & Sites (incl. Tenders) | Projects | प्रोजेक्ट |
| Labour & Attendance | Workers & attendance | मज़दूर और हाज़िरी |
| Expenses & Payments | Expenses | खर्च |
| Procurement & Inventory | Purchases & stock | ख़रीद और स्टॉक |
| Clients & CRM (incl. Leads) | Clients & enquiries | ग्राहक और पूछताछ |
| Quotations & Invoices | Quotes & bills | कोटेशन और बिल |
| Contracts | Contracts | अनुबंध |
| Accounting & CA Export | Accounts | हिसाब-किताब |
| Calendar & Tasks | Calendar & tasks | कैलेंडर और काम |
| Machinery & Equipment | Machines | मशीनें |
| Real Estate & Properties | Properties | प्रॉपर्टी |
| Reports & Documents | Reports | रिपोर्ट |
| Settings | Settings | सेटिंग्स |

Phone bottom navigation (spec §4A.5): **Home** होम · **Attendance** हाज़िरी · **Expenses** खर्च · **Projects** प्रोजेक्ट · **More** और

**Main actions and money words:**

| Meaning | English | Hindi |
|---|---|---|
| Record an expense | Add expense | खर्च जोड़ें |
| Mark today's attendance | Mark attendance | हाज़िरी लगाएँ |
| Mark everyone present | Mark all present | सबको हाज़िर करें |
| Payments received from clients | Money received | मिला पैसा |
| Record a client payment | Record money received | मिला पैसा दर्ज करें |
| Client dues, retention, TDS held | To receive | लेना है |
| Vendor dues, wages, machine rent | To pay | देना है |
| Pay workers | Pay wages | मज़दूरी दें |
| Wages earned but not paid | Wages due | बकाया मज़दूरी |
| Advance to a worker | Give advance | एडवांस दें |
| New invoice | New bill | नया बिल |
| New quotation | New quote | नया कोटेशन |
| Share | Send on WhatsApp | WhatsApp पर भेजें |
| Download | Download PDF | PDF डाउनलोड करें |
| Approve / reject | Approve · Reject | मंज़ूर करें · नामंज़ूर करें |
| Approval pending | Waiting for approval | मंज़ूरी बाकी |
| Export for the CA | Send to CA | CA को भेजें |
| Cash and bank balances | Money in hand and bank | हाथ में और बैंक में पैसा |
| Lock a month | Close month | महीना बंद करें |
| Theme switch | Dark mode | डार्क मोड |
| Save / cancel | Save · Cancel | सेव करें · रद्द करें |
| Delete (destructive) | Delete | हटाएँ |

On the screen the CA uses (Accounts), the accounting term follows the plain one in brackets, e.g. "Money received (Receipts)", so the CA and the owner read the same screen.

**Hints for unavoidable terms.** Shown as a one-line hint under the label the first time the term appears on a screen, and as a tooltip after that (tap on phones).

| Term | English hint | Hindi hint |
|---|---|---|
| EMD | Deposit paid with a tender bid; refunded after the result. | टेंडर के साथ जमा की गई राशि; नतीजे के बाद वापस मिलती है। |
| RA bill | Running bill: part-payment bill for work done so far. | चालू बिल: अब तक हुए काम का आंशिक बिल। |
| BOQ | List of work items with quantity and rate (Bill of Quantities). | काम की सूची, मात्रा और रेट के साथ। |
| MB | Measurement Book: measured quantities of work done. | नाप पुस्तिका: किए गए काम की नाप। |
| GST | Goods and Services Tax on the bill. | बिल पर लगने वाला GST टैक्स। |
| TDS | Tax deducted from a payment and paid to the government. | भुगतान से काटा गया टैक्स, जो सरकार को जमा होता है। |
| Retention | Part of the bill held back by the client until the work is cleared. | बिल का हिस्सा जो काम पास होने तक ग्राहक रोकता है। |
| Performance guarantee | Bank guarantee given to the department; has an expiry date. | विभाग को दी गई बैंक गारंटी; इसकी तारीख खत्म होती है। |
| EOT | Extension of time: extra days approved to finish the work. | समय बढ़ोतरी: काम पूरा करने के लिए मंज़ूर अतिरिक्त दिन। |
| HSN / SAC | Tax code for the item or service, printed on GST bills. | सामान या सेवा का टैक्स कोड, GST बिल पर छपता है। |
| Proforma | Estimate bill for advance payment; not a tax bill. | एडवांस के लिए अनुमानित बिल; टैक्स बिल नहीं। |
| Input credit (ITC) | GST paid on purchases that can be set off against GST collected. | ख़रीद पर दिया GST, जो वसूले गए GST में घटता है। |
| Voucher | Serial number the CA uses for each money entry. | हर लेन-देन का नंबर, जो CA इस्तेमाल करते हैं। |

### 5.2 Buttons

| Kind | Look | Use |
|---|---|---|
| **Primary** | Pill, #F12136 fill, **#0B0B0C label** (4.69); hover #D7192C with a white label (dark: #FF4A5C, black label) | **The one main action on the screen**, always in the same place: bottom-right of a form or dialog on desktop, a full-width bar pinned to the bottom on phones. At most one per screen or dialog. |
| Secondary | Pill. **Light:** rose #B23A48 outline and label (5.85) on the surface. **Dark:** raised surface, input-border outline, peach label. brand.md v4 allows rose-filled secondaries; the CRM outlines them because a screen often has several (Edit, Archive, Columns, Export), and filled rose would compete with the one red main action | Other actions (Cancel, Download PDF, Filter) |
| Text | No border, brand-red label | Low-emphasis links (View all, Edit) |
| **Destructive** | **Outlined red** (1 px red border, red label, no fill), or a red text button | Delete, cancel an invoice, remove a worker from a project, reject. **Always followed by a confirmation dialog** in plain words (5.5) |

- The floating quick-add button on phones (spec §4A.5) is a **round** 56 px red button (black plus icon) labelled "Add" with a plus icon. It opens a bottom sheet: Add expense, Mark attendance, Money received, Add photo.
- Buttons are never icon-only (except close and back), always pill-shaped (brand.md v4), and never disabled without a reason. A disabled button shows a hint saying why, e.g. "Add a bill photo or a reason to save".
- Double submission is blocked: the button shows a spinner and "Saving…" until the write is queued.

### 5.3 Navigation by screen size (Material)

| Width | Pattern | Detail |
|---|---|---|
| **< 600 px** (phone) | **Bottom navigation** | 5 items with icon + label (Home, Attendance, Expenses, Projects, More); active item marked by a 3 px red top bar and red icon and label. "More" opens a full-screen list of the remaining items. Supervisors see only their site's items. |
| **600–1023 px** (tablet) | **Navigation rail with labels** | 88 px wide, icon above a 12 px label, every item visible (scrolls if needed); active item has the `--color-selected` background and a 3 px red left bar. |
| **≥ 1024 px** (desktop) | **Sidebar** | 256 px, icon + label, collapsible to the rail, AG mark at the top; active item as in the rail. |

**Top bar** (every size, 56 px): page title (phones) or breadcrumbs (tablet and desktop), project selector where relevant, search (opens the command palette, Ctrl/Cmd + K on desktop), notifications, language toggle (EN / हिं), online/offline sync indicator, **Dark mode switch**, profile. On phones and tablets, the ⋮ menu holds what doesn't fit (search, language, sync state, profile); on phones its **first row is the Dark mode switch** (§6, brand.md v2.2), so the page title shows in full.

### 5.4 Tables

- On desktop and tablet: compact rows (44 px), sticky header (shadow 1 in light), right-aligned tabular money columns, status badges, a row menu labelled "Actions", server-side pagination (25 or 50), column visibility, and Export.
- **Below 600 px, every table becomes a list of cards.** One card per row:
  - title (party or item) and amount on the first line
  - date and status badge on the second
  - up to two more fields
  - the whole card opens the record, and actions sit inside the record, never on the card
- Wide tables scroll only inside their own container. The page itself never scrolls sideways.

### 5.5 Messages

**Empty state** (no illustrations): a 24 px line icon, one sentence saying what will appear here, one sentence on what to do, and **one** button.
> *[icon: receipt]* **No expenses yet for this project.** Add the first one with its bill photo. **[Add expense]**

**Success** (toast for 4 s, bottom on phones, bottom-left on desktop): says what happened and what's next, with Undo where possible.
> Expense saved. Waiting for approval.
> Attendance saved for 42 workers. It will sync when you're online.
> Bill AG/2026-27/0012 sent on WhatsApp to Sharma Builders.

**Error** (inline next to the field, plus a summary at the top of long forms): icon + what's wrong + how to fix it. Typed data is never lost.
> *[icon: alert]* Enter a 10-digit mobile number, like 98765 43210.
> *[icon: info]* Upload a masked Aadhaar: the first 8 digits must be hidden. You can download one from the UIDAI website. (KYC upload hint, D-22)

> *[icon: alert]* September is closed. Ask the owner to reopen it, or record this as an adjustment in October.

**Confirmation dialog** (before deleting anything or moving money): the title says exactly what will happen, with the amount, date and party; the body gives the consequence; the buttons are the destructive verb and "Keep it" / "Go back".
> **Delete the ₹12,500 cement expense from 25 Oct 2026?**
> It will be removed from the project's totals. The owner can see it in the deleted list.
> **[Go back]** **[Delete expense]** (outlined red)

> **Pay ₹1,84,300 in wages to 42 workers at Shiv Nagar Road?**
> This records cash payments from Cash in hand and updates each worker's balance.
> **[Go back]** **[Pay ₹1,84,300]** (solid red: the main action of this flow)

**Offline:** a persistent strip under the top bar ("Offline. 6 entries will sync when you're back online."). Never a blocking dialog.

### 5.6 Forms

- One column on phones and at most two on desktop, with a label above every field and an example in the hint ("e.g. 25 bags").
- Inputs are 16 px text and 48 px tall on phones, 40 px on desktop, 12 px corners, with a 1 px input-border and a 2 px red focus outline.
- Dates are typed as DD/MM/YYYY with a calendar picker (D-03). Money is typed in rupees and shown with ₹ and Indian grouping as you type.
- Bottom sheets for short forms on phones (spec §4A.2); full pages for long ones. Multi-step only for new project, contract and tender (spec §4A.8).

## 6. Light / dark switch

The user asked for this specifically.

**Control.** A switch with the text label "Dark mode" (डार्क मोड), a sun or moon icon, pill track and round thumb, `role="switch"` with `aria-checked`. **Placement (brand.md v2.2):** in the top bar on tablet and desktop; **on phones, the first row of the ⋮ menu**, as on the website, so the page title is never cut off and the switch keeps its text label. Its row is 48 px tall.

**Profile menu.** Keeps the three-way choice from spec §4A.4: **Light / Dark / System**. Turning the top-bar switch on or off sets Dark or Light explicitly; System is chosen only in the profile menu. While System is active, the switch shows the theme currently applied.

**Saving.**
1. On change: apply immediately, write `localStorage['ag-theme']` (inside try/catch), and update `users/{uid}.theme` (an offline write is fine; it syncs).
2. On sign-in: if `users.theme` differs from the cached value, the profile wins and the cache is updated.
3. First visit: no stored value, so follow the device (`prefers-color-scheme`).

**No flash.** This inline script goes first in `<head>`, before any stylesheet, in Next.js through the root layout:

```html
<script>
(function () {
  var t = null;
  try { t = localStorage.getItem('ag-theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  var d = document.documentElement;
  d.setAttribute('data-theme', t);
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', t === 'dark' ? '#121212' : '#F5F5F5');
})();
</script>
```

The stored value is `light`, `dark` or `system`; anything other than `light` or `dark` resolves through the media query. With System selected, the app also listens for `prefers-color-scheme` changes. `tokens.css` keys every colour off `[data-theme]`, with a media-query fallback only when the attribute is missing (JS disabled).

## 7. PDFs (invoices, quotations, contracts)

- Brand red is the **single accent** (spec §8.4): #D7192C for small text and rules in print, #F12136 for large fills. It's used for the AG mark, the document title rule (a 3 px bar), and the totals block's grand-total line. Everything else is black and greys on white.
- Inter for body and figures (tabular) with Inter Tight headings, plus Noto Sans Devanagari, embedded (Puppeteer, D-27). Thin table rules in ink at 10%; documents stay rectangular for print.
- PDFs are always light, whatever the app theme.
- Check in print: on a monochrome printer the red becomes a mid-dark grey. The PAID / DRAFT watermark is outlined text, so it stays readable in both.

## 8. Checks before the mockups are signed off

- Every screen at 360, 768 and 1280 px, in both themes (supervisor's list; brand.md adds 390, 1024 and 1440 for the build).
- Hindi strings in every container (they run longer).
- Keyboard focus visible on every control. Contrast spot checks on any colour pair not listed in §1.
