# Ragetrack - Capture the Flag Game

A web-based multiplayer physics-driven Capture the Flag game with arcade-style car controls.

## Features

- **Physics-based gameplay** using Rapier.js
- **Server-authoritative multiplayer** with Socket.IO
- **Deterministic physics** for fair gameplay
- **Team-based CTF** with flag mechanics
- **Map system** with JSON-based map loading
- **Fall-based elimination** (no health bars)

## Tech Stack

- **Client**: Three.js, Rapier.js, Socket.IO Client, Vite
- **Server**: Node.js, Express, Socket.IO, Rapier.js
- **Shared**: Constants and map data

## Installation

1. Install dependencies:
```bash
npm run install:all
```

2. Start development servers:
```bash
npm run dev
```

This will start:
- Client on http://localhost:3000
- Server on http://localhost:3001

## Play with friends online (Tunnel / ngrok)

This is the quickest way for **friends in different places** to join your server without port-forwarding.

### Prereqs

- Install ngrok: `https://ngrok.com/download`

### Host (you)

1. Start the server:

```powershell
cd C:\Ragetrack\server
npm run start
```

2. Start an ngrok tunnel to the server port:

```powershell
ngrok http 3001
```

Copy the **Forwarding** URL ngrok prints (example: `https://abcd-1234.ngrok-free.app`).

3. Start the client pointing at the ngrok URL:

```powershell
cd C:\Ragetrack\client
$env:VITE_SERVER_URL="https://abcd-1234.ngrok-free.app"
npm run dev
```

Open the client (Vite prints a URL like `http://localhost:3000`).

### Friends

Your friends run the client locally and use **the same** `VITE_SERVER_URL`:

```powershell
cd C:\Ragetrack\client
$env:VITE_SERVER_URL="https://abcd-1234.ngrok-free.app"
npm run dev
```

Then they open their own `http://localhost:3000` and click **Join Game**.

### Quick check

From any machine, this should work (shows JSON):

- `https://<your-ngrok-host>/status`

### Note on CORS

Your Socket.IO server currently allows `http://localhost:3000` as the web client origin (see `server/src/index.js`). This is **fine** if everyone runs the client locally (friends will also be on `http://localhost:3000`). If you later host the client on a real domain, you’ll need to update that allowed origin.

## Game Rules

- **Teams**: Red and Blue
- **Objective**: Capture enemy flags and return them to your base
- **Win Condition**: First team to capture 3 flags wins
- **Elimination**: Falling below the death threshold eliminates you
- **Respawn**: 5 second delay after elimination
- **Players**: 2-10 players required to start

## Controls

- **W / Arrow Up**: Throttle
- **S / Arrow Down**: Brake
- **A / Arrow Left**: Steer Left
- **D / Arrow Right**: Steer Right

## Project Structure

```
/client
  /src
    /core          - Game engine, camera
    /physics       - Physics world
    /gameplay      - Car, map loader, input
    /network       - Network manager
  /public
    /maps          - Map JSON files

/server
  /src
    physicsWorld.js    - Server physics
    playerManager.js   - Player management
    gameLogic.js       - Game state and logic
    car.js            - Server-side car physics
    mapLoader.js      - Map loading

/shared
  constants.js        - Shared game constants
  /maps              - Map definitions
```

## Development Roadmap

- ✅ Phase 1: Core Movement and Physics
- ✅ Phase 2: Server-Authoritative Multiplayer
- ✅ Phase 3: Capture the Flag Logic
- ✅ Phase 4: Collision and Elimination Rules
- ✅ Phase 5: Map System and Loading
- ⏳ Phase 6: Map Editor
- ✅ Phase 7: Gameplay Rules and Win Conditions

## License

MIT
