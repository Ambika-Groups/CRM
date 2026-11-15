import {
  INTEGRATIONS, maskSecret, validateIntegration, CommandError,
  type IntegrationId, type IntegrationStatus, type TestOutcome,
} from "@ag/core";
import type { SetupApi, SetupStatuses } from "../types";

const KEY = "ag-demo-setup";

/**
 * Setup & integrations in demo mode: a labelled SIMULATION (D-48). Nothing is sent anywhere and no secret is kept:
 * a secret you type is reduced to its masked tail at once. Tests pass or fail on what is saved, so the page, its
 * role gate and its screenshots can be checked without a real project. Every result says it is a simulation.
 */
export class DemoSetup implements SetupApi {
  readonly simulated = true;

  private read(): SetupStatuses {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as SetupStatuses; } catch { return {}; }
  }
  private write(s: SetupStatuses) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: the simulation just isn't kept */ }
  }

  async statuses(): Promise<SetupStatuses> { return this.read(); }

  async save(id: IntegrationId, input: { enabled?: boolean; enforce?: boolean; values: Record<string, string> }): Promise<IntegrationStatus> {
    const d = INTEGRATIONS[id];
    if (!d.available) throw new CommandError("This is coming in a later phase.");
    const all = this.read();
    const prev = all[id];
    const errors = validateIntegration(d, input.values, Object.fromEntries(Object.keys(prev?.masked ?? {}).map((k) => [k, true])));
    if (Object.keys(errors).length) throw new CommandError("Check the highlighted settings.", errors);
    const values = { ...(prev?.values ?? {}) }, masked = { ...(prev?.masked ?? {}) };
    let changed = false;
    for (const f of d.fields) {
      const v = (input.values[f.key] ?? "").trim();
      if (!v) continue;
      if (f.secret) { masked[f.key] = maskSecret(v); changed = true; } else if (values[f.key] !== v) { values[f.key] = v; changed = true; }
    }
    const enabled = input.enabled ?? prev?.enabled ?? true;
    const enforce = d.hasEnforce ? (input.enforce ?? prev?.enforce ?? false) : undefined;
    if (enabled !== (prev?.enabled ?? true) || (d.hasEnforce && enforce !== (prev?.enforce ?? false))) changed = true;
    const next: IntegrationStatus = {
      id, enabled, values, masked, ...(d.hasEnforce ? { enforce } : {}), test: changed ? null : prev?.test ?? null,
      lastOkAt: prev?.lastOkAt ?? null, updatedAt: new Date().toISOString(), updatedBy: "demo",
    };
    all[id] = next;
    this.write(all);
    return next;
  }

  async clear(id: IntegrationId): Promise<void> {
    const all = this.read();
    delete all[id];
    this.write(all);
  }

  async rotateWebsiteKey(): Promise<{ key: string; status: IntegrationStatus }> {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const key = `agw_demo_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    const all = this.read();
    const status: IntegrationStatus = { id: "websiteLink", enabled: true, values: {}, masked: { apiKey: maskSecret(key) }, test: null, lastOkAt: all.websiteLink?.lastOkAt ?? null, updatedAt: new Date().toISOString(), updatedBy: "demo" };
    all.websiteLink = status;
    this.write(all);
    return { key, status };
  }

  async test(id: IntegrationId, opts?: { key?: string }): Promise<TestOutcome> {
    const d = INTEGRATIONS[id];
    const all = this.read();
    const s = all[id];
    const sim = "Simulation: ";
    let out: TestOutcome;
    if (!d.available) out = { ok: false, message: "This is coming in a later phase." };
    else if (d.kind === "check") out = { ok: true, message: `${sim}this would be checked against your real project once you connect one. Nothing was contacted.` };
    else if (d.kind === "device") out = { ok: false, message: `${sim}there is no project connected on this device yet.`, hint: "Paste your Firebase web config above, or follow the setup guide to connect your own project." };
    else if (!s || (d.fields.some((f) => f.required && (f.secret ? !s.masked[f.key] : !s.values[f.key])))) {
      out = { ok: false, message: `${sim}nothing is saved yet.`, hint: "Fill in the settings and choose Save, then Test." };
    } else if (id === "websiteLink" && !opts?.key) {
      out = { ok: false, message: `${sim}to test, paste the website key.`, hint: "The key is shown once when you make it." };
    } else out = { ok: true, message: `${sim}saved and in the right format. A real test runs once you connect your own project.` };
    all[id] = { ...(s ?? { id, enabled: true, values: {}, masked: {} }), test: { ...out, at: new Date().toISOString() }, ...(out.ok ? { lastOkAt: new Date().toISOString() } : {}) };
    this.write(all);
    return out;
  }

  configInUse() { return { from: "none" as const, config: {} }; }
  enquiryEndpoint() { return "https://asia-south1-YOUR-PROJECT.cloudfunctions.net/submitEnquiry"; }
}
