/** Client master (spec §8.1): name, company, phone, WhatsApp, email, address, GSTIN, PAN, type, notes. */
import type { Client, Project } from "../model";
import { toStoredAnyPhone, toStoredPhone } from "../phone";
import { searchKeywords } from "../search";
import type { Doc, MemoryStore } from "../store";
import { Checker, CommandError, isEmail, isGstin, isPan, newId, requireRole, stampCreate, stampUpdate, trimOrEmpty, type CommandCtx } from "./common";

export interface ClientInput {
  name: string;
  company?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  stateCode?: string;
  gstin?: string;
  pan?: string;
  type: Client["type"];
  notes?: string;
}

export function validateClient(input: ClientInput): ClientInput {
  const c = new Checker();
  const name = trimOrEmpty(input.name);
  c.need("name", name.length >= 2, "Enter the client's name.");
  c.need("type", ["individual", "builder", "government"].includes(input.type), "Choose individual, builder or government department.");
  const phone = trimOrEmpty(input.phone);
  const whatsapp = trimOrEmpty(input.whatsapp);
  c.need("phone", !phone || !!toStoredAnyPhone(phone), "Enter a mobile number, or a landline with its STD code, like 0522 2345678.");
  c.need("whatsapp", !whatsapp || !!toStoredPhone(whatsapp), "Enter a 10-digit WhatsApp number.");
  const email = trimOrEmpty(input.email);
  c.need("email", !email || isEmail(email), "Enter an email address like name@example.com.");
  const gstin = trimOrEmpty(input.gstin).toUpperCase();
  c.need("gstin", !gstin || isGstin(gstin), "Check the GSTIN: 15 characters, like 09ABCDE1234F1ZY, and the last one must match.");
  const pan = trimOrEmpty(input.pan).toUpperCase();
  c.need("pan", !pan || isPan(pan), "A PAN has 10 characters, like ABCDE1234F.");
  const stateCode = trimOrEmpty(input.stateCode) || (gstin ? gstin.slice(0, 2) : "");
  c.need("stateCode", !stateCode || /^\d{2}$/.test(stateCode), "The state code has 2 digits, like 09 for Uttar Pradesh.");
  c.throwIfAny();
  return {
    name, type: input.type, company: trimOrEmpty(input.company), phone: phone ? toStoredAnyPhone(phone)! : "",
    whatsapp: whatsapp ? toStoredPhone(whatsapp)! : "", email, address: trimOrEmpty(input.address), stateCode, gstin, pan,
    notes: trimOrEmpty(input.notes),
  };
}

export function createClient(store: MemoryStore, input: ClientInput, ctx: CommandCtx): string {
  requireRole(ctx, ["owner", "accountant"], "add clients");
  const v = validateClient(input);
  const id = newId();
  store.set("clients", { id, ...v, searchKeywords: searchKeywords(v.name, v.company, v.phone, v.gstin), ...stampCreate(ctx) } as Doc);
  return id;
}

export function updateClient(store: MemoryStore, id: string, input: ClientInput, ctx: CommandCtx): void {
  requireRole(ctx, ["owner", "accountant"], "edit clients");
  if (!store.get("clients", id)) throw new CommandError("This client no longer exists.");
  const v = validateClient(input);
  store.merge("clients", id, { ...v, searchKeywords: searchKeywords(v.name, v.company, v.phone, v.gstin), ...stampUpdate(ctx) });
  // Keep the client-name snapshot on projects in step (§3.1 rule 2).
  for (const p of store.list<Project>("projects", (p) => p.clientId === id, { field: "clientId", value: id })) store.merge("projects", p.id, { clientName: v.name });
}

/** Outstanding per client (§8.1): billed − received, from posted client balances. */
export function clientOutstanding(store: MemoryStore, clientId: string): { billedPaise: number; receivedPaise: number; outstandingPaise: number } {
  const b = store.get<{ billedPaise?: number; receivedPaise?: number }>("client_balances", clientId);
  const billed = b?.billedPaise ?? 0;
  const received = b?.receivedPaise ?? 0;
  return { billedPaise: billed, receivedPaise: received, outstandingPaise: billed - received };
}
