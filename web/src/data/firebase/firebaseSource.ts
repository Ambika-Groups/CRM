/**
 * Firebase mode (decisions D-37). Implemented in milestone M1.6: Firestore, Auth (Google via the
 * /__/auth proxy, email, SMS fallback; D-35), App Check (D-41), Storage and callable Functions, behind the
 * same DataSource interface the screens use. Until then a Firebase build shows a setup message rather than
 * ever falling back to demo data.
 */
import { CommandError, type CommandArgs, type CommandName, type CommandResult, type Page } from "@ag/core";
import type { DataSource, Session } from "../types";

export class FirebaseSource implements DataSource {
  readonly mode = "firebase" as const;
  async init(): Promise<void> {
    throw new Error("The connection to the live database isn't switched on in this version yet. Remove the NEXT_PUBLIC_FIREBASE_* settings to use the demo.");
  }
  session(): Session | null { return null; }
  subscribe(): () => void { return () => {}; }
  async get<T>(): Promise<T | null> { return null; }
  async docStatus(): Promise<"ok" | "missing" | "denied"> { return "missing"; }
  async getMany<T>(): Promise<(T | null)[]> { return []; }
  async query<T extends { id: string }>(): Promise<Page<T>> { return { items: [], next: null, total: 0 }; }
  async count(): Promise<number> { return 0; }
  async listSmall<T>(): Promise<T[]> { return []; }
  async run<N extends CommandName>(_n: N, _a: CommandArgs<N>): Promise<CommandResult<N>> { throw new CommandError("Not connected."); }
  async setPreference(): Promise<void> {}
}
