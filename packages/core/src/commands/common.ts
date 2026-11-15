/**
 * Shared plumbing for commands: the operations the UI asks for. In demo mode they run against the
 * browser store; in Firebase mode the same functions run inside callable Cloud Functions (M1.6).
 * Each command re-checks the caller's role (the same matrix as firestore.rules), validates input with
 * plain-words messages, writes audit stamps, and returns what changed.
 */
import type { Role } from "../model";
import type { MemoryStore } from "../store";

export interface CommandCtx {
  uid: string;
  role: Role;
  projectIds: string[];
  nowIso: string;
  /** D-48: the caller is an owner with superUser=true (set by the runner from the users document). */
  superUser?: boolean;
}

/**
 * The shape of every command. A feature exports its own map from `commands/<feature>.ts`
 * (`export const EXPENSE_COMMANDS = { ... } satisfies Record<string, CommandFn>`); the registry spreads the maps together.
 */
export type CommandFn = (store: MemoryStore, args: never, ctx: CommandCtx) => unknown;

/** A refusal or validation failure the UI shows as-is. `fields` maps a field name to its message. */
export class CommandError extends Error {
  constructor(message: string, readonly fields: Record<string, string> = {}) {
    super(message);
  }
}

export function requireRole(ctx: CommandCtx, roles: readonly Role[], what: string): void {
  if (!roles.includes(ctx.role)) throw new CommandError(`Your role can't ${what}.`);
}

export function requireAssigned(ctx: CommandCtx, projectId: string, what: string): void {
  const all = ctx.role === "owner" || ctx.role === "accountant";
  if (!all && !ctx.projectIds.includes(projectId)) throw new CommandError(`You aren't assigned to this project, so you can't ${what}.`);
}

export function stampCreate(ctx: CommandCtx) {
  return { createdBy: ctx.uid, createdAt: ctx.nowIso, updatedBy: ctx.uid, updatedAt: ctx.nowIso, isDeleted: false };
}

export function stampUpdate(ctx: CommandCtx) {
  return { updatedBy: ctx.uid, updatedAt: ctx.nowIso };
}

/** Collects field errors and throws once, so a form shows every problem together (spec §4A.8). */
export class Checker {
  errors: Record<string, string> = {};
  need(field: string, ok: boolean, message: string) {
    if (!ok && !this.errors[field]) this.errors[field] = message;
    return this;
  }
  throwIfAny(summary = "Some details need fixing.") {
    if (Object.keys(this.errors).length) throw new CommandError(summary, this.errors);
  }
}

const AUTO = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** When set, newId() takes its ids from here (see withIdSource). */
let idSource: (() => string) | null = null;

/** A fresh seed for a repeatable id sequence. */
export function newIdSeed(): Uint32Array {
  const seed = new Uint32Array(4);
  globalThis.crypto.getRandomValues(seed);
  return seed;
}

/** A repeatable sequence of 20-character ids: the same seed gives the same ids in the same order (xorshift128). */
export function seededIds(seed: Uint32Array): () => string {
  let a = seed[0]! | 0, b = seed[1]! | 0, c = seed[2]! | 0, d = seed[3]! | 0;
  if ((a | b | c | d) === 0) a = 0x9e3779b9 | 0;
  const next = () => {
    let t = d;
    const s0 = a;
    d = c; c = b; b = s0;
    t ^= t << 11; t ^= t >>> 8;
    a = t ^ s0 ^ (s0 >>> 19);
    return a >>> 0;
  };
  return () => {
    let s = "";
    for (let i = 0; i < 20; i++) s += AUTO[next() % AUTO.length];
    return s;
  };
}

/**
 * Run `fn` with newId() taking its ids from `source`. The server runs a command several times while it loads what the
 * command reads (server.ts runWithLoads); every run must make the same new ids, or a rerun would ask for records the
 * run before never named. Not for overlapping commands: the server part runs one command at a time.
 */
export async function withIdSource<T>(source: () => string, fn: () => Promise<T>): Promise<T> {
  const before = idSource;
  idSource = source;
  try { return await fn(); } finally { idSource = before; }
}

/** Firestore-style auto ID (20 characters). */
export function newId(): string {
  if (idSource) return idSource();
  let s = "";
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) s += AUTO[b % AUTO.length];
  return s;
}

export function trimOrEmpty(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/** GSTIN shape: 2-digit state, 10-character PAN, entity number, Z, check character. */
const B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The GSTIN check character (15th) from the first 14 (GSTN's base-36 mod check). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = B36.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return B36[(36 - (sum % 36)) % 36]!;
}

/** A GSTIN in the right format with a correct check character (QA N2). */
export function isGstin(v: string): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v) && gstinCheckChar(v.slice(0, 14)) === v[14];
}

export function isPan(v: string): boolean {
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(v);
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export type { MemoryStore };
