"use client";
import { staffLoginEmail } from "@ag/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { LangToggle } from "@/components/shell/LangToggle";
import { ThemeSwitch } from "@/components/shell/ThemeSwitch";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/feedback";
import { TextField } from "@/components/ui/form";
import { forgetDeviceConfig, resolveConfig } from "@/data/config";
import { useData } from "@/data/DataProvider";
import { SignInError, type AuthApi, type AuthState, type SignInErrorCode } from "@/data/types";
import { SetupProgress, useProjectProbe } from "./SetupProgress";

/**
 * Sign-in and "not set up yet" (Firebase mode, D-35). Plain words, one clear action at a time. Google first (site staff),
 * an emailed sign-in link (no password; also how the first owner can start when their address is not a Google account),
 * a password for office staff (with "Create a password" for the first time), and a phone code for anyone without either.
 */
export function AuthScreen({ state }: { state: AuthState }) {
  const { t } = useTranslation();
  const { source } = useData();
  const auth = source.auth as AuthApi;
  const probe = useProjectProbe();
  // Sign-in is "off" in the project when the check finds Authentication not started, or no method turned on.
  const providersOff = probe.lines?.find((l) => l.key === "signIn")?.ok === false;
  return (
    <main className="auth-page" id="main">
      <div className="auth-top"><LangToggle /><ThemeSwitch /></div>
      <section className="card auth-card" aria-labelledby="auth-title">
        <div className="brand-mark auth-brand"><span className="ag">AG</span><span className="name">{t("app.name")}</span></div>
        {state.kind === "loading" && <p className="muted" role="status">{t("signin.loading")}</p>}
        {state.kind === "signedOut" && <SignedOut auth={auth} initialError={state.error ?? null} finishLink={!!state.finishLink} providersOff={providersOff} />}
        {state.kind === "notSetUp" && <NotSetUp auth={auth} state={state} />}
        {state.kind === "problem" && (
          <>
            <h1 id="auth-title">{t("signin.problem.title")}</h1>
            <div className="banner error" role="alert" data-problem={state.reason}><Icon name="alert" /><span className="text">{t(`signin.problem.${state.reason}`)}</span></div>
            <ProblemActions auth={auth} />
          </>
        )}
        {state.kind === "switchedOff" && (
          <>
            <h1 id="auth-title">{t("signin.off.title")}</h1>
            <p>{t("signin.off.body")}</p>
            <Button variant="secondary" block onClick={() => void auth.signOut()}>{t("signin.notSet.signOut")}</Button>
          </>
        )}
      </section>
      {(state.kind === "signedOut" || state.kind === "problem" || (state.kind === "notSetUp" && !state.canBootstrap)) && <SetupProgress probe={probe} />}
      <DeviceConfigNote />
    </main>
  );
}

/** A site connected through settings saved on this device (not through the build) says so, and offers the way back to the demo. */
function DeviceConfigNote() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (typeof window === "undefined" || resolveConfig().from !== "device") return null;
  return (
    <section className="card auth-device" data-device-config>
      <p className="muted small">{t("signin.device.note")}</p>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-forget-device>{t("setup.config.forget")}</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={t("setup.config.forget")} body={t("setup.config.forgetBody")} confirmLabel={t("setup.config.forget")}
        onConfirm={() => { forgetDeviceConfig(); window.location.assign("/"); }} />
    </section>
  );
}

function ErrorLine({ code }: { code: SignInErrorCode | null }) {
  const { t } = useTranslation();
  if (!code) return null;
  return <div className="banner error" role="alert" data-signin-error={code}><Icon name="alert" /><span className="text">{t(`signin.err.${code}`)}</span></div>;
}

/** Runs a sign-in action; its error becomes a plain message, never a stack trace. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SignInErrorCode | null>(null);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try { await fn(); return true; } catch (e) { setError(e instanceof SignInError ? e.code : "other"); return false; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

function SignedOut({ auth, initialError, finishLink, providersOff }: { auth: AuthApi; initialError: SignInErrorCode | null; finishLink: boolean; providersOff: boolean }) {
  const { t } = useTranslation();
  const a = useAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const shown = a.error ?? initialError;

  // An emailed link was opened on a device that doesn't remember the address it was sent to.
  if (finishLink) {
    return (
      <>
        <h1 id="auth-title">{t("signin.link.confirmTitle")}</h1>
        <p>{t("signin.link.confirmBody")}</p>
        <ErrorLine code={shown} />
        <form onSubmit={(e) => { e.preventDefault(); void a.run(() => auth.finishEmailLink(email)); }} noValidate>
          <TextField label={creating ? t("signin.email") : t("signin.emailOrMobile")} value={email} onChange={setEmail} type={creating ? "email" : "text"} inputMode="email" autoComplete="username" />
          <Button variant="primary" type="submit" block disabled={a.busy || !email}>{t("signin.link.confirmButton")}</Button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1 id="auth-title">{t("signin.title")}</h1>
      <p className="muted">{t("signin.sub")}</p>
      {providersOff && <div className="banner info" role="note" data-providers-off><Icon name="info" /><span className="text">{t("signin.providersOff")}</span></div>}
      <ErrorLine code={shown} />
      <form onSubmit={(e) => { e.preventDefault(); void a.run(async () => { if (creating) await auth.createAccount(email, password); else await auth.emailSignIn(staffLoginEmail(email) ?? email, password); }); }} noValidate>
        <TextField label={t("signin.email")} value={email} onChange={setEmail} type="email" inputMode="email" autoComplete="username" />
        <TextField label={creating ? t("signin.create.password") : t("signin.password")} hint={creating ? t("signin.create.hint") : undefined} value={password} onChange={setPassword} type="password"
          autoComplete={creating ? "new-password" : "current-password"} />
        <Button variant="primary" type="submit" block disabled={a.busy || !email || !password} data-password-submit>
          {a.busy ? t("signin.signingIn") : creating ? t("signin.create.button") : t("signin.signIn")}
        </Button>
      </form>
      <button type="button" className="link-btn auth-link" disabled={!email || a.busy}
        onClick={() => void a.run(async () => { await auth.sendPasswordLink(email); setNote(t("signin.linkSent")); })}>
        {t("signin.forgot")}
      </button>
      {note && <p className="hint" role="status" data-note><Icon name="info" size={16} /><span>{note}</span></p>}
      <p className="auth-or"><span>{t("signin.orElse")}</span></p>
      <Button variant="secondary" block disabled={a.busy} onClick={() => void a.run(() => auth.googleSignIn())} data-google>
        {t("signin.google")}
      </Button>
      <Button variant="secondary" block disabled={a.busy || !email} data-email-link
        onClick={() => void a.run(async () => { await auth.sendSignInLink(email); setNote(t("signin.link.sent", { email: email.trim() })); })}>
        {t("signin.link.button")}
      </Button>
      <p className="muted small auth-hint">{t("signin.link.hint")}</p>
      <button type="button" className="link-btn auth-link" aria-pressed={creating} onClick={() => setCreating((c) => !c)} data-create-toggle>
        {creating ? t("signin.create.back") : t("signin.create.toggle")}
      </button>
    </>
  );
}

function NotSetUp({ auth, state }: { auth: AuthApi; state: Extract<AuthState, { kind: "notSetUp" }> }) {
  const { t } = useTranslation();
  const a = useAction();
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const needsVerify = state.viaPassword && !state.emailVerified;
  return (
    <>
      <h1 id="auth-title">{t("signin.notSet.title")}</h1>
      <p>{t("signin.notSet.body", { email: state.email ?? "" })}</p>
      {!state.serverReady && <div className="banner error" role="alert" data-server-missing><Icon name="alert" /><span className="text">{t("signin.notSet.serverMissing")}</span></div>}
      {state.serverReady && !state.canBootstrap && !state.alreadySetUp && !state.ownerEmailConfigured && <p className="hint" role="note"><Icon name="info" size={16} /><span>{t("signin.notSet.ownerEmail")}</span></p>}
      {state.serverReady && !state.canBootstrap && !state.alreadySetUp && state.ownerHint && (
        <div className="banner info" role="note" data-owner-mismatch><Icon name="info" /><span className="text">{t("signin.notSet.ownerMismatch", { email: state.email ?? "", hint: state.ownerHint })}</span></div>
      )}
      {state.canBootstrap && (
        <div className="auth-first" data-first-owner>
          <h2>{t("signin.notSet.firstTitle")}</h2>
          <p>{t("signin.notSet.firstBody")}</p>
          {failed && <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{t("signin.notSet.firstFailed")}</span></div>}
          <Button variant="primary" block disabled={a.busy}
            onClick={() => void a.run(async () => { setFailed(false); try { await auth.setupFirstOwner(); setNote(t("signin.notSet.firstDone")); } catch (e) { setFailed(true); throw e; } })}>
            {t("signin.notSet.firstButton")}
          </Button>
        </div>
      )}
      {!state.canBootstrap && needsVerify && (
        <div className="auth-first" data-verify-email>
          <h2>{t("signin.notSet.verifyTitle")}</h2>
          <p>{t("signin.notSet.verifyBody")}</p>
          <Button variant="secondary" block disabled={a.busy} onClick={() => void a.run(async () => { await auth.sendVerificationEmail(); setNote(t("signin.notSet.verifySent")); })}>{t("signin.notSet.verifySend")}</Button>
        </div>
      )}
      {note && <p className="hint" role="status"><Icon name="info" size={16} /><span>{note}</span></p>}
      <ErrorLine code={a.error} />
      <div className="auth-actions">
        <Button variant="secondary" disabled={a.busy} onClick={() => void a.run(() => auth.recheck())}>{t("signin.notSet.check")}</Button>
        <Button variant="text" onClick={() => void auth.signOut()}>{t("signin.notSet.signOut")}</Button>
      </div>
      <p className="muted small">{t("signin.notSet.guide")}</p>
    </>
  );
}

function ProblemActions({ auth }: { auth: AuthApi }) {
  const { t } = useTranslation();
  const a = useAction();
  return (
    <div className="auth-actions">
      <Button variant="secondary" disabled={a.busy} onClick={() => void a.run(() => auth.recheck())}>{t("signin.notSet.check")}</Button>
      <Button variant="text" onClick={() => void auth.signOut()}>{t("signin.notSet.signOut")}</Button>
    </div>
  );
}
