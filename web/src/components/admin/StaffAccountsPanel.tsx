"use client";
// Settings > Users, for the owner (PRD §2, D-51): add a person with a role and projects, set or reset their password,
// choose their projects, and switch them on or off. Uses the existing commands (createUser, setAssignment,
// setUserActive); the password goes to the server part and is never kept by the app. In the demo the password part
// is a labelled simulation.
import { CommandError, ROLE_LABELS, ROLES, seesAllProjects, type Role, type User } from "@ag/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog, MiniWrap, Skeleton, useToast } from "@/components/ui/feedback";
import { ErrorSummary, SelectField, TextField, useForm } from "@/components/ui/form";
import { useData, useRead, useRun, useSession, useSmall } from "@/data/DataProvider";
import { date, phone } from "@/lib/fmt";
import { errorText, PasswordProblem, setStaffPassword, type PasswordResult } from "./adminApi";
import { checkStaffPassword, staffHandover, staffLoginFor } from "./core";

type Person = User & { passwordSetAt?: string; loginEmail?: string };
interface ProjectLite { id: string; name: string; isArchived?: boolean; assignedUsers?: string[] }

function useProjects(): ProjectLite[] | undefined {
  return useRead("admin-projects", (s) => s.query<ProjectLite>("projects", { where: [{ field: "isArchived", op: "==", value: false }], orderBy: [{ field: "name" }], limit: 50 }))?.items;
}

export function StaffAccountsPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const session = useSession();
  const { source } = useData();
  const run = useRun();
  const toast = useToast();
  const users = useSmall<Person>("users");
  const projects = useProjects();
  const [pwFor, setPwFor] = useState<Person | null>(null);
  const [assignFor, setAssignFor] = useState<Person | null>(null);
  const [offFor, setOffFor] = useState<Person | null>(null);
  const [handover, setHandover] = useState<{ person: Person; result: PasswordResult } | null>(null);

  if (!session || session.role !== "owner") return null;
  const demo = source.mode === "demo";

  const setActive = async (u: Person, active: boolean) => {
    try {
      await run("setUserActive", { userId: u.id, active });
      toast(t(active ? "admin.staff.switchedOn" : "admin.staff.switchedOff", { name: u.name }));
    } catch (e) { toast(errorText(e, t), "error"); }
  };
  const projectsOf = (u: Person) => {
    if (seesAllProjects(u.role)) return t("admin.staff.allProjects");
    const n = (u.projectIds ?? []).length;
    return n === 0 ? t("admin.staff.projectsNone") : n === 1 ? t("admin.staff.projectsOne") : t("admin.staff.projectsN", { n });
  };

  return (
    <>
      <section className="card section" data-staff-accounts>
        <h2 className="card-title">{t("admin.staff.title")}</h2>
        <p className="hint"><Icon name="info" size={16} /><span>{t("admin.staff.hint")}</span></p>
        {demo && <div className="banner info" role="note" data-staff-demo><Icon name="info" /><span className="text">{t("admin.staff.demoNote")}</span></div>}
        {!users ? <Skeleton lines={4} /> : (
          <MiniWrap label={t("admin.staff.title")}><table className="mini-table">
            <caption className="sr-only">{t("admin.staff.title")}</caption>
            <thead><tr>
              <th scope="col">{t("admin.staff.colName")}</th><th scope="col">{t("admin.staff.colSignIn")}</th><th scope="col">{t("admin.staff.colPassword")}</th>
              <th scope="col">{t("admin.staff.colProjects")}</th><th scope="col">{t("admin.staff.colActive")}</th>
            </tr></thead>
            <tbody>
              {[...users].sort((a, b) => a.name.localeCompare(b.name)).map((u) => {
                const login = staffLoginFor(u);
                const self = u.id === session.uid;
                // Another owner's password is for a super user only (the server checks again).
                const mayPw = !self && !!login && (u.role !== "owner" || session.superUser);
                return (
                  <tr key={u.id} data-staff={u.id} data-active={u.active}>
                    <td>{u.name}{self ? <span className="muted"> ({t("admin.staff.you")})</span> : null}<br /><span className="muted small">{ROLE_LABELS[u.role][lang]}</span></td>
                    <td data-sign-in>{login ? (login.kind === "mobile" ? phone(u.phone) : login.signInWith) : <span className="muted">{t("admin.staff.noLogin")}</span>}</td>
                    <td>
                      <span className="muted small" data-pw-state>{u.passwordSetAt ? t("admin.staff.pwSet", { date: date(u.passwordSetAt.slice(0, 10), lang) }) : demo ? "—" : t("admin.staff.pwNotSet")}</span>
                      {mayPw && <> <button type="button" className="link-btn" onClick={() => setPwFor(u)} data-set-password={u.id}>{u.passwordSetAt ? t("admin.staff.resetPw") : t("admin.staff.setPw")}</button></>}
                    </td>
                    <td>
                      {projectsOf(u)}
                      {!seesAllProjects(u.role) && <> <button type="button" className="link-btn" onClick={() => setAssignFor(u)} data-assign={u.id} aria-label={`${t("admin.staff.change")}: ${t("admin.staff.assign.title", { name: u.name })}`}>{t("admin.staff.change")}</button></>}
                    </td>
                    <td>
                      <label className="admin-switch"><input type="checkbox" checked={u.active} disabled={self} aria-label={t("admin.staff.switchOnFor", { name: u.name })} data-active-switch={u.id}
                        onChange={(e) => { if (e.target.checked) void setActive(u, true); else setOffFor(u); }} /><span>{u.active ? t("admin.staff.on") : t("admin.staff.off")}</span></label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></MiniWrap>
        )}
      </section>

      <AddPersonForm projects={projects} onPassword={(person, result) => setHandover({ person, result })} />

      {pwFor && <PasswordDialog person={pwFor} onClose={() => setPwFor(null)} onDone={(result) => { setHandover({ person: pwFor, result }); setPwFor(null); }} />}
      {assignFor && <AssignDialog person={assignFor} projects={projects} onClose={() => setAssignFor(null)} />}
      {handover && <HandoverDialog person={handover.person} result={handover.result} onClose={() => setHandover(null)} />}
      <ConfirmDialog open={!!offFor} onOpenChange={(o) => { if (!o) setOffFor(null); }} title={t("admin.staff.switchOffTitle", { name: offFor?.name ?? "" })}
        body={t("admin.staff.switchOffBody")} confirmLabel={t("admin.staff.switchOff")} onConfirm={async () => { if (offFor) await setActive(offFor, false); }} />
    </>
  );
}

function ProjectTicks({ projects, picked, onChange }: { projects: ProjectLite[]; picked: string[]; onChange: (ids: string[]) => void }) {
  return (
    <ul className="admin-ticks" data-project-ticks>
      {projects.map((p) => (
        <li key={p.id}><label><input type="checkbox" checked={picked.includes(p.id)} value={p.id}
          onChange={(e) => onChange(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} /><span>{p.name}</span></label></li>
      ))}
    </ul>
  );
}

function AddPersonForm({ projects, onPassword }: { projects: ProjectLite[] | undefined; onPassword: (person: Person, result: PasswordResult) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const { source } = useData();
  const run = useRun();
  const toast = useToast();
  const blank = { name: "", contact: "", role: "supervisor" as Role, projectIds: [] as string[], password: "" };
  const f = useForm(blank);
  const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r][lang] }));
  const scoped = !seesAllProjects(f.values.role);

  return (
    <form className="card section" noValidate data-add-person onSubmit={(e) => {
      e.preventDefault();
      void f.submit(async (x) => {
        const email = x.contact.includes("@") ? x.contact.trim() : undefined;
        const mobile = email ? undefined : x.contact.trim();
        // A weak first password is refused before the person is added, so nothing is half done.
        if (x.password) {
          try { checkPasswordOnly(x.password, { name: x.name, email, phone: mobile }); } catch (err) { throw new CommandError(errorText(err, t), { password: errorText(err, t) }); }
        }
        const id = await run("createUser", { name: x.name, email, phone: mobile, role: x.role });
        if (scoped) for (const projectId of x.projectIds) await run("setAssignment", { projectId, userId: id, assigned: true });
        toast(t("admin.staff.add.added", { name: x.name.trim() }));
        f.setAll(blank);
        if (x.password) {
          const person = { id, name: x.name.trim(), email: email ?? "", phone: mobile ?? "", role: x.role } as Person;
          try { onPassword(person, await setStaffPassword(source, person, x.password)); } catch (err) { toast(errorText(err, t), "error"); }
        }
      });
    }}>
      <h2 className="card-title">{t("admin.staff.add.title")}</h2>
      <ErrorSummary summary={f.summary} errors={f.errors} />
      <div className="form-grid two" style={{ marginTop: "var(--space-4)" }}>
        <TextField label={t("admin.staff.add.name")} value={f.values.name} onChange={(v) => f.set("name", v)} error={f.errors.name} required autoComplete="off" />
        <TextField label={t("admin.staff.add.contact")} hint={t("admin.staff.add.contactHint")} value={f.values.contact} onChange={(v) => f.set("contact", v)} error={f.errors.email ?? f.errors.phone} required autoComplete="off" />
        <SelectField label={t("admin.staff.add.role")} value={f.values.role} onChange={(v) => f.set("role", v)} options={roleOptions} error={f.errors.role} />
        <TextField label={t("admin.staff.add.password")} hint={t("admin.staff.add.passwordHint")} value={f.values.password} onChange={(v) => f.set("password", v)} error={f.errors.password} autoComplete="new-password" />
        {scoped && (
          <fieldset className="span-2 admin-fieldset">
            <legend>{t("admin.staff.add.projects")}</legend>
            <p className="muted small">{t("admin.staff.add.projectsHint")}</p>
            {!projects ? <Skeleton lines={2} /> : projects.length === 0 ? <p className="muted small">{t("admin.staff.add.noProjects")}</p>
              : <ProjectTicks projects={projects} picked={f.values.projectIds} onChange={(ids) => f.set("projectIds", ids)} />}
          </fieldset>
        )}
      </div>
      <div className="form-actions"><Button variant="primary" type="submit" disabled={f.submitting} data-add-person-save><Icon name="plus" />{f.submitting ? t("common.saving") : t("admin.staff.add.submit")}</Button></div>
    </form>
  );
}

/** The password rules alone (no save): throws the same problem the save would. */
function checkPasswordOnly(password: string, about: { name?: string; email?: string; phone?: string }): void {
  const problem = checkStaffPassword(password, about);
  if (problem) throw new PasswordProblem(problem.code, problem.message);
}

function PasswordDialog({ person, onClose, onDone }: { person: Person; onClose: () => void; onDone: (r: PasswordResult) => void }) {
  const { t } = useTranslation();
  const { source } = useData();
  const f = useForm({ password: "" });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={t("admin.staff.pw.title", { name: person.name })} description={t("admin.staff.pw.body", { name: person.name })}>
        <form noValidate data-password-form onSubmit={(e) => {
          e.preventDefault();
          void f.submit(async (x) => {
            try { onDone(await setStaffPassword(source, person, x.password)); } catch (err) {
              if (err instanceof CommandError && Object.keys(err.fields).length) throw err;
              const msg = errorText(err, t);
              throw new CommandError(msg, err instanceof PasswordProblem ? { password: msg } : {});
            }
          });
        }}>
          {source.mode === "demo" && <p className="hint"><Icon name="info" size={16} /><span>{t("admin.staff.demoNote")}</span></p>}
          <ErrorSummary summary={f.summary} errors={f.errors} />
          <TextField label={t("admin.staff.pw.label")} hint={t("admin.staff.pw.hint")} value={f.values.password} onChange={(v) => f.set("password", v)} error={f.errors.password} required autoComplete="new-password" />
          <DialogActions>
            <DialogClose asChild><Button variant="secondary" type="button">{t("common.cancel")}</Button></DialogClose>
            <Button variant="primary" type="submit" disabled={f.submitting} data-save-password>{f.submitting ? t("common.saving") : t("admin.staff.pw.save")}</Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HandoverDialog({ person, result, onClose }: { person: Person; result: PasswordResult; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const line = staffHandover({ email: result.loginEmail, signInWith: result.signInWith, kind: result.signInWith.includes("@") ? "email" : "mobile" }, lang);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={t("admin.staff.pw.doneTitle")}>
        <div data-handover data-simulated={result.simulated}>
          {result.simulated && <div className="banner info" role="note"><Icon name="info" /><span className="text">{t("admin.staff.pw.simulated")}</span></div>}
          <p>{t("admin.staff.pw.tell", { name: person.name })}</p>
          <p className="admin-handover" data-handover-line>{line}</p>
          {!result.simulated && <p className="muted small">{t("admin.staff.pw.signedOut")}</p>}
        </div>
        <DialogActions>
          <Button variant="secondary" type="button" onClick={() => { void navigator.clipboard?.writeText(line).then(() => toast(t("admin.staff.pw.copied")), () => undefined); }}><Icon name="copy" />{t("admin.staff.pw.copy")}</Button>
          <Button variant="primary" type="button" onClick={onClose} data-handover-done>{t("admin.staff.pw.done")}</Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ person, projects, onClose }: { person: Person; projects: ProjectLite[] | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const before = person.projectIds ?? [];
  const [picked, setPicked] = useState<string[]>(before);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const p of projects ?? []) {
        const was = before.includes(p.id), now = picked.includes(p.id);
        if (was !== now) await run("setAssignment", { projectId: p.id, userId: person.id, assigned: now });
      }
      toast(t("admin.staff.assign.saved"));
      onClose();
    } catch (e) { setError(errorText(e, t)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={t("admin.staff.assign.title", { name: person.name })}>
        <div data-assign-dialog>
          {error && <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{error}</span></div>}
          {!projects ? <Skeleton lines={3} /> : projects.length === 0 ? <p className="muted">{t("admin.staff.assign.none")}</p>
            : <ProjectTicks projects={projects} picked={picked} onChange={setPicked} />}
        </div>
        <DialogActions>
          <DialogClose asChild><Button variant="secondary" type="button">{t("common.cancel")}</Button></DialogClose>
          <Button variant="primary" type="button" onClick={() => void save()} disabled={busy || !projects?.length} data-save-assign>{busy ? t("common.saving") : t("admin.staff.assign.save")}</Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
