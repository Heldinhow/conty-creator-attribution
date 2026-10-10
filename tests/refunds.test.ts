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

  it("stores a refund for an unknown order as pending instead of 404", async () => {
    const res = await postRefund({ id: "ref-ghost", orderId: "nope", amountCents: 100 });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "ref-ghost", orderId: "nope", status: "pending" });
  });

  it("applies an early refund in arrival order when the order lands", async () => {
    const early = await postRefund({ id: "ref-early", orderId: "ord-early", amountCents: 400 });
    expect(early.status).toBe(201);
    expect(await early.json()).toMatchObject({ status: "pending" });

    const created = await postOrder({ id: "ord-early", totalCents: 2000, coupon: "ANA10", status: "paid" });
    expect(created.status).toBe(201);

    const got = await app.request("/orders/ord-early");
    const body = await got.json();
    expect(body.netTotalCents).toBe(1600);
    expect(body.refunds).toHaveLength(1);
    expect(body.refunds[0]).toMatchObject({ id: "ref-early", amountCents: 400, status: "applied" });
    expect(body.attributionStatus).toBe("attributed");
  });

  it("applies multiple early refunds in arrival order, rejecting the one that breaches the cap", async () => {
    await postRefund({ id: "ref-e1", orderId: "ord-multi", amountCents: 1500 });
    await postRefund({ id: "ref-e2", orderId: "ord-multi", amountCents: 600 });

    await postOrder({ id: "ord-multi", totalCents: 2000, coupon: "ANA10", status: "paid" });

    const got = await app.request("/orders/ord-multi");
    const body = await got.json();
    expect(body.netTotalCents).toBe(500);
    const first = body.refunds.find((r: { id: string }) => r.id === "ref-e1");
    const second = body.refunds.find((r: { id: string }) => r.id === "ref-e2");
    expect(first).toMatchObject({ status: "applied" });
    expect(second).toMatchObject({ status: "rejected", reason: "exceeds-total" });
  });

  it("marks a fully refunded order as reversed while keeping creator and history", async () => {
    await postOrder({ id: "ord-full", totalCents: 2000, coupon: "ANA10", status: "paid" });
    await postRefund({ id: "ref-full", orderId: "ord-full", amountCents: 2000 });

    const got = await app.request("/orders/ord-full");
    const body = await got.json();
    expect(body.netTotalCents).toBe(0);
    expect(body.attributionStatus).toBe("reversed");
    expect(body.creator).toMatchObject({ couponCode: "ANA10" });
    expect(body.creatorId).not.toBeNull();
    expect(body.refunds).toHaveLength(1);
  });

  it("marks cumulative partials summing to the total as reversed", async () => {
    await postOrder({ id: "ord-cum", totalCents: 2000, coupon: "ANA10", status: "paid" });
    await postRefund({ id: "ref-c1", orderId: "ord-cum", amountCents: 1200 });
    await postRefund({ id: "ref-c2", orderId: "ord-cum", amountCents: 800 });

    const got = await app.request("/orders/ord-cum");
    const body = await got.json();
    expect(body.netTotalCents).toBe(0);
    expect(body.attributionStatus).toBe("reversed");
    expect(body.creator).toMatchObject({ couponCode: "ANA10" });
    expect(body.refunds).toHaveLength(2);
  });

  it("keeps a fully refunded creator-less order unattributed with net zero", async () => {
    await postOrder({ id: "ord-nocreator", totalCents: 1000, coupon: "UNKNOWN", status: "paid" });
    await postRefund({ id: "ref-nc1", orderId: "ord-nocreator", amountCents: 1000 });

    const got = await app.request("/orders/ord-nocreator");
    const body = await got.json();
    expect(body.creator).toBeNull();
    expect(body.creatorId).toBeNull();
    expect(body.netTotalCents).toBe(0);
    expect(body.attributionStatus).toBe("unattributed");
  });

  it("lists refunds per order id even before the order exists", async () => {
    await postRefund({ id: "ref-pre1", orderId: "ord-pre", amountCents: 300 });
    await postRefund({ id: "ref-pre2", orderId: "ord-pre", amountCents: 5000 });

    const res = await app.request("/refunds?orderId=ord-pre");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orderId).toBe("ord-pre");
    expect(body.refunds).toHaveLength(2);
    expect(body.refunds[0]).toMatchObject({ id: "ref-pre1", status: "pending" });
  });

  it("trims whitespace in the refund listing query", async () => {
    await postRefund({ id: "ref-ws1", orderId: "ord-ws", amountCents: 300 });

    const res = await app.request("/refunds?orderId=%20%20ord-ws%20%20");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orderId).toBe("ord-ws");
    expect(body.refunds).toHaveLength(1);
  });
});
