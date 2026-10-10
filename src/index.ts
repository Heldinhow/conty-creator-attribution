import { createApp } from "./app.js";
import { openDatabase } from "./db.js";

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? "./data.sqlite";

const db = await openDatabase(dbPath);

export default {
  port,
  fetch: createApp(db).fetch,
};
