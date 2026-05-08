# voicepos server

bun + hono server that receives position data from the fabric mod and serves the web UI.

## setup

```bash
bun install
bun run server.ts
# open http://localhost:7270
```

## how it works

- fabric mod POSTs to `POST /positions` every 0.5s
- frontend polls `GET /positions` every 0.5s
- webrtc connection is established via manual copy-paste (no relay server needed)
- web audio api PannerNode handles 3d spatial audio based on positions

## connect with a friend

1. both of you open http://localhost:7270
2. one person clicks "create offer", copies the text, sends it to the other (discord, etc)
3. other person pastes it, clicks "accept offer", copies the answer back
4. first person pastes the answer and clicks "apply answer"
5. done — audio is now spatial based on your in-game positions

## ports

- `7270` — server (change in server.ts if needed)
