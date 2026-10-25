/**
 * Expense category tree (spec §7.1). A self-referencing tree (parentId), at least 4 levels, admin-editable.
 * Rollups are keyed by the POSTED category ID; a node's total = its own posted amount + all descendants'
 * (D-10), so re-parenting a category changes no stored amount.
 */

export interface Category {
  id: string;
  name: string;
  nameHi?: string;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
  /** Seed heads used by automatic postings (wages, purchases, machinery); can't be deleted. */
  isSystem?: boolean;
}

type SeedNode = [id: string, name: string, nameHi: string, children?: SeedNode[]];

/** Seed data from spec §7.1, with readable stable IDs. */
const SEED: SeedNode[] = [
  ["cat_labour", "Labour", "मज़दूरी", [
    ["cat_labour_mistri", "Mistri (daily / contract)", "मिस्त्री"],
    ["cat_labour_labour", "Labour (daily / contract)", "मज़दूर"],
    ["cat_labour_helpers", "Helpers / Operators / Drivers", "हेल्पर / ऑपरेटर / ड्राइवर"],
    ["cat_labour_thekedar", "Thekedar payments", "ठेकेदार भुगतान"],
  ]],
  ["cat_materials", "Materials", "सामान", [
    ["cat_materials_cement", "Cement", "सीमेंट"],
    ["cat_materials_steel", "Steel (Sariya)", "सरिया"],
    ["cat_materials_aggregate", "Aggregate", "गिट्टी-बालू", [
      ["cat_materials_aggregate_gitti", "Gitti (by size)", "गिट्टी"],
      ["cat_materials_aggregate_balu", "Balu (sand)", "बालू"],
      ["cat_materials_aggregate_gsb", "Stone dust / GSB / WMM", "डस्ट / जीएसबी / डब्ल्यूएमएम"],
    ]],
    ["cat_materials_bricks", "Bricks / Blocks", "ईंट / ब्लॉक"],
    ["cat_materials_paver", "Interlocking / Paver tiles", "इंटरलॉकिंग / पेवर टाइल"],
    ["cat_materials_bitumen", "Bitumen / Asphalt", "बिटुमेन / डामर"],
    ["cat_materials_mep", "Electrical / Plumbing / Sanitary", "बिजली / प्लंबिंग / सैनिटरी"],
    ["cat_materials_finishing", "Paint, tiles, finishing", "पेंट, टाइल, फ़िनिशिंग"],
  ]],
  ["cat_machinery", "Machinery", "मशीनें", [
    ["cat_machinery_hire", "Hire charges (JCB, roller, mixer, tractor…)", "किराया (जेसीबी, रोलर, मिक्सर, ट्रैक्टर…)"],
    ["cat_machinery_fuel", "Fuel (diesel)", "डीज़ल"],
    ["cat_machinery_repair", "Repair and maintenance", "मरम्मत"],
  ]],
  ["cat_commission", "Commission / Brokerage", "कमीशन / दलाली"],
  ["cat_transport", "Transport and Loading", "ढुलाई और लदाई"],
  ["cat_overheads", "Site Overheads (office, electricity, water, food, rent)", "साइट खर्च (ऑफ़िस, बिजली, पानी, खाना, किराया)"],
  ["cat_permits", "Permits, Fees, Taxes (tender fee, EMD cost, insurance)", "परमिट, फ़ीस, टैक्स"],
  ["cat_misc", "Miscellaneous", "अन्य"],
];

export function seedCategories(): Category[] {
  const out: Category[] = [];
  const walk = (nodes: SeedNode[], parentId: string | null) => {
    nodes.forEach(([id, name, nameHi, children], i) => {
      out.push({ id, name, nameHi, parentId, sortOrder: i + 1, active: true, isSystem: true });
      if (children) walk(children, id);
    });
  };
  walk(SEED, null);
  return out;
}

/** The five quick-summary heads of §7.3, in the fixed chart-series order (design-tokens §4). */
export const SUMMARY_HEADS = ["cat_labour", "cat_materials", "cat_commission", "cat_machinery", "other"] as const;
export type SummaryHead = (typeof SUMMARY_HEADS)[number];

export class CategoryTree {
  readonly byId: Map<string, Category>;
  readonly children: Map<string | null, Category[]>;

  constructor(categories: Category[]) {
    this.byId = new Map(categories.map((c) => [c.id, c]));
    this.children = new Map();
    for (const c of categories) {
      const list = this.children.get(c.parentId) ?? [];
      list.push(c);
      this.children.set(c.parentId, list);
    }
    for (const list of this.children.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    this.assertAcyclic();
  }

  private assertAcyclic(): void {
    for (const c of this.byId.values()) {
      const seen = new Set<string>();
      let p: string | null = c.id;
      while (p) {
        if (seen.has(p)) throw new Error(`Category cycle at ${c.id}`);
        seen.add(p);
        p = this.byId.get(p)?.parentId ?? null;
      }
    }
  }

  roots(): Category[] {
    return this.children.get(null) ?? [];
  }

  childrenOf(id: string): Category[] {
    return this.children.get(id) ?? [];
  }

  isLeaf(id: string): boolean {
    return this.childrenOf(id).length === 0;
  }

  /** Root-to-node IDs, e.g. [cat_materials, cat_materials_aggregate, cat_materials_aggregate_gitti]. */
  pathOf(id: string): string[] {
    const path: string[] = [];
    let p: string | null = id;
    while (p) {
      const c = this.byId.get(p);
      if (!c) throw new Error(`Unknown category ${p}`);
      path.unshift(c.id);
      p = c.parentId;
    }
    return path;
  }

  level(id: string): number {
    return this.pathOf(id).length;
  }

  /** The node and every node beneath it. */
  descendantsAndSelf(id: string): string[] {
    const out = [id];
    for (const c of this.childrenOf(id)) out.push(...this.descendantsAndSelf(c.id));
    return out;
  }

  /** Total for a node from a map of posted amounts keyed by category ID (own + descendants). */
  total(id: string, posted: Record<string, number>): number {
    return this.descendantsAndSelf(id).reduce((s, x) => s + (posted[x] ?? 0), 0);
  }

  /** Which §7.3 summary head a category belongs to. */
  summaryHead(id: string): SummaryHead {
    const root = this.pathOf(id)[0]!;
    return (SUMMARY_HEADS as readonly string[]).includes(root) ? (root as SummaryHead) : "other";
  }

  /** Category level 1/2/3 names for the CA export columns, from the live tree (D-10). */
  levelNames(id: string): [string, string, string] {
    const names = this.pathOf(id).map((x) => this.byId.get(x)!.name);
    return [names[0] ?? "", names[1] ?? "", names[2] ?? ""];
  }

  /** A copy with one category moved under a new parent (re-parenting, §7.4). */
  withParent(id: string, parentId: string | null): CategoryTree {
    if (parentId && this.descendantsAndSelf(id).includes(parentId)) throw new Error("Can't move a category under itself");
    return new CategoryTree([...this.byId.values()].map((c) => (c.id === id ? { ...c, parentId } : c)));
  }
}
