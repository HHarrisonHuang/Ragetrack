import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { GameServer } from './gameLogic.js';
import { MapLoader } from './mapLoader.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const app = express();

// Root endpoint - helpful message
app.get('/', (req, res) => {
  res.json({ 
    message: 'Ragetrack Game Server',
    port: 3001,
    status: 'running',
    note: 'This is the Socket.IO server. Open http://localhost:3000 in your browser to play!'
  });
});

// Health check endpoint
app.get('/status', (req, res) => {
  res.json({ status: 'ok', port: 3001, message: 'Ragetrack server is running' });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  allowEIO3: true, // Allow Engine.IO v3 clients
});

const gameServer = new GameServer(io);
const mapLoader = new MapLoader();

// Initialize server - wait for physics and map to load
(async () => {
  try {
    // Wait for physics world to initialize
    await gameServer.physicsWorld.init();
    console.log('✅ Physics world ready');
    
    // Load map
    const mapData = await mapLoader.loadMap('defaultMap.json');
    gameServer.setMap(mapData);
    console.log('✅ Map loaded successfully');
  } catch (error) {
    console.error('❌ Error initializing server:', error);
  }
})();

io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);
  
  gameServer.handleConnection(socket);
  
  // Send initial game state to newly connected client
  gameServer.broadcastGameState();

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    gameServer.handleDisconnection(socket.id);
  });

  socket.on('joinGame', () => {
    console.log('📥 Received joinGame event from socket:', socket.id);
    gameServer.handleJoinGame(socket);
  });

  socket.on('playerInput', (inputState) => {
    gameServer.handlePlayerInput(socket.id, inputState);
  });

  socket.on('playerFall', () => {
    gameServer.handlePlayerFall(socket.id);
  });

  socket.on('playerReady', () => {
    gameServer.handlePlayerReady(socket.id);
  });
});

// ============================================
// CHECK PORT AVAILABILITY
// ============================================
async function checkPort(port) {
  try {
    // Try to find what's using the port (Windows)
    const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/989d4d4f-8f62-438d-b642-d7c884c1d6b9',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:92',message:'Port check result',data:{port,hasProcess:!!stdout,output:stdout.substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    return stdout.trim();
  } catch (error) {
    // Port might be free, or command failed
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/989d4d4f-8f62-438d-b642-d7c884c1d6b9',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:99',message:'Port check failed',data:{port,error:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    return null;
  }
}

const PORT = process.env.PORT || 3001;

// #region agent log
fetch('http://127.0.0.1:7242/ingest/989d4d4f-8f62-438d-b642-d7c884c1d6b9',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:107',message:'Attempting to listen on port',data:{port:PORT},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
// #endregion

httpServer.on('error', async (error) => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/989d4d4f-8f62-438d-b642-d7c884c1d6b9',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:110',message:'Server listen error',data:{code:error.code,errno:error.errno,port:PORT},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  
  if (error.code === 'EADDRINUSE') {
    const portInfo = await checkPort(PORT);
    let processInfo = '';
    if (portInfo) {
      const lines = portInfo.split('\n');
      const pidMatch = lines[0]?.match(/\s+(\d+)$/);
      processInfo = pidMatch ? `\n  PID: ${pidMatch[1]} (kill with: taskkill /F /PID ${pidMatch[1]})` : '';
    }
    
    console.error(`
╔════════════════════════════════════════════╗
║     Port ${PORT} Already In Use!              ║
╠════════════════════════════════════════════╣
║  Another process is using port ${PORT}.        ║${processInfo}
║                                            ║
║  Solutions:                                ║
║  1. Stop the other server:                 ║
║     - Check if minimalServer.js is running║
║     - Check for other Node processes       ║
║     - Kill process: taskkill /F /PID <pid> ║
║                                            ║
║  2. Use a different port:                  ║
║     PORT=3002 npm run dev                   ║
╚════════════════════════════════════════════╝
    `);
    process.exit(1);
  } else {
    console.error('❌ Server error:', error);
    process.exit(1);
  }
});

httpServer.listen(PORT, () => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/989d4d4f-8f62-438d-b642-d7c884c1d6b9',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:140',message:'Server successfully listening',data:{port:PORT},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  console.log(`✅ Server running on port ${PORT}`);
});
