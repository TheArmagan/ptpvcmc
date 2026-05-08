import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFileSync } from "fs";

const app = new Hono();
app.use("*", cors());

const PLAYER_TTL = 5000;

// Per-player position store: name → {self, nearby, ip, lastSeen}
const players = new Map<string, { self: any; nearby: any[]; ip: string; lastSeen: number }>();
// IP → player name (for self-identification on GET without ?me=)
const ipToName = new Map<string, string>();

// Signaling queues: targetName → [{from, data}]
const signals = new Map<string, Array<{ from: string; data: any }>>();

function evict() {
  const now = Date.now();
  for (const [name, p] of players) {
    if (now - p.lastSeen > PLAYER_TTL) {
      ipToName.delete(p.ip);
      players.delete(name);
    }
  }
}

app.post("/positions", async (c) => {
  const ip = c.req.header("x-client-ip") ?? "unknown";
  const body = await c.req.json();
  if (body.self?.name) {
    players.set(body.self.name, {
      self: body.self,
      nearby: body.nearby ?? [],
      ip,
      lastSeen: Date.now(),
    });
    ipToName.set(ip, body.self.name);
  }
  return c.json({ ok: true });
});

app.get("/positions", (c) => {
  evict();
  const ip = c.req.header("x-client-ip") ?? "unknown";
  const me = c.req.query("me") ?? ipToName.get(ip);
  if (!me || !players.has(me)) return c.json({ self: null, nearby: [] });
  const myData = players.get(me)!;
  const nearby = [...players.values()]
    .filter((p) => p.self.name !== me)
    .map((p) => p.self);
  return c.json({ self: myData.self, nearby });
});

app.post("/signal", async (c) => {
  const { from, to, data } = await c.req.json();
  if (!signals.has(to)) signals.set(to, []);
  signals.get(to)!.push({ from, data });
  return c.json({ ok: true });
});

app.get("/signal/:id", (c) => {
  const id = decodeURIComponent(c.req.param("id"));
  const queue = signals.get(id) ?? [];
  signals.delete(id);
  return c.json(queue);
});

app.get("/", (c) => {
  return c.html(readFileSync("./index.html", "utf-8"));
});

console.log("voicepos server running on http://localhost:7270");

// Wrap fetch to inject real client IP before Hono sees the request
export default {
  port: 7270,
  async fetch(req: Request, server: any) {
    const ip: string = server.requestIP?.(req)?.address ?? "unknown";
    const headers = new Headers(req.headers);
    headers.set("x-client-ip", ip);
    return app.fetch(new Request(req, { headers }));
  },
};
