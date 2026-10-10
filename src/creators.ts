import type { DatabaseHandle } from "./db.js";
import { normalizeCoupon, normalizeUtmCampaign } from "./attribution.js";

export interface Creator {
  id: number;
  name: string;
  couponCode: string;
  utmCampaign: string;
}

interface CreatorRow {
  id: number;
  name: string;
  coupon_code: string;
  utm_campaign: string;
}

function toCreator(row: CreatorRow): Creator {
  return { id: row.id, name: row.name, couponCode: row.coupon_code, utmCampaign: row.utm_campaign };
}

export const SEED_CREATORS = [
  { name: "Ana", couponCode: "ANA10", utmCampaign: "ana-summer" },
  { name: "Bruno", couponCode: "BRUNO20", utmCampaign: "bruno-winter" },
] as const;

export function seedCreators(db: DatabaseHandle): void {
  db.transaction(() => {
    for (const seed of SEED_CREATORS) {
      db.run(
        "INSERT OR IGNORE INTO creators (name, coupon_code, utm_campaign) VALUES (?, ?, ?)",
        [seed.name, normalizeCoupon(seed.couponCode), normalizeUtmCampaign(seed.utmCampaign)]
      );
    }
  });
}

export class CreatorConflictError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function listCreators(db: DatabaseHandle): Creator[] {
  return db.all<CreatorRow>("SELECT id, name, coupon_code, utm_campaign FROM creators ORDER BY id").map(toCreator);
}

export function createCreator(
  db: DatabaseHandle,
  input: { name: string; couponCode: string; utmCampaign: string }
): Creator {
  const couponCode = normalizeCoupon(input.couponCode);
  const utmCampaign = normalizeUtmCampaign(input.utmCampaign);
  return db.transaction(() => {
    const couponTaken = db.get<CreatorRow>("SELECT id FROM creators WHERE coupon_code = ?", [couponCode]);
    if (couponTaken) throw new CreatorConflictError("couponCode already in use");
    const utmTaken = db.get<CreatorRow>("SELECT id FROM creators WHERE utm_campaign = ?", [utmCampaign]);
    if (utmTaken) throw new CreatorConflictError("utmCampaign already in use");
    try {
      const result = db.run(
        "INSERT INTO creators (name, coupon_code, utm_campaign) VALUES (?, ?, ?)",
        [input.name.trim(), couponCode, utmCampaign]
      );
      return { id: result.lastInsertRowid, name: input.name.trim(), couponCode, utmCampaign };
    } catch {
      // UNIQUE backstop for races: check-then-insert already ran inside one serialized transaction.
      throw new CreatorConflictError("couponCode or utmCampaign already in use");
    }
  });
}
