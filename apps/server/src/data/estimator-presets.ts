/**
 * Starter coefficients for the construction estimator (F4). These are common Pakistani
 * rule-of-thumb quantities per square foot — deliberately editable: the admin picks the
 * matching catalog product for each row and tunes the coefficient to their engineer's
 * rates. Presets carry NO product link (products differ per shop); they only pre-fill the
 * "New template" form so the owner isn't staring at a blank page.
 */
export type EstimatorPresetRow = { label: string; unitHint: string; qtyPerUnit: number };
export type EstimatorPreset = {
  key: string;
  name: string;
  description: string;
  areaLabel: string;
  multiplyByFloors: boolean;
  rows: EstimatorPresetRow[];
};

export const ESTIMATOR_PRESETS: EstimatorPreset[] = [
  {
    key: "grey_structure",
    name: "Grey structure (per sq ft covered)",
    description: "Rough material for a bare/grey structure per covered square foot. Multiply by number of floors.",
    areaLabel: "Covered area (sq ft)",
    multiplyByFloors: true,
    rows: [
      { label: "Cement", unitHint: "bags", qtyPerUnit: 0.4 },
      { label: "Sariya / steel", unitHint: "kg", qtyPerUnit: 3.0 },
      { label: "Bricks", unitHint: "nos", qtyPerUnit: 8 },
      { label: "Sand (bajri)", unitHint: "cft", qtyPerUnit: 1.2 },
      { label: "Crush", unitHint: "cft", qtyPerUnit: 0.85 },
    ],
  },
  {
    key: "rcc_slab",
    name: "RCC roof slab 6\" (per sq ft)",
    description: "Reinforced concrete roof slab, 6 inch, per square foot of slab. Multiply by number of slabs/floors.",
    areaLabel: "Slab area (sq ft)",
    multiplyByFloors: true,
    rows: [
      { label: "Cement", unitHint: "bags", qtyPerUnit: 0.4 },
      { label: "Steel 12mm", unitHint: "kg", qtyPerUnit: 4.0 },
      { label: "Crush", unitHint: "cft", qtyPerUnit: 1.35 },
      { label: "Sand", unitHint: "cft", qtyPerUnit: 0.65 },
    ],
  },
  {
    key: "brick_wall",
    name: "Brick masonry wall 4.5\" (per sq ft)",
    description: "Half-brick (4.5 inch) wall per square foot of wall face. Not multiplied by floors.",
    areaLabel: "Wall area (sq ft)",
    multiplyByFloors: false,
    rows: [
      { label: "Bricks", unitHint: "nos", qtyPerUnit: 5.5 },
      { label: "Cement", unitHint: "bags", qtyPerUnit: 0.05 },
      { label: "Sand", unitHint: "cft", qtyPerUnit: 0.15 },
    ],
  },
];
