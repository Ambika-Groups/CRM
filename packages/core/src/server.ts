/**
 * The server side of a command (M1.6), free of any Firebase import so it is tested here without the emulator.
 *
 * Commands are synchronous over a MemoryStore. On the server the store starts empty: a LoadingStore answers from
 * what has been loaded so far and records every document or list it didn't have. The `command` callable runs the
 * command, loads everything recorded in one batch inside its Firestore transaction, and runs it again on a fresh
 * store, until a run misses nothing; that run's changes are then written in the same transaction. A run that
 * missed something is thrown away, so a guess made on missing data never reaches the database.
 */
import { seedCategories } from "./categories";
import type { CommandCtx } from "./commands/common";
import type { CommandArgs, CommandName, CommandResult } from "./commands/registry";
import { DEFAULT_WORKER_ROLES } from "./commands/people";
import type { Role, User } from "./model";
import { runCommand } from "./runner";
import { MemoryStore, getPath, type Doc, type JournalEntry, type ListHint } from "./store";

/** A list the command asked for: a whole collection, or the documents where one field equals a value. */
export interface ListNeed { collection: string; hint?: ListHint }

export const listKey = (n: ListNeed) => (n.hint ? `${n.collection}|${n.hint.field}|${JSON.stringify(n.hint.value)}` : n.collection);

/** Everything loaded so far for one command, kept across runs. */
export class Loaded {
  /** "collection/id" → the document, or null when it doesn't exist. */
  readonly docs = new Map<string, Doc | null>();
  /** Lists already loaded (listKey). */
  readonly lists = new Set<string>();

  addDoc(collection: string, id: string, doc: Doc | null) { this.docs.set(`${collection}/${id}`, doc ? { ...doc, id } : null); }
  addList(need: ListNeed, docs: Doc[]) {
    for (const d of docs) this.addDoc(need.collection, d.id, d);
    this.lists.add(listKey(need));
  }
}

export class LoadingStore extends MemoryStore {
  readonly missingDocs = new Set<string>();
  readonly missingLists = new Map<string, ListNeed>();
  /** Documents this run wrote: reading them back never needs the database. */
  private written = new Set<string>();

  constructor(private loaded: Loaded) {
    super();
    for (const [path, doc] of loaded.docs) {
      if (!doc) continue;
      const { collection, id } = MemoryStore.split(path);
      if (!this.data.has(collection)) this.data.set(collection, new Map());
      this.data.get(collection)!.set(id, structuredClone(doc));
    }
  }

  get missedAnything() { return this.missingDocs.size > 0 || this.missingLists.size > 0; }

  private fullyLoaded(collection: string) { return this.loaded.lists.has(collection); }

  override get<T = Doc>(collection: string, id: string): T | null {
    const path = `${collection}/${id}`;
    if (!this.loaded.docs.has(path) && !this.written.has(path) && !this.fullyLoaded(collection)) this.missingDocs.add(path);
    return super.get<T>(collection, id);
  }

  override list<T = Doc>(collection: string, filter?: (d: T) => boolean, hint?: ListHint): T[] {
    const need: ListNeed = hint ? { collection, hint } : { collection };
    if (!this.fullyLoaded(collection) && !this.loaded.lists.has(listKey(need))) this.missingLists.set(listKey(need), need);
    return super.list<T>(collection, filter, hint);
  }

  override set(collection: string, doc: Doc): void { this.written.add(`${collection}/${doc.id}`); super.set(collection, doc); }
  override delete(collection: string, id: string): void { this.written.add(`${collection}/${id}`); super.delete(collection, id); }
}

/** Reads the server does for a run that missed something, all in one batch. */
export interface LoadPlan { docs: { collection: string; id: string }[]; lists: ListNeed[] }

export interface Loader { load(plan: LoadPlan, into: Loaded): Promise<void> }

export const MAX_RUNS = 12;

/**
 * Run a command until it misses nothing, loading what each run asked for. Returns the result and the changes to
 * write. A command error is only trusted from a complete run (one that missed nothing).
 */
export async function runWithLoads<N extends CommandName>(loader: Loader, name: N, args: CommandArgs<N>, ctx: CommandCtx): Promise<{ result: CommandResult<N>; changes: JournalEntry[]; runs: number }> {
  const loaded = new Loaded();
  for (let run = 1; run <= MAX_RUNS; run++) {
    const store = new LoadingStore(loaded);
    let out: { result: CommandResult<N>; changes: JournalEntry[] } | null = null;
    let error: unknown = null;
    try { out = await runCommand(store, name, args, ctx); } catch (e) { error = e; }
    if (store.missedAnything) {
      await loader.load({ docs: [...store.missingDocs].map((p) => MemoryStore.split(p)), lists: [...store.missingLists.values()] }, loaded);
      continue;
    }
    if (error) throw error;
    return { ...out!, runs: run };
  }
  throw new Error(`The command ${String(name)} needed more than ${MAX_RUNS} rounds of reads.`);
}

// ---------- Sign-in claims (D-05): the role and assigned projects the security rules check ----------

export interface Claims { role: Role; projects: string[]; superUser?: boolean }

/** Claims for a user document, or null when the user may not sign in (inactive or missing). */
export function claimsFor(user: Pick<User, "role" | "active" | "projectIds" | "superUser"> | null): Claims | null {
  if (!user || !user.active) return null;
  const claims: Claims = { role: user.role, projects: [...(user.projectIds ?? [])].sort() };
  if (user.role === "owner" && user.superUser === true) claims.superUser = true; // D-48
  return claims;
}

/** The user IDs whose claims a set of changes may have altered: users edited, or project assignments changed. */
export function usersToResync(changes: JournalEntry[]): string[] {
  const out = new Set<string>();
  for (const c of changes) {
    if (c.collection === "users") {
      const b = c.before as Partial<User> | null, a = c.after as Partial<User> | null;
      if (b?.role !== a?.role || b?.active !== a?.active || (b?.superUser === true) !== (a?.superUser === true) || JSON.stringify([...(b?.projectIds ?? [])].sort()) !== JSON.stringify([...(a?.projectIds ?? [])].sort())) out.add(c.id);
    }
    if (c.collection === "projects") {
      const b = new Set((getPath(c.before, "assignedUsers") as string[] | undefined) ?? []);
      const a = new Set((getPath(c.after, "assignedUsers") as string[] | undefined) ?? []);
      for (const u of a) if (!b.has(u)) out.add(u);
      for (const u of b) if (!a.has(u)) out.add(u);
    }
  }
  return [...out].sort();
}

// ---------- First owner (DEPLOY.md step "Create the first owner") ----------

/**
 * The documents a brand-new company needs: the first owner's user record, the expense heads (§7.3), operations
 * settings (defaults-applied.md) and company and bank placeholders the owner fills in Settings. Written only when
 * no owner exists yet.
 */
export function firstOwnerDocs(owner: { uid: string; name: string; email: string }, nowIso: string): { collection: string; doc: Doc }[] {
  const stamp = { createdAt: nowIso, createdBy: owner.uid, updatedAt: nowIso, updatedBy: owner.uid };
  const out: { collection: string; doc: Doc }[] = [
    { collection: "users", doc: { id: owner.uid, name: owner.name || owner.email, email: owner.email, phone: "", role: "owner", superUser: true, active: true, language: "en", theme: "system", projectIds: [], ...stamp } },
    { collection: "settings", doc: {
      id: "company", legalName: "Ambika Group [legal name to be confirmed]", tradeName: "Ambika Group", address: "", stateCode: "09",
      gstin: "", pan: "", phone: "", email: owner.email, brandColor: "#F12136", gstScheme: "regular", logoPath: null, signaturePath: null, stampPath: null, ...stamp,
    } },
    { collection: "settings", doc: { id: "bank", accounts: [], ...stamp } },
    { collection: "settings", doc: {
      id: "operations", workerRoles: DEFAULT_WORKER_ROLES.map((r) => ({ ...r, active: true })), attendanceLockDays: 3,
      missingBillThresholdPaise: 200_000, pmApprovalLimitPaise: 2_500_000, autoApproveLimitPaise: 2_500_000, leadFollowUpHours: 2,
      emdRefundAlertDays: 30, shareLinkDays: 30, ...stamp,
    } },
    { collection: "meta", doc: { id: "bootstrap", ownerUid: owner.uid, at: nowIso } },
  ];
  for (const cat of seedCategories()) out.push({ collection: "expense_categories", doc: { ...(cat as unknown as Doc), ...stamp } });
  return out;
}

// ---------- Who may become the first owner (callables.ts) ----------

/** What the sign-in token says about a person (only what the first-owner check needs). */
export interface TokenFacts { email?: unknown; email_verified?: unknown }

/**
 * May this signed-in person be set up as the first owner? Their email must be verified (Google and email-link sign-in always
 * are), and equal to OWNER_EMAIL ignoring capital letters and stray spaces. A person who signed up with a password has an
 * unverified email until they press the link we send them.
 */
export function canBecomeFirstOwner(ownerEmail: string | undefined, token: TokenFacts): { ok: boolean; email: string; why?: "noOwnerConfigured" | "unverified" | "different" } {
  const want = (ownerEmail ?? "").trim().toLowerCase();
  const email = String(token.email ?? "").trim().toLowerCase();
  if (!want) return { ok: false, email, why: "noOwnerConfigured" };
  if (email !== want) return { ok: false, email, why: "different" };
  if (token.email_verified !== true) return { ok: false, email, why: "unverified" };
  return { ok: true, email };
}

/**
 * A partial view of the owner address to help the person spot a typo, shown only to someone signed in with an address on the
 * same domain: "b••••••s@ambikagroups.tech" (first and last letter of the part before the @, the rest as dots, and the domain).
 */
export function ownerHint(ownerEmail: string | undefined, signedInEmail: string): string | null {
  const want = (ownerEmail ?? "").trim().toLowerCase();
  const at = want.lastIndexOf("@");
  const mine = signedInEmail.trim().toLowerCase();
  if (at < 2 || mine.slice(mine.lastIndexOf("@")) !== want.slice(at)) return null;
  const local = want.slice(0, at);
  return `${local[0]}${"•".repeat(Math.max(0, local.length - 2))}${local[local.length - 1]}${want.slice(at)}`;
}
