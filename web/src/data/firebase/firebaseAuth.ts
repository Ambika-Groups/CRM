/**
 * Sign-in for Firebase mode (D-35): Google (a redirect through the app's own /__/auth proxy), email and password,
 * and email-link sign-in. (Phone codes need the Blaze plan, so they are not offered on Spark, D-51.) A person can use the
 * app only when they have a users document that is switched on: their role, projects and super-user flag are read from it,
 * by the app and by the security rules alike (D-52). Everything else is "not set up yet", never a half-open app.
 */
import { canBecomeFirstOwner, firstOwnerDocs, ownerHint, ROLES, toStoredPhone, type Role } from "@ag/core";
import {
  EmailAuthProvider, GoogleAuthProvider, RecaptchaVerifier, createUserWithEmailAndPassword, getRedirectResult, isSignInWithEmailLink, onAuthStateChanged, sendSignInLinkToEmail, signInWithEmailLink, reauthenticateWithCredential, reauthenticateWithPopup,
  sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPhoneNumber, signInWithPopup, signInWithRedirect, signOut as fbSignOut,
  type ConfirmationResult, type User as FbUser,
} from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import { SignInError, type AuthApi, type AuthState, type SignInErrorCode } from "../types";
import { OWNER_EMAIL } from "../config";
import { docData, type Clients } from "./client";

export interface Claims { role: Role; projects: string[]; superUser: boolean }
export interface ProfileDoc { id: string; name?: string; email?: string; role?: Role; active?: boolean; superUser?: boolean; projectIds?: string[]; language?: "en" | "hi"; theme?: "light" | "dark" | "system" }

const LINK_EMAIL_KEY = "ag-link-email";
const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r);

/** Firebase's error codes in plain words (signin.err.<code> on screen). */
export function mapAuthError(e: unknown): SignInError {
  if (e instanceof SignInError) return e;
  const code = String((e as { code?: string } | null)?.code ?? "");
  const table: [RegExp, SignInErrorCode][] = [
    [/admin-restricted-operation/, "signupOff"],
    [/operation-not-allowed|configuration-not-found/, "notEnabled"],
    [/email-already-in-use/, "emailInUse"],
    [/weak-password/, "weakPassword"],
    [/invalid-action-code|expired-action-code/, "linkInvalid"],
    [/invalid-credential|wrong-password|user-not-found|invalid-email|missing-password/, "badLogin"],
    [/too-many-requests/, "tooMany"],
    [/network-request-failed/, "offline"],
    [/invalid-phone-number|missing-phone-number/, "badPhone"],
    [/invalid-verification-code|missing-verification-code/, "badCode"],
    [/code-expired|session-expired/, "expired"],
    [/user-disabled/, "switchedOff"],
    [/popup-closed|cancelled-popup|popup-blocked/, "cancelled"],
    [/unauthorized-domain/, "domain"],
  ];
  return new SignInError(table.find(([re]) => re.test(code))?.[1] ?? "other");
}

export class FirebaseAuth implements AuthApi {
  private st: AuthState = { kind: "loading" };
  private user: FbUser | null = null;
  private unsubProfile: (() => void) | null = null;
  private confirmation: ConfirmationResult | null = null;
  /** An emailed link was opened here but this device doesn't know the email it was sent to. */
  private linkPending = false;
  private linkError: SignInErrorCode | null = null;
  private verifier: RecaptchaVerifier | null = null;
  private method: string | null = null;
  claims: Claims | null = null;
  profile: ProfileDoc | null = null;

  constructor(private c: Clients, private changed: () => void, private clearLocal: () => Promise<void>) {}

  state(): AuthState { return this.st; }
  currentUser(): FbUser | null { return this.user; }
  signInMethod(): string | null { return this.method; }

  private set(s: AuthState) { this.st = s; this.changed(); }

  /** Starts listening; resolves once the first sign-in state is known, so the app never flashes the wrong screen. */
  start(): Promise<void> {
    return new Promise<void>((resolve) => {
      let first = true;
      void this.completeEmailLink();
      // A Google redirect that failed comes back as an error here; show it on the sign-in screen.
      void getRedirectResult(this.c.auth).catch((e) => { if (!this.user) this.set({ kind: "signedOut", error: mapAuthError(e).code }); });
      onAuthStateChanged(this.c.auth, (u) => {
        void this.handleUser(u).finally(() => { if (first) { first = false; resolve(); } });
      });
    });
  }

  private async handleUser(user: FbUser | null): Promise<void> {
    this.unsubProfile?.();
    this.unsubProfile = null;
    this.profile = null;
    this.claims = null;
    this.method = null;
    this.user = user;
    if (!user) {
      this.set({ kind: "signedOut", ...(this.linkPending ? { finishLink: true } : {}), ...(this.linkError ? { error: this.linkError } : {}) });
      this.linkError = null;
      return;
    }
    try {
      this.method = (await user.getIdTokenResult()).signInProvider ?? null;
      await this.watchProfile(user);
    } catch (e) {
      const err = mapAuthError(e);
      this.set(err.code === "switchedOff" ? { kind: "switchedOff", email: user.email } : { kind: "signedOut", error: err.code });
    }
  }

  /**
   * A signed-in account with no users document is "not set up yet". If nobody is the owner yet and this person's verified
   * email is the owner address, they may set themselves up as the first owner (the rules decide, and say no to anyone else).
   */
  private async enterNotSetUp(user: FbUser): Promise<void> {
    let alreadySetUp = false;
    try { alreadySetUp = (await getDoc(doc(this.c.db, "system", "owner"))).exists(); } catch (e) {
      const denied = String((e as { code?: string }).code).includes("permission-denied");
      this.set({ kind: "problem", reason: denied ? "rules" : "database", email: user.email });
      return;
    }
    const check = canBecomeFirstOwner(OWNER_EMAIL, { email: user.email, email_verified: user.emailVerified });
    this.set({
      kind: "notSetUp", email: user.email, emailVerified: user.emailVerified, viaPassword: user.providerData.some((p) => p.providerId === "password"),
      canBootstrap: check.ok && !alreadySetUp, alreadySetUp, ownerEmailConfigured: !!OWNER_EMAIL, serverReady: true,
      ownerHint: !check.ok && check.why === "different" && !alreadySetUp ? ownerHint(OWNER_EMAIL, check.email) : null,
    });
  }

  /** Watches the person's own users document: their role, projects, name and language, live (D-52). */
  private watchProfile(user: FbUser): Promise<void> {
    return new Promise<void>((resolve) => {
      let first = true;
      this.unsubProfile = onSnapshot(doc(this.c.db, "users", user.uid), (snap) => {
        const p = snap.exists() ? docData<ProfileDoc>(snap.id, snap.data()) : null;
        this.profile = p;
        this.claims = p && isRole(p.role) ? { role: p.role, projects: Array.isArray(p.projectIds) ? p.projectIds : [], superUser: p.role === "owner" && p.superUser === true } : null;
        if (!p || !this.claims) void this.enterNotSetUp(user);
        else if (p.active === false) this.set({ kind: "switchedOff", email: user.email });
        else this.set({ kind: "ready" });
        if (first) { first = false; resolve(); }
      }, (err) => {
        // Reading one's own users document is always allowed once the rules are published; a refusal means they are not
        // published (or the database does not exist yet), and the screen says so (never a loop, never a blank page).
        const denied = String((err as { code?: string }).code).includes("permission-denied");
        this.set({ kind: "problem", reason: denied ? "rules" : "database", email: user.email });
        if (first) { first = false; resolve(); }
      });
    });
  }

  async recheck(): Promise<void> {
    if (!this.user) return;
    try { await this.user.reload(); } catch { /* offline */ }
    await this.handleUser(this.user);
  }

  /**
   * Google. On the app's own address (the /__/auth proxy, D-35) a redirect keeps everything on one domain; anywhere else,
   * for example localhost with the project's own firebaseapp.com domain, a pop-up is what browsers still allow.
   */
  async googleSignIn(): Promise<void> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const sameOrigin = this.c.app.options.authDomain === window.location.hostname;
    try {
      if (sameOrigin) await signInWithRedirect(this.c.auth, provider);
      else await signInWithPopup(this.c.auth, provider);
    } catch (e) {
      if (!sameOrigin && /popup-blocked/.test(String((e as { code?: string }).code))) {
        try { await signInWithRedirect(this.c.auth, provider); return; } catch (e2) { throw mapAuthError(e2); }
      }
      throw mapAuthError(e);
    }
  }

  async emailSignIn(email: string, password: string): Promise<void> {
    try { await signInWithEmailAndPassword(this.c.auth, email.trim(), password); } catch (e) { throw mapAuthError(e); }
  }

  // ---- email-link sign-in (no password; the email counts as verified, so the first owner can use it) ----

  /** If this page was opened from an emailed sign-in link, finish signing in with it (or ask for the email it was sent to). */
  private async completeEmailLink(): Promise<void> {
    const href = window.location.href;
    if (!isSignInWithEmailLink(this.c.auth, href)) return;
    let email: string | null = null;
    try { email = localStorage.getItem(LINK_EMAIL_KEY); } catch { /* private mode */ }
    if (!email) { this.linkPending = true; if (this.st.kind === "signedOut") this.set({ kind: "signedOut", finishLink: true }); return; }
    try { await this.finishWith(email, href); } catch (e) { this.linkError = mapAuthError(e).code; if (!this.user) this.set({ kind: "signedOut", error: this.linkError }); }
  }

  private async finishWith(email: string, href: string): Promise<void> {
    await signInWithEmailLink(this.c.auth, email.trim(), href);
    try { localStorage.removeItem(LINK_EMAIL_KEY); } catch { /* private mode */ }
    this.linkPending = false;
    window.history.replaceState({}, "", window.location.pathname);
  }

  async finishEmailLink(email: string): Promise<void> {
    try { await this.finishWith(email, window.location.href); } catch (e) { throw mapAuthError(e); }
  }

  async sendSignInLink(email: string): Promise<void> {
    try {
      await sendSignInLinkToEmail(this.c.auth, email.trim(), { url: `${window.location.origin}/`, handleCodeInApp: true });
      try { localStorage.setItem(LINK_EMAIL_KEY, email.trim()); } catch { /* private mode: the link then asks for the email */ }
    } catch (e) { throw mapAuthError(e); }
  }

  async createAccount(email: string, password: string): Promise<void> {
    try {
      const cred = await createUserWithEmailAndPassword(this.c.auth, email.trim(), password);
      // The owner's address must be verified before they can be set up, so the link goes out at once.
      await sendEmailVerification(cred.user).catch(() => undefined);
    } catch (e) { throw mapAuthError(e); }
  }

  async sendPasswordLink(email: string): Promise<void> {
    try { await sendPasswordResetEmail(this.c.auth, email.trim()); } catch (e) {
      // Never say whether the address has an account.
      if (String((e as { code?: string }).code).includes("user-not-found")) return;
      throw mapAuthError(e);
    }
  }

  async sendPhoneCode(phone: string, holder: HTMLElement): Promise<void> {
    const stored = toStoredPhone(phone);
    if (!stored) throw new SignInError("badPhone");
    try {
      this.verifier?.clear();
      this.verifier = new RecaptchaVerifier(this.c.auth, holder, { size: "invisible" });
      this.confirmation = await signInWithPhoneNumber(this.c.auth, stored, this.verifier);
    } catch (e) { this.verifier?.clear(); this.verifier = null; throw mapAuthError(e); }
  }

  async confirmPhoneCode(code: string): Promise<void> {
    if (!this.confirmation) throw new SignInError("expired");
    try { await this.confirmation.confirm(code.trim()); } catch (e) { throw mapAuthError(e); }
  }

  async sendVerificationEmail(): Promise<void> {
    if (!this.user) return;
    try { await sendEmailVerification(this.user); } catch (e) { throw mapAuthError(e); }
  }

  /**
   * Make the signed-in person the first owner and super user: their users document and the one-time marker system/owner,
   * written together (the rules allow it only for the verified owner address, and only once). Then the company placeholders,
   * which the new owner may write. No server involved (D-52).
   */
  async setupFirstOwner(): Promise<void> {
    const user = this.user;
    if (!user?.email) throw new SignInError("other");
    const { db } = this.c;
    const batch = writeBatch(db);
    batch.set(doc(db, "users", user.uid), {
      name: user.displayName || user.email, email: user.email, phone: "", role: "owner", active: true, superUser: true, language: "en", theme: "system", projectIds: [],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: user.uid, updatedBy: user.uid,
    });
    batch.set(doc(db, "system", "owner"), { uid: user.uid, email: user.email, at: serverTimestamp() });
    try { await batch.commit(); } catch (e) {
      // The rules said no: not the owner address, not verified, or an owner already exists.
      throw new SignInError(String((e as { code?: string }).code).includes("permission-denied") ? "notOwner" : "other");
    }
    // Company placeholders and working limits (defaults-applied.md). A failure here is not fatal: Settings can fill them in.
    try {
      const now = new Date().toISOString();
      const stamp = { createdAt: now, createdBy: user.uid, updatedAt: now, updatedBy: user.uid };
      const b2 = writeBatch(db);
      for (const { collection, doc: d } of firstOwnerDocs({ uid: user.uid, name: user.displayName ?? "", email: user.email }, now)) {
        if (collection !== "settings") continue;
        b2.set(doc(db, collection, d.id), { ...d, ...stamp });
      }
      await b2.commit();
    } catch { /* the owner fills in Settings */ }
    await this.recheck();
  }

  /** A protected change needs a recent sign-in (D-48). The new token carries the fresh sign-in time. */
  async reauthenticate(password?: string): Promise<void> {
    const user = this.user;
    if (!user) throw new SignInError("other");
    try {
      if (this.method === "password") {
        if (!password || !user.email) throw new SignInError("badLogin");
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      } else if (this.method === "google.com") {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      } else throw new SignInError("other");
      await user.getIdToken(true);
    } catch (e) { throw mapAuthError(e); }
  }

  async signOut(): Promise<void> {
    this.unsubProfile?.();
    this.unsubProfile = null;
    await fbSignOut(this.c.auth);
    // Nothing of the last person's data stays on a shared phone.
    await this.clearLocal();
    window.location.assign("/");
  }
}
