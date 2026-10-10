import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDatabase, type DatabaseHandle } from "../src/db.js";

let db: DatabaseHandle;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await openDatabase(":memory:");
  app = createApp(db);
});

function postOrder(payload: unknown) {
  return app.request("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("order ingestion and reading", () => {
  it("attributes an order via coupon and reads it back", async () => {
    const res = await postOrder({ id: "ord-1", totalCents: 1999, coupon: "ANA10", status: "paid" });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.attributionStatus).toBe("attributed");

    const got = await app.request("/orders/ord-1");
    expect(got.status).toBe(200);
    const body = await got.json();
    expect(body.id).toBe("ord-1");
    expect(body.totalCents).toBe(1999);
    expect(body.creatorId).toBe(created.creatorId);
    expect(body.creator).toMatchObject({ couponCode: "ANA10" });
    expect(body.refunds).toEqual([]);
    expect(body.netTotalCents).toBe(1999);
    expect(body.attributionStatus).toBe("attributed");
  });

  it("prefers coupon over UTM when they conflict", async () => {
    const res = await postOrder({
      id: "ord-tie",
      totalCents: 5000,
      coupon: "ANA10",
      utmSource: "shop",
      utmCampaign: "bruno-winter",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.creator).toMatchObject({ couponCode: "ANA10" });

    const got = await app.request("/orders/ord-tie");
    const read = await got.json();
    expect(read.creator).toMatchObject({ couponCode: "ANA10" });
  });

  it("attributes via UTM when coupon is absent", async () => {
    const res = await postOrder({ id: "ord-utm", totalCents: 1200, utmCampaign: "bruno-winter" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attributionStatus).toBe("attributed");
    expect(body.creator).toMatchObject({ couponCode: "BRUNO20" });
  });

  it("leaves unmatched orders unattributed with null creator", async () => {
    const res = await postOrder({ id: "ord-none", totalCents: 750, coupon: "NOPE", utmCampaign: "nope" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attributionStatus).toBe("unattributed");
    expect(body.creator).toBeNull();
    expect(body.creatorId).toBeNull();
  });

  it("ignores duplicate delivery including divergent payloads (first write wins)", async () => {
    const first = await postOrder({ id: "ord-dup", totalCents: 2000, coupon: "ANA10", status: "paid" });
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await postOrder({ id: "ord-dup", totalCents: 9999, coupon: "BRUNO20", status: "refunded" });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.totalCents).toBe(2000);
    expect(secondBody.creator).toMatchObject({ couponCode: "ANA10" });

    const got = await app.request("/orders/ord-dup");
    const read = await got.json();
    expect(read.totalCents).toBe(2000);
    expect(read.creator).toMatchObject({ couponCode: "ANA10" });
    expect(read.storeStatus).toBe("paid");
    expect(firstBody.creatorId).toBe(read.creatorId);
  });

  it("stores store status raw without driving attribution", async () => {
    const res = await postOrder({ id: "ord-raw", totalCents: 1000, coupon: "ZZZ", status: "weird-status-123" });
    expect(res.status).toBe(201);
    const got = await app.request("/orders/ord-raw");
    const body = await got.json();
    expect(body.storeStatus).toBe("weird-status-123");
    expect(body.attributionStatus).toBe("unattributed");
  });

  it("rejects non-positive or non-integer totals with 400 and details", async () => {
    for (const totalCents of [0, -100, 19.99, "1999"]) {
      const res = await postOrder({ id: `ord-bad-${String(totalCents)}`, totalCents });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(body.details).toBeDefined();
    }
  });

  it("returns 404 for an unknown order", async () => {
    const res = await app.request("/orders/nope");
    expect(res.status).toBe(404);
  });
});
