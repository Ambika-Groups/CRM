/**
 * Demo data: the spec §17 test set. 3 projects (2 residential, 1 government), 50 workers, 30 days of
 * attendance, 200 expenses and 10 invoices, for an Indian construction business in Lucknow.
 * Every money effect goes through the real posting engine and approval actions, so rollups, balances
 * and account rows behave exactly as in production. Deterministic: same anchor date, same data.
 */
import { approveWorkerPayment, markAttendance, rosterSnapshot } from "../actions";
import { syncContractScope } from "../commands/labour";
import { seedCategories } from "../categories";
import { addDays, fyOf, monthKeyOf, weekday } from "../dates";
import { computeInvoice, type LineInput } from "../gst";
import type {
  Account, AttendanceStatus, Client, Expense, Invoice, PaymentMode, PaymentReceived, Project, User, Vendor, Worker, WorkerPayment,
} from "../model";
import { allocate, formatDocNumber } from "../numbering";
import { mulDivRound } from "../money";
import { MemoryStore, type Doc } from "../store";
import { tds194C } from "../wages";
import { DEFAULT_WORKER_ROLES } from "../commands/people";
import { searchKeywords } from "../search";

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
  };
}

const R = (rupees: number) => Math.round(rupees * 100);

export const DEMO_IDS = {
  owner: "uOwner", accountant: "uAccountant", pm: "uPm", sup1: "uSupShivNagar", sup2: "uSupGomti", viewer: "uViewer", ca: "uCa",
  projGov: "projShivNagar", projApt: "projGomti", projHouse: "projSharma",
  cash: "accCash", sbi: "accSbi", hdfc: "accHdfc",
  thekedar: "wMohanLal",
} as const;

export interface SeedSummary {
  anchor: string;
  projects: number;
  workers: number;
  attendanceDays: number;
  attendanceRecords: number;
  expensesManual: number;
  expensesGenerated: number;
  invoices: number;
  workerPayments: number;
}

const FIRST = ["Suresh", "Rajkumar", "Ramesh", "Sunita", "Ajay", "Raju", "Salim", "Pappu", "Kallu", "Shyam", "Meena", "Dinesh", "Mukesh",
  "Rakesh", "Santosh", "Anil", "Vinod", "Manoj", "Sanjay", "Ramesh", "Geeta", "Kamla", "Bablu", "Sonu", "Raju", "Arvind", "Lalit",
  "Naresh", "Pramod", "Satish", "Shiv", "Om", "Bhola", "Chhotelal", "Ram", "Hari", "Jagdish", "Phool", "Kishan", "Sohan",
  "Munna", "Rajendra", "Kamlesh", "Ashok", "Deepak", "Rinku", "Sushil", "Neeraj", "Pintu", "Golu"] as const;
const LAST = ["Pal", "Verma", "Kumar", "Devi", "Yadav", "Nishad", "Rawat", "Prajapati", "Babu", "Kumari", "Maurya", "Gautam",
  "Kashyap", "Lodhi", "Saini", "Rajput", "Pasi", "Kori", "Singh", "Chauhan"] as const;

interface Ctx { store: MemoryStore; now: string; anchor: string }

function put<T extends { id: string }>(store: MemoryStore, collection: string, doc: T) {
  store.set(collection, doc as unknown as Doc);
}

function auditFields(by: string, at: string) {
  return { createdBy: by, createdAt: at, updatedBy: by, updatedAt: at, isDeleted: false };
}

/** Build the demo store. `anchor` is "today" in IST; dates are placed relative to it. */
export async function seedDemo(anchor: string): Promise<{ store: MemoryStore; summary: SeedSummary }> {
  const store = new MemoryStore();
  const now = `${anchor}T09:00:00.000Z`;
  const c: Ctx = { store, now, anchor };
  const r = rng(20261025);
  const fy = fyOf(anchor);

  // ---------- settings (company details are placeholders, open questions B1–B4) ----------
  put(store, "settings", {
    id: "company", legalName: "Ambika Group [legal name to be confirmed]", tradeName: "Ambika Group",
    address: "[Registered address to be confirmed], Lucknow, Uttar Pradesh", stateCode: "09",
    gstin: "[GSTIN to be confirmed]", pan: "[PAN to be confirmed]", phone: "[Phone]", email: "[Email]",
    brandColor: "#C62828", gstScheme: "regular", logoPath: null, signaturePath: null, stampPath: null,
  });
  put(store, "settings", { id: "bank", accounts: [{ bankName: "[Bank to be confirmed]", accountName: "Ambika Group", accountNo: "[Account no.]", ifsc: "[IFSC]", branch: "", upiId: "[UPI ID]" }] });
  put(store, "meta", { id: "demo", anchor, seededAt: now, version: 1 });
  for (const cat of seedCategories()) put(store, "expense_categories", { ...cat, ...auditFields("system", now) });

  // ---------- users (one per role, two supervisors) ----------
  const users: User[] = [
    { id: DEMO_IDS.owner, name: "Anil Mishra", email: "owner@demo.ambika", role: "owner", active: true, language: "en", theme: "system", projectIds: [] },
    { id: DEMO_IDS.accountant, name: "Priya Srivastava", email: "accounts@demo.ambika", role: "accountant", active: true, language: "en", theme: "system", projectIds: [] },
    { id: DEMO_IDS.pm, name: "Vikas Tiwari", email: "vikas@demo.ambika", role: "pm", active: true, language: "en", theme: "system", projectIds: [DEMO_IDS.projGov, DEMO_IDS.projHouse] },
    { id: DEMO_IDS.sup1, name: "Ramesh Yadav", phone: "+919839000001", role: "supervisor", active: true, language: "hi", theme: "system", projectIds: [DEMO_IDS.projGov] },
    { id: DEMO_IDS.sup2, name: "Sunil Gupta", phone: "+919839000002", role: "supervisor", active: true, language: "hi", theme: "system", projectIds: [DEMO_IDS.projApt] },
    { id: DEMO_IDS.viewer, name: "Neha Agarwal", email: "viewer@demo.ambika", role: "viewer", active: true, language: "en", theme: "system", projectIds: [] },
    { id: DEMO_IDS.ca, name: "CA Rakesh Jain", email: "ca@demo.ambika", role: "ca", active: true, language: "en", theme: "system", projectIds: [] },
  ];
  for (const u of users) put(store, "users", { ...u, ...auditFields("system", now) });

  // ---------- clients and vendors ----------
  const clients: Client[] = [
    { id: "clNagarNigam", name: "Nagar Nigam Lucknow", type: "government", address: "Lalbagh, Lucknow 226001", stateCode: "09", gstin: "09AAALN0001C1ZV", phone: "+915222000000", notes: "Sample data: the GSTIN is a made-up, format-valid example." },
    { id: "clAwadh", name: "Awadh Builders Pvt Ltd", company: "Awadh Builders Pvt Ltd", type: "builder", address: "Gomti Nagar, Lucknow 226010", stateCode: "09", gstin: "09AAACA1234B1ZG", notes: "Sample data: the GSTIN is a made-up, format-valid example.", phone: "+919415000010", whatsapp: "+919415000010" },
    { id: "clSharma", name: "Rajesh Sharma", type: "individual", address: "Sector 11, Indira Nagar, Lucknow 226016", stateCode: "09", phone: "+919415000020", whatsapp: "+919415000020" },
  ];
  for (const cl of clients) put(store, "clients", { ...cl, ...auditFields(DEMO_IDS.accountant, now) });
  const vendors: Vendor[] = [
    { id: "vMaaDurga", name: "Maa Durga Stone Suppliers", type: "aggregate", phone: "+919839100001", gstin: "09AAAFM1234A1Z0" },
    { id: "vShreeCement", name: "Shree Cement Agency", type: "cement", phone: "+919839100002", gstin: "09AAAFS2345A1ZO" },
    { id: "vLucknowSteel", name: "Lucknow Steel Traders", type: "steel", phone: "+919839100003", gstin: "09AAAFL3456A1ZP" },
    { id: "vVermaTransport", name: "Verma Transport", type: "transporter", phone: "+919839100004" },
    { id: "vSinghJcb", name: "Singh JCB Hire", type: "machinery_owner", phone: "+919839100005", gstin: "09AAAFS4567A1ZC" },
  ];
  for (const v of vendors) put(store, "vendors", { ...v, ...auditFields(DEMO_IDS.accountant, now) });

  // ---------- accounts ----------
  const openingDate = addDays(anchor, -60);
  const accounts: Account[] = [
    { id: DEMO_IDS.cash, name: "Cash in hand", type: "cash", openingBalancePaise: R(250000), openingDate, active: true },
    { id: DEMO_IDS.sbi, name: "SBI current account", type: "bank", bankName: "State Bank of India", last4: "4821", openingBalancePaise: R(2500000), openingDate, active: true },
    { id: DEMO_IDS.hdfc, name: "HDFC current account", type: "bank", bankName: "HDFC Bank", last4: "0937", openingBalancePaise: R(1500000), openingDate, active: true },
  ];
  for (const a of accounts) put(store, "accounts", { ...a, balancePaise: a.openingBalancePaise, ...auditFields(DEMO_IDS.owner, now) });

  // ---------- projects (codes from the project counter) ----------
  let projNext: number | undefined;
  const code = () => { const a = allocate("project", fy, projNext); projNext = a.next; return a.number; };
  const projects: (Project & { budget: number; contract: number })[] = [
    {
      id: DEMO_IDS.projGov, code: code(), name: "Shiv Nagar CC Road", type: "government", subtype: "road",
      clientId: "clNagarNigam", clientName: "Nagar Nigam Lucknow", address: "Shiv Nagar", city: "Lucknow",
      startDate: addDays(anchor, -163), expectedEndDate: addDays(anchor, 98), status: "in_progress", isArchived: false,
      managerId: DEMO_IDS.pm, managerName: "Vikas Tiwari", assignedUsers: [DEMO_IDS.pm, DEMO_IDS.sup1], progressPct: 62,
      itcEligible: true, attendanceRequiresSelfie: false, attendanceRequiresGps: false,
      government: {
        department: "Nagar Nigam Lucknow", division: "Zone 4", engineerInCharge: { name: "Er. S. K. Verma", phone: "+919415000030" },
        tenderNo: "NN/LKO/2026/0431", nitRef: "NIT-17/2026", workOrderNo: "WO/NN/2026/118", workOrderDate: addDays(anchor, -166),
        agreementNo: "AGR/NN/2026/52", stipulatedStartDate: addDays(anchor, -163), stipulatedEndDate: addDays(anchor, 98),
      },
      residential: null, budget: R(14800000), contract: R(16450000),
    },
    {
      id: DEMO_IDS.projApt, code: code(), name: "Gomti Residency, Block B", type: "residential", subtype: "apartments",
      clientId: "clAwadh", clientName: "Awadh Builders Pvt Ltd", address: "Vibhuti Khand, Gomti Nagar", city: "Lucknow",
      startDate: addDays(anchor, -238), expectedEndDate: addDays(anchor, -24), status: "in_progress", isArchived: false,
      managerId: DEMO_IDS.pm, managerName: "Vikas Tiwari", assignedUsers: [DEMO_IDS.sup2], progressPct: 35,
      itcEligible: false, attendanceRequiresSelfie: false, attendanceRequiresGps: false,
      residential: { units: 24, floors: 6, builtUpAreaSqft: 28800, plotAreaSqft: 9600, reraNo: "UPRERAPRJ445566", contractType: "per_sqft", defectLiabilityMonths: 12 },
      government: null, budget: R(32000000), contract: R(35500000),
    },
    {
      id: DEMO_IDS.projHouse, code: code(), name: "Sharma Villa, Indira Nagar", type: "residential", subtype: "individual_house",
      clientId: "clSharma", clientName: "Rajesh Sharma", address: "Plot 14, Sector 11, Indira Nagar", city: "Lucknow",
      startDate: addDays(anchor, -205), expectedEndDate: addDays(anchor, 70), status: "in_progress", isArchived: false,
      managerId: DEMO_IDS.pm, managerName: "Vikas Tiwari", assignedUsers: [DEMO_IDS.pm], progressPct: 78,
      itcEligible: false, attendanceRequiresSelfie: false, attendanceRequiresGps: false,
      residential: { units: 1, floors: 3, builtUpAreaSqft: 2450, plotAreaSqft: 1800, contractType: "lump_sum", defectLiabilityMonths: 12 },
      government: null, budget: R(4600000), contract: R(4850000),
    },
  ];
  put(store, "counters", { id: "project", docType: "project", next: projNext });
  for (const { budget, contract, ...p } of projects) {
    put(store, "projects", { ...p, ...auditFields(DEMO_IDS.owner, now) });
    put(store, `projects/${p.id}/private`, { id: "budget", projectId: p.id, budgetPaise: budget });
    put(store, `projects/${p.id}/private`, { id: "commercial", projectId: p.id, contractValuePaise: contract });
  }

  // ---------- workers (50) and site rosters ----------
  const workers: Worker[] = [];
  workers.push({ id: DEMO_IDS.thekedar, name: "Mohan Lal", role: "thekedar", isThekedar: true, defaultPayType: "contract", phone: "+919839200000", active: true, joiningDate: addDays(anchor, -400) });
  const roster: Record<string, string[]> = { [DEMO_IDS.projGov]: [], [DEMO_IDS.projApt]: [], [DEMO_IDS.projHouse]: [] };
  const rates = { mistri: R(800), labour: R(500), helper: R(450), operator: R(700) } as const;
  const pay = new Map<string, number>();
  const plan: [string, number, (i: number) => keyof typeof rates, boolean][] = [
    [DEMO_IDS.projGov, 8, (i) => (i < 2 ? "mistri" : i === 5 ? "helper" : i === 6 ? "operator" : "labour"), false],
    [DEMO_IDS.projGov, 22, (i) => (i < 4 ? "mistri" : i < 7 ? "helper" : "labour"), true],
    [DEMO_IDS.projApt, 12, (i) => (i < 3 ? "mistri" : i < 5 ? "helper" : "labour"), false],
    [DEMO_IDS.projHouse, 7, (i) => (i < 2 ? "mistri" : i === 2 ? "helper" : "labour"), false],
  ];
  const fixedNames = ["Suresh Pal", "Rajkumar Verma", "Ramesh Kumar", "Sunita Devi", "Ajay Yadav", "राजू निषाद", "Mohd. Salim", "Pappu Rawat"];
  let n = 0;
  for (const [pid, count, roleOf, viaThekedar] of plan) {
    for (let i = 0; i < count; i++, n++) {
      const role = roleOf(i);
      const name = pid === DEMO_IDS.projGov && !viaThekedar ? fixedNames[i]! : `${FIRST[(n * 7 + 3) % FIRST.length]} ${LAST[(n * 3 + 1) % LAST.length]}`;
      const w: Worker = {
        id: `w${String(n + 1).padStart(3, "0")}`, name, role, isThekedar: false,
        thekedarId: viaThekedar ? DEMO_IDS.thekedar : null, thekedarName: viaThekedar ? "Mohan Lal" : null,
        defaultPayType: "daily",
        phone: `+9198${String(39300000 + n).padStart(8, "0")}`, joiningDate: addDays(anchor, -r.int(90, 900)), active: true,
      };
      workers.push(w);
      pay.set(w.id, rates[role] + (role === "mistri" ? R(r.int(0, 2) * 25) : 0));
      roster[pid]!.push(w.id);
    }
  }
  for (const w of workers) {
    put(store, "workers", { ...w, ...auditFields(DEMO_IDS.accountant, now) });
    if (pay.has(w.id)) put(store, `workers/${w.id}/private`, { id: "pay", defaultRatePaise: pay.get(w.id)!, otRatePaise: null });
    put(store, `workers/${w.id}/private`, {
      id: "kyc", idProofType: "aadhaar_masked", idProofNumberMasked: String(1000 + ((w.id.charCodeAt(3) * 37) % 9000)),
      upiId: w.isThekedar ? "mohanlal@upi" : null, pan: w.isThekedar ? "ABCPL1234L" : null, tdsSection: w.isThekedar ? "194C" : null, tdsRateBp: w.isThekedar ? 100 : null,
    });
  }
  const workerById = new Map(workers.map((w) => [w.id, w]));
  for (const [pid, ids] of Object.entries(roster)) {
    for (const wid of ids) {
      put(store, `projects/${pid}/roster`, { id: wid, projectId: pid, active: true, addedBy: DEMO_IDS.pm, addedAt: now, ...rosterSnapshot(workerById.get(wid)!) });
    }
  }

  // ---------- 30 working days of attendance (Sundays off) ----------
  const days: string[] = [];
  for (let d = anchor; days.length < 30; d = addDays(d, -1)) if (weekday(d) !== 0) days.unshift(d);
  const markers: Record<string, string> = { [DEMO_IDS.projGov]: DEMO_IDS.sup1, [DEMO_IDS.projApt]: DEMO_IDS.sup2, [DEMO_IDS.projHouse]: DEMO_IDS.pm };
  let attendanceRecords = 0;
  for (const day of days) {
    for (const [pid, ids] of Object.entries(roster)) {
      for (const wid of ids) {
        const x = r.next();
        const status: AttendanceStatus = x < 0.84 ? "present" : x < 0.88 ? "half_day" : x < 0.95 ? "absent" : x < 0.98 ? "overtime" : "leave";
        await markAttendance(store, {
          projectId: pid, projectName: projects.find((p) => p.id === pid)!.name, workerId: wid, workerName: workerById.get(wid)!.name,
          workerRole: workerById.get(wid)!.role, thekedarId: workerById.get(wid)!.thekedarId ?? null, date: day, status,
          otHoursMilli: status === "overtime" ? 2000 : 0, markedBy: markers[pid]!,
        }, { uid: markers[pid]!, nowIso: `${day}T10:00:00.000Z` });
        attendanceRecords++;
      }
    }
  }

  // ---------- Mohan Lal's contract: CC pavement labour, per square metre (§6.2) ----------
  const CONTRACT = "tcShivNagarCC";
  const contractRate = R(60);
  put(store, "thekedar_contracts", {
    id: CONTRACT, thekedarId: DEMO_IDS.thekedar, thekedarName: "Mohan Lal", projectId: DEMO_IDS.projGov, projectName: "Shiv Nagar CC Road",
    scope: "Labour for M30 CC pavement: shuttering, laying, finishing and curing", basis: "per_unit", unit: "sqm", ratePaise: contractRate,
    qtyMilli: 6_000_000, valuePaise: contractRate * 6000, status: "active",
    milestones: [{ name: "Chainage 0–400 m", amountPaise: R(120000) }, { name: "Chainage 400–800 m", amountPaise: R(120000) }, { name: "Chainage 800–1,200 m", amountPaise: R(120000) }],
    ...auditFields(DEMO_IDS.accountant, now),
  });
  let mN = 0;

  // ---------- wages: advances, weekly settlements, thekedar bills (all approved) ----------
  let wpN = 0;
  const wpId = () => `wp${String(++wpN).padStart(4, "0")}`;
  const payDays = days.filter((d) => weekday(d) === 6 && d < addDays(anchor, -5)); // Saturdays, leaving the last week unpaid
  const advances: [string, number][] = [["w003", R(3000)], ["w010", R(5000)], ["w033", R(2000)], ["w045", R(4000)]];
  const advanceLeft = new Map<string, number>();
  for (const [wid, amt] of advances) {
    const w = workerById.get(wid)!;
    const pid = Object.entries(roster).find(([, ids]) => ids.includes(wid))![0];
    const id = wpId();
    put(store, "worker_payments", {
      id, workerId: wid, workerName: w.name, projectId: pid, projectName: projects.find((p) => p.id === pid)!.name, date: days[1]!,
      monthKey: monthKeyOf(days[1]!), fy: fyOf(days[1]!), type: "advance", grossPaise: amt, advanceRecoveredPaise: 0, tdsPaise: 0,
      netPaidPaise: amt, mode: "cash", accountId: DEMO_IDS.cash, approvalStatus: "pending", remarks: "Family need", ...auditFields(DEMO_IDS.pm, now),
    } satisfies WorkerPayment);
    await approveWorkerPayment(store, id, { uid: DEMO_IDS.owner, nowIso: now });
    advanceLeft.set(wid, amt);
  }
  let lastPaid = addDays(days[0]!, -1);
  for (const payDay of payDays) {
    // Direct workers: each paid what they earned since the last settlement.
    for (const [pid, ids] of Object.entries(roster)) {
      for (const wid of ids) {
        const w = workerById.get(wid)!;
        if (w.thekedarId) continue;
        const earned = store.list<{ projectId: string; workerId: string; date: string; earnedPaise?: number }>("attendance",
          (a) => a.projectId === pid && a.workerId === wid && a.date > lastPaid && a.date <= payDay)
          .reduce((s, a) => s + (a.earnedPaise ?? 0), 0);
        if (!earned) continue;
        const recover = Math.min(advanceLeft.get(wid) ?? 0, R(1000), earned);
        if (recover) advanceLeft.set(wid, (advanceLeft.get(wid) ?? 0) - recover);
        const id = wpId();
        put(store, "worker_payments", {
          id, workerId: wid, workerName: w.name, projectId: pid, projectName: projects.find((p) => p.id === pid)!.name, date: payDay,
          monthKey: monthKeyOf(payDay), fy: fyOf(payDay), type: "wage", grossPaise: earned, advanceRecoveredPaise: recover, tdsPaise: 0,
          netPaidPaise: earned - recover, mode: "cash", accountId: DEMO_IDS.cash, approvalStatus: "pending", payoutBatchId: `payout_${pid}_${payDay}`,
          ...auditFields(DEMO_IDS.pm, now),
        } satisfies WorkerPayment);
        await approveWorkerPayment(store, id, { uid: DEMO_IDS.owner, nowIso: now });
      }
    }
    // Thekedar bill: the work value of Mohan Lal's crew, TDS under 194C at 1% (individual, default).
    const crew = roster[DEMO_IDS.projGov]!.filter((wid) => workerById.get(wid)!.thekedarId);
    const value = store.list<{ projectId: string; workerId: string; date: string; earnedPaise?: number }>("attendance",
      (a) => a.projectId === DEMO_IDS.projGov && crew.includes(a.workerId) && a.date > lastPaid && a.date <= payDay)
      .reduce((s, a) => s + (a.earnedPaise ?? 0), 0);
    if (value) {
      const tds = tds194C(value, 100);
      const id = wpId();
      put(store, "worker_payments", {
        id, workerId: DEMO_IDS.thekedar, workerName: "Mohan Lal", projectId: DEMO_IDS.projGov, projectName: "Shiv Nagar CC Road",
        thekedarId: DEMO_IDS.thekedar, date: payDay, monthKey: monthKeyOf(payDay), fy: fyOf(payDay), type: "thekedar_bill",
        grossPaise: value, advanceRecoveredPaise: 0, tdsPaise: tds, tdsSection: "194C", netPaidPaise: value - tds, mode: "bank", contractId: CONTRACT,
        accountId: DEMO_IDS.sbi, reference: `NEFT ${payDay.replace(/-/g, "")}`, approvalStatus: "pending", ...auditFields(DEMO_IDS.accountant, now),
      } satisfies WorkerPayment);
      await approveWorkerPayment(store, id, { uid: DEMO_IDS.owner, nowIso: now });
      // The week's work measured on the contract, in square metres at the contract rate.
      const qtyMilli = Math.round((value * 1000) / contractRate);
      put(store, "contract_measurements", {
        id: `cm${String(++mN).padStart(3, "0")}`, contractId: CONTRACT, projectId: DEMO_IDS.projGov, thekedarId: DEMO_IDS.thekedar, date: payDay,
        qtyMilli, pctBp: null, valuePaise: Math.round((contractRate * qtyMilli) / 1000), note: "Weekly measurement", ...auditFields(DEMO_IDS.pm, now),
      });
    }
    // Weekly cash withdrawal from SBI to keep cash in hand positive.
    const tid = `tr${payDay.replace(/-/g, "")}`;
    put(store, "account_transfers", {
      id: tid, kind: "transfer", fromAccountId: DEMO_IDS.sbi, toAccountId: DEMO_IDS.cash, amountPaise: R(150000), date: addDays(payDay, -1),
      monthKey: monthKeyOf(addDays(payDay, -1)), fy: fyOf(addDays(payDay, -1)), narration: "Cash withdrawn for wages", ...auditFields(DEMO_IDS.accountant, now),
    });
    await store.post("account_transfers", tid, now);
    lastPaid = payDay;
  }

  // ---------- 200 manual expenses ----------
  type Kind = { cat: string; desc: string; unit: string; qty: [number, number]; rate: [number, number]; gstBp: number; vendor?: string; mode?: PaymentMode; sites: string[]; w: number };
  const ROAD = [DEMO_IDS.projGov];
  const HOUSE = [DEMO_IDS.projApt, DEMO_IDS.projHouse];
  const ALLP = [DEMO_IDS.projGov, DEMO_IDS.projApt, DEMO_IDS.projHouse];
  const kinds: Kind[] = [
    { cat: "cat_materials_cement", desc: "Cement, OPC 53", unit: "bag", qty: [40, 150], rate: [370, 395], gstBp: 1800, vendor: "vShreeCement", sites: ALLP, w: 14 },
    { cat: "cat_materials_steel", desc: "TMT bars Fe500", unit: "tonne", qty: [1, 4], rate: [58000, 64000], gstBp: 1800, vendor: "vLucknowSteel", sites: HOUSE, w: 6 },
    { cat: "cat_materials_aggregate_gitti", desc: "Gitti 20 mm", unit: "brass", qty: [6, 18], rate: [3900, 4300], gstBp: 500, vendor: "vMaaDurga", sites: ALLP, w: 12 },
    { cat: "cat_materials_aggregate_balu", desc: "Balu (Morang sand)", unit: "brass", qty: [5, 14], rate: [3300, 3700], gstBp: 500, vendor: "vMaaDurga", sites: ALLP, w: 10 },
    { cat: "cat_materials_aggregate_gsb", desc: "WMM / GSB", unit: "cum", qty: [30, 90], rate: [850, 1000], gstBp: 500, vendor: "vMaaDurga", sites: ROAD, w: 7 },
    { cat: "cat_materials_bricks", desc: "Bricks, first class", unit: "thousand", qty: [4, 12], rate: [7200, 7800], gstBp: 600, sites: HOUSE, w: 8 },
    { cat: "cat_materials_paver", desc: "Paver tiles 60 mm", unit: "sqft", qty: [400, 1500], rate: [32, 38], gstBp: 1800, sites: [DEMO_IDS.projApt], w: 3 },
    { cat: "cat_materials_mep", desc: "Plumbing pipes and fittings", unit: "lot", qty: [1, 1], rate: [6000, 22000], gstBp: 1800, sites: HOUSE, w: 4 },
    { cat: "cat_materials_finishing", desc: "Wall putty and primer", unit: "lot", qty: [1, 1], rate: [5000, 18000], gstBp: 1800, sites: [DEMO_IDS.projHouse], w: 3 },
    { cat: "cat_machinery_hire", desc: "JCB 3DX hire", unit: "hour", qty: [4, 9], rate: [1050, 1150], gstBp: 1800, vendor: "vSinghJcb", sites: ALLP, w: 9 },
    { cat: "cat_machinery_fuel", desc: "Diesel for roller and mixer", unit: "litre", qty: [30, 90], rate: [89, 93], gstBp: 0, mode: "cash", sites: ALLP, w: 10 },
    { cat: "cat_machinery_repair", desc: "Mixer repair", unit: "job", qty: [1, 1], rate: [1500, 7000], gstBp: 0, mode: "cash", sites: ALLP, w: 3 },
    { cat: "cat_transport", desc: "Tractor trolley trips", unit: "trip", qty: [2, 8], rate: [1200, 1600], gstBp: 0, vendor: "vVermaTransport", sites: ALLP, w: 8 },
    { cat: "cat_overheads", desc: "Site tea, water and electricity", unit: "lot", qty: [1, 1], rate: [600, 3500], gstBp: 0, mode: "cash", sites: ALLP, w: 9 },
    { cat: "cat_commission", desc: "Brokerage on material order", unit: "job", qty: [1, 1], rate: [5000, 15000], gstBp: 0, mode: "cash", sites: HOUSE, w: 1 },
    { cat: "cat_permits", desc: "Road cutting permission fee", unit: "job", qty: [1, 1], rate: [2000, 6000], gstBp: 0, mode: "bank", sites: ROAD, w: 1 },
    { cat: "cat_misc", desc: "Safety helmets and gloves", unit: "lot", qty: [1, 1], rate: [1200, 4000], gstBp: 1800, sites: ALLP, w: 2 },
  ];
  const bag: Kind[] = kinds.flatMap((k) => Array.from({ length: k.w }, () => k));
  let expensesManual = 0;
  const pendingFrom = 192; // the last 8 are still waiting for approval
  for (let i = 0; i < 200; i++) {
    const k = r.pick(bag);
    const pid = r.pick(k.sites);
    const date = days[Math.min(days.length - 1, Math.floor((i / 200) * days.length))]!;
    const qtyMilli = k.unit === "tonne" ? r.int(k.qty[0] * 2, k.qty[1] * 2) * 500 : r.int(k.qty[0], k.qty[1]) * 1000;
    const ratePaise = R(r.int(k.rate[0], k.rate[1]));
    const taxable = mulDivRound(qtyMilli, ratePaise, 1000);
    const gstHalf = mulDivRound(taxable, k.gstBp, 20000);
    const amount = taxable + 2 * gstHalf;
    const vendor = k.vendor ? vendors.find((v) => v.id === k.vendor)! : null;
    // Cash only for small amounts: cash expenses over ₹10,000 a day aren't deductible (Income Tax Act s.40A(3)).
    const picked: PaymentMode = k.mode ?? (vendor && r.chance(0.35) ? "credit" : r.pick(["cash", "upi", "bank", "bank"] as const));
    const mode: PaymentMode = picked === "cash" && amount > R(10000) ? (r.chance(0.5) ? "upi" : "bank") : picked;
    const small = amount < R(10000);
    const site = projects.find((p) => p.id === pid)!;
    const enteredBy = small && pid !== DEMO_IDS.projHouse ? (pid === DEMO_IDS.projGov ? DEMO_IDS.sup1 : DEMO_IDS.sup2) : DEMO_IDS.accountant;
    const hasBill = !!vendor || !small || r.chance(0.6);
    const pending = i >= pendingFrom;
    const exp: Expense = {
      id: `exp${String(i + 1).padStart(4, "0")}`, projectId: pid, projectName: site.name, date, monthKey: monthKeyOf(date), fy: fyOf(date),
      categoryId: k.cat, description: k.desc, qtyMilli, unit: k.unit, ratePaise, amountPaise: amount, taxablePaise: taxable,
      gstRateBp: k.gstBp, cgstPaise: gstHalf, sgstPaise: gstHalf, igstPaise: 0, tdsPaise: 0,
      payeeType: vendor ? "vendor" : "other", payeeId: vendor?.id ?? null, payeeName: vendor?.name ?? "Local supplier", partyGstin: vendor?.gstin ?? "",
      mode, paidStatus: mode === "credit" ? "unpaid" : "paid",
      accountId: mode === "credit" ? null : mode === "cash" ? DEMO_IDS.cash : r.chance(0.7) ? DEMO_IDS.sbi : DEMO_IDS.hdfc,
      billNo: hasBill ? `${(vendor?.name ?? "LS").split(" ").map((x) => x[0]).join("")}/${1000 + i}` : "",
      billDate: hasBill ? date : "", billPaths: hasBill && r.chance(0.93) ? [`demo/bills/exp${i + 1}.jpg`] : [],
      noBillReason: hasBill ? "" : "Local supplier gives no bill",
      approvalStatus: pending ? "pending" : "approved", approvedBy: pending ? undefined : DEMO_IDS.owner, approvedAt: pending ? undefined : now,
      source: "manual", enteredBy, enteredByName: users.find((u) => u.id === enteredBy)!.name,
      ...auditFields(enteredBy, `${date}T12:00:00.000Z`),
    };
    put(store, "expenses", exp);
    await store.post("expenses", exp.id, now);
    expensesManual++;
  }

  // ---------- 10 invoices, receipts against the issued ones ----------
  // Built in date order so gapless numbers follow the calendar; counters are per financial year (D-12).
  const counters = new Map<string, number>();
  const take = (docType: "invoice" | "receipt", date: string) => {
    const key = `${docType}_${fyOf(date)}`;
    const a = allocate(docType, fyOf(date), counters.get(key));
    counters.set(key, a.next);
    return a;
  };
  type Item = LineInput & { description: string; hsnSac?: string; unit?: string };
  interface Spec {
    id: string; type: Invoice["type"]; projectId: string; clientId: string; date: string; items: Item[]; status: Invoice["status"];
    deductions?: { head: string; rateBp: number }[];
    receipt?: { date: string; amount: (t: ReturnType<typeof computeInvoice>) => number; withheld: boolean };
  }
  const raDed = [{ head: "TDS, income tax", rateBp: 200 }, { head: "GST-TDS", rateBp: 200 }, { head: "Labour cess", rateBp: 100 }, { head: "Retention", rateBp: 500 }];
  const road = (wmm: number, pcc: number, cc: number, kerb: number): Item[] => [
    { description: "Wet mix macadam (WMM) base course, 150 mm", hsnSac: "995421", unit: "cum", qtyMilli: wmm, ratePaise: R(1850), gstRateBp: 1800 },
    { description: "Plain cement concrete M15 below pavement", hsnSac: "995421", unit: "cum", qtyMilli: pcc, ratePaise: R(5400), gstRateBp: 1800 },
    { description: "Cement concrete pavement M30, 200 mm", hsnSac: "995421", unit: "cum", qtyMilli: cc, ratePaise: R(7250), gstRateBp: 1800 },
    { description: "Kerb stone, supplied and fixed", hsnSac: "995421", unit: "rmt", qtyMilli: kerb, ratePaise: R(310), gstRateBp: 1800 },
  ];
  const stage = (name: string, pct: number): Item[] => [{ description: `${name} stage (${pct}% of ₹48,50,000)`, hsnSac: "995411", unit: "stage", qtyMilli: 1000, ratePaise: R((4850000 * pct) / 100), gstRateBp: 1800 }];
  const apt = (desc: string, amount: number): Item[] => [{ description: desc, hsnSac: "995411", unit: "stage", qtyMilli: 1000, ratePaise: R(amount), gstRateBp: 1800 }];
  const aptDed = [{ head: "TDS, income tax", rateBp: 200 }];
  const net = (t: ReturnType<typeof computeInvoice>) => t.netReceivablePaise;
  const specs: Spec[] = [
    // Government project: RA bills 1 and 2 issued, RA bill 3 still a draft.
    { id: "invRa1", type: "ra", projectId: DEMO_IDS.projGov, clientId: "clNagarNigam", date: addDays(anchor, -95), items: road(900000, 210000, 380000, 1100000), status: "paid", deductions: raDed, receipt: { date: addDays(anchor, -62), amount: net, withheld: true } },
    { id: "invRa2", type: "ra", projectId: DEMO_IDS.projGov, clientId: "clNagarNigam", date: addDays(anchor, -40), items: road(620000, 150000, 300000, 700000), status: "partially_paid", deductions: raDed, receipt: { date: addDays(anchor, -3), amount: () => R(1650000), withheld: false } },
    { id: "invRa3", type: "ra", projectId: DEMO_IDS.projGov, clientId: "clNagarNigam", date: anchor, items: road(420000, 96500, 248000, 640000), status: "draft", deductions: raDed },
    // House: milestone bills on the ₹48,50,000 lump sum (spec §5.3 payment schedule).
    { id: "invShBooking", type: "milestone", projectId: DEMO_IDS.projHouse, clientId: "clSharma", date: addDays(anchor, -190), items: stage("Booking", 10), status: "paid", receipt: { date: addDays(anchor, -181), amount: (t) => t.totalPaise, withheld: false } },
    { id: "invShPlinth", type: "milestone", projectId: DEMO_IDS.projHouse, clientId: "clSharma", date: addDays(anchor, -150), items: stage("Plinth", 15), status: "paid", receipt: { date: addDays(anchor, -141), amount: (t) => t.totalPaise, withheld: false } },
    { id: "invShSlabs", type: "milestone", projectId: DEMO_IDS.projHouse, clientId: "clSharma", date: addDays(anchor, -85), items: stage("Slabs", 25), status: "paid", receipt: { date: addDays(anchor, -76), amount: (t) => t.totalPaise, withheld: false } },
    { id: "invShBrickwork", type: "milestone", projectId: DEMO_IDS.projHouse, clientId: "clSharma", date: addDays(anchor, -12), items: stage("Brickwork", 15), status: "sent" },
    { id: "invShPlaster", type: "milestone", projectId: DEMO_IDS.projHouse, clientId: "clSharma", date: anchor, items: stage("Plaster", 15), status: "draft" },
    // Apartments: two milestone bills to the builder, who deducts TDS at 2% under 194C.
    { id: "invGrFoundation", type: "milestone", projectId: DEMO_IDS.projApt, clientId: "clAwadh", date: addDays(anchor, -120), items: apt("Foundation and plinth, Block B", 4200000), status: "paid", deductions: aptDed, receipt: { date: addDays(anchor, -100), amount: net, withheld: true } },
    { id: "invGrSlab1", type: "milestone", projectId: DEMO_IDS.projApt, clientId: "clAwadh", date: addDays(anchor, -50), items: apt("First-floor slab, Block B", 3100000), status: "overdue", deductions: aptDed },
  ];
  const invoices: Invoice[] = [];
  const receipts: { spec: Spec; inv: Invoice; t: ReturnType<typeof computeInvoice> }[] = [];
  for (const o of [...specs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const proj = projects.find((p) => p.id === o.projectId)!;
    const client = clients.find((x) => x.id === o.clientId)!;
    const t = computeInvoice(o.items, true, o.deductions ?? []);
    const number = o.status === "draft" ? null : take("invoice", o.date).number;
    const inv: Invoice = {
      id: o.id, number, type: o.type, projectId: o.projectId, projectName: proj.name, clientId: client.id, clientName: client.name,
      clientGstin: client.gstin ?? "", date: o.date, dueDate: addDays(o.date, 30), monthKey: monthKeyOf(o.date), fy: fyOf(o.date),
      placeOfSupply: "09", items: o.items.map((x) => ({ ...x })),
      totals: { taxablePaise: t.taxablePaise, cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: t.igstPaise, roundOffPaise: t.roundOffPaise, totalPaise: t.totalPaise },
      deductions: t.deductions, netReceivablePaise: t.netReceivablePaise, status: o.status, paidPaise: 0,
      ...auditFields(DEMO_IDS.accountant, now),
    };
    put(store, "invoices", inv);
    await store.post("invoices", inv.id, now);
    invoices.push(inv);
    if (o.receipt) receipts.push({ spec: o, inv, t });
  }
  const ded = (t: ReturnType<typeof computeInvoice>, head: string) => t.deductions.find((d) => d.head === head)?.amountPaise ?? 0;
  for (const { spec, inv, t } of receipts.sort((a, b) => a.spec.receipt!.date.localeCompare(b.spec.receipt!.date))) {
    const rc = spec.receipt!;
    const a = take("receipt", rc.date);
    const rec: PaymentReceived = {
      id: `rcpt${String(a.seq).padStart(3, "0")}${fyOf(rc.date).replace("-", "")}`, invoiceId: inv.id, projectId: inv.projectId, projectName: inv.projectName,
      clientId: inv.clientId, clientName: inv.clientName, date: rc.date, monthKey: monthKeyOf(rc.date), fy: fyOf(rc.date),
      amountPaise: rc.amount(t),
      tdsPaise: rc.withheld ? ded(t, "TDS, income tax") + ded(t, "GST-TDS") : 0,
      retentionPaise: rc.withheld ? ded(t, "Retention") : 0,
      otherDeductionsPaise: rc.withheld ? ded(t, "Labour cess") : 0,
      mode: "bank", accountId: DEMO_IDS.sbi, reference: `RTGS ${rc.date.replace(/-/g, "")}`, receiptNo: a.number,
      ...auditFields(DEMO_IDS.accountant, now),
    };
    put(store, "payments_received", rec);
    await store.post("payments_received", rec.id, now);
  }
  for (const [id, next] of counters) put(store, "counters", { id, docType: id.slice(0, id.indexOf("_")), fy: id.slice(id.indexOf("_") + 1), next });

  // ---------- M1.2: operations settings (defaults-applied.md) and project detail records ----------
  put(store, "settings", {
    id: "operations", workerRoles: DEFAULT_WORKER_ROLES.map((r) => ({ ...r, active: true })), attendanceLockDays: 3,
    missingBillThresholdPaise: R(2000), pmApprovalLimitPaise: R(25000), autoApproveLimitPaise: R(25000), leadFollowUpHours: 2,
    emdRefundAlertDays: 30, shareLinkDays: 30,
  });
  for (const p of store.list<Project & { id: string }>("projects")) {
    store.merge("projects", p.id, { searchKeywords: searchKeywords(p.name, p.code, p.clientName, p.city), notes: "" });
  }
  for (const cl of store.list<Client>("clients")) store.merge("clients", cl.id, { searchKeywords: searchKeywords(cl.name, cl.company, cl.phone, cl.gstin) });
  for (const w of store.list<Worker>("workers")) {
    const siteIds = Object.entries(roster).filter(([, ids]) => ids.includes(w.id)).map(([pid]) => pid);
    store.merge("workers", w.id, { searchKeywords: searchKeywords(w.name, w.phone), siteIds });
    if (w.isThekedar) {
      const crewSites = Object.entries(roster).filter(([, ids]) => ids.some((id) => workerById.get(id)?.thekedarId === w.id)).map(([pid]) => pid);
      store.merge("workers", w.id, { crewSiteIds: crewSites });
    }
  }
  syncContractScope(store, "tcShivNagarCC");
  const child = (pid: string, kind: string, doc: Record<string, unknown> & { id: string }) =>
    put(store, `projects/${pid}/${kind}`, { ...doc, projectId: pid, ...auditFields(DEMO_IDS.accountant, now) });
  // House: 7-stage payment schedule on ₹48,50,000 (§5.3), linked to the milestone bills.
  const stages: [string, number, number, string][] = [
    ["Booking", 10, -190, "paid"], ["Plinth", 15, -150, "paid"], ["Slabs", 25, -85, "paid"], ["Brickwork", 15, -12, "invoiced"],
    ["Plaster", 15, 20, "pending"], ["Finishing", 15, 50, "pending"], ["Handover", 5, 70, "pending"],
  ];
  stages.forEach(([name, pct, due, status], i) => child(DEMO_IDS.projHouse, "project_milestones", {
    id: `ms${i + 1}`, name, sortOrder: i + 1, pctBp: pct * 100, amountPaise: R((4850000 * pct) / 100), dueDate: addDays(anchor, due), status,
  }));
  for (const [i, [kind, status, applied, approved]] of ([["map", "approved", -230, -215], ["electricity", "approved", -120, -100], ["water", "applied", -40, null]] as const).entries()) {
    child(DEMO_IDS.projHouse, "project_approvals", { id: `ap${i + 1}`, kind, status, appliedDate: addDays(anchor, applied), approvedDate: approved === null ? null : addDays(anchor, approved), expiryDate: null, documentId: null });
  }
  // Apartments: 24 flats (6 floors × 4), statuses; approvals; payment schedule with the builder.
  for (let f = 1; f <= 6; f++) for (let u = 1; u <= 4; u++) {
    const n = (f - 1) * 4 + u;
    child(DEMO_IDS.projApt, "project_units", {
      id: `u${f}0${u}`, unitNo: `B-${f}0${u}`, floor: f, areaSqft: u % 2 ? 1250 : 1180,
      status: n <= 9 ? "sold" : n <= 14 ? "booked" : "available", customerId: null, customerName: n <= 14 ? `Buyer ${n} (sample)` : null,
      pricePaise: R((u % 2 ? 1250 : 1180) * 5200),
    });
  }
  for (const [i, [kind, status, applied, approved, expiry]] of ([["map", "approved", -300, -260, null], ["noc", "approved", -280, -250, null], ["rera", "approved", -270, -240, 400]] as const).entries()) {
    child(DEMO_IDS.projApt, "project_approvals", { id: `ap${i + 1}`, kind, status, appliedDate: addDays(anchor, applied), approvedDate: addDays(anchor, approved), expiryDate: expiry === null ? null : addDays(anchor, expiry), documentId: null });
  }
  for (const [i, [name, amount, due, status]] of ([["Foundation and plinth", 4200000, -120, "paid"], ["First-floor slab", 3100000, -50, "invoiced"], ["Second-floor slab", 3100000, 30, "pending"]] as const).entries()) {
    child(DEMO_IDS.projApt, "project_milestones", { id: `ms${i + 1}`, name, sortOrder: i + 1, pctBp: Math.round((amount / 35500000) * 10000), amountPaise: R(amount), dueDate: addDays(anchor, due), status });
  }
  // Road: BOQ (quantities site-visible, rates finance-only), MB entries, commercial terms incl. EMD / SD / PG and deductions.
  const boq: [string, string, string, number, number][] = [
    ["1", "Wet mix macadam (WMM) base course, 150 mm", "cum", 2600, 1850], ["2", "Plain cement concrete M15 below pavement", "cum", 620, 5400],
    ["3", "Cement concrete pavement M30, 200 mm", "cum", 1250, 7250], ["4", "Kerb stone, supplied and fixed", "rmt", 3400, 310],
  ];
  for (const [no, description, unit, qty, rate] of boq) {
    child(DEMO_IDS.projGov, "boq_items", { id: `boq${no}`, itemNo: no, description, unit, qtyMilli: qty * 1000, sorRef: `SOR-UP-2025/${no}` });
    child(DEMO_IDS.projGov, "boq_rates", { id: `boq${no}`, ratePaise: R(rate), amountPaise: R(qty * rate) });
  }
  const mb: [string, number, string, number][] = [["boq1", -30, "41", 420], ["boq2", -28, "42", 96.5], ["boq3", -24, "44", 248], ["boq4", -20, "47", 640]];
  for (const [i, [item, back, page, qty]] of mb.entries()) {
    child(DEMO_IDS.projGov, "measurement_book", { id: `mb${i + 1}`, boqItemId: item, boqItemName: boq.find((b) => `boq${b[0]}` === item)![1], date: addDays(anchor, back), qtyMilli: Math.round(qty * 1000), mbPage: page, remarks: "Measured with JE", measuredBy: DEMO_IDS.pm });
  }
  child(DEMO_IDS.projGov, "hindrance_register", { id: "h1", type: "rain", fromDate: addDays(anchor, -70), toDate: addDays(anchor, -64), notes: "Heavy rain, site waterlogged" });
  child(DEMO_IDS.projGov, "eot_requests", { id: "eot1", reason: "Rain and late site handover", appliedDate: addDays(anchor, -60), periodRequestedDays: 21, periodApprovedDays: null, authority: "Executive Engineer, Zone 4", orderNo: "", orderDate: null, status: "pending", hindranceIds: ["h1"] });
  store.merge(`projects/${DEMO_IDS.projGov}/private`, "commercial", {
    government: {
      agreementValuePaise: R(16450000), tenderPremiumBp: -350,
      emd: { amountPaise: R(329000), mode: "fdr", reference: "FDR 77120045 (sample)", status: "converted_to_sd", refundDate: null },
      securityDepositPaise: R(822500),
      pg: { bank: "State Bank of India", number: "BG/0098/2026 (sample)", amountPaise: R(822500), expiryDate: addDays(anchor, 33) },
      deductionHeads: [{ head: "TDS, income tax", rateBp: 200 }, { head: "GST-TDS", rateBp: 200 }, { head: "Labour cess", rateBp: 100 }, { head: "Retention", rateBp: 500 }],
    },
  });

  const generated = store.list<Expense>("expenses", (e) => e.source !== "manual").length;
  return {
    store,
    summary: {
      anchor, projects: projects.length, workers: workers.length, attendanceDays: days.length, attendanceRecords,
      expensesManual, expensesGenerated: generated, invoices: invoices.length, workerPayments: wpN,
    },
  };
}

/** Number formats used in the demo, re-exported for screens that show example numbers. */
export const demoNumber = (fy: string, seq: number) => formatDocNumber("invoice", fy, seq);
