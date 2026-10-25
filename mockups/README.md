# CRM mockups (Phase 0, replacing Figma)

HTML mockups of the six screens in spec §4A.13. They follow `docs\brand.md` v2.1 and [design-tokens.md](../docs/design-tokens.md), and use [`../tokens.css`](../tokens.css). All numbers are **sample data** (each screen is labelled).

| File | Screen |
|---|---|
| `index.html` | Dashboard (owner) |
| `project.html` | Project detail: Shiv Nagar CC Road, Overview tab |
| `expenses.html` | Expenses: pyramid tree, drill-down chart, entries for one category |
| `attendance.html` | Attendance (supervisor, mobile-first): three taps or fewer per worker |
| `invoice.html` | Bill preview: RA bill 3 to Nagar Nigam, per-line GST and deductions |
| `contract.html` | Contract preview: residential construction agreement |

Open any file in a browser; the links between screens work. The **Dark mode** switch works (top bar on tablet and desktop, first row of the ⋮ menu on phones), and `?theme=dark` or `?theme=light` forces a theme. Fonts load from Google Fonts, so the first view needs internet.

Shared files: `mockup.css` (components, which become the Phase 1 component library), `mockup.js` (navigation shell, icons, theme switch, ring charts). Some interactions are wired for review: the confirmation dialogs ("Send on WhatsApp", "Discard draft"), the attendance taps and counters, and the attendance save message.

Checked at 360, 768 and 1280 px in both themes: no horizontal page scroll. Screenshots and check output for each milestone are in `C:\GRIND\AmbikaGroups\progress\crm\` (latest: `2026-10-25_phase0-mockups-v2`). `CRM\.screenshots\` is scratch space only.
