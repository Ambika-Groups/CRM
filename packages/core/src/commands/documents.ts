/**
 * Document sharing commands (spec §8.5): "Log each share (who, when, to which number) on the document", and the
 * message templates the company can change (English and Hindi).
 *
 * - logShare: anyone who may read the shared record may log that they shared it. The row is append-only
 *   (`share_logs`, written only here; firestore.rules refuses client writes).
 * - saveShareTemplates: owner and accountant. Kept in `settings/templates` under `share`.
 */
import {
  SHARE_CHANNELS, SHARE_LOG_COLLECTION, buildShareLog, shareTemplatesFrom, validateShareTemplates,
  type ShareLogInput, type ShareLogRecord, type ShareTemplates,
} from "../documents";
import type { User } from "../model";
import { normaliseIndianMobile } from "../phone";
import { canRead } from "../roles";
import type { Doc, MemoryStore } from "../store";
import { CommandError, newId, requireRole, stampUpdate, trimOrEmpty, type CommandCtx, type CommandFn } from "./common";

/** Record that the caller shared a document (WhatsApp, the phone's share sheet, print…). */
export function logShare(store: MemoryStore, input: ShareLogInput, ctx: CommandCtx): { id: string } {
  const collection = trimOrEmpty(input?.collection), id = trimOrEmpty(input?.id);
  if (!collection || !id || collection === SHARE_LOG_COLLECTION) throw new CommandError("Choose the document that was shared.");
  if (!SHARE_CHANNELS.includes(input.channel)) throw new CommandError("Choose how it was shared.");
  const doc = store.get<Doc>(collection, id);
  // The same answer for "not there" and "not yours", so a share log can't be used to find out what exists.
  if (!doc || !canRead(collection, doc, { role: ctx.role, uid: ctx.uid, assignedProjectIds: ctx.projectIds })) {
    throw new CommandError("You can't open this document, so you can't share it.");
  }
  const phone = trimOrEmpty(input.phone);
  if (phone && !normaliseIndianMobile(phone)) throw new CommandError("Enter a 10-digit mobile number.", { phone: "Enter a 10-digit mobile number." });
  const row: ShareLogRecord = buildShareLog(newId(), { ...input, collection, id, phone }, doc, { uid: ctx.uid, name: store.get<User>("users", ctx.uid)?.name ?? "" }, ctx.nowIso);
  store.set(SHARE_LOG_COLLECTION, row as unknown as Doc);
  return { id: row.id };
}

/** Save the share messages. Every kind and both languages are needed; only the known `{words}` are allowed. */
export function saveShareTemplates(store: MemoryStore, input: { templates: ShareTemplates }, ctx: CommandCtx): { templates: ShareTemplates } {
  requireRole(ctx, ["owner", "accountant"], "change the share messages");
  const errors = validateShareTemplates(input?.templates);
  if (Object.keys(errors).length) throw new CommandError("Some messages need fixing.", errors);
  // Only the known kinds and languages are kept, trimmed.
  const share = shareTemplatesFrom({ share: input.templates });
  for (const k of Object.keys(share) as (keyof ShareTemplates)[]) share[k] = { en: share[k].en.trim(), hi: share[k].hi.trim() };
  store.merge("settings", "templates", { share, ...stampUpdate(ctx) });
  return { templates: share };
}

export const DOCUMENT_COMMANDS = {
  logShare: (s, a: ShareLogInput, c) => logShare(s, a, c),
  saveShareTemplates: (s, a: { templates: ShareTemplates }, c) => saveShareTemplates(s, a, c),
} satisfies Record<string, CommandFn>;
