/** Role scope: menus and the demo read matrix (D-05, D-42 viewer, D-43 CA, QA F1/F6/F7/F9). firestore.rules mirrors these; its emulator cases are in docs/rules-test-matrix.md §17. */
import { describe, expect, it } from "vitest";
import { canOpen, canRead, navFor, projectTabsFor, type Role } from "../src";

const ctx = (role: Role, assignedProjectIds: string[] = []) => ({ role, uid: `u_${role}`, assignedProjectIds });
const keys = (role: Role) => navFor(role).map((n) => n.key);

describe("menus by role", () => {
  it("RL-01 each role's menu is exactly its scope", () => {
    expect(keys("viewer")).toEqual(["home", "projects", "reports"]);
    expect(keys("ca")).toEqual(["home", "accounts", "reports"]);
    expect(keys("pm")).not.toContain("clients");
    expect(keys("pm")).not.toContain("billing");
    expect(keys("supervisor")).toEqual(["home", "projects", "labour", "expenses", "procurement", "calendar", "machinery"]);
    expect(keys("owner")).toHaveLength(14);
    expect(canOpen("viewer", "clients")).toBe(false);
    expect(canOpen("ca", "projects")).toBe(false);
  });

  it("RL-02 project tabs hide billing, contracts and profit from site roles; the viewer sees the overview only", () => {
    for (const r of ["pm", "supervisor"] as const) {
      expect(projectTabsFor(r)).not.toContain("billing");
      expect(projectTabsFor(r)).not.toContain("pnl");
    }
    expect(projectTabsFor("viewer")).toEqual(["overview"]);
    expect(projectTabsFor("owner")).toHaveLength(12);
  });
});

describe("read matrix", () => {
  const p = { projectId: "p1" };
  it("RL-03 viewer (D-42): totals and project progress, no client contacts, no raw lists", () => {
    const v = ctx("viewer");
    expect(canRead("projects", { id: "p1" }, v)).toBe(true);
    expect(canRead("projects/private/budget", p, v)).toBe(true);
    expect(canRead("rollups", { scope: "project", projectId: "p1" }, v)).toBe(true);
    expect(canRead("finance_rollups", {}, v)).toBe(true);
    for (const c of ["clients", "invoices", "payments_received", "accounts", "attendance", "roster", "boq_items", "workers", "expenses", "projects/private/commercial"]) {
      expect(canRead(c, p, v), c).toBe(false);
    }
  });

  it("RL-04 CA (D-43): accounting records only; no clients, leads, workers, KYC or project detail", () => {
    const c = ctx("ca");
    for (const k of ["expenses", "invoices", "payments_received", "account_transactions", "accounts", "vendor_bills", "vendor_payments", "worker_payments", "client_balances", "finance_rollups"]) {
      expect(canRead(k, p, c), k).toBe(true);
    }
    for (const k of ["clients", "workers", "workers/private/kyc", "workers/private/pay", "roster", "attendance", "projects/private/commercial", "project_milestones", "boq_items"]) {
      expect(canRead(k, p, c), k).toBe(false);
    }
  });

  it("RL-05 PM (F1): only workers on their sites' rosters, and never a rate", () => {
    const pm = ctx("pm", ["p1"]);
    expect(canRead("workers", { id: "w1", siteIds: ["p1", "p9"] }, pm)).toBe(true);
    expect(canRead("workers", { id: "w2", siteIds: ["p9"] }, pm)).toBe(false);
    expect(canRead("workers", { id: "w3" }, pm)).toBe(false);
    expect(canRead("workers/private/pay", { id: "pay" }, pm)).toBe(false);
    expect(canRead("workers/private/kyc", { id: "kyc" }, pm)).toBe(false);
    expect(canRead("project_terms", { id: "p1" }, pm)).toBe(false);
    expect(canRead("clients", {}, pm)).toBe(false);
  });

  it("RL-06 supervisor: the roster of their site, never the worker master or money totals", () => {
    const s = ctx("supervisor", ["p1"]);
    expect(canRead("roster", p, s)).toBe(true);
    expect(canRead("roster", { projectId: "p2" }, s)).toBe(false);
    expect(canRead("workers", { siteIds: ["p1"] }, s)).toBe(false);
    expect(canRead("rollups", { scope: "project", projectId: "p1" }, s)).toBe(false);
    expect(canRead("projects/private/budget", p, s)).toBe(false);
  });
});
