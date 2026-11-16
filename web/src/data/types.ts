import type { CommandArgs, CommandName, CommandResult, FirebaseWebConfig, IntegrationId, IntegrationStatus, Page, QuerySpec, Role, TestOutcome, User, Where } from "@ag/core";
import type { DataMode } from "./config";
import type { FilesApi } from "./files/types";

export interface Session {
  uid: string;
  name: string;
  role: Role;
  projectIds: string[];
  language: "en" | "hi";
  theme: "light" | "dark" | "system";
  /** D-48: an owner who may open Setup & integrations. */
  superUser: boolean;
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
  /** `requestId` makes a retry safe: the same id never runs the command twice (Firebase mode). */
  run<N extends CommandName>(name: N, args: CommandArgs<N>, requestId?: string): Promise<CommandResult<N>>;
  setPreference(patch: Partial<Pick<Session, "theme" | "language">>): Promise<void>;
  /** Firebase mode: who is signed in and the sign-in actions. Absent in demo mode. */
  auth?: AuthApi;
  /** Setup & integrations (super user). In demo mode a labelled simulation. */
  setup?: SetupApi;
  /** Firebase mode: sample data for an empty project (super user, on purpose only). */
  sample?: SampleApi;
  /** Photos and documents on records (the storage adapter): keep, fetch, remove, usage. */
  files?: FilesApi;
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

/** Where sign-in stands (Firebase mode). "ready" means a person with a role is signed in. */
export type AuthState =
  | { kind: "loading" }
  /** `finishLink`: the person pressed an emailed sign-in link on a device that doesn't know their email, so it asks for it. */
  | { kind: "signedOut"; error?: SignInErrorCode; finishLink?: boolean }
  | { kind: "notSetUp"; email: string | null; emailVerified: boolean; viaPassword: boolean; canBootstrap: boolean; ownerEmailConfigured: boolean; alreadySetUp: boolean; serverReady: boolean; ownerHint?: string | null }
  /** Signed in with a role, but the database could not be read: the rules or the database are not deployed yet. */
  | { kind: "problem"; reason: "rules" | "database"; email: string | null }
  | { kind: "switchedOff"; email: string | null }
  | { kind: "ready" };

export type SignInErrorCode = "signupOff" | "notOwner" | "emailInUse" | "weakPassword" | "linkInvalid" | "notEnabled" | "badLogin" | "tooMany" | "offline" | "badPhone" | "badCode" | "expired" | "switchedOff" | "cancelled" | "domain" | "other";

/** A sign-in problem in plain words; the code picks the message (signin.err.<code>). */
export class SignInError extends Error {
  constructor(readonly code: SignInErrorCode) { super(code); }
}

export interface AuthApi {
  state(): AuthState;
  googleSignIn(): Promise<void>;
  emailSignIn(email: string, password: string): Promise<void>;
  /** Sends the link that sets or resets a password. */
  sendPasswordLink(email: string): Promise<void>;
  /** Emails a sign-in link: no password, and the email counts as verified (the first owner, and staff the owner added). */
  sendSignInLink(email: string): Promise<void>;
  /** Finishes a sign-in link that was opened on a device that doesn't remember the email. */
  finishEmailLink(email: string): Promise<void>;
  /** Makes a new account with an email and a password, and emails a link to verify the address. */
  createAccount(email: string, password: string): Promise<void>;
  /** Texts a 6-digit code to an Indian mobile (D-35). `holder` is the element the invisible check attaches to. */
  sendPhoneCode(phone: string, holder: HTMLElement): Promise<void>;
  confirmPhoneCode(code: string): Promise<void>;
  sendVerificationEmail(): Promise<void>;
  /** Re-read the account and its claims (after verifying an email, or after the owner is set up). */
  recheck(): Promise<void>;
  /** Make the signed-in person the first owner and super user (once, DEPLOY.md). */
  setupFirstOwner(): Promise<void>;
  signOut(): Promise<void>;
  /** Sign in again for a protected change (Setup, D-48): a Google pop-up, or the password. */
  reauthenticate(password?: string): Promise<void>;
  /** How this person signed in: "google.com", "password" or "phone". */
  signInMethod(): string | null;
}

export type SetupStatuses = Partial<Record<IntegrationId, IntegrationStatus>>;

export interface SetupApi {
  /** True in demo mode: results are a labelled simulation and no real secret is stored. */
  readonly simulated: boolean;
  statuses(): Promise<SetupStatuses>;
  save(id: IntegrationId, input: { enabled?: boolean; enforce?: boolean; values: Record<string, string> }): Promise<IntegrationStatus>;
  clear(id: IntegrationId): Promise<void>;
  /** The website key is returned once, here. */
  rotateWebsiteKey(): Promise<{ key: string; status: IntegrationStatus }>;
  /** Runs the item's Test and records the result. `key` is only for the website link. */
  test(id: IntegrationId, opts?: { key?: string }): Promise<TestOutcome>;
  /** The config in use and where it came from (build variables, this device, or none). */
  configInUse(): { from: "env" | "device" | "none"; config: Partial<FirebaseWebConfig> };
  /** The Cloud Functions address the website posts enquiries to. */
  enquiryEndpoint(): string;
}

/** Thrown when a protected change needs a fresh sign-in (D-48); the page asks, then retries. */
export class ReauthNeeded extends Error {
  constructor() { super("Please sign in again to change settings."); }
}

/** Sample data in a real, empty project (super user): loaded and removed only by pressing the buttons. */
export interface SampleStatus {
  loaded: boolean;
  state?: "loading" | "loaded";
  at?: string;
  counts?: Record<string, number>;
  /** The project holds the user's own records: loading and removing are both refused. */
  hasOwnRecords: boolean;
}

export interface SampleApi {
  status(): Promise<SampleStatus>;
  load(): Promise<SampleStatus>;
  remove(): Promise<SampleStatus>;
}
