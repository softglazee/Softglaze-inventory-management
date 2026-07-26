/**
 * Business Type presets — starter data per docs/09-EXTENDED-FEATURES.md §1.
 * The core engine is generic; a preset only seeds categories, units and a few
 * sample products (suffixed "(sample)" so the owner can delete them easily).
 */

export type PresetUnit = {
  name: string;
  shortName: string;
  /** Optional conversion, e.g. Ton → 1000 kg */
  base?: { shortName: string; factor: number };
};

export type PresetCategory = { name: string; children?: string[] };

export type PresetProduct = {
  name: string;
  category: string; // category name (must exist in categories below)
  unit: string; // unit shortName
  costPrice: number;
  salePrice: number;
};

export type BusinessPreset = {
  key: string;
  label: string;
  description: string;
  units: PresetUnit[];
  categories: PresetCategory[];
  sampleProducts: PresetProduct[];
};

export const BUSINESS_PRESETS: BusinessPreset[] = [
  {
    key: "building_materials",
    label: "Building Materials",
    description: "Cement, sariya (iron rods), windows, doors, pipes, hardware — the default.",
    units: [
      { name: "Piece", shortName: "pc" },
      { name: "Kilogram", shortName: "kg" },
      { name: "Ton", shortName: "t", base: { shortName: "kg", factor: 1000 } },
      { name: "Bag", shortName: "bag" },
      { name: "Foot", shortName: "ft" },
      { name: "Square Foot", shortName: "sqft" },
      { name: "Bundle", shortName: "bdl" },
    ],
    categories: [
      { name: "Cement" },
      { name: "Iron Rods (Sariya)", children: ["Sariya 10mm", "Sariya 12mm", "Sariya 16mm", "Sariya 20mm"] },
      { name: "Windows" },
      { name: "Doors" },
      { name: "Pipes & Fittings" },
      { name: "Sand & Crush" },
      { name: "Bricks & Blocks" },
      { name: "Hardware" },
    ],
    sampleProducts: [
      { name: "Lucky Cement 50kg (sample)", category: "Cement", unit: "bag", costPrice: 1250, salePrice: 1330 },
      { name: "Sariya 12mm Grade-60 (sample)", category: "Sariya 12mm", unit: "kg", costPrice: 255, salePrice: 268 },
      { name: "Aluminium Window 3x4 (sample)", category: "Windows", unit: "sqft", costPrice: 850, salePrice: 980 },
    ],
  },
  {
    key: "kiryana",
    label: "Kiryana / General Store",
    description: "Grocery, beverages, snacks, cleaning, dairy — daily household items.",
    units: [
      { name: "Piece", shortName: "pc" },
      { name: "Kilogram", shortName: "kg" },
      { name: "Gram", shortName: "g" },
      { name: "Litre", shortName: "ltr" },
      { name: "Dozen", shortName: "dzn", base: { shortName: "pc", factor: 12 } },
      { name: "Carton", shortName: "ctn" },
    ],
    categories: [
      { name: "Grocery" },
      { name: "Beverages" },
      { name: "Snacks" },
      { name: "Cleaning" },
      { name: "Dairy" },
    ],
    sampleProducts: [
      { name: "Basmati Rice 5kg (sample)", category: "Grocery", unit: "pc", costPrice: 1600, salePrice: 1750 },
      { name: "Cola 1.5L (sample)", category: "Beverages", unit: "pc", costPrice: 150, salePrice: 180 },
    ],
  },
  {
    key: "electronics",
    label: "Electronics",
    description: "Mobiles, accessories, home appliances, repair parts.",
    units: [
      { name: "Piece", shortName: "pc" },
      { name: "Set", shortName: "set" },
    ],
    categories: [
      { name: "Mobiles" },
      { name: "Accessories" },
      { name: "Home Appliances" },
      { name: "Repair Parts" },
    ],
    sampleProducts: [
      { name: "USB-C Charger 25W (sample)", category: "Accessories", unit: "pc", costPrice: 900, salePrice: 1250 },
    ],
  },
  {
    key: "clothing",
    label: "Clothing",
    description: "Gents, ladies, kids, unstitched fabric, accessories.",
    units: [
      { name: "Piece", shortName: "pc" },
      { name: "Meter", shortName: "mtr" },
      { name: "Suit", shortName: "suit" },
    ],
    categories: [
      { name: "Gents" },
      { name: "Ladies" },
      { name: "Kids" },
      { name: "Unstitched" },
      { name: "Accessories" },
    ],
    sampleProducts: [
      { name: "Lawn Suit 3pc (sample)", category: "Unstitched", unit: "suit", costPrice: 2200, salePrice: 2850 },
    ],
  },
  {
    key: "pharmacy",
    label: "Pharmacy",
    description: "Tablets, syrups, surgical items, cosmetics.",
    units: [
      { name: "Piece", shortName: "pc" },
      { name: "Strip", shortName: "strip" },
      { name: "Box", shortName: "box" },
      { name: "Bottle", shortName: "btl" },
    ],
    categories: [
      { name: "Tablets" },
      { name: "Syrups" },
      { name: "Surgical" },
      { name: "Cosmetics" },
    ],
    sampleProducts: [
      { name: "Paracetamol 500mg (sample)", category: "Tablets", unit: "strip", costPrice: 35, salePrice: 45 },
    ],
  },
  {
    key: "hardware_paint",
    label: "Hardware & Paint",
    description: "Tools, fasteners, paint, plumbing, electrical.",
    units: [
      { name: "Piece", shortName: "pc" },
      { name: "Kilogram", shortName: "kg" },
      { name: "Litre", shortName: "ltr" },
      { name: "Box", shortName: "box" },
    ],
    categories: [
      { name: "Tools" },
      { name: "Fasteners" },
      { name: "Paint" },
      { name: "Plumbing" },
      { name: "Electrical" },
    ],
    sampleProducts: [
      { name: "Weather Shield 4L (sample)", category: "Paint", unit: "pc", costPrice: 3400, salePrice: 3850 },
    ],
  },
  {
    key: "custom",
    label: "Custom",
    description: "Start empty — build your own categories and units.",
    units: [
      { name: "Piece", shortName: "pc" },
      { name: "Kilogram", shortName: "kg" },
    ],
    categories: [],
    sampleProducts: [],
  },
];

export function getPreset(key: string) {
  return BUSINESS_PRESETS.find((p) => p.key === key) ?? null;
}
