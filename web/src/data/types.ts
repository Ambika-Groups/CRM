import type { CommandArgs, CommandName, CommandResult, Page, QuerySpec, Role, User, Where } from "@ag/core";
import type { DataMode } from "./config";

export interface Session {
  uid: string;
  name: string;
  role: Role;
  projectIds: string[];
  language: "en" | "hi";
  theme: "light" | "dark" | "system";
}

/**
 * The one data-access interface the screens use (spec §4A.12: UI, business logic, auth and data access
 * kept separate). Demo mode implements it over an in-browser store; Firebase mode over Firestore and
 * callable Functions (M1.6). Every read is filtered to what the signed-in role may see.
 *
 * Reads follow spec §3.1 rule 9: lists come one page at a time (limit 1–50); totals come from counts
 * and rollups; only small bounded collections (core SMALL_COLLECTIONS, and a project's own detail
 * lists) may be read whole.
 */
export interface DataSource {
  readonly mode: DataMode;
  init(): Promise<void>;
  session(): Session | null;
  /** Called on any change; returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
  get<T>(collection: string, id: string): Promise<T | null>;
  /**
   * Why a record isn't shown: it exists and can be read ("ok"), it doesn't exist ("missing"), or the role may not
   * read it ("denied"). In Firebase mode a permission-denied read is "denied" and an absent document "missing".
   */
  docStatus(collection: string, id: string): Promise<"ok" | "missing" | "denied">;
  getMany<T>(collection: string, ids: string[]): Promise<(T | null)[]>;
  query<T extends { id: string }>(collection: string, spec: QuerySpec): Promise<Page<T>>;
  count(collection: string, where?: Where[]): Promise<number>;
  /** Small, bounded collections only (throws otherwise). */
  listSmall<T>(collection: string): Promise<T[]>;
  run<N extends CommandName>(name: N, args: CommandArgs<N>): Promise<CommandResult<N>>;
  setPreference(patch: Partial<Pick<Session, "theme" | "language">>): Promise<void>;
  /** Demo only. */
  demoUsers?(): User[];
  switchUser?(uid: string): Promise<void>;
  reset?(): Promise<void>;
}

/** A project's own detail lists are bounded by the project, so they may be read whole. */
export const SMALL_PROJECT_CHILDREN = new Set([
  "project_units", "project_milestones", "project_approvals", "boq_items", "boq_rates", "eot_requests", "hindrance_register", "roster", "private",
]);

export function isSmallCollection(collection: string, small: ReadonlySet<string>): boolean {
  if (small.has(collection)) return true;
  const parts = collection.split("/");
  return parts.length === 3 && parts[0] === "projects" && SMALL_PROJECT_CHILDREN.has(parts[2]!)
    || (parts.length === 3 && parts[0] === "workers" && (parts[2] === "private" || parts[2] === "project_terms"));
}
