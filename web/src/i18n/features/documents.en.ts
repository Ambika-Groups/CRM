// Documents: print, save as PDF, share (spec §8.4, §8.5). Read as t("documents.…"). The words printed on the page
// itself (headings, totals) live in core documents.ts, because the page is also made outside the screens.
export const en = {
  title: { invoice: "Bill", receipt: "Payment receipt" },
  back: "Back to quotes and bills",
  actions: "Print and share",
  draftNote: "This bill is still a draft, so it has no number yet. It gets its number when it is sent.",
  print: {
    action: "Print or save as PDF",
    hint: "To keep it as a file, press this button and choose \"Save as PDF\" in the print window of your phone or computer.",
  },
  share: {
    action: "Share on WhatsApp",
    to: "The message opens in WhatsApp for {{phone}}.",
    noNumber: "This client has no mobile number saved, so you choose who to send it to.",
    attach: "WhatsApp does not attach the file by itself: save the PDF first, then attach it in the chat.",
    opened: "WhatsApp is open with the message.",
    shared: "Shared.",
  },
  copy: { action: "Copy message", done: "Message copied.", failed: "Could not copy. Select the message and copy it yourself." },
  message: { title: "Message that will be sent" },
  lang: { label: "Language of the document" },
  sheet: { label: "The page as it will print" },
  history: { title: "Shared so far", empty: "Not shared yet.", noNumber: "Person chosen while sharing" },
  channel: { whatsapp: "WhatsApp", web_share: "Phone's share menu", email: "Email", download: "Saved as a file", print: "Printed" },
};
