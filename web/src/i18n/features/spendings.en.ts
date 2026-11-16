/** Total spendings and expense heads (spec §7.1, §7.3). Read as t("spendings.<key>"). */
export const en = {
  title: "Total spendings",
  tabs: { spendings: "Total spendings", categories: "Expense heads" },
  filters: {
    label: "Filters", period: "Period", month: "This month", fy: "Financial year", custom: "Choose months", from: "From month", to: "To month",
    fyLabel: "Year", project: "Project", allProjects: "All projects and office", myProjects: "All my projects",
    view: "Show", viewAll: "All approved spending", viewPaid: "Paid only", viewUnpaid: "Not yet paid",
  },
  total: {
    all: "Total spent", paid: "Paid so far", unpaid: "Still to pay", range: "{{from}} to {{to}}",
    entries: "{{n}} approved entries", gst: "GST inside: {{amount}}",
    note: "Approved entries only. Entries waiting for approval are not counted.",
    mismatch: "The heads below do not add up to this total. Tell the office so the totals can be checked.",
  },
  heads: { label: "Summary by main head", all: "All", cat_labour: "Labour", cat_materials: "Materials", cat_commission: "Commission", cat_machinery: "Machinery", other: "Other" },
  chart: {
    title: "Where the money went", top: "All heads", path: "You are looking at", hint: "Tap a bar to see what is inside it.",
    open: "See what is inside", none: "Nothing was spent here in this period.", months: "Month by month", monthsOf: "Month by month: {{name}}",
    share: "{{pct}} of {{name}}",
  },
  tree: {
    title: "Every head, with amount and share", entries: "See entries", own: "Other {{name}}", unlisted: "Not under any head",
    archived: "Archived", tiny: "under 0.1%", amount: "Amount", percent: "Share of total",
  },
  csv: {
    download: "Download CSV", done: "Downloaded {{n}} rows.", level1: "Head", level2: "Level 2", level3: "Level 3", level4: "Level 4",
    amount: "Amount", gst: "GST inside", entries: "Entries", percent: "% of total",
  },
  empty: {
    title: "No approved spending in this period", body: "Choose another period or project. Expenses show here once they are approved.",
    noProject: "No project is assigned to you yet", noProjectBody: "Ask the owner to assign you to a project.",
  },
  cats: {
    title: "Expense heads",
    intro: "These are the heads people choose when they enter an expense. Pick a head to rename it, move it, archive it, or add a head under it.",
    readOnly: "Only the owner can change the expense heads.",
    list: "Expense heads", addTop: "Add a main head", pick: "Pick a head from the list below.", selected: "Selected: {{name}}",
    addUnder: "Add a head under it", rename: "Rename", move: "Move", archive: "Archive", restore: "Restore", archivedTag: "Archived",
    name: "Name in English", nameHi: "Name in Hindi", nameHiHint: "Optional. Shown when the app is in Hindi.",
    add: {
      title: "Add a main head", titleUnder: "Add a head under {{name}}", save: "Add head", done: "Head added.",
      note: "Entries already made on {{name}} stay there and show as “Other {{name}}”.",
    },
    renameDialog: { title: "Rename {{name}}", save: "Save name", done: "Name changed.", note: "Past entries and totals stay as they are. Only the name changes." },
    moveDialog: {
      title: "Move {{name}}", to: "Move it under", choose: "Choose a place", top: "Top level (a main head)", confirm: "Move head", done: "Head moved.",
      note: "Everything under it moves with it. No amount changes: the totals of the old place and the new place are worked out again.",
      finishing: "Finishing the move: {{n}} entries updated so far.", unfinished: "A move is not finished yet.", finish: "Finish the move",
    },
    archiveDialog: {
      title: "Archive {{name}}?", body: "It will no longer be offered for new expenses. Its past entries stay in the totals. You can restore it later.",
      confirm: "Archive", done: "Head archived.",
      restoreTitle: "Restore {{name}}?", restoreBody: "It will be offered again for new expenses.", restoreConfirm: "Restore", restored: "Head restored.",
    },
  },
  refusal: {
    ownerOnly: "Only the owner can change the expense heads.",
    notFound: "This expense head is no longer in the list. Reload the page and try again.",
    nameShort: "Enter a name of at least 2 letters.",
    nameLong: "Keep the name under 60 letters.",
    nameTaken: "There is already a head with this name at this place. Choose another name.",
    parentMissing: "Choose where the head should go.",
    parentArchived: "That head is archived. Restore it first.",
    tooDeep: "Heads can go 6 levels deep at most. Choose a place higher up.",
    sameParent: "The head is already there. Choose a different place.",
    underItself: "A head can't be moved under itself or under one of its own heads.",
    moveRunning: "The last move is still finishing. Let it finish, then try again.",
    moveMissing: "This move is no longer in the list. Reload the page.",
    hasActiveChildren: "Archive or move the heads under it first.",
    usedByRecurring: "A recurring expense uses this head. Pause or change that recurring expense first.",
  },
};
