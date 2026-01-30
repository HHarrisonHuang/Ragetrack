import { io } from 'socket.io-client';

// Simple EventEmitter implementation
class EventEmitter {
  constructor() {
    this.events = {};
  }

  on(event, callback) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
  }

  emit(event, data) {
    if (this.events[event]) {
      this.events[event].forEach(callback => callback(data));
    }
  }

  off(event, callback) {
    if (this.events[event]) {
      this.events[event] = this.events[event].filter(cb => cb !== callback);
    }
  }
}

export class NetworkManager extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.playerId = null;
    this.playerCount = 0;
    this.maxPlayers = 10;
    this.connected = false;
    this.isReady = false;
  }

  connect() {
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
    console.log('🔌 Attempting to connect to:', serverUrl);
    console.log('Socket.io client available:', typeof io !== 'undefined');
    
    if (typeof io === 'undefined') {
      console.error('❌ socket.io-client not loaded! Check if it is imported correctly.');
      alert('Socket.io client library not loaded. Please check the console for errors.');
      return;
    }
    
    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    
    console.log('Socket instance created:', !!this.socket);
    
    this.socket.on('connect', () => {
      this.connected = true;
      console.log('✅ Connected to server, socket ID:', this.socket.id);
      this.emit('socketConnected');
    });

    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Connection error:', error);
      this.emit('connectionError', error);
      const statusEl = document.getElementById('connectionStatus');
      if (statusEl) {
        statusEl.textContent = 'Connection failed - Is server running?';
        statusEl.style.color = '#f44336';
      }
      alert('Failed to connect to server. Make sure the server is running on port 3001.\n\nError: ' + error.message);
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      console.log('Disconnected from server');
    });

    this.socket.on('playerId', (data) => {
      this.playerId = data.playerId;
      this.emit('connected', data);
    });

    this.socket.on('gameState', (state) => {
      this.playerCount = state.playerCount || 0;
      this.emit('gameState', state);
    });

    this.socket.on('spawn', (data) => {
      this.emit('spawn', data);
    });

    this.socket.on('playerUpdate', (update) => {
      this.emit('playerUpdate', update);
    });
    
    // Minimal-style authoritative snapshot (same payload as playerUpdate)
    this.socket.on('snapshot', (snapshot) => {
      this.emit('snapshot', snapshot);
    });
    
    this.socket.on('serverDebug', (data) => {
      // Log here so it shows even if Game didn't subscribe yet.
      try {
        console.log('🧩 serverDebug (raw):', JSON.stringify(data));
      } catch {
        console.log('🧩 serverDebug (raw):', data);
      }
      this.emit('serverDebug', data);
    });

    this.socket.on('eliminated', (data) => {
      this.emit('eliminated', data);
    });

    this.socket.on('gameStart', (data) => {
      this.emit('gameStart', data);
    });

    this.socket.on('gameEnd', (data) => {
      this.emit('gameEnd', data);
    });

    this.socket.on('scoreUpdate', (scores) => {
      this.emit('scoreUpdate', scores);
    });

    this.socket.on('flagUpdate', (data) => {
      console.log('🚩 Received flagUpdate from server:', data);
      this.emit('flagUpdate', data);
    });
  }

  joinGame() {
    console.log('🎮 joinGame() called');
    console.log('  - socket exists:', !!this.socket);
    console.log('  - connected:', this.connected);
    console.log('  - socket ID:', this.socket?.id);
    
    if (!this.socket) {
      console.log('📡 No socket, calling connect()...');
      this.connect();
      
      // Wait for connection before joining
      if (this.socket) {
        console.log('⏳ Waiting for socket connection...');
        this.socket.once('connect', () => {
          console.log('✅ Socket connected! Socket ID:', this.socket.id);
          console.log('📤 Emitting joinGame event...');
          this.socket.emit('joinGame');
          console.log('✅ joinGame event emitted');
        });
        
        // Also set a timeout to show error if connection takes too long
        setTimeout(() => {
          if (!this.connected) {
            console.error('⏱️ Connection timeout - server may not be running');
            const statusEl = document.getElementById('connectionStatus');
            if (statusEl) {
              statusEl.textContent = 'Connection timeout - Check if server is running on port 3001';
              statusEl.style.color = '#f44336';
            }
            const joinButton = document.getElementById('joinButton');
            if (joinButton) {
              joinButton.disabled = false;
              joinButton.textContent = 'Join Game';
            }
          }
        }, 5000);
      } else {
        console.error('❌ Failed to create socket - connect() returned null');
        alert('Failed to create socket connection. Please check:\n1. Is the server running?\n2. Check browser console for errors');
      }
    } else if (this.connected) {
      console.log('✅ Already connected, emitting joinGame immediately');
      this.socket.emit('joinGame');
      console.log('✅ joinGame event emitted');
    } else {
      console.log('⏳ Socket exists but not connected yet, waiting for connection...');
      // Socket exists but not connected yet, wait for connection
      this.socket.once('connect', () => {
        console.log('✅ Socket connected! Emitting joinGame...');
        this.socket.emit('joinGame');
        console.log('✅ joinGame event emitted');
      });
    }
  }

  sendInput(inputState) {
    if (this.socket && this.connected) {
      // Prefer minimal-style event name, but keep legacy for compatibility.
      this.socket.emit('input', inputState);
      this.socket.emit('playerInput', inputState);
    }
  }

  sendFall() {
    if (this.socket && this.connected) {
      this.socket.emit('playerFall');
    }
  }

  sendReady() {
    if (this.socket && this.connected) {
      this.socket.emit('playerReady');
      this.isReady = !this.isReady; // Toggle ready state
    }
  }

  sendRespawnRequest() {
    if (this.socket && this.connected) {
      this.socket.emit('respawnRequest');
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
