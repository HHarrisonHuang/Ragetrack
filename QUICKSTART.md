# Quick Start Guide

## Installation

1. **Install all dependencies:**
   ```bash
   npm run install:all
   ```

2. **Start the development servers:**
   ```bash
   npm run dev
   ```

   This starts:
   - Client: http://localhost:3000
   - Server: http://localhost:3001

## Playing the Game

1. Open http://localhost:3000 in your browser
2. Click "Join Game"
3. Wait for 4-10 players to join
4. Game starts automatically when minimum players reached
5. Use WASD or Arrow Keys to control your car:
   - **W/↑**: Throttle
   - **S/↓**: Brake
   - **A/←**: Steer Left
   - **D/→**: Steer Right

## Game Rules

- **Objective**: Capture the enemy flag and return it to your base
- **Win Condition**: First team to capture 3 flags wins
- **Elimination**: Fall below Y=-50 to be eliminated
- **Respawn**: 5 second delay, then respawn at your base with 2 seconds invincibility
- **Flag Mechanics**:
  - Pick up enemy flag by driving near it
  - Carrying flag reduces handling
  - Drop flag if you fall or are eliminated
  - Return enemy flag to your base to score

## Map Editor

1. Click "Map Editor" button during gameplay
2. **Place Blocks**: Click on the ground to place blocks
3. **Select Block**: Click on an existing block to select it
4. **Rotate**: Press R or click Rotate button
5. **Delete**: Select block and press Delete or click Delete button
6. **Save**: Click "Save Map" to download your map as JSON
7. **Load**: Click "Load Map" to load a previously saved map
8. **Validate**: Click "Validate Map" to check for issues

## Testing Multiplayer

To test with multiple players:
1. Open multiple browser windows/tabs
2. Each window connects as a separate player
3. All players see the same game state
4. Server handles all physics and game logic

## Troubleshooting

- **Connection Issues**: Make sure server is running on port 3001
- **Physics Not Working**: Check browser console for errors
- **Map Not Loading**: Verify `shared/maps/defaultMap.json` exists
- **Players Not Spawning**: Ensure at least 4 players have joined

## Development

- **Client Code**: `client/src/`
- **Server Code**: `server/src/`
- **Shared Constants**: `shared/constants.js`
- **Maps**: `shared/maps/` and `client/public/maps/`
