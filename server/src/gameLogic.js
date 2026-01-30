import { PhysicsWorld } from './physicsWorld.js';
import { PlayerManager } from './playerManager.js';
import { GAME, NETWORK } from '../../shared/constants.js';

let RAPIER = null;

export class GameServer {
  constructor(io) {
    this.io = io;
    this.physicsWorld = new PhysicsWorld();
    // Initialize physics world asynchronously
    this.physicsWorld.init().then(() => {
      console.log('✅ Physics world initialized');
    }).catch(err => {
      console.error('❌ Failed to initialize physics world:', err);
    });
    this.playerManager = new PlayerManager(this.physicsWorld);
    
    this.gameState = 'lobby'; // lobby, waiting, playing, ended
    this.players = new Map(); // socketId -> playerId
    this.waitingPlayers = new Set();
    this.readyPlayers = new Set(); // socketId -> ready state
    this.mapData = null;
    this.mapCollidersCreated = false;
    this.mapCollidersPromise = null;
    this.lastDebug = {
      mapColliders: null,
      startGameWorld: null,
    };
    
    this.scores = { red: 0, blue: 0 };
    this.flags = {
      red: { position: null, carriedBy: null },
      blue: { position: null, carriedBy: null },
    };
    
    // Store custom map (most recent one uploaded)
    this.customMap = null;
    
    this.lastUpdate = Date.now();
    this.gameLoopInterval = null;

    // Server clock for snapshot interpolation (monotonic, based on tick rate)
    this.serverTick = 0;
    this.serverTickMs = 0;
    
    // Start game loop
    this.startGameLoop();
  }

  setMap(mapData) {
    this.mapData = mapData;
    this.mapCollidersCreated = false;
    this.mapCollidersPromise = this.createMapColliders()
      .then(() => {
        this.mapCollidersCreated = true;
      })
      .catch((err) => {
        console.error('Error creating map colliders:', err);
        this.mapCollidersCreated = false;
      });
    this.initializeFlags();
  }

  setCustomMap(mapData) {
    console.log('🗺️ Setting custom map as active map');
    this.customMap = mapData;
    // Update the active map immediately
    this.setMap(mapData);
  }

  async ensureMapReady() {
    // Make sure physics + colliders exist before spawning cars.
    if (!this.physicsWorld.rapierLoaded) {
      await this.physicsWorld.init();
    }
    if (this.mapCollidersPromise) {
      await this.mapCollidersPromise;
    } else if (!this.mapCollidersCreated) {
      await this.createMapColliders();
      this.mapCollidersCreated = true;
    }
  }

  async createMapColliders() {
    if (!this.mapData || !this.mapData.blocks) return;
    
    // Wait for physics world to be initialized
    if (!this.physicsWorld.rapierLoaded) {
      await this.physicsWorld.init();
    }
    
    if (!RAPIER) {
      RAPIER = this.physicsWorld.getRAPIER();
    }
    
    const world = this.physicsWorld.getWorld();
    if (!world || !RAPIER) {
      console.error('Physics world or RAPIER not initialized');
      return;
    }
    
    this.mapData.blocks.forEach((block) => {
      const rotation = block.rotation || [0, 0, 0];
      // Simple Euler to Quaternion for Y-axis rotation (most common for map blocks)
      const cy = Math.cos(rotation[1] * 0.5);
      const sy = Math.sin(rotation[1] * 0.5);
      const cp = Math.cos(rotation[0] * 0.5);
      const sp = Math.sin(rotation[0] * 0.5);
      const cr = Math.cos(rotation[2] * 0.5);
      const sr = Math.sin(rotation[2] * 0.5);

      const q = {
        w: cr * cp * cy + sr * sp * sy,
        x: sr * cp * cy - cr * sp * sy,
        y: cr * sp * cy + sr * cp * sy,
        z: cr * cp * sy - sr * sp * cy
      };

      const bodyDesc = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(
          block.position[0],
          block.position[1],
          block.position[2]
        )
        .setRotation(q);
      const body = world.createRigidBody(bodyDesc);
      
      const colliderDesc = RAPIER.ColliderDesc.cuboid(
        block.size[0] / 2,
        block.size[1] / 2,
        block.size[2] / 2
      );
      
      // Set physics properties based on block type
      if (block.type === 'obstacle') {
        // Obstacles: solid collisions like real life - cars hit and stop/bounce realistically
        colliderDesc.setFriction(0.5); // Moderate friction - cars can slide but also grip
        colliderDesc.setRestitution(0.5); // Higher bounciness - cars bounce back further
      } else {
        // Platforms: lower friction to prevent sticking, especially for vertical surfaces
        // If platform is tall (height > 1), treat it more like an obstacle
        const isTallBlock = block.size[1] > 1;
        if (isTallBlock) {
          colliderDesc.setFriction(0.3); // Lower friction for tall blocks - cars slide off
          colliderDesc.setRestitution(0.5); // Higher bounce for tall blocks - cars bounce back further
        } else {
          // Flat platforms: normal friction for driving
          colliderDesc.setFriction(0.7);
          colliderDesc.setRestitution(0.1);
        }
      }
      
      world.createCollider(colliderDesc, body);
    });

    // Debug: verify colliders are actually created in the active world.
    try {
      const info = {
        bodies: typeof world?.bodies?.len === 'function' ? world.bodies.len() : 'n/a',
        colliders: typeof world?.colliders?.len === 'function' ? world.colliders.len() : 'n/a',
      };
      console.log('🧱 Map colliders created:', info);
      this.lastDebug.mapColliders = info;
      // Also send to clients so it’s visible in the browser console.
      this.io?.emit?.('serverDebug', { type: 'mapColliders', ...info });
    } catch (e) {
      console.warn('Map collider count debug failed:', e?.message);
    }
  }

  initializeFlags() {
    if (!this.mapData || !this.mapData.flags) {
      console.log('⚠️ No flags in map data');
      return;
    }
    
    this.flags.red.position = [...this.mapData.flags.red.position];
    this.flags.blue.position = [...this.mapData.flags.blue.position];
    this.flags.red.carriedBy = null;
    this.flags.blue.carriedBy = null;
    console.log('🚩 Flags initialized:', {
      red: this.flags.red.position,
      blue: this.flags.blue.position
    });
  }

  handleConnection(socket) {
    // Player connects but hasn't joined game yet
    // Always send a debug ping so we know the client is receiving serverDebug.
    try {
      const world = this.physicsWorld.getWorld();
      socket.emit('serverDebug', {
        type: 'connectPing',
        rapierLoaded: !!this.physicsWorld.rapierLoaded,
        hasWorld: !!world,
        mapSet: !!this.mapData,
        mapBlocks: this.mapData?.blocks?.length ?? 0,
        bodies: typeof world?.bodies?.len === 'function' ? world.bodies.len() : 'n/a',
        colliders: typeof world?.colliders?.len === 'function' ? world.colliders.len() : 'n/a',
      });

      // If map colliders were created before this client connected, resend that info too.
      if (this.lastDebug.mapColliders) {
        socket.emit('serverDebug', { type: 'mapColliders', ...this.lastDebug.mapColliders });
      }
      if (this.lastDebug.startGameWorld) {
        socket.emit('serverDebug', { type: 'startGameWorld', ...this.lastDebug.startGameWorld });
      }
    } catch (e) {
      // If even this fails, at least tell the client something.
      socket.emit('serverDebug', { type: 'connectPingError', message: e?.message || String(e) });
    }
  }

  handleDisconnection(socketId) {
    const playerId = this.players.get(socketId);
    if (playerId) {
      this.waitingPlayers.delete(socketId);
      this.readyPlayers.delete(socketId);
      this.playerManager.removePlayer(playerId);
      this.players.delete(socketId);
      
      // If game was playing and player count drops, handle appropriately
      if (this.gameState === 'playing') {
        this.checkGameEnd();
      }
    }
    
    this.broadcastGameState();
  }

  handleJoinGame(socket) {
    console.log(`🎮 handleJoinGame called for socket: ${socket.id}`);
    console.log(`  - Current game state: ${this.gameState}`);
    console.log(`  - Already waiting: ${this.waitingPlayers.has(socket.id)}`);
    console.log(`  - Current waiting players: ${this.waitingPlayers.size}`);
    
    if (this.gameState === 'playing') {
      console.log('⚠️ Game already in progress, rejecting join');
      socket.emit('error', { message: 'Game already in progress' });
      return;
    }

    if (this.waitingPlayers.has(socket.id)) {
      console.log('⚠️ Player already in waiting list');
      return; // Already waiting
    }

    this.waitingPlayers.add(socket.id);
    const playerId = socket.id;
    this.players.set(socket.id, playerId);
    
    console.log(`✅ Player ${playerId} joined. Total players: ${this.waitingPlayers.size}`);
    socket.emit('playerId', { playerId });
    console.log(`📤 Sent playerId to socket ${socket.id}`);
    
    // Broadcast immediately after player joins
    this.broadcastGameState();
    console.log('📢 Broadcasted game state');
  }

  handlePlayerReady(socketId) {
    if (this.gameState !== 'lobby' && this.gameState !== 'waiting') {
      return; // Can't ready up if game is playing or ended
    }

    if (!this.waitingPlayers.has(socketId)) {
      console.log(`Player ${socketId} tried to ready but not in lobby`);
      return; // Player not in lobby
    }

    if (this.readyPlayers.has(socketId)) {
      // Toggle ready state - unready
      this.readyPlayers.delete(socketId);
      console.log(`Player ${socketId} unready. Ready: ${this.readyPlayers.size}/${this.waitingPlayers.size}`);
    } else {
      this.readyPlayers.add(socketId);
      console.log(`Player ${socketId} ready. Ready: ${this.readyPlayers.size}/${this.waitingPlayers.size}`);
    }

    this.broadcastGameState();

    // Check if all players are ready and we have minimum players
    if (this.waitingPlayers.size >= GAME.MIN_PLAYERS && 
        this.waitingPlayers.size <= GAME.MAX_PLAYERS &&
        this.readyPlayers.size === this.waitingPlayers.size &&
        this.readyPlayers.size > 0) {
      console.log(`All players ready! Starting game...`);
      this.startGame().catch((err) => console.error('startGame failed:', err));
    }
  }

  async startGame() {
    if (!this.mapData) {
      console.error('Cannot start game: no map loaded');
      return;
    }

    // CRITICAL: ensure map colliders exist BEFORE spawning.
    await this.ensureMapReady();

    // Debug: confirm world still has colliders at game start.
    try {
      const world = this.physicsWorld.getWorld();
      const info = {
        bodies: typeof world?.bodies?.len === 'function' ? world.bodies.len() : 'n/a',
        colliders: typeof world?.colliders?.len === 'function' ? world.colliders.len() : 'n/a',
      };
      console.log('🎮 startGame physics world:', info);
      this.lastDebug.startGameWorld = info;
      this.io?.emit?.('serverDebug', { type: 'startGameWorld', ...info });
    } catch (e) {
      console.warn('startGame collider count debug failed:', e?.message);
    }

    this.gameState = 'waiting';
    this.broadcastGameState();
    
    // Assign teams
    const playerIds = Array.from(this.waitingPlayers);
    this.playerManager.assignTeams(playerIds);
    
    // Collect all spawn data first
    const allSpawns = [];
    
    // Spawn all players
    playerIds.forEach((socketId) => {
      const playerId = this.players.get(socketId);
      if (!playerId) return;
      
      // Get team from playerManager
      let playerTeam = this.playerManager.getTeamForPlayer(playerId);
      if (!playerTeam) {
        // Assign team based on index if not assigned
        playerTeam = playerIds.indexOf(socketId) % 2 === 0 ? 'red' : 'blue';
      }
      
      const spawns = this.mapData.spawnPoints[playerTeam];
      if (!spawns || spawns.length === 0) return;
      
      const spawn = spawns[Math.floor(Math.random() * spawns.length)];
      
      // Add player if not exists
      if (!this.playerManager.getPlayer(playerId)) {
        this.playerManager.addPlayer(
          playerId,
          playerTeam,
          spawn.position,
          spawn.rotation
        );
      }
      
      // Store spawn data for broadcasting
      allSpawns.push({
        playerId,
        team: playerTeam,
        position: spawn.position,
        rotation: spawn.rotation,
      });
    });
    
    // Broadcast ALL spawns to ALL clients so everyone sees all players
    allSpawns.forEach((spawnData) => {
      this.io.emit('spawn', spawnData);
      console.log(`📢 Broadcasted spawn for player ${spawnData.playerId} (${spawnData.team} team) to all clients`);
    });
    
    // Start game after brief delay
    setTimeout(() => {
      this.gameState = 'playing';
      this.scores = { red: 0, blue: 0 };
      this.broadcastGameState();
      
      // Use custom map if available, otherwise default
      const mapToUse = this.customMap ? 'customMap' : 'defaultMap.json';
      console.log(`🎮 Starting game with map: ${mapToUse}`);
      
      this.io.emit('gameStart', {
        map: mapToUse,
        scores: this.scores,
        mapData: this.customMap || null, // Send custom map data directly
      });
    }, 2000);
  }

  handlePlayerInput(socketId, inputState) {
    if (this.gameState !== 'playing') return;
    
    const playerId = this.players.get(socketId);
    if (!playerId) return;
    
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.eliminated) return;
    
    player.car.setInput(
      inputState.throttle || 0,
      inputState.brake || 0,
      inputState.steer || 0
    );
  }

  handlePlayerFall(socketId) {
    if (this.gameState !== 'playing') return;
    
    const playerId = this.players.get(socketId);
    if (!playerId) return;
    
    // Always check if player was carrying a flag and drop it
    const wasCarryingRedFlag = this.flags.red.carriedBy === playerId;
    const wasCarryingBlueFlag = this.flags.blue.carriedBy === playerId;
    
    if (wasCarryingRedFlag || wasCarryingBlueFlag) {
      console.log(`🚩 Player ${playerId} died while carrying flag, returning it`);
      this.handleFlagDrop(playerId);
    }
    
    this.playerManager.eliminatePlayer(playerId);
    this.io.to(socketId).emit('eliminated', {});
  }

  handleRespawnRequest(socketId) {
    if (this.gameState !== 'playing') return;
    
    const playerId = this.players.get(socketId);
    if (!playerId) return;
    
    const player = this.playerManager.getPlayer(playerId);
    if (!player || !this.mapData) return;
    
    // Get spawn point for player's team
    const spawns = this.mapData.spawnPoints[player.team];
    if (!spawns || spawns.length === 0) return;
    
    const spawn = spawns[Math.floor(Math.random() * spawns.length)];
    
    // Teleport player back to spawn
    player.car.respawn(spawn.position, spawn.rotation);
    
    // Broadcast spawn event to all clients so they see the teleport
    this.io.emit('spawn', {
      playerId: playerId,
      team: player.team,
      position: spawn.position,
      rotation: spawn.rotation,
    });
    
    console.log(`📢 Player ${playerId} teleported back to spawn`);
  }

  handleFlagPickup(playerId, flagTeam) {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.eliminated || player.hasFlag) return false;
    
    // Can only pick up enemy flag
    if (player.team === flagTeam) return false;
    
    // Check distance to flag
    const flag = this.flags[flagTeam];
    if (!flag.position || flag.carriedBy) return false;
    
    const playerPos = player.car.getPosition();
    const distance = Math.sqrt(
      (playerPos.x - flag.position[0]) ** 2 +
      (playerPos.y - flag.position[1]) ** 2 +
      (playerPos.z - flag.position[2]) ** 2
    );
    
    if (distance < 5) { // Pickup radius
      player.hasFlag = true;
      flag.carriedBy = playerId;
      player.car.hasFlag = true;
      
      // Broadcast flag pickup
      this.io.emit('flagUpdate', {
        team: flagTeam,
        carriedBy: playerId,
        position: null, // Flag is being carried, not at a position
      });
      console.log(`🚩 ${playerId} picked up ${flagTeam} flag!`);
      return true;
    }
    
    return false;
  }

  handleFlagDrop(playerId) {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;
    
    // Find which flag they're carrying
    let flagTeam = null;
    if (this.flags.red.carriedBy === playerId) {
      flagTeam = 'red';
    } else if (this.flags.blue.carriedBy === playerId) {
      flagTeam = 'blue';
    }
    
    if (flagTeam) {
      if (player.hasFlag) {
        player.hasFlag = false;
      }
      if (player.car) {
        player.car.hasFlag = false;
      }
      this.flags[flagTeam].carriedBy = null;
      // Flag returns to base
      this.flags[flagTeam].position = [...this.mapData.flags[flagTeam].position];
      
      // Broadcast flag return
      this.io.emit('flagUpdate', {
        team: flagTeam,
        carriedBy: null,
        position: this.flags[flagTeam].position,
      });
      console.log(`🚩 ${flagTeam} flag returned to base!`);
    }
  }

  checkFlagCapture(playerId) {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || !player.hasFlag || player.eliminated) return false;
    
    // Check if player is at their own base with enemy flag
    const enemyTeam = player.team === 'red' ? 'blue' : 'red';
    const flag = this.flags[enemyTeam];
    
    if (flag.carriedBy !== playerId) return false;
    
    // Check if at own base (use bases field if available, otherwise spawn points)
    let basePos;
    if (this.mapData.bases && this.mapData.bases[player.team]) {
      basePos = this.mapData.bases[player.team].position;
    } else {
      const baseSpawns = this.mapData.spawnPoints[player.team];
      if (!baseSpawns || baseSpawns.length === 0) return false;
      basePos = baseSpawns[0].position;
    }
    
    const playerPos = player.car.getPosition();
    const distance = Math.sqrt(
      (playerPos.x - basePos[0]) ** 2 +
      (playerPos.z - basePos[2]) ** 2  // Only check X and Z (horizontal distance)
    );
    
    if (distance < 10) { // Capture radius (must be in own base area)
      // Score!
      this.scores[player.team]++;
      console.log(`🏆 ${player.team} team scored! Score: Red ${this.scores.red} - Blue ${this.scores.blue}`);
      
      // Reset flag
      player.hasFlag = false;
      player.car.hasFlag = false;
      flag.carriedBy = null;
      flag.position = [...this.mapData.flags[enemyTeam].position];
      
      // Broadcast flag return and score
      this.io.emit('flagUpdate', {
        team: enemyTeam,
        carriedBy: null,
        position: flag.position,
      });
      this.io.emit('scoreUpdate', this.scores);
      
      // Check win condition
      if (this.scores[player.team] >= GAME.WIN_SCORE) {
        // Wait 1 second before ending game
        setTimeout(() => {
          this.endGame(player.team);
        }, 1000);
      }
      
      return true;
    }
    
    return false;
  }

  checkGameEnd() {
    // Check if game should end due to insufficient players
    const activePlayers = this.playerManager.getAllPlayers().filter(p => !p.eliminated);
    if (activePlayers.length < 2) {
      // End game if too few players
      this.endGame(null);
    }
  }

  endGame(winner) {
    this.gameState = 'ended';
    
    this.io.emit('gameEnd', {
      winner: winner || 'none',
      scores: this.scores,
    });
    
    // Reset after delay
    setTimeout(() => {
      this.resetGame();
    }, 10000);
  }

  resetGame() {
    this.gameState = 'lobby';
    this.waitingPlayers.clear();
    this.readyPlayers.clear();
    this.players.clear();
    this.playerManager = new PlayerManager(this.physicsWorld);
    this.scores = { red: 0, blue: 0 };
    this.initializeFlags();
    this.broadcastGameState();
  }

  broadcastGameState() {
    const state = {
      state: this.gameState,
      playerCount: this.waitingPlayers.size,
      maxPlayers: GAME.MAX_PLAYERS,
      readyCount: this.readyPlayers.size,
      canReady: this.waitingPlayers.size >= GAME.MIN_PLAYERS && 
                this.waitingPlayers.size <= GAME.MAX_PLAYERS &&
                (this.gameState === 'lobby' || this.gameState === 'waiting'),
    };
    console.log('Broadcasting game state:', state);
    this.io.emit('gameState', state);
  }

  startGameLoop() {
    const targetFPS = NETWORK.TICK_RATE;
    const interval = 1000 / targetFPS;
    
    this.gameLoopInterval = setInterval(() => {
      const now = Date.now();
      const deltaTime = (now - this.lastUpdate) / 1000;
      this.lastUpdate = now;

      this.serverTick += 1;
      this.serverTickMs += interval;
      
      if (this.gameState === 'playing') {
        // Update physics
        this.physicsWorld.update(deltaTime);
        
        // Create reverse map: playerId -> socketId
        const playerSocketMap = new Map();
        this.players.forEach((playerId, socketId) => {
          playerSocketMap.set(playerId, socketId);
        });
        
        // Update players (pass io for respawn broadcasts and elimination events)
        this.playerManager.update(deltaTime, this.mapData, this.io, playerSocketMap);

        // If a player gets eliminated by server-side physics (falling), ensure any carried flag
        // returns immediately. (PlayerManager can eliminate without going through handlePlayerFall.)
        this.playerManager.getAllPlayers().forEach((player) => {
          if (!player?.eliminated) return;
          if (this.flags.red.carriedBy === player.id || this.flags.blue.carriedBy === player.id) {
            this.handleFlagDrop(player.id);
          }
        });
        
        // Check flag interactions
        this.playerManager.getAllPlayers().forEach((player) => {
          if (player.eliminated) return;
          
          // Check flag pickup
          this.handleFlagPickup(player.id, 'red');
          this.handleFlagPickup(player.id, 'blue');
          
          // Check flag capture
          this.checkFlagCapture(player.id);
        });
        
        // Broadcast player states with flag info
        const playerStates = this.playerManager.getPlayerStates();
        const t = this.serverTickMs;
        Object.entries(playerStates).forEach(([playerId, s]) => {
          s.t = t;
          // Add flag carrier info
          if (this.flags.red.carriedBy === playerId) {
            s.carryingFlag = 'red';
          } else if (this.flags.blue.carriedBy === playerId) {
            s.carryingFlag = 'blue';
          } else {
            s.carryingFlag = null;
          }
        });
        this.io.emit('playerUpdate', playerStates);
        this.io.emit('snapshot', playerStates);
      }
    }, interval);
  }

  stopGameLoop() {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = null;
    }
  }
}
