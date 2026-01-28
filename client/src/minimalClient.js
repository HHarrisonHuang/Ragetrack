/**
 * Minimal Socket.IO Multiplayer Client
 * 
 * Architecture:
 *   Player Browser
 *      ↓ (inputs)
 *   Game Server ← authoritative
 *      ↓ (state)
 *   All Players
 */

import { io } from 'socket.io-client';

// ============================================
// CONFIGURATION
// ============================================
const SERVER_URL = 'http://localhost:3001';

// ============================================
// STATE
// ============================================
let socket = null;
let myId = null;
let players = {}; // id -> { x, y, z, rotation }
let input = { throttle: 0, brake: 0, steer: 0 };

// ============================================
// CONNECT TO SERVER
// ============================================
export function connect() {
  socket = io(SERVER_URL, {
    transports: ['websocket'],
  });
  
  socket.on('connect', () => {
    console.log('[+] Connected to server');
  });
  
  socket.on('connected', (data) => {
    myId = data.id;
    console.log(`[+] My ID: ${myId}`);
  });
  
  // Receive authoritative state from server
  socket.on('snapshot', (snapshot) => {
    players = snapshot;
    onSnapshot(snapshot);
  });
  
  socket.on('disconnect', () => {
    console.log('[-] Disconnected from server');
    myId = null;
  });
  
  return socket;
}

// ============================================
// SEND INPUT TO SERVER
// ============================================
export function sendInput(newInput) {
  input = { ...input, ...newInput };
  if (socket && socket.connected) {
    socket.emit('input', input);
  }
}

// ============================================
// GETTERS
// ============================================
export function getMyId() {
  return myId;
}

export function getPlayers() {
  return players;
}

export function getMyState() {
  return myId ? players[myId] : null;
}

// ============================================
// CALLBACK (override this in your game)
// ============================================
export let onSnapshot = (snapshot) => {
  // Override this function to handle snapshots
  // Example: update your Three.js meshes here
};

export function setOnSnapshot(callback) {
  onSnapshot = callback;
}

// ============================================
// KEYBOARD INPUT HELPER
// ============================================
export function setupKeyboardInput() {
  const keys = {};
  
  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    updateInputFromKeys();
  });
  
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
    updateInputFromKeys();
  });
  
  function updateInputFromKeys() {
    sendInput({
      throttle: (keys['w'] || keys['arrowup']) ? 1 : 0,
      brake: (keys['s'] || keys['arrowdown']) ? 1 : 0,
      steer: (keys['a'] || keys['arrowleft']) ? -1 : 
             (keys['d'] || keys['arrowright']) ? 1 : 0,
    });
  }
}

// ============================================
// USAGE EXAMPLE
// ============================================
/*
import { connect, setupKeyboardInput, setOnSnapshot, getMyId } from './minimalClient.js';

// Connect to server
connect();

// Setup keyboard controls
setupKeyboardInput();

// Handle server updates
setOnSnapshot((snapshot) => {
  Object.entries(snapshot).forEach(([id, state]) => {
    const isMe = id === getMyId();
    // Update your Three.js mesh positions here
    // mesh.position.set(state.x, state.y, state.z);
    // mesh.rotation.y = state.rotation;
  });
});
*/
