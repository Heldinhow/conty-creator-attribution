import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? "./data.sqlite";

const db = await openDatabase(dbPath);
const app = createApp(db);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`listening on http://localhost:${info.port}`);
});
