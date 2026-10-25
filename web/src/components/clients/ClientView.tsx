"use client";
import { canOpen, isFinanceRole, type Client, type Project } from "@ag/core";
import { NoAccess, NotFoundRecord } from "@/components/ModulePage";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { useDoc, useDocStatus, useRead, useSession } from "@/data/DataProvider";
import { dash, phone, rupees } from "@/lib/fmt";
import { useParam } from "@/lib/params";

/** One client (spec §8.1): every master field, linked projects and outstanding balance. */
export function ClientView() {
  const { t } = useTranslation();
  const id = useParam("id");
  const session = useSession();
  const client = useDoc<Client>("clients", id);
  const status = useDocStatus("clients", id);
  const projects = useRead(`client-projects:${id}`, (s) => s.query<Project>("projects", { where: [{ field: "clientId", op: "==", value: id }], orderBy: [{ field: "name" }], limit: 50 }));
  const balance = useDoc<{ billedPaise?: number; receivedPaise?: number }>("client_balances", id);
  const name = client?.name ?? t("clients.title");

  return (
    <AppShell nav="clients" title={name} crumbs={[{ label: t("nav.clients"), href: "/clients/" }, { label: name }]}>
      {session && !canOpen(session.role, "clients") ? <NoAccess name={t("clients.title")} /> : client === undefined || id === undefined ? <Skeleton lines={6} /> : client === null ? (
        status === "denied" ? <NoAccess name={t("clients.title")} /> : status === undefined ? <Skeleton lines={4} />
          : <NotFoundRecord name={t("clients.title")} back="/clients/" backLabel={t("nav.clients")} />
      ) : (
        <>
          <div className="page-head">
            <div className="heading"><h1>{client.name}</h1><p className="sub">{t(`clients.${client.type}`)}{client.company ? ` · ${client.company}` : ""}</p></div>
            {session && isFinanceRole(session.role) && (
              <div className="page-actions"><Link className="btn btn-secondary" href={`/clients/edit/?id=${client.id}`}><Icon name="edit" />{t("common.edit")}</Link></div>
            )}
          </div>
          <div className="grid grid-2-1">
            <section className="card">
              <h2 className="card-title">{t("clients.contact")}</h2>
              <dl className="dl-grid">
                <div><dt>{t("clients.phone")}</dt><dd>{phone(client.phone)}</dd></div>
                <div><dt>{t("clients.whatsapp")}</dt><dd>{phone(client.whatsapp)}</dd></div>
                <div><dt>{t("clients.email")}</dt><dd>{dash(client.email)}</dd></div>
                <div><dt>{t("clients.address")}</dt><dd>{dash(client.address)}</dd></div>
              </dl>
              <h2 className="card-title" style={{ marginTop: "var(--space-6)" }}>{t("clients.tax")}</h2>
              <dl className="dl-grid">
                <div><dt>{t("clients.gstin")}</dt><dd>{dash(client.gstin)}</dd></div>
                <div><dt>{t("clients.pan")}</dt><dd>{dash(client.pan)}</dd></div>
                <div><dt>{t("clients.stateCode")}</dt><dd>{dash(client.stateCode)}</dd></div>
              </dl>
              {client.notes ? <p className="muted" style={{ marginTop: "var(--space-4)" }}>{client.notes}</p> : null}
            </section>
            <section className="card">
              <h2 className="card-title">{t("clients.outstanding")}</h2>
              <dl className="kv">
                <dt>{t("clients.billed")}</dt><dd>{rupees(balance?.billedPaise ?? 0)}</dd>
                <dt>{t("clients.received")}</dt><dd>{rupees(balance?.receivedPaise ?? 0)}</dd>
                <dt className="total">{t("clients.outstanding")}</dt><dd className="total">{rupees((balance?.billedPaise ?? 0) - (balance?.receivedPaise ?? 0))}</dd>
              </dl>
            </section>
          </div>
          <section className="section">
            <h2 className="section-title">{t("clients.linkedProjects")}</h2>
            {projects === undefined ? <Skeleton /> : projects.items.length === 0 ? <EmptyState title={t("clients.noProjects")} /> : (
              <ul className="list card">
                {projects.items.map((p) => (
                  <li key={p.id}><Icon name="folder" /><div className="grow"><Link href={`/projects/view/?id=${p.id}`}>{p.name}</Link><div className="meta">{p.code} · {t(`projects.${p.status}`)}</div></div></li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
