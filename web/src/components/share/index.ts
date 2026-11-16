// Share a document (spec §8.5): WhatsApp for the client's number, or the phone's own share sheet, and a row in the
// share log. No file can be attached through a wa.me link, so a file goes only through the share sheet, and only on
// devices that accept files there; everywhere else the message text is sent.
import { normaliseIndianMobile, whatsappLink, type ShareChannel } from "@ag/core";

export interface ShareDocumentInput {
  /** The record being shared: it is what the share log points at. */
  entity: { collection: string; id: string };
  /** The client's mobile in any typed form. Without one, the person picks who to send it to. */
  phone?: string | null;
  text: string;
  /** A file to attach where the device allows it (for example a PDF the page already holds). */
  file?: Blob | null;
  fileName?: string;
}
export type ShareResult = "shared" | "opened" | "cancelled";

export interface ShareLogRow { collection: string; id: string; channel: ShareChannel; phone?: string | null }
type ShareLogger = (row: ShareLogRow) => Promise<unknown>;

// The share log is written by the `logShare` command. A screen inside the data layer registers how to run it
// (ShareLogBridge.tsx); the last one registered is used.
const loggers: ShareLogger[] = [];
export function registerShareLogger(fn: ShareLogger): () => void {
  loggers.push(fn);
  return () => { const i = loggers.lastIndexOf(fn); if (i >= 0) loggers.splice(i, 1); };
}

async function log(row: ShareLogRow): Promise<void> {
  // The message has already left: a log that could not be written must not look like a failed share.
  try { await loggers[loggers.length - 1]?.(row); } catch { /* shown nowhere: the share itself went through */ }
}

const cancelled = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/**
 * "shared": the phone's share sheet sent it. "opened": WhatsApp was opened with the message. "cancelled": the person
 * closed the share sheet. Call it from a button press (browsers only open windows and share sheets on a press).
 */
export async function shareDocument({ entity, phone, text, file, fileName }: ShareDocumentInput): Promise<ShareResult> {
  const nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator;
  const mobile = phone ? normaliseIndianMobile(phone) : null;

  if (file && nav?.share && nav.canShare) {
    const f = file instanceof File ? file : new File([file], fileName || "document.pdf", { type: file.type || "application/pdf" });
    if (nav.canShare({ files: [f] })) {
      try {
        await nav.share({ files: [f], text });
        await log({ ...entity, channel: "web_share" });
        return "shared";
      } catch (e) {
        if (cancelled(e)) return "cancelled";
        // Anything else: fall back to the message alone.
      }
    }
  }

  if (!mobile && nav?.share) {
    try {
      await nav.share({ text });
      await log({ ...entity, channel: "web_share" });
      return "shared";
    } catch (e) {
      if (cancelled(e)) return "cancelled";
    }
  }

  window.open(whatsappLink(mobile, text), "_blank", "noopener,noreferrer");
  await log({ ...entity, channel: "whatsapp", phone: mobile ? `+91${mobile}` : null });
  return "opened";
}
