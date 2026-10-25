"use client";
import { canOpen, isFinanceRole, navFor, searchTerm, type Client, type Project, type Role, type Worker } from "@ag/core";
import * as D from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useData, useSession, useSmall } from "@/data/DataProvider";
import type { DataSource, Session } from "@/data/types";
import { usePmWorkers } from "@/components/workers/pmRoster";
import { Icon } from "./Icon";

interface Hit { key: string; group: "actions" | "pages" | "projects" | "workers" | "clients"; label: string; meta?: string; href: string; icon: string }

const OPEN_EVENT = "ag-open-palette";
/** Opens the palette from anywhere (top-bar search, the phone's ⋮ panel). */
export const openPalette = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** Quick actions by role (spec §4A.2); more arrive with their modules. */
function actionsFor(role: Role): { key: string; href: string; icon: string; roles: (r: Role) => boolean }[] {
  const staff = (r: Role) => isFinanceRole(r) || r === "pm" || r === "supervisor";
  return [
    { key: "addExpense", href: "/expenses/", icon: "receipt", roles: staff },
    { key: "markAttendance", href: "/labour/attendance/", icon: "check", roles: staff },
    { key: "addProject", href: "/projects/new/", icon: "folder", roles: isFinanceRole },
    { key: "addClient", href: "/clients/edit/", icon: "contact", roles: isFinanceRole },
    { key: "addWorker", href: "/labour/workers/edit/", icon: "user-plus", roles: (r: Role) => isFinanceRole(r) || r === "pm" },
  ].filter((a) => a.roles(role));
}

/** Records the role can read whose keywords match: at most 6 per kind, never a whole collection (rule 9). */
async function searchRecords(s: DataSource, session: Session, term: string, pmWorkers: Worker[] | undefined, roleOf: (k: string) => string): Promise<Hit[]> {
  const role = session.role;
  const kw = { field: "searchKeywords", op: "array-contains" as const, value: term };
  const tasks: Promise<Hit[]>[] = [];
  if (canOpen(role, "projects")) {
    const where = [kw, ...(isFinanceRole(role) || role === "viewer" ? [] : [{ field: "assignedUsers", op: "array-contains" as const, value: session.uid }])];
    tasks.push(s.query<Project>("projects", { where, orderBy: [{ field: "name" }], limit: 6 })
      .then((p) => p.items.map((x) => ({ key: `p-${x.id}`, group: "projects" as const, label: x.name, meta: x.code, href: `/projects/view/?id=${x.id}`, icon: "folder" }))));
  }
  if (isFinanceRole(role)) {
    tasks.push(s.query<Worker>("workers", { where: [kw], orderBy: [{ field: "name" }], limit: 6 })
      .then((p) => p.items.map((x) => ({ key: `w-${x.id}`, group: "workers" as const, label: x.name, meta: roleOf(x.role), href: `/labour/workers/view/?id=${x.id}`, icon: "users" }))));
  } else if ((role === "pm" || role === "supervisor") && pmWorkers) {
    // Site roles search the rosters of their own sites (QA N11). A supervisor can't open worker records, so the hit opens the site's workforce.
    const hits = pmWorkers.filter((w) => ((w as Worker & { searchKeywords?: string[] }).searchKeywords ?? []).includes(term)).slice(0, 6);
    tasks.push(Promise.resolve(hits.map((x) => ({
      key: `w-${x.id}`, group: "workers" as const, label: x.name, meta: roleOf(x.role), icon: "users",
      href: role === "pm" ? `/labour/workers/view/?id=${x.id}` : `/projects/view/?id=${x.siteIds?.[0] ?? ""}&tab=workforce`,
    }))));
  }
  if (canOpen(role, "clients")) {
    tasks.push(s.query<Client>("clients", { where: [kw], orderBy: [{ field: "name" }], limit: 6 })
      .then((p) => p.items.map((x) => ({ key: `c-${x.id}`, group: "clients" as const, label: x.name, meta: x.company, href: `/clients/view/?id=${x.id}`, icon: "contact" }))));
  }
  return (await Promise.all(tasks)).flat();
}

/**
 * Global search and command palette (spec §4A.2, §4A.5): opens from the top-bar search or Ctrl/Cmd+K.
 * Searches projects, workers and clients by keyword, limited to what the role may read, plus quick actions and pages.
 */
export function CommandPalette() {
  const { t, i18n } = useTranslation();
  const { source } = useData();
  const session = useSession();
  const router = useRouter();
  const pmWorkers = usePmWorkers();
  const roles = (useSmall<{ id: string; workerRoles?: { key: string; label: string; labelHi?: string }[] }>("settings") ?? []).find((x) => x.id === "operations")?.workerRoles ?? [];
  const roleOf = (k: string) => { const r = roles.find((x) => x.key === k); return r ? (i18n.language === "hi" && r.labelHi ? r.labelHi : r.label) : k; };
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); opener.current = document.activeElement as HTMLElement | null; setOpen(true); }
    };
    const onOpen = () => { opener.current = document.activeElement as HTMLElement | null; setOpen(true); };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, []);

  useEffect(() => { if (!open) { setQ(""); setHits([]); setActive(0); } }, [open]);

  const fixed: Hit[] = useMemo(() => {
    if (!session) return [];
    const needle = q.trim().toLowerCase();
    const acts = actionsFor(session.role).map((a) => ({ key: `a-${a.key}`, group: "actions" as const, label: t(`palette.${a.key}`), href: a.href, icon: a.icon }));
    const pages = navFor(session.role).map((n) => ({ key: `n-${n.key}`, group: "pages" as const, label: t(`nav.${n.key}`), href: n.href, icon: n.icon }));
    return [...acts, ...pages].filter((h) => !needle || h.label.toLowerCase().includes(needle));
  }, [session, q, t]);

  useEffect(() => {
    const term = searchTerm(q);
    if (!open || !session || !term) { setHits([]); return; }
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      void searchRecords(source, session, term, pmWorkers, roleOf).then((h) => { if (live) { setHits(h); setActive(0); } }).catch(() => { if (live) setHits([]); }).finally(() => { if (live) setBusy(false); });
    }, 150);
    return () => { live = false; clearTimeout(timer); };
  }, [q, open, session, source, pmWorkers]);

  const all = [...hits, ...fixed];
  const go = (h: Hit) => { setOpen(false); router.push(h.href); };
  const groups: Hit["group"][] = ["projects", "workers", "clients", "actions", "pages"];

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="scrim" />
        <D.Content className="dialog dialog-fixed palette" aria-describedby={undefined} data-palette
          onCloseAutoFocus={(e) => { const o = opener.current; if (o && o !== document.body && o.isConnected) { e.preventDefault(); o.focus(); } }}>
          <D.Title className="sr-only">{t("palette.title")}</D.Title>
          <div className="palette-input">
            <Icon name="search" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("palette.placeholder")} aria-label={t("palette.title")}
              role="combobox" aria-expanded={all.length > 0} aria-controls="palette-list" aria-activedescendant={all[active] ? `ph-${all[active]!.key}` : undefined}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(all.length - 1, a + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                else if (e.key === "Enter" && all[active]) { e.preventDefault(); go(all[active]!); }
              }} />
            <kbd>Esc</kbd>
          </div>
          {all.length > 0 && <ul className="palette-list" id="palette-list" role="listbox" ref={listRef} aria-label={t("palette.title")}>
            {groups.map((g) => {
              const items = all.filter((h) => h.group === g);
              if (!items.length) return null;
              return (
                <li key={g} role="presentation">
                  <div className="palette-group" role="presentation">{t(`palette.${g}`)}</div>
                  <ul role="group" aria-label={t(`palette.${g}`)}>
                    {items.map((h) => {
                      const i = all.indexOf(h);
                      return (
                        <li key={h.key} id={`ph-${h.key}`} role="option" aria-selected={i === active} className="palette-item"
                          onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
                          <Icon name={h.icon} size={18} /><span className="grow">{h.label}</span>{h.meta ? <span className="meta">{h.meta}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>}
          {searchTerm(q) && !busy && hits.length === 0 && <p className="palette-empty" role="status">{t("palette.noMatch", { q: q.trim() })}</p>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
