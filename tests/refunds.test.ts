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

function postRefund(payload: unknown) {
  return app.request("/refunds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("refund ingestion", () => {
  it("applies a partial refund: net drops, creator kept, history preserved", async () => {
    await postOrder({ id: "ord-r1", totalCents: 2000, coupon: "ANA10", status: "paid" });

    const res = await postRefund({ id: "ref-1", orderId: "ord-r1", amountCents: 500 });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "ref-1", orderId: "ord-r1", amountCents: 500 });

    const got = await app.request("/orders/ord-r1");
    const body = await got.json();
    expect(body.netTotalCents).toBe(1500);
    expect(body.creator).toMatchObject({ couponCode: "ANA10" });
    expect(body.creatorId).not.toBeNull();
    expect(body.refunds).toHaveLength(1);
    expect(body.refunds[0]).toMatchObject({ id: "ref-1", amountCents: 500, status: "applied" });
    expect(body.attributionStatus).toBe("attributed");
  });

  it("treats a repeated refund as success no-op including divergent payloads", async () => {
    await postOrder({ id: "ord-r2", totalCents: 2000, coupon: "ANA10", status: "paid" });
    const first = await postRefund({ id: "ref-dup", orderId: "ord-r2", amountCents: 500 });
    expect(first.status).toBe(201);

    const second = await postRefund({ id: "ref-dup", orderId: "ord-r2", amountCents: 999 });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ id: "ref-dup", amountCents: 500 });

    const got = await app.request("/orders/ord-r2");
    const body = await got.json();
    expect(body.netTotalCents).toBe(1500);
    expect(body.refunds).toHaveLength(1);
  });

  it("stores an over-cap refund as rejected, visible but excluded from the sum", async () => {
    await postOrder({ id: "ord-r3", totalCents: 2000, coupon: "ANA10", status: "paid" });
    await postRefund({ id: "ref-ok", orderId: "ord-r3", amountCents: 1500 });

    const res = await postRefund({ id: "ref-over", orderId: "ord-r3", amountCents: 600 });
    expect(res.status).toBe(422);
    const rejected = await res.json();
    expect(rejected.reason).toBe("exceeds-total");

    const got = await app.request("/orders/ord-r3");
    const body = await got.json();
    expect(body.netTotalCents).toBe(500);
    expect(body.refunds).toHaveLength(2);
    const over = body.refunds.find((r: { id: string }) => r.id === "ref-over");
    expect(over).toMatchObject({ amountCents: 600, status: "rejected", reason: "exceeds-total" });
  });

  it("rejects non-positive or non-integer amounts with 400 and details", async () => {
    await postOrder({ id: "ord-r4", totalCents: 2000, coupon: "ANA10", status: "paid" });
    for (const amountCents of [0, -50, 10.5, "100"]) {
      const res = await postRefund({ id: `ref-bad-${String(amountCents)}`, orderId: "ord-r4", amountCents });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(body.details).toBeDefined();
    }
    const got = await app.request("/orders/ord-r4");
    expect((await got.json()).netTotalCents).toBe(2000);
  });

  it("returns 404 for a refund on an unknown order", async () => {
    const res = await postRefund({ id: "ref-ghost", orderId: "nope", amountCents: 100 });
    expect(res.status).toBe(404);
  });
});
