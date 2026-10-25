"use client";
import { useRouter } from "next/navigation";
import { canOpen, isFinanceRole, type Client } from "@ag/core";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { DataTable } from "@/components/ui/data-table";
import { useSession } from "@/data/DataProvider";
import { phone } from "@/lib/fmt";

/** Client master list (spec §8.1). Finance roles read; owner and accountant add and edit. */
export function ClientsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const session = useSession();
  const canEdit = !!session && isFinanceRole(session.role);
  const typeLabel = (v: Client["type"]) => t(`clients.${v}`);

  return (
    <AppShell nav="clients" title={t("clients.title")} crumbs={[{ label: t("nav.clients") }]} actionBar={canEdit}>
      <div className="page-head">
        <div className="heading"><h1>{t("clients.title")}</h1></div>
        {canEdit && (
          <div className="page-actions action-bar">
            <Link className="btn btn-primary" href="/clients/edit/"><Icon name="plus" />{t("clients.new")}</Link>
          </div>
        )}
      </div>
      {session && !canOpen(session.role, "clients") ? (
        <NoAccess name={t("clients.title")} heading={false} />
      ) : (
        <DataTable<Client>
          id="clients" collection="clients" caption={t("clients.title")} exportName="clients"
          defaultSort={{ field: "name", dir: "asc" }} rowHref={(c) => `/clients/view/?id=${c.id}`}
          filters={[{ key: "type", label: t("clients.type"), options: (["individual", "builder", "government"] as const).map((v) => ({ value: v, label: typeLabel(v) })), where: (v) => ({ field: "type", op: "==", value: v }) }]}
          columns={[
            { key: "name", header: t("clients.name"), cell: (c) => c.name, sortField: "name", cardHead: true },
            { key: "type", header: t("clients.type"), cell: (c) => typeLabel(c.type), sortField: "type" },
            { key: "phone", header: t("clients.phone"), cell: (c) => phone(c.phone), csv: (c) => c.phone ?? "" },
            { key: "email", header: t("clients.email"), cell: (c) => c.email || "—", defaultHidden: true },
            { key: "gstin", header: t("clients.gstin"), cell: (c) => c.gstin || "—" },
            { key: "address", header: t("clients.address"), cell: (c) => c.address || "—", defaultHidden: true },
          ]}
          rowActions={canEdit ? [{ label: t("common.edit"), onSelect: (c) => { router.push(`/clients/edit/?id=${c.id}`); } }] : undefined}
          empty={{ title: t("clients.empty"), body: t("clients.emptyBody") }}
        />
      )}
    </AppShell>
  );
}
