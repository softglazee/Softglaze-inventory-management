import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/**
 * Business-Type UI tailoring.
 *
 * The server data model stays fully generic — every field and route works for
 * every shop. This module is a *presentation* layer only: it decides which
 * domain-specific menu items and product-form field groups to SHOW for the
 * shop's chosen Business Type, so a pharmacy owner isn't shown "Cutting" and a
 * kiryana store isn't shown the steel weight calculator.
 *
 * Rule of safety: anything not explicitly mapped (an unknown/empty type, or
 * before settings load) falls back to ALL capabilities, so nothing is ever
 * hidden by accident. "Custom" also gets everything.
 */
export type BizCapability =
  | "steelTools" // steel weight calculator + bar cutting (Weight Calc + Cutting nav, weight-profile fields)
  | "estimator"  // construction/room estimator
  | "delivery"   // delivery trips for heavy goods
  | "dimensions"; // physical length / width / height / weight product fields

export const ALL_CAPS: BizCapability[] = ["steelTools", "estimator", "delivery", "dimensions"];

/** business_type key → the extra capabilities that make sense for that trade. */
const CAPS_BY_TYPE: Record<string, BizCapability[]> = {
  building_materials: ["steelTools", "estimator", "delivery", "dimensions"],
  hardware_paint: ["steelTools", "estimator", "dimensions"],
  electronics: ["dimensions"],
  clothing: [],
  pharmacy: [],
  kiryana: [],
  custom: ["steelTools", "estimator", "delivery", "dimensions"],
};

/** Pure resolver — returns the enabled capability set for a business_type value. */
export function capsFor(businessType?: string | null): Set<BizCapability> {
  if (!businessType || !(businessType in CAPS_BY_TYPE)) return new Set(ALL_CAPS);
  return new Set(CAPS_BY_TYPE[businessType]);
}

/**
 * Reads business_type from the cached `["settings"]` query (deduped with the
 * rest of the app) and returns a capability set plus a `has()` helper. While
 * settings are loading, everything is enabled so nothing flicker-hides.
 */
export function useBusinessCaps() {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ settings: Record<string, string> }>("/settings"),
    staleTime: 60_000,
  });
  const businessType = data?.settings.business_type ?? null;
  const caps = data ? capsFor(businessType) : new Set(ALL_CAPS);
  return { caps, has: (c: BizCapability) => caps.has(c), businessType, loaded: !!data };
}
