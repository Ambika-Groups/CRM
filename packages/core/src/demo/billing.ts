/**
 * Demo data for billing (spec §8.2): a few quotations in different states, made through the real commands as the demo
 * accountant. The base seed already holds the 10 invoices and their receipts; nothing here adds or changes a bill, so
 * no total is counted twice. Ids start with `qtnDemo`.
 *
 *  qtnDemo01  draft                      Sharma Villa: boundary wall and gate
 *  qtnDemo02  sent                       Awadh Builders: interlocking for the Block B driveway
 *  qtnDemo03  accepted                   Nagar Nigam: drain covers on Shiv Nagar road (extra work)
 *  qtnDemo04  rejected (version 1)       Awadh Builders: site office and store room
 *  qtnDemo05  sent (Rev 2 of the above)  the same work at a revised rate
 */
import { saveQuotation, sendQuotation, setQuotationStatus, type QuotationInput } from "../commands/billing";
import { withIdSource, type CommandCtx } from "../commands/common";
import { DEFAULT_PAYMENT_TERMS, DEFAULT_QUOTATION_TERMS, type BillItem } from "../billing";
import { addDays } from "../dates";
import type { FeatureSeedCtx } from "./features";
import { DEMO_IDS } from "./seed";

const R = (rupees: number) => Math.round(rupees * 100);
const Q = (qty: number) => Math.round(qty * 1000);

export async function seedBilling(seed: FeatureSeedCtx): Promise<void> {
  const { store, anchor, nowIso } = seed;
  const accountant: CommandCtx = { uid: DEMO_IDS.accountant, role: "accountant", projectIds: [], nowIso };
  const day = (back: number) => addDays(anchor, -back);
  const line = (section: string, description: string, unit: string, qty: number, rate: number, hsnSac = "995454"): BillItem =>
    ({ section, description, unit, qtyMilli: Q(qty), ratePaise: R(rate), gstRateBp: 1800, hsnSac });
  const base = (date: string): Pick<QuotationInput, "date" | "validUntil" | "terms" | "paymentTerms"> =>
    ({ date, validUntil: addDays(date, 30), terms: DEFAULT_QUOTATION_TERMS, paymentTerms: DEFAULT_PAYMENT_TERMS });

  // The commands pick a random id for a new record; the demo wants stable ones, in the order they are made.
  let n = 0;
  await withIdSource(() => `qtnDemo${String(++n).padStart(2, "0")}`, async () => {
    saveQuotation(store, {
      ...base(day(1)), clientId: "clSharma", projectId: DEMO_IDS.projHouse, title: "Boundary wall and main gate",
      items: [
        line("Boundary wall", "Earthwork in excavation for the wall footing", "cum", 18, 420, "995432"),
        line("Boundary wall", "Brickwork in cement mortar 1:6, 230 mm wall", "cum", 26, 6800),
        line("Boundary wall", "Cement plaster 12 mm, both faces", "sqm", 210, 310, "995472"),
        line("Gate", "MS main gate, fabricated and fixed, with primer and paint", "nos", 1, 68000, "995477"),
      ],
      inclusions: "All materials, labour and tools.", exclusions: "Electrical points and lights on the gate pillars.",
    }, accountant);

    const sent = saveQuotation(store, {
      ...base(day(9)), clientId: "clAwadh", projectId: DEMO_IDS.projApt, title: "Interlocking for the Block B driveway",
      items: [
        line("Base", "Granular sub-base (GSB), laid and compacted, 150 mm", "cum", 96, 1650, "995421"),
        line("Surface", "Interlocking paver blocks 60 mm, supplied and laid", "sqft", 6900, 62, "995421"),
        line("Surface", "Kerb stone, supplied and fixed", "rmt", 240, 310, "995421"),
      ],
      inclusions: "Levelling, sand bedding and compaction.", exclusions: "Drainage pipes and manhole covers.",
    }, accountant);
    sendQuotation(store, { id: sent.id }, accountant);

    const accepted = saveQuotation(store, {
      ...base(day(20)), clientId: "clNagarNigam", projectId: DEMO_IDS.projGov, title: "RCC drain covers, Shiv Nagar road (extra work)",
      items: [
        line("Drain covers", "Precast RCC drain cover slab 100 mm, M25, with steel", "nos", 320, 1450),
        line("Drain covers", "Fixing in position with cement mortar", "nos", 320, 180),
      ],
    }, accountant);
    sendQuotation(store, { id: accepted.id }, accountant);
    setQuotationStatus(store, { id: accepted.id, status: "accepted", note: "Accepted by the Executive Engineer by letter." }, accountant);

    const office: QuotationInput = {
      ...base(day(16)), clientId: "clAwadh", projectId: DEMO_IDS.projApt, title: "Site office and store room",
      items: [
        line("Structure", "Plain cement concrete (PCC) M15 in foundation", "cum", 9, 5600),
        line("Structure", "Brickwork in cement mortar 1:6", "cum", 22, 7200),
        line("Structure", "Reinforced cement concrete (RCC) M25 roof slab, with steel", "cum", 11, 11800),
      ],
    };
    const first = saveQuotation(store, office, accountant);
    sendQuotation(store, { id: first.id }, accountant);
    setQuotationStatus(store, { id: first.id, status: "rejected", note: "The client asked for a lower brickwork rate." }, accountant);
    // A change after sending makes version 2 with the same number (D-17); version 1 stays as it was.
    const second = saveQuotation(store, {
      ...office, ...base(day(6)), id: first.id,
      items: office.items.map((it) => (it.description.startsWith("Brickwork") ? { ...it, ratePaise: R(6800) } : it)),
    }, accountant);
    sendQuotation(store, { id: second.id }, accountant);
  });
}
