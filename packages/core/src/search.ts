/**
 * Prefix search (spec §3.1 rule 10): Firestore has no full-text search, so each searchable record carries a
 * lowercase `searchKeywords` array of word prefixes (min 2 characters), phone digits and document numbers.
 * Queried with `array-contains` on the first word the user types.
 */

const MAX_KEYWORDS = 60;

function prefixes(word: string): string[] {
  const out: string[] = [];
  for (let i = 2; i <= Math.min(word.length, 15); i++) out.push(word.slice(0, i));
  return out;
}

/** Build keywords from names, phones and numbers. */
export function searchKeywords(...values: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    const lower = v.toLowerCase().normalize("NFKC");
    for (const word of lower.split(/[\s,./()-]+/).filter(Boolean)) for (const p of prefixes(word)) set.add(p);
    const digits = v.replace(/\D/g, "");
    if (digits.length >= 10) {
      const last10 = digits.slice(-10);
      for (const p of prefixes(last10)) set.add(p);
      set.add(last10.slice(-4));
    }
    if (/[/-]/.test(v) && /\d/.test(v)) set.add(lower.trim()); // whole document number, e.g. ag-p-0003
  }
  return [...set].slice(0, MAX_KEYWORDS);
}

/** The term to query with: the first word typed, lowercase, at least 2 characters. */
export function searchTerm(input: string): string | null {
  const w = input.trim().toLowerCase().normalize("NFKC").split(/\s+/)[0] ?? "";
  if (w.replace(/\D/g, "").length >= 4 && /^\+?[\d\s-]+$/.test(input.trim())) {
    const d = input.replace(/\D/g, "");
    return d.length > 10 ? d.slice(-10) : d.slice(0, 15);
  }
  return w.length >= 2 ? w.slice(0, 15) : null;
}
