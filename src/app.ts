import { Hono } from "hono";
import { z } from "zod";
import { type DatabaseHandle, migrate } from "./db.js";
import { resolveAttribution } from "./attribution.js";
import { CreatorConflictError, createCreator, listCreators, seedCreators } from "./creators.js";

const CreatorBody = z.object({
  name: z.string().trim().min(1, "name is required"),
  couponCode: z.string().trim().min(1, "couponCode is required"),
  utmCampaign: z.string().trim().min(1, "utmCampaign is required"),
});

const OrderBody = z.object({
  id: z.string().trim().min(1, "id is required"),
  totalCents: z.number().int("totalCents must be an integer").positive("totalCents must be positive"),
  coupon: z.string().nullish(),
  utmSource: z.string().nullish(),
  utmCampaign: z.string().nullish(),
  status: z.string().nullish(),
});

interface OrderRow {
  id: string;
  total_cents: number;
  coupon: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  store_status: string | null;
  creator_id: number | null;
  attribution_status: string;
}

function orderView(db: DatabaseHandle, row: OrderRow) {
  const creator = row.creator_id
    ? db.get<{ id: number; name: string; coupon_code: string; utm_campaign: string }>(
        "SELECT id, name, coupon_code, utm_campaign FROM creators WHERE id = ?",
        [row.creator_id]
      )
    : undefined;
  return {
    id: row.id,
    totalCents: row.total_cents,
    coupon: row.coupon,
    utmSource: row.utm_source,
    utmCampaign: row.utm_campaign,
    storeStatus: row.store_status,
    creatorId: row.creator_id,
    creator: creator
      ? { id: creator.id, name: creator.name, couponCode: creator.coupon_code, utmCampaign: creator.utm_campaign }
      : null,
    refunds: [],
    netTotalCents: row.total_cents,
    attributionStatus: row.attribution_status,
  };
}

export function createApp(db: DatabaseHandle): Hono {
  migrate(db);
  seedCreators(db);

  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/creators", (c) => c.json({ creators: listCreators(db) }));

  app.post("/creators", async (c) => {
    const parsed = CreatorBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid request", details: parsed.error.issues }, 400);
    }
    try {
      const creator = createCreator(db, parsed.data);
      return c.json(creator, 201);
    } catch (err) {
      if (err instanceof CreatorConflictError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }
  });

  app.post("/orders", async (c) => {
    const parsed = OrderBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid request", details: parsed.error.issues }, 400);
    }
    const body = parsed.data;
    const result = db.transaction(() => {
      const existing = db.get<OrderRow>("SELECT * FROM orders WHERE id = ?", [body.id]);
      if (existing) return { row: existing, created: false };
      const creator = resolveAttribution({ coupon: body.coupon, utmCampaign: body.utmCampaign }, listCreators(db));
      const creatorId = creator ? creator.id : null;
      db.run(
        "INSERT INTO orders (id, total_cents, coupon, utm_source, utm_campaign, store_status, creator_id, attribution_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          body.id,
          body.totalCents,
          body.coupon ?? null,
          body.utmSource ?? null,
          body.utmCampaign ?? null,
          body.status ?? null,
          creatorId,
          creator ? "attributed" : "unattributed",
        ]
      );
      return { row: db.get<OrderRow>("SELECT * FROM orders WHERE id = ?", [body.id])!, created: true };
    });
    return c.json(orderView(db, result.row), result.created ? 201 : 200);
  });

  app.get("/orders/:id", (c) => {
    const row = db.get<OrderRow>("SELECT * FROM orders WHERE id = ?", [c.req.param("id")]);
    if (!row) return c.json({ error: "order not found" }, 404);
    return c.json(orderView(db, row));
  });

  return app;
}
