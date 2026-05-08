import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { readFileSync } from "fs";

const app = new Hono();

app.use("*", cors());

// latest position data from the fabric mod
let latestPositions: any = null;

// POST /positions — fabric mod sends here every 0.5s
app.post("/positions", async (c) => {
  latestPositions = await c.req.json();
  return c.json({ ok: true });
});

// GET /positions — frontend polls this
app.get("/positions", (c) => {
  return c.json(latestPositions ?? { self: null, nearby: [] });
});

// serve index.html
app.get("/", (c) => {
  const html = readFileSync("./index.html", "utf-8");
  return c.html(html);
});

console.log("voicepos server running on http://localhost:7270");
export default { port: 7270, fetch: app.fetch };
