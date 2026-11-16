"use client";
// Expense heads (spec §7.1 "editable by admin", §7.4): the tree people pick from when they enter an expense. The owner
// picks a head and then adds one under it, renames it, moves it or archives it; each change asks first. No amount is
// ever changed here: totals are kept by head and added up again from the tree (D-10), and nothing is deleted.
import {
  categoryRefusalKey, MAX_CATEGORY_LEVELS, moveRefusal,
  type Category, type CategoryMove, type CategoryTree,
} from "@ag/core";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ExpenseTabs, useCategoryTree, useLang } from "@/components/expenses/common";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog, Skeleton, useToast } from "@/components/ui/feedback";
import { SelectField, TextField } from "@/components/ui/form";
import { useRead, useRun, useSession } from "@/data/DataProvider";
import { useSpendingsTabs } from "./tabs";

const TOP = "__top";
type Ask =
  | { kind: "add"; parentId: string | null }
  | { kind: "rename" | "move" | "archive" | "restore"; id: string };

/** The refusal in the person's language (the commands answer in English; the key finds the Hindi words). */
function useSay(): (e: unknown) => string {
  const { t } = useTranslation();
  return (e) => {
    const message = e instanceof Error ? e.message : String(e);
    const key = categoryRefusalKey(message);
    return key ? t(`spendings.refusal.${key}`) : message;
  };
}

function Shell({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={title}>{open ? children : null}</DialogContent>
    </Dialog>
  );
}

function Problem({ text }: { text: string | null }) {
  return text ? <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{text}</span></div> : null;
}

export function CategoriesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const session = useSession();
  const tree = useCategoryTree();
  const tabs = useSpendingsTabs();
  const run = useRun();
  const toast = useToast();
  const say = useSay();
  const [picked, setPicked] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const owner = session?.role === "owner";
  const allowed = owner || session?.role === "accountant";
  // A move that was interrupted (the page was closed part-way) is offered again, from where it stopped.
  const unfinished = useRead(`cat-moves:${owner}`, (s) => (owner
    ? s.query<CategoryMove>("category_moves", { where: [{ field: "status", op: "==", value: "running" }], limit: 5 }).then((p) => p.items)
    : Promise.resolve([] as CategoryMove[])));

  const title = t("spendings.cats.title");
  const crumbs = [{ label: t("nav.expenses"), href: "/expenses/" }, { label: title }];
  if (session && !allowed) return <AppShell nav="expenses" title={title} crumbs={[{ label: title }]}><NoAccess name={title} /></AppShell>;

  const nameOf = (c: Category) => (lang === "hi" && c.nameHi ? c.nameHi : c.name);
  const otherName = (c: Category) => (lang === "hi" ? (c.nameHi ? c.name : "") : c.nameHi ?? "");
  const pathName = (id: string) => (tree ? tree.pathOf(id).map((x) => nameOf(tree.byId.get(x)!)).join(" › ") : "");
  const sel = picked && tree?.byId.has(picked) ? tree.byId.get(picked)! : null;
  const target = ask && ask.kind !== "add" && tree?.byId.has(ask.id) ? tree.byId.get(ask.id)! : null;

  /** Run the remaining pages of a move, one after another, until it says it is done. */
  const finishMove = async (moveId: string, soFar: number) => {
    setProgress(soFar);
    try {
      for (let i = 0; i < 500; i++) {
        const r = await run("continueCategoryMove", { moveId });
        setProgress(r.rewritten);
        if (r.done) break;
      }
      toast(t("spendings.cats.moveDialog.done"));
    } catch (e) { toast(say(e), "error"); } finally { setProgress(null); }
  };

  const setActive = async (c: Category, archived: boolean) => {
    try {
      await run("archiveCategory", { id: c.id, archived });
      toast(t(archived ? "spendings.cats.archiveDialog.done" : "spendings.cats.archiveDialog.restored"));
    } catch (e) { toast(say(e), "error"); }
  };

  const branch = (parentId: string | null): ReactNode => {
    const list = tree ? (parentId ? tree.childrenOf(parentId) : tree.roots()) : [];
    if (!list.length) return null;
    return (
      <ul>
        {list.map((c) => {
          const inner = (
            <>
              <span className="cat-name">{nameOf(c)}</span>
              {otherName(c) ? <span className="cat-other" lang={lang === "hi" ? "en" : "hi"}>{otherName(c)}</span> : null}
              {c.active === false ? <span className="badge neutral">{t("spendings.cats.archivedTag")}</span> : null}
            </>
          );
          return (
            <li key={c.id} data-cat={c.id} data-parent={c.parentId ?? ""} data-active={c.active !== false} data-name={c.name}>
              {owner
                ? <button type="button" className="cat-row" aria-pressed={picked === c.id} onClick={() => setPicked(picked === c.id ? null : c.id)}>{inner}</button>
                : <div className="cat-row">{inner}</div>}
              {branch(c.id)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <AppShell nav="expenses" title={title} crumbs={crumbs}>
      <div className="page-head">
        <div className="heading"><h1>{title}</h1><p className="sub">{t("spendings.cats.intro")}</p></div>
        {owner && (
          <div className="page-actions">
            <Button variant="primary" onClick={() => setAsk({ kind: "add", parentId: null })} data-cat-add-top><Icon name="plus" />{t("spendings.cats.addTop")}</Button>
          </div>
        )}
      </div>
      <ExpenseTabs current="categories" extra={tabs} />

      {session && !owner && <div className="banner info" role="note" data-cat-read-only><Icon name="lock" /><span className="text">{t("spendings.cats.readOnly")}</span></div>}
      {owner && progress !== null && <div className="banner info" role="status" data-cat-progress><Icon name="info" /><span className="text">{t("spendings.cats.moveDialog.finishing", { n: progress })}</span></div>}
      {owner && progress === null && !!unfinished?.length && (
        <div className="banner warning" role="status" data-cat-unfinished><Icon name="alert" />
          <span className="text">{t("spendings.cats.moveDialog.unfinished")} <button type="button" className="link-btn" onClick={() => void finishMove(unfinished[0]!.id, unfinished[0]!.rewritten)}>{t("spendings.cats.moveDialog.finish")}</button></span></div>
      )}

      {owner && (
        <section className="card cat-actions" aria-live="polite" data-cat-actions>
          {sel ? (
            <>
              <b className="cat-selected" data-cat-selected={sel.id}>{t("spendings.cats.selected", { name: pathName(sel.id) })}</b>
              <div className="page-actions">
                <Button size="sm" onClick={() => setAsk({ kind: "add", parentId: sel.id })} disabled={sel.active === false || (tree?.level(sel.id) ?? 0) >= MAX_CATEGORY_LEVELS} data-cat-action="add"><Icon name="plus" />{t("spendings.cats.addUnder")}</Button>
                <Button size="sm" onClick={() => setAsk({ kind: "rename", id: sel.id })} data-cat-action="rename"><Icon name="edit" />{t("spendings.cats.rename")}</Button>
                <Button size="sm" onClick={() => setAsk({ kind: "move", id: sel.id })} disabled={progress !== null || !!unfinished?.length} data-cat-action="move"><Icon name="chevron-right" />{t("spendings.cats.move")}</Button>
                {sel.active === false
                  ? <Button size="sm" onClick={() => setAsk({ kind: "restore", id: sel.id })} data-cat-action="restore"><Icon name="reset" />{t("spendings.cats.restore")}</Button>
                  : <Button size="sm" onClick={() => setAsk({ kind: "archive", id: sel.id })} data-cat-action="archive"><Icon name="archive" />{t("spendings.cats.archive")}</Button>}
              </div>
            </>
          ) : <p className="muted">{t("spendings.cats.pick")}</p>}
        </section>
      )}

      <section className="card" aria-label={t("spendings.cats.list")} data-cat-list>
        {!tree ? <Skeleton lines={8} /> : <div className="cat-tree">{branch(null)}</div>}
      </section>

      <Shell open={ask?.kind === "add"} onClose={() => setAsk(null)}
        title={ask?.kind === "add" && ask.parentId && tree?.byId.has(ask.parentId) ? t("spendings.cats.add.titleUnder", { name: nameOf(tree.byId.get(ask.parentId)!) }) : t("spendings.cats.add.title")}>
        {ask?.kind === "add" && (
          <NameForm parent={ask.parentId && tree?.byId.has(ask.parentId) ? tree.byId.get(ask.parentId)! : null} onClose={() => setAsk(null)} onDone={(id) => setPicked(id)} />
        )}
      </Shell>
      <Shell open={ask?.kind === "rename" && !!target} onClose={() => setAsk(null)} title={target ? t("spendings.cats.renameDialog.title", { name: nameOf(target) }) : ""}>
        {ask?.kind === "rename" && target && <NameForm cat={target} parent={null} onClose={() => setAsk(null)} />}
      </Shell>
      <Shell open={ask?.kind === "move" && !!target} onClose={() => setAsk(null)} title={target ? t("spendings.cats.moveDialog.title", { name: nameOf(target) }) : ""}>
        {ask?.kind === "move" && target && tree && (
          <MoveForm cat={target} tree={tree} onClose={() => setAsk(null)} onPages={(moveId, soFar) => void finishMove(moveId, soFar)} />
        )}
      </Shell>
      <ConfirmDialog open={ask?.kind === "archive" && !!target} onOpenChange={(o) => { if (!o) setAsk(null); }}
        title={target ? t("spendings.cats.archiveDialog.title", { name: nameOf(target) }) : ""} body={t("spendings.cats.archiveDialog.body")}
        confirmLabel={t("spendings.cats.archiveDialog.confirm")} onConfirm={() => (target ? setActive(target, true) : undefined)} />
      <ConfirmDialog open={ask?.kind === "restore" && !!target} onOpenChange={(o) => { if (!o) setAsk(null); }} destructive={false}
        title={target ? t("spendings.cats.archiveDialog.restoreTitle", { name: nameOf(target) }) : ""} body={t("spendings.cats.archiveDialog.restoreBody")}
        confirmLabel={t("spendings.cats.archiveDialog.restoreConfirm")} onConfirm={() => (target ? setActive(target, false) : undefined)} />
    </AppShell>
  );
}

/** Add a head (under `parent`, or at the top) or rename `cat`: the English name and, if wanted, the Hindi one. */
function NameForm({ cat, parent, onClose, onDone }: { cat?: Category; parent: Category | null; onClose: () => void; onDone?: (id: string) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const run = useRun();
  const toast = useToast();
  const say = useSay();
  const [name, setName] = useState(cat?.name ?? "");
  const [nameHi, setNameHi] = useState(cat?.nameHi ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: string | null } | null>(null);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (cat) {
        await run("renameCategory", { id: cat.id, name, nameHi });
        toast(t("spendings.cats.renameDialog.done"));
      } else {
        const r = await run("addCategory", { name, nameHi, parentId: parent?.id ?? null });
        toast(t("spendings.cats.add.done"));
        onDone?.(r.id);
      }
      onClose();
    } catch (e) {
      const fields = (e as { fields?: Record<string, string> }).fields ?? {};
      setError({ text: say(e), field: Object.keys(fields)[0] ?? null });
    } finally { setBusy(false); }
  };
  const parentName = parent ? (lang === "hi" && parent.nameHi ? parent.nameHi : parent.name) : "";
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} data-cat-name-form>
      <p className="muted small">{cat ? t("spendings.cats.renameDialog.note") : parent ? t("spendings.cats.add.note", { name: parentName }) : ""}</p>
      <Problem text={error && !error.field ? error.text : null} />
      <TextField label={t("spendings.cats.name")} value={name} onChange={setName} required error={error?.field === "name" || error?.field === "parentId" ? error.text : undefined} />
      <TextField label={t("spendings.cats.nameHi")} value={nameHi} onChange={setNameHi} hint={t("spendings.cats.nameHiHint")} error={error?.field === "nameHi" ? error.text : undefined} />
      <DialogActions>
        <DialogClose asChild><Button variant="secondary" type="button">{t("common.cancel")}</Button></DialogClose>
        <Button variant="primary" type="submit" disabled={busy} data-cat-save>{busy ? t("common.working") : cat ? t("spendings.cats.renameDialog.save") : t("spendings.cats.add.save")}</Button>
      </DialogActions>
    </form>
  );
}

/** Choose the new place for a head. Only places the move would be allowed to are offered. */
function MoveForm({ cat, tree, onClose, onPages }: { cat: Category; tree: CategoryTree; onClose: () => void; onPages: (moveId: string, soFar: number) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const run = useRun();
  const toast = useToast();
  const say = useSay();
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (c: Category) => (lang === "hi" && c.nameHi ? c.nameHi : c.name);
  const places = [
    ...(moveRefusal(tree, cat.id, null) ? [] : [{ value: TOP, label: t("spendings.cats.moveDialog.top") }]),
    ...tree.roots().flatMap((r) => tree.descendantsAndSelf(r.id))
      .filter((id) => !moveRefusal(tree, cat.id, id))
      .map((id) => ({ value: id, label: `${"— ".repeat(tree.level(id) - 1)}${nameOf(tree.byId.get(id)!)}` })),
  ];
  const move = async () => {
    if (busy || !to) return;
    setBusy(true);
    setError(null);
    try {
      const r = await run("moveCategory", { id: cat.id, parentId: to === TOP ? null : to });
      onClose();
      if (r.done) toast(t("spendings.cats.moveDialog.done"));
      else onPages(r.moveId, r.rewritten);
    } catch (e) { setError(say(e)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void move(); }} data-cat-move-form>
      <p className="muted small">{t("spendings.cats.moveDialog.note")}</p>
      <Problem text={error} />
      <SelectField label={t("spendings.cats.moveDialog.to")} value={to} onChange={setTo} options={places} placeholder={t("spendings.cats.moveDialog.choose")} required />
      <DialogActions>
        <DialogClose asChild><Button variant="secondary" type="button">{t("common.cancel")}</Button></DialogClose>
        <Button variant="primary" type="submit" disabled={busy || !to} data-cat-move>{busy ? t("common.working") : t("spendings.cats.moveDialog.confirm")}</Button>
      </DialogActions>
    </form>
  );
}
