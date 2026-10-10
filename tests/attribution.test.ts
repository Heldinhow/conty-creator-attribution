import { describe, expect, it } from "vitest";
import { resolveAttribution } from "../src/attribution.js";
import type { Creator } from "../src/creators.js";

const creators: Creator[] = [
  { id: 1, name: "Ana", couponCode: "ANA10", utmCampaign: "ana-summer" },
  { id: 2, name: "Bruno", couponCode: "BRUNO20", utmCampaign: "bruno-winter" },
];

describe("resolveAttribution", () => {
  it("matches coupon only", () => {
    expect(resolveAttribution({ coupon: "ANA10" }, creators)).toMatchObject({ name: "Ana" });
  });

  it("matches UTM only", () => {
    expect(resolveAttribution({ utmCampaign: "bruno-winter" }, creators)).toMatchObject({ name: "Bruno" });
  });

  it("matches when coupon and UTM agree", () => {
    const hit = resolveAttribution({ coupon: "ANA10", utmCampaign: "ana-summer" }, creators);
    expect(hit).toMatchObject({ name: "Ana" });
  });

  it("prefers coupon on conflict", () => {
    const hit = resolveAttribution({ coupon: "ANA10", utmCampaign: "bruno-winter" }, creators);
    expect(hit).toMatchObject({ name: "Ana" });
  });

  it("falls through to UTM when coupon is unknown", () => {
    const hit = resolveAttribution({ coupon: "NOPE", utmCampaign: "bruno-winter" }, creators);
    expect(hit).toMatchObject({ name: "Bruno" });
  });

  it("returns null when nothing matches", () => {
    expect(resolveAttribution({ coupon: "NOPE", utmCampaign: "nope" }, creators)).toBeNull();
    expect(resolveAttribution({}, creators)).toBeNull();
  });

  it("normalizes case and whitespace variants", () => {
    expect(resolveAttribution({ coupon: "  ana10 " }, creators)).toMatchObject({ name: "Ana" });
    expect(resolveAttribution({ utmCampaign: "  Ana-Summer " }, creators)).toMatchObject({ name: "Ana" });
    expect(resolveAttribution({ coupon: "   ", utmCampaign: " BRUNO-WINTER " }, creators)).toMatchObject({
      name: "Bruno",
    });
  });
});
