# 🎱 8-Ball Pool 1v1

Simple multiplayer-ready 8-ball pool game built with Vite + Canvas.

## Features

- Realistic ball physics (collisions, cushions, pockets)
- Proper 8-ball rules (solids / stripes assignment, scratch, early 8)
- **Local 1v1** (same device, take turns)
- **Online room codes** (BroadcastChannel – works across tabs on same browser; easy to upgrade to real signaling)
- Power meter + aim line
- Mobile touch support
- Ready for Vercel

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Deploy to Vercel

1. Push this folder to a GitHub repo
2. Import the repo in [vercel.com](https://vercel.com)
3. Deploy (Vite is auto-detected)

Or use CLI:

```bash
npm i -g vercel
vercel
```

## Online Multiplayer Notes

Current online mode uses `BroadcastChannel` so two tabs on the **same browser/device** can play together with a room code.  

For real cross-device online 1v1 you can plug in any of these (all work great with Vercel):

- **Supabase Realtime** (Broadcast) – free tier
- **Ably** / **Pusher**
- **PartyKit**
- **Firebase Realtime Database**

The game already sends `shoot` + full state sync messages – you only need to replace the `sendState` / `handleSignal` transport.

## Controls

- **Mouse / Touch**: Click (or press) near cue ball, drag away to aim & set power, release to shoot
- Aim line shows direction
- Power bar at the bottom

Enjoy!
