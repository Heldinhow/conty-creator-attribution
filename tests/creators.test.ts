import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDatabase, type DatabaseHandle } from "../src/db.js";

let db: DatabaseHandle;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await openDatabase(":memory:");
  app = createApp(db);
});

describe("creator lifecycle", () => {
  it("answers the health check", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("loads seed creators on startup", async () => {
    const res = await app.request("/creators");
    expect(res.status).toBe(200);
    const body = await res.json();
    const coupons = body.creators.map((c: { couponCode: string }) => c.couponCode);
    expect(coupons).toContain("ANA10");
    expect(coupons).toContain("BRUNO20");
  });

  it("creates a creator and reads it back", async () => {
    const res = await app.request("/creators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Carol", couponCode: "CAROL30", utmCampaign: "carol-spring" }),
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ name: "Carol", couponCode: "CAROL30", utmCampaign: "carol-spring" });
    expect(created.id).toBeDefined();

    const list = await (await app.request("/creators")).json();
    expect(list.creators).toHaveLength(3);
  });

  it("rejects a duplicate coupon code", async () => {
    const res = await app.request("/creators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Clone", couponCode: "ANA10", utmCampaign: "clone-campaign" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects a duplicate UTM campaign", async () => {
    const res = await app.request("/creators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Clone", couponCode: "CLONE10", utmCampaign: "ana-summer" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects invalid shapes with 400 and error details", async () => {
    const res = await app.request("/creators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", couponCode: "", utmCampaign: "" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.details).toBeDefined();
  });
});
