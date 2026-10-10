import { Hono } from "hono";
import { z } from "zod";
import { type DatabaseHandle, migrate } from "./db.js";
import { CreatorConflictError, createCreator, listCreators, seedCreators } from "./creators.js";

const CreatorBody = z.object({
  name: z.string().trim().min(1, "name is required"),
  couponCode: z.string().trim().min(1, "couponCode is required"),
  utmCampaign: z.string().trim().min(1, "utmCampaign is required"),
});

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

  return app;
}
