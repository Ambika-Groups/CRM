/**
 * Admin commands (PRD §3.1 rule 16 as changed by D-51): the note that a backup was downloaded.
 *
 * There is no password command on purpose: a password never passes through a command, the store or the audit log.
 * The server part sets it directly (functions/src/staff.ts) and writes an audit entry that does not contain it.
 */
import type { BackupRecord } from "../admin";
import type { Doc, MemoryStore } from "../store";
import { CommandError, isNonNegInt, newId, requireRole, stampUpdate, type CommandCtx, type CommandFn } from "./common";

/** The most collection names a backup note may carry (children are added up under their parent's name by the screen). */
const MAX_COUNT_KEYS = 200;

export interface RecordBackupInput {
  /** Records per collection in the file that was downloaded. */
  counts: Record<string, number>;
  /** False when some collection could not be read: the reminder then stays. */
  complete?: boolean;
}

/** The owner downloaded a backup: remember when, who and how much, so the 7-day reminder knows (owner only). */
export function recordBackup(store: MemoryStore, input: RecordBackupInput, ctx: CommandCtx): BackupRecord {
  requireRole(ctx, ["owner"], "download a backup");
  const counts = input?.counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) throw new CommandError("The backup could not be noted. Download it again.");
  const keys = Object.keys(counts);
  if (keys.length === 0 || keys.length > MAX_COUNT_KEYS || keys.some((k) => !/^[A-Za-z0-9_\-/]{1,120}$/.test(k) || !isNonNegInt(counts[k]))) {
    throw new CommandError("The backup could not be noted. Download it again.");
  }
  const total = keys.reduce((a, k) => a + counts[k]!, 0);
  const complete = input.complete !== false;
  const prev = store.get<BackupRecord>("settings", "backup");
  // An incomplete file does not count as a backup: the last complete one keeps its date, so the reminder stays.
  const rec: BackupRecord = { id: "backup", lastBackupAt: complete ? ctx.nowIso : prev?.lastBackupAt ?? "", by: ctx.uid, counts: { ...counts }, total, complete };
  store.set("settings", { ...rec, lastAttemptAt: ctx.nowIso, ...stampUpdate(ctx) } as Doc);
  store.set("audit_log", {
    id: newId(), entity: "settings", entityId: "backup", action: "backup", command: "recordBackup", fields: [], paths: ["settings/backup"],
    projectId: null, after: { total, complete }, by: ctx.uid, at: ctx.nowIso,
  } as Doc);
  return rec;
}

export const ADMIN_COMMANDS = {
  recordBackup: (s, a: RecordBackupInput, c) => recordBackup(s, a, c),
} satisfies Record<string, CommandFn>;
