/**
 * Minimal Socket.IO Multiplayer Server
 * 
 * Architecture:
 *   Player Browser
 *      ↓ (inputs)
 *   Game Server ← authoritative
 *      ↓ (state)
 *   All Players
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================
// CONFIGURATION
// ============================================
const PORT = process.env.PORT || 3001;
const TICK_RATE = 60; // Hz
const TICK_INTERVAL = 1000 / TICK_RATE;

// ============================================
// PLAYER STORAGE
// ============================================
const players = new Map(); // socket.id -> { state, input }

// ============================================
// CAR UPDATE FUNCTION (plug in your physics here)
// ============================================
function updateCar(state, input, dt) {
  // This is where your physics logic goes
  // For now, simple integration example:
  
  const acceleration = 50;
  const steerSpeed = 2;
  const friction = 0.98;
  const maxSpeed = 100;
  
  // Apply input
  if (input.throttle) {
    state.vx += Math.sin(state.rotation) * acceleration * dt;
    state.vz += Math.cos(state.rotation) * acceleration * dt;
  }
  if (input.brake) {
    state.vx *= 0.95;
    state.vz *= 0.95;
  }
  if (input.steer !== 0) {
    const speed = Math.sqrt(state.vx * state.vx + state.vz * state.vz);
    if (speed > 0.1) {
      // Check if moving backward for steering inversion
      const forwardX = Math.sin(state.rotation);
      const forwardZ = Math.cos(state.rotation);
      const dot = state.vx * forwardX + state.vz * forwardZ;
      const steerDir = dot < 0 ? -1 : 1; // Invert when reversing
      state.rotation += input.steer * steerSpeed * steerDir * dt;
    }
  }
  
  // Apply friction
  state.vx *= friction;
  state.vz *= friction;
  
  // Clamp speed
  const speed = Math.sqrt(state.vx * state.vx + state.vz * state.vz);
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    state.vx *= scale;
    state.vz *= scale;
  }
  
  // Update position
  state.x += state.vx * dt;
  state.z += state.vz * dt;
  
  return state;
}

// ============================================
// CREATE SERVER
// ============================================
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    players: players.size,
    tickRate: TICK_RATE,
  });
});

// ============================================
// SOCKET HANDLERS
// ============================================
io.on('connection', (socket) => {
  console.log(`[+] Player connected: ${socket.id}`);
  
  // Initialize player state
  players.set(socket.id, {
    state: {
      x: 0,
      y: 2,
      z: 0,
      rotation: 0,
      vx: 0,
      vz: 0,
    },
    input: {
      throttle: 0,
      brake: 0,
      steer: 0,
    },
  });
  
  // Send player their ID
  socket.emit('connected', { id: socket.id });
  
  // Receive input from client
  socket.on('input', (input) => {
    const player = players.get(socket.id);
    if (player) {
      player.input = {
        throttle: input.throttle || 0,
        brake: input.brake || 0,
        steer: input.steer || 0,
      };
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`[-] Player disconnected: ${socket.id}`);
    players.delete(socket.id);
  });
});

// ============================================
// SERVER LOOP (60Hz)
// ============================================
let lastTime = Date.now();

function serverLoop() {
  const now = Date.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  
  // Update each player
  players.forEach((player, id) => {
    player.state = updateCar(player.state, player.input, dt);
  });
  
  // Build snapshot (only state, no input)
  const snapshot = {};
  players.forEach((player, id) => {
    snapshot[id] = {
      x: player.state.x,
      y: player.state.y,
      z: player.state.z,
      rotation: player.state.rotation,
    };
  });
  
  // Broadcast to all clients
  io.emit('snapshot', snapshot);
}

// Start the server loop
let serverLoopInterval = setInterval(serverLoop, TICK_INTERVAL);

// Cleanup function
let isCleaningUp = false;
function cleanup() {
  if (isCleaningUp) return; // Prevent double cleanup
  isCleaningUp = true;
  
  console.log('\n🛑 Shutting down server...');
  
  // Clear the server loop interval
  if (serverLoopInterval) {
    clearInterval(serverLoopInterval);
    serverLoopInterval = null;
  }
  
  // Close socket.io server
  if (io) {
    io.close(() => {
      console.log('✅ Socket.IO server closed');
    });
  }
  
  // Close HTTP server
  if (httpServer) {
    httpServer.close(() => {
      console.log('✅ HTTP server closed');
      process.exit(0);
    });
    
    // Force exit after timeout if graceful shutdown fails
    setTimeout(() => {
      console.log('⚠️ Force exiting...');
      process.exit(0);
    }, 2000);
  } else {
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ============================================
// START SERVER
// ============================================
// CHECK PORT AVAILABILITY
// ============================================
async function checkPort(port) {
  try {
    // Try to find what's using the port (Windows)
    const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/989d4d4f-8f62-438d-b642-d7c884c1d6b9',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'minimalServer.js:190',message:'Port check result',data:{port,hasProcess:!!stdout,output:stdout.substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return stdout.trim();
  } catch (error) {
    // Port might be free, or command failed
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/989d4d4f-8f62-438d-b642-d7c884c1d6b9',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'minimalServer.js:197',message:'Port check failed',data:{port,error:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return null;
  }
}

// ============================================
// START SERVER
// ============================================
// #region agent log
fetch('http://127.0.0.1:7242/ingest/989d4d4f-8f62-438d-b642-d7c884c1d6b9',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'minimalServer.js:205',message:'Attempting to listen on port',data:{port:PORT},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
// #endregion

httpServer.on('error', async (error) => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/989d4d4f-8f62-438d-b642-d7c884c1d6b9',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'minimalServer.js:208',message:'Server listen error',data:{code:error.code,errno:error.errno,port:PORT},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  if (error.code === 'EADDRINUSE') {
    const portInfo = await checkPort(PORT);
    let processInfo = '';
    if (portInfo) {
      const lines = portInfo.split('\n');
      const pidMatch = lines[0]?.match(/\s+(\d+)$/);
      processInfo = pidMatch ? `\n║  PID: ${pidMatch[1]} (use: taskkill /F /PID ${pidMatch[1]}) ║` : '';
    }
    
    console.error(`
╔════════════════════════════════════════════╗
║     Port ${PORT} Already In Use!              ║
╠════════════════════════════════════════════╣
║  Another process is using port ${PORT}.        ║${processInfo}
║                                            ║
║  Solutions:                                ║
║  1. Stop the other server:                 ║
║     - Check if src/index.js is running     ║
║     - Check for other Node processes       ║
║     - Kill process: taskkill /F /PID <pid> ║
║                                            ║
║  2. Use a different port:                  ║
║     PORT=3002 npm run minimal              ║
╚════════════════════════════════════════════╝
    `);
    process.exit(1);
  } else {
    console.error('Server error:', error);
    process.exit(1);
  }
});

httpServer.listen(PORT, () => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/989d4d4f-8f62-438d-b642-d7c884c1d6b9',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'minimalServer.js:210',message:'Server successfully listening',data:{port:PORT},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  console.log(`
╔════════════════════════════════════════════╗
║     Minimal Multiplayer Server             ║
╠════════════════════════════════════════════╣
║  Port:      ${PORT}                           ║
║  Tick Rate: ${TICK_RATE} Hz                         ║
║  Protocol:  Socket.IO                      ║
╠════════════════════════════════════════════╣
║  Events:                                   ║
║    ← input    (client → server)            ║
║    → snapshot (server → clients)           ║
╚════════════════════════════════════════════╝
  `);
});
