import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from "fs";
import { throttle } from "lodash";

const app = new Hono();
app.use("*", cors());

const PLAYER_TTL = 5000;
const JUKEBOX_PLAYING_TTL = 15_000; // inactive after 15s without mod report
const JUKEBOX_EVICT_TTL = 120_000;  // evict file-less jukeboxes after 2m
const JUKEBOX_AUDIO_DIR = "./jukebox-audio";
const JUKEBOX_STATE_FILE = "./jukebox-state.json";

// ─── player state ─────────────────────────────────────────────────────────
const players = new Map<string, { self: any; nearby: any[]; ip: string; lastSeen: number }>();
const ipToName = new Map<string, string>();

// ─── jukebox state ────────────────────────────────────────────────────────
type JukeboxEntry = {
  x: number; y: number; z: number;
  world: string;
  file: string | null;
  startedAt: number;
  lastSeen: number;
};

const jukeboxes = new Map<string, JukeboxEntry>();

function jukeboxId(world: string, x: number, y: number, z: number) {
  return `${world}:${Math.floor(x)}:${Math.floor(y)}:${Math.floor(z)}`;
}

function sanitizeFilename(id: string) {
  return id.replace(/[^a-z0-9]/gi, "_");
}

function serializeJukeboxes() {
  const now = Date.now();
  return [...jukeboxes.entries()].map(([id, jb]) => ({
    id,
    x: jb.x, y: jb.y, z: jb.z,
    world: jb.world,
    file: jb.file,
    startedAt: jb.startedAt,
    active: jb.file !== null && now - jb.lastSeen < JUKEBOX_PLAYING_TTL,
  }));
}

function saveJukeboxState() {
  try {
    const state = [...jukeboxes.entries()]
      .filter(([, jb]) => jb.file)
      .map(([id, jb]) => ({ id, x: jb.x, y: jb.y, z: jb.z, world: jb.world, file: jb.file, startedAt: jb.startedAt }));
    writeFileSync(JUKEBOX_STATE_FILE, JSON.stringify(state));
  } catch {}
}

function loadJukeboxState() {
  if (!existsSync(JUKEBOX_STATE_FILE)) return;
  try {
    const state = JSON.parse(readFileSync(JUKEBOX_STATE_FILE, "utf-8")) as any[];
    for (const entry of state) {
      const filePath = `${JUKEBOX_AUDIO_DIR}/${entry.file}`;
      if (!existsSync(filePath)) continue; // file was deleted
      jukeboxes.set(entry.id, {
        x: entry.x, y: entry.y, z: entry.z,
        world: entry.world,
        file: entry.file,
        startedAt: entry.startedAt,
        lastSeen: 0, // unknown — becomes active once mod re-reports it
      });
    }
  } catch {}
}

// ─── eviction ─────────────────────────────────────────────────────────────
function evict() {
  const now = Date.now();
  for (const [name, p] of players) {
    if (now - p.lastSeen > PLAYER_TTL) {
      ipToName.delete(p.ip);
      players.delete(name);
    }
  }
  for (const [id, jb] of jukeboxes) {
    if (!jb.file && now - jb.lastSeen > JUKEBOX_EVICT_TTL) {
      jukeboxes.delete(id);
    }
  }
}

// ─── WebSocket clients ────────────────────────────────────────────────────
const wsClients = new Map<any, { name: string | null }>();

function sendPositionsToClient(ws: any, name: string | null) {
  ws.send(JSON.stringify({ type: "players", data: [...players.keys()] }));
  if (name) {
    const myData = players.get(name);
    if (myData) {
      // Dimension fix: only include players in the same world
      const nearby = [...players.values()]
        .filter((p) => p.self.name !== name && p.self.world === myData.self.world)
        .map((p) => p.self);
      ws.send(JSON.stringify({
        type: "positions",
        data: { self: myData.self, nearby, jukeboxes: serializeJukeboxes() },
      }));
    } else {
      ws.send(JSON.stringify({
        type: "positions",
        data: { self: null, nearby: [], jukeboxes: serializeJukeboxes() },
      }));
    }
  }
}

function _broadcastToAll() {
  evict();
  for (const [ws, client] of wsClients) {
    sendPositionsToClient(ws, client.name);
  }
}

const broadcastToAll = throttle(_broadcastToAll, 50);

setInterval(() => {
  if (wsClients.size > 0) broadcastToAll();
}, 2000);

// ─── positions (mod → server) ─────────────────────────────────────────────
app.post("/positions", async (c) => {
  const ip = c.req.header("x-client-ip") ?? "unknown";
  const body = await c.req.json();
  const now = Date.now();

  if (body.self?.name) {
    players.set(body.self.name, {
      self: body.self,
      nearby: body.nearby ?? [],
      ip,
      lastSeen: now,
    });
    ipToName.set(ip, body.self.name);
  }

  // Process nearby jukeboxes reported by the mod
  for (const jb of (body.jukeboxes ?? [])) {
    const id = jukeboxId(jb.world, jb.x, jb.y, jb.z);
    const existing = jukeboxes.get(id);
    if (existing) {
      existing.lastSeen = now;
    } else {
      jukeboxes.set(id, {
        x: jb.x, y: jb.y, z: jb.z,
        world: jb.world,
        file: null,
        startedAt: 0,
        lastSeen: now,
      });
    }
  }

  broadcastToAll();
  return c.json({ ok: true });
});

// ─── jukebox audio upload ─────────────────────────────────────────────────
app.post("/jukebox/:id/upload", async (c) => {
  const id = decodeURIComponent(c.req.param("id"));
  const jb = jukeboxes.get(id);
  if (!jb) return c.json({ error: "jukebox not in registry" }, 404);

  const form = await c.req.formData();
  const file = form.get("audio") as File | null;
  if (!file) return c.json({ error: "no file" }, 400);

  if (!existsSync(JUKEBOX_AUDIO_DIR)) mkdirSync(JUKEBOX_AUDIO_DIR);

  // Remove old file if present
  if (jb.file) {
    try { unlinkSync(`${JUKEBOX_AUDIO_DIR}/${jb.file}`); } catch {}
  }

  const filename = `${sanitizeFilename(id)}.mp3`;
  writeFileSync(`${JUKEBOX_AUDIO_DIR}/${filename}`, Buffer.from(await file.arrayBuffer()));

  jb.file = filename;
  jb.startedAt = Date.now();
  jb.lastSeen = Date.now();

  saveJukeboxState();
  broadcastToAll();
  return c.json({ ok: true });
});

// ─── jukebox audio remove ─────────────────────────────────────────────────
app.delete("/jukebox/:id/audio", (c) => {
  const id = decodeURIComponent(c.req.param("id"));
  const jb = jukeboxes.get(id);
  if (!jb) return c.json({ error: "not found" }, 404);

  if (jb.file) {
    try { unlinkSync(`${JUKEBOX_AUDIO_DIR}/${jb.file}`); } catch {}
    jb.file = null;
    jb.startedAt = 0;
  }

  saveJukeboxState();
  broadcastToAll();
  return c.json({ ok: true });
});

// ─── static files ─────────────────────────────────────────────────────────
const STATIC: Record<string, string> = {
  "style.css": "text/css",
  "main.js": "application/javascript",
  "radar.js": "application/javascript",
  "audio.js": "application/javascript",
  "peers.js": "application/javascript",
  "jukebox.js": "application/javascript",
};

for (const [file, contentType] of Object.entries(STATIC)) {
  app.get(`/static/${file}`, () =>
    new Response(readFileSync(`./static/${file}`, "utf-8"), {
      headers: { "Content-Type": contentType },
    })
  );
}

app.get("/", (c) => c.html(readFileSync("./static/index.html", "utf-8")));

// ─── helpers ──────────────────────────────────────────────────────────────
function normalizeIP(ip: string): string {
  if (ip === "::1") return "127.0.0.1";
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

// ─── startup ──────────────────────────────────────────────────────────────
if (!existsSync(JUKEBOX_AUDIO_DIR)) mkdirSync(JUKEBOX_AUDIO_DIR);
loadJukeboxState();
console.log("voicepos server running on http://localhost:7270");

// ─── export ───────────────────────────────────────────────────────────────
export default {
  port: 7270,
  fetch(req: Request, server: any) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      if (server.upgrade(req)) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Serve jukebox audio with Bun native range-request support
    if (url.pathname.startsWith("/jukebox-audio/")) {
      const filename = decodeURIComponent(url.pathname.slice("/jukebox-audio/".length));
      if (!filename || filename.includes("..") || filename.includes("/")) {
        return new Response("Not found", { status: 404 });
      }
      const filepath = `${JUKEBOX_AUDIO_DIR}/${filename}`;
      if (!existsSync(filepath)) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(filepath), {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      });
    }

    const ip = normalizeIP(server.requestIP?.(req)?.address ?? "unknown");
    const headers = new Headers(req.headers);
    headers.set("x-client-ip", ip);
    return app.fetch(new Request(req, { headers }));
  },

  websocket: {
    open(ws: any) {
      wsClients.set(ws, { name: null });
      evict();
      ws.send(JSON.stringify({ type: "players", data: [...players.keys()] }));
    },

    message(ws: any, msg: string) {
      try {
        const payload = JSON.parse(msg);
        const client = wsClients.get(ws);
        if (!client) return;

        if (payload.type === "identify") {
          client.name = payload.name;
          evict();
          sendPositionsToClient(ws, client.name);
        } else if (payload.type === "signal") {
          const from = client.name;
          const { to, data } = payload;
          for (const [targetWs, targetClient] of wsClients) {
            if (targetClient.name === to) {
              targetWs.send(JSON.stringify({ type: "signal", from, data }));
              break;
            }
          }
        }
      } catch {}
    },

    close(ws: any) {
      wsClients.delete(ws);
    },
  },
};
