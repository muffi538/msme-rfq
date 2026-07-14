// Single source of truth for the app's built-in ("always available") RFQ
// item categories. Previously this list was hardcoded separately in three
// places (the AI extraction schema/prompts, the Suppliers category picker,
// and the RFQ item category dropdown) — they drifted from each other by
// definition the moment any one of them changed. Every consumer now imports
// from here instead.
const CATEGORY_KEYS = [
  "POWER_TOOLS",
  "HAND_TOOLS",
  "FURNITURE_FITTINGS",
  "SAFETY_ITEMS",
  "FASTENERS",
  "SANITARY_PLUMBING",
  "PAINTS",
  "VALVES_FITTINGS",
  "PACKAGING_MATERIALS",
  "ELECTRICAL",
  "HVAC",
  "CONSUMABLES_HARDWARE",
  "ABRASIVES",
  "ROPES",
  "SCREWS",
  "GLOVES",
  "RUBBER_ITEMS",
  "WALL_CEILING_FITTINGS",
  "RIGGING_ITEMS",
  "CASTOR_WHEELS",
] as const;

export type Category = (typeof CATEGORY_KEYS)[number];

// Typed as plain `readonly string[]`, not the narrower literal-union tuple
// type above — every consumer calls `.includes()` against an arbitrary
// string (free-text normalized input, a DB column's stored value), not a
// value already known to be a Category, so the wider type is what the real
// call sites need.
export const BUILT_IN_CATEGORIES: readonly string[] = CATEGORY_KEYS;

// Used when the AI returns a category outside this list (or omits one) —
// General Hardware previously served as this catch-all fallback; Consumables
// Hardware is its closest replacement now that it's been removed.
export const DEFAULT_CATEGORY: Category = "CONSUMABLES_HARDWARE";
