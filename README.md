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

## Game Rules

- **Teams**: Red and Blue
- **Objective**: Capture enemy flags and return them to your base
- **Win Condition**: First team to capture 3 flags wins
- **Elimination**: Falling below the death threshold eliminates you
- **Respawn**: 5 second delay after elimination
- **Players**: 4-10 players required to start

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
