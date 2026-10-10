import type { Creator } from "./creators.js";

export interface AttributionInput {
  coupon?: string | null;
  utmCampaign?: string | null;
}

// Normalization, owned by the single attribution module:
// coupon trimmed + uppercased, UTM campaign trimmed + lowercased.
export function normalizeCoupon(raw: string): string {
  return raw.trim().toUpperCase();
}

export function normalizeUtmCampaign(raw: string): string {
  return raw.trim().toLowerCase();
}

// Single attribution rule: coupon match wins over UTM match, else null.
export function resolveAttribution(input: AttributionInput, creators: Creator[]): Creator | null {
  const rawCoupon = input.coupon ?? null;
  if (typeof rawCoupon === "string" && rawCoupon.trim() !== "") {
    const coupon = normalizeCoupon(rawCoupon);
    const hit = creators.find((c) => c.couponCode === coupon);
    if (hit) return hit;
  }
  const rawUtm = input.utmCampaign ?? null;
  if (typeof rawUtm === "string" && rawUtm.trim() !== "") {
    const utm = normalizeUtmCampaign(rawUtm);
    const hit = creators.find((c) => c.utmCampaign === utm);
    if (hit) return hit;
  }
  return null;
}
