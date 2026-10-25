/**
 * Runs one command the same way in both modes (decisions D-37): demo mode on the browser store, Firebase mode inside
 * a Firestore transaction in the `command` callable (M1.6). The command either changes everything or nothing (a
 * failure part-way rolls back), and every command leaves an audit entry (spec §15: audit trail on create, edit,
 * approve, delete).
 */
import { type CommandCtx } from "./commands/common";
import { COMMANDS, type CommandArgs, type CommandName, type CommandResult } from "./commands/registry";
import { newId } from "./commands/common";
import type { Doc, JournalEntry, MemoryStore } from "./store";

/** Collections a command changes as a consequence (totals, postings, numbers): never the "what" of an audit entry. */
export const DERIVED_COLLECTIONS: ReadonlySet<string> = new Set([
  "rollups", "finance_rollups", "postings", "account_transactions", "counters", "audit_log", "worker_balances", "contract_scopes",
]);

const STAMP_FIELDS = new Set(["updatedAt", "updatedBy", "createdAt", "createdBy", "searchKeywords"]);

/**
 * One audit entry for a command that didn't write its own: the main record it touched (the first one that isn't a
 * derived total), whether it was created, changed or deleted, the fields that changed, and every path it wrote.
 */
export function auditFor(command: string, changes: JournalEntry[], ctx: CommandCtx): Doc | null {
  if (!changes.length || changes.some((c) => c.collection === "audit_log")) return null;
  const main = changes.find((c) => !DERIVED_COLLECTIONS.has(c.collection.split("/")[0]!) && !DERIVED_COLLECTIONS.has(c.collection)) ?? changes[0]!;
  const action = main.before === null ? "create" : main.after === null ? "delete" : "update";
  const keys = new Set([...Object.keys(main.before ?? {}), ...Object.keys(main.after ?? {})]);
  const fields = action === "update"
    ? [...keys].filter((k) => k !== "id" && !STAMP_FIELDS.has(k) && JSON.stringify(main.before?.[k]) !== JSON.stringify(main.after?.[k]))
    : [];
  const projectId = (main.after?.projectId ?? main.before?.projectId ?? (main.collection === "projects" ? main.id : null)) as string | null;
  return {
    id: newId(), entity: main.collection, entityId: main.id, action, command, fields: fields.slice(0, 40),
    paths: changes.map((c) => `${c.collection}/${c.id}`).slice(0, 60), projectId, by: ctx.uid, at: ctx.nowIso,
  };
}

/**
 * Run a command atomically on a store: on success, its result and the documents it changed (audit included); on
 * failure, every write is undone and the error is thrown on.
 */
export async function runCommand<N extends CommandName>(store: MemoryStore, name: N, args: CommandArgs<N>, ctx: CommandCtx): Promise<{ result: CommandResult<N>; changes: JournalEntry[] }> {
  const fn = COMMANDS[name] as unknown as (s: MemoryStore, a: CommandArgs<N>, c: CommandCtx) => CommandResult<N> | Promise<CommandResult<N>>;
  if (typeof fn !== "function") throw new Error(`Unknown command: ${String(name)}`);
  store.beginJournal();
  try {
    const result = await fn(store, args, ctx);
    const audit = auditFor(name, store.peekJournal(), ctx);
    if (audit) store.set("audit_log", audit);
    return { result, changes: store.endJournal() };
  } catch (e) {
    store.rollback();
    throw e;
  }
}
