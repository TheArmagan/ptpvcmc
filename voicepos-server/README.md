# voicepos server

Bun + Hono server that receives position data from the Fabric mod, serves the web UI, and relays WebRTC signaling between players.

## do i need to run a server?

**Yes — one person hosts it, everyone connects to it.**

The server is a shared hub for two things:
- **Position data**: each player's Fabric mod POSTs their in-game coordinates here
- **WebRTC signaling**: the server relays SDP offers/answers so peer connections can be established automatically

The actual **voice audio is peer-to-peer** (direct WebRTC between browsers). The server doesn't carry audio traffic.

## host setup

```bash
cd voicepos-server
bun install
bun run server.ts
```

Open `http://localhost:7270` in your browser. The Fabric mod on your machine already points to `localhost:7270` by default — no changes needed.

Make sure port `7270` is reachable by your friends:
- **LAN**: firewall may need to allow TCP 7270 inbound
- **Internet**: port-forward 7270 on your router, share your public IP

## friend setup

Each friend needs two things:

### 1. Edit the mod config file

On first launch, the mod creates `.minecraft/config/voicepos.properties` with defaults:

```properties
# voicepos config — set endpoint to your host's IP:port
endpoint=http://localhost:7270/positions
range=96
```

Change `endpoint` to the host's IP before launching Minecraft:

```properties
endpoint=http://192.168.1.x:7270/positions   # LAN
# or
endpoint=http://HOST_PUBLIC_IP:7270/positions # internet
```

No recompile needed — just edit the file and restart Minecraft.

### 2. Open the web UI

Each player opens `http://HOST_IP:7270` in their browser (not localhost — the host's IP).

## how to use

1. Everyone loads into the same Minecraft session and opens the web UI
2. Wait for `receiving — YourName` to appear in the header (mod is connected)
3. Click **join voice** — connections to nearby players happen automatically
4. Voice is spatial: direction and volume change based on in-game positions
5. Players appear in the list with a colored dot: green = connected, yellow = connecting

Leaving voice range (default 96 blocks) disconnects the audio after ~8 seconds. Coming back reconnects automatically.

## how it works internally

```
[Player A mod] --POST /positions--> [Server] <--POST /positions-- [Player B mod]
[Player A browser] --GET /positions--> [Server] <--GET /positions-- [Player B browser]

[A browser] --POST /signal (offer)--> [Server] --GET /signal/B--> [B browser]
[B browser] --POST /signal (answer)--> [Server] --GET /signal/A--> [A browser]

[A browser] <====================== WebRTC (P2P audio) ======================> [B browser]
```

- Position poll: 100ms
- Signal poll: 500ms
- Player TTL: 5s without a mod POST → evicted from server

## ports

| Port | Purpose |
|------|---------|
| `7270` | Server (HTTP) — change in `server.ts` if needed |
