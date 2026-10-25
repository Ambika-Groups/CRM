// Unit tests for money, dates, GST, numbering, phone, categories and wages (decisions D-01, D-03, D-04,
// D-10, D-12, D-13, D-15, D-16; enquiry contract phone rule). Test IDs C-xxx are referenced from
// docs/prd-traceability.md.
import { describe, expect, it } from "vitest";
import { formatPhone,
  addDays, amountInWords, attendanceEarned, CategoryTree, computeInvoice, csvAmount, DEFAULT_FORMATS, divRoundHalfUp, fyMonths, fyOf,
  formatDate, formatDocNumber, formatINR, formatINRCompact, formatQty, isDateStr, isValidGstSerial, lineTax, monthKeyOf, mulDivRound,
  mulMulDivRound, normaliseIndianMobile, parseInputDate, parseQty, parseRupees, payableNow, roundToRupee, seedCategories, toStoredPhone,
  validateWorkerPayment, quotationLabel,
} from "../src";

describe("money (D-01)", () => {
  it("C-001 rounds half away from zero on integers", () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(mulDivRound(-1, 1, 2)).toBe(-1);
  });
  it("C-002 survives products beyond Number.MAX_SAFE_INTEGER (BigInt intermediate)", () => {
    // 50,000 cum at ₹2,000 with a 2.5% discount: qtyMilli × ratePaise × (10000 − 250) ≈ 9.75e17.
    const taxable = mulMulDivRound(50_000_000, 200_000, 9750, 1000 * 10000);
    expect(taxable).toBe(9_750_000_000); // ₹9,75,00,000.00
    expect(() => mulDivRound(Number.MAX_SAFE_INTEGER, 10, 1)).toThrow(RangeError);
  });
  it("C-003 formats Indian currency", () => {
    expect(formatINR(12_500_000)).toBe("₹1,25,000");
    expect(formatINR(12_500_050)).toBe("₹1,25,000.50");
    expect(formatINR(12_500_000, { paise: true })).toBe("₹1,25,000.00");
    expect(formatINR(-50_000)).toBe("−₹500");
    expect(formatINR(388_751_000)).toBe("₹38,87,510");
    expect(formatINR(0)).toBe("₹0");
    expect(formatINRCompact(125_000_000)).toBe("₹12.5 L");
    expect(formatINRCompact(1_200_000_000)).toBe("₹1.2 Cr");
  });
  it("C-004 writes CSV amounts with two decimals and no separators (§11A.2)", () => {
    expect(csvAmount(388_751_000)).toBe("3887510.00");
    expect(csvAmount(-1_05)).toBe("-1.05");
    expect(csvAmount(7)).toBe("0.07");
  });
  it("C-005 parses typed amounts and quantities", () => {
    expect(parseRupees("1,25,000")).toBe(12_500_000);
    expect(parseRupees("₹ 1250.5")).toBe(125_050);
    expect(parseRupees("12.345")).toBeNull();
    expect(parseRupees("-5")).toBeNull();
    expect(parseQty("2.5")).toBe(2500);
    expect(parseQty("1,200")).toBe(1_200_000);
    expect(formatQty(420_000, true)).toBe("420.000");
    expect(formatQty(2500)).toBe("2.5");
    expect(roundToRupee(150)).toBe(200);
    expect(roundToRupee(149)).toBe(100);
  });
});

describe("dates and FY (D-04, D-13)", () => {
  it("C-010 derives month and Indian financial year", () => {
    expect(monthKeyOf("2026-10-25")).toBe("2026-10");
    expect(fyOf("2026-03-31")).toBe("2025-26");
    expect(fyOf("2026-04-01")).toBe("2026-27");
    expect(fyOf("2027-01-15")).toBe("2026-27");
    expect(fyOf("2099-06-01")).toBe("2099-00");
    expect(fyOf("2008-05-01")).toBe("2008-09");
    expect(fyMonths("2026-27")[0]).toBe("2026-04");
    expect(fyMonths("2026-27")[11]).toBe("2027-03");
  });
  it("C-011 rejects impossible dates (the lock-bypass guard, rules fix 1)", () => {
    expect(isDateStr("2026-13-01")).toBe(false);
    expect(isDateStr("2026-02-30")).toBe(false);
    expect(isDateStr("2028-02-29")).toBe(true);
    expect(() => monthKeyOf(".*")).toThrow();
  });
  it("C-012 formats and parses (D-03)", () => {
    expect(formatDate("2026-10-25")).toBe("25 Oct 2026");
    expect(parseInputDate("25/10/2026")).toBe("2026-10-25");
    expect(parseInputDate("31/02/2026")).toBeNull();
    expect(addDays("2026-03-31", 1)).toBe("2026-04-01");
  });
});

describe("GST per line (D-15)", () => {
  // The RA bill 3 figures recomputed independently by the supervisor during the mockup review.
  const items = [
    { qtyMilli: 420_000, ratePaise: 185_000, gstRateBp: 1800 },
    { qtyMilli: 96_500, ratePaise: 540_000, gstRateBp: 1800 },
    { qtyMilli: 248_000, ratePaise: 725_000, gstRateBp: 1800 },
    { qtyMilli: 640_000, ratePaise: 31_000, gstRateBp: 1800 },
  ];
  it("C-020 matches the approved RA bill 3 to the paisa", () => {
    const t = computeInvoice(items, true, [
      { head: "TDS", rateBp: 200 }, { head: "GST-TDS", rateBp: 200 }, { head: "Labour cess", rateBp: 100 }, { head: "Retention", rateBp: 500 },
    ]);
    expect(t.taxablePaise).toBe(329_450_000);
    expect(t.cgstPaise).toBe(29_650_500);
    expect(t.sgstPaise).toBe(29_650_500);
    expect(t.totalPaise).toBe(388_751_000);
    expect(t.roundOffPaise).toBe(0);
    expect(t.deductionsTotalPaise).toBe(32_945_000);
    expect(t.netReceivablePaise).toBe(355_806_000);
  });
  it("C-021 totals are sums of lines and rate-wise table agrees", () => {
    const t = computeInvoice([...items, { qtyMilli: 1000, ratePaise: 10_001, gstRateBp: 1200 }], true);
    expect(t.cgstPaise).toBe(t.lines.reduce((s, l) => s + l.cgstPaise, 0));
    expect(t.byRate.reduce((s, r) => s + r.taxablePaise, 0)).toBe(t.taxablePaise);
    expect(t.totalPaise % 100).toBe(0);
    expect(Math.abs(t.roundOffPaise)).toBeLessThanOrEqual(50);
  });
  it("C-022 inter-state uses IGST", () => {
    const l = lineTax({ qtyMilli: 1000, ratePaise: 100_000, gstRateBp: 1800 }, false);
    expect(l).toEqual({ taxablePaise: 100_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 18_000 });
  });
  it("C-023 amount in words, Indian system", () => {
    expect(amountInWords(388_751_000)).toBe("Rupees Thirty-Eight Lakh Eighty-Seven Thousand Five Hundred Ten Only");
    expect(amountInWords(485_000_000)).toBe("Rupees Forty-Eight Lakh Fifty Thousand Only");
    expect(amountInWords(1_250_000_050)).toBe("Rupees One Crore Twenty-Five Lakh and Fifty Paise Only");
  });
});

describe("numbering (D-12, D-17)", () => {
  it("C-030 formats and enforces the 16-character GST limit", () => {
    expect(formatDocNumber("invoice", "2026-27", 12)).toBe("AG/2026-27/0012");
    expect(formatDocNumber("credit_note", "2026-27", 1)).toBe("CN/2026-27/0001");
    expect(formatDocNumber("invoice", "2026-27", 10000)).toBe("AG/2026-27/10000");
    expect(formatDocNumber("project", "2026-27", 3)).toBe("AG-P-0003");
    expect(() => formatDocNumber("credit_note", "2026-27", 1, "AG/CN/{fy}/{seq4}")).toThrow(/16 characters/);
    expect(formatDocNumber("proforma", "2026-27", 1)).toBe("AG/PF/2026-27/0001"); // not a GST document
    for (const t of ["invoice", "credit_note", "debit_note", "advance_receipt"] as const) {
      expect(isValidGstSerial(formatDocNumber(t, "2026-27", 9999, DEFAULT_FORMATS[t]))).toBe(true);
    }
    expect(quotationLabel("AG/Q/2026-27/0001", 2)).toBe("AG/Q/2026-27/0001 (Rev 2)");
  });
});

describe("phone rule (enquiry contract)", () => {
  it("C-040 matches the contract table", () => {
    expect(normaliseIndianMobile("98765 43210")).toBe("9876543210");
    expect(normaliseIndianMobile("+91 98765-43210")).toBe("9876543210");
    expect(normaliseIndianMobile("09876543210")).toBe("9876543210");
    expect(normaliseIndianMobile("919876543210")).toBe("9876543210");
    expect(normaliseIndianMobile("0522 2345678")).toBeNull();
    expect(normaliseIndianMobile("12345")).toBeNull();
    expect(toStoredPhone("98765 43210")).toBe("+919876543210");
  });
  it("C-041 display: mobiles in two groups of five; landlines with their STD code", () => {
    expect(formatPhone("+919876543210")).toBe("98765 43210");
    expect(formatPhone("+915222000000")).toBe("0522 2000000");
    expect(formatPhone("+911123456789")).toBe("011 23456789");
  });
});

describe("category tree (§7.1, D-10)", () => {
  const tree = new CategoryTree(seedCategories());
  it("C-050 seeds the §7.1 hierarchy with 4 levels", () => {
    expect(tree.roots().map((c) => c.id)).toEqual([
      "cat_labour", "cat_materials", "cat_machinery", "cat_commission", "cat_transport", "cat_overheads", "cat_permits", "cat_misc",
    ]);
    expect(tree.level("cat_materials_aggregate_gitti")).toBe(3);
    expect(tree.pathOf("cat_materials_aggregate_gitti")).toEqual(["cat_materials", "cat_materials_aggregate", "cat_materials_aggregate_gitti"]);
    expect(tree.summaryHead("cat_transport")).toBe("other");
    expect(tree.summaryHead("cat_labour_mistri")).toBe("cat_labour");
  });
  it("C-051 parent totals = own + descendants", () => {
    const posted = { cat_materials_aggregate_gitti: 100, cat_materials_aggregate_balu: 50, cat_materials_aggregate: 7, cat_materials_cement: 3 };
    expect(tree.total("cat_materials_aggregate", posted)).toBe(157);
    expect(tree.total("cat_materials", posted)).toBe(160);
  });
  it("C-052 refuses a cycle when re-parenting", () => {
    expect(() => tree.withParent("cat_materials", "cat_materials_aggregate")).toThrow();
  });
});

describe("wages (§6.2–§6.4, D-16)", () => {
  it("C-060 attendance earnings", () => {
    expect(attendanceEarned("present", "daily", 50_000, 6_250)).toBe(50_000);
    expect(attendanceEarned("half_day", "daily", 50_000, 6_250)).toBe(25_000);
    expect(attendanceEarned("overtime", "daily", 50_000, 6_250, 2000)).toBe(62_500);
    expect(attendanceEarned("absent", "daily", 50_000, 6_250)).toBe(0);
    // Monthly staff (M1.3): salary ÷ 26 per day present; contract work earns nothing per day.
    expect(attendanceEarned("present", "monthly", 2_600_000, 0)).toBe(100_000);
    expect(attendanceEarned("present", "contract", 50_000, 6_250)).toBe(0);
    expect(() => attendanceEarned("overtime", "daily", 50_000, 6_250, -1)).toThrow();
  });
  it("C-061 payable = earned − settled − advance recovered", () => {
    const p = payableNow({ earnedPaise: 300_000, paidPaise: 100_000, advanceGivenPaise: 300_000, advanceRecoveredPaise: 50_000, advanceWrittenOffPaise: 0 }, 100_000);
    expect(p).toEqual({ grossPaise: 200_000, recoverPaise: 100_000, netPaise: 100_000 });
  });
  it("C-062 payment validation mirrors the rules (fixes 4, 7)", () => {
    expect(validateWorkerPayment({ type: "wage", grossPaise: 100, netPaidPaise: 100, mode: "cash", accountId: "acc" })).toEqual([]);
    expect(validateWorkerPayment({ type: "wage", grossPaise: 100, netPaidPaise: 100, mode: "cash", accountId: null }).length).toBe(1);
    expect(validateWorkerPayment({ type: "wage", grossPaise: 100, netPaidPaise: 90, mode: "cash", accountId: "a" }).length).toBe(1);
    expect(validateWorkerPayment({ type: "wage", grossPaise: 100, netPaidPaise: 100, mode: "credit", accountId: "a" }).length).toBe(1);
  });
});
