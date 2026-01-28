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
    
    this.scores = { red: 0, blue: 0 };
    this.flags = {
      red: { position: null, carriedBy: null },
      blue: { position: null, carriedBy: null },
    };
    
    this.lastUpdate = Date.now();
    this.gameLoopInterval = null;
    
    // Start game loop
    this.startGameLoop();
  }

  setMap(mapData) {
    this.mapData = mapData;
    this.createMapColliders().catch(err => {
      console.error('Error creating map colliders:', err);
    });
    this.initializeFlags();
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
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
        block.position[0],
        block.position[1],
        block.position[2]
      );
      const body = world.createRigidBody(bodyDesc);
      
      const colliderDesc = RAPIER.ColliderDesc.cuboid(
        block.size[0] / 2,
        block.size[1] / 2,
        block.size[2] / 2
      );
      world.createCollider(colliderDesc, body);
    });
  }

  initializeFlags() {
    if (!this.mapData || !this.mapData.flags) return;
    
    this.flags.red.position = this.mapData.flags.red.position;
    this.flags.blue.position = this.mapData.flags.blue.position;
  }

  handleConnection(socket) {
    // Player connects but hasn't joined game yet
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
      this.startGame();
    }
  }

  startGame() {
    if (!this.mapData) {
      console.error('Cannot start game: no map loaded');
      return;
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
      
      this.io.emit('gameStart', {
        map: 'defaultMap.json',
        scores: this.scores,
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
    
    const result = this.playerManager.eliminatePlayer(playerId);
    
    if (result && result.droppedFlag) {
      this.handleFlagDrop(playerId);
    }
    
    this.io.to(socketId).emit('eliminated', {});
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
    
    if (distance < 3) { // Pickup radius
      player.hasFlag = true;
      flag.carriedBy = playerId;
      player.car.hasFlag = true;
      return true;
    }
    
    return false;
  }

  handleFlagDrop(playerId) {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || !player.hasFlag) return;
    
    // Find which flag they're carrying
    let flagTeam = null;
    if (this.flags.red.carriedBy === playerId) {
      flagTeam = 'red';
    } else if (this.flags.blue.carriedBy === playerId) {
      flagTeam = 'blue';
    }
    
    if (flagTeam) {
      player.hasFlag = false;
      player.car.hasFlag = false;
      this.flags[flagTeam].carriedBy = null;
      // Flag returns to base
      this.flags[flagTeam].position = this.mapData.flags[flagTeam].position;
    }
  }

  checkFlagCapture(playerId) {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || !player.hasFlag || player.eliminated) return false;
    
    // Check if player is at their own base with enemy flag
    const enemyTeam = player.team === 'red' ? 'blue' : 'red';
    const flag = this.flags[enemyTeam];
    
    if (flag.carriedBy !== playerId) return false;
    
    // Check if at base (simplified - check distance to base spawn)
    const baseSpawns = this.mapData.spawnPoints[player.team];
    if (!baseSpawns || baseSpawns.length === 0) return false;
    
    const basePos = baseSpawns[0].position;
    const playerPos = player.car.getPosition();
    const distance = Math.sqrt(
      (playerPos.x - basePos[0]) ** 2 +
      (playerPos.y - basePos[1]) ** 2 +
      (playerPos.z - basePos[2]) ** 2
    );
    
    if (distance < 5) { // Capture radius
      // Score!
      this.scores[player.team]++;
      
      // Reset flag
      this.handleFlagDrop(playerId);
      this.flags[enemyTeam].position = this.mapData.flags[enemyTeam].position;
      
      // Check win condition
      if (this.scores[player.team] >= GAME.WIN_SCORE) {
        this.endGame(player.team);
      } else {
        this.io.emit('scoreUpdate', this.scores);
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
      
      if (this.gameState === 'playing') {
        // Update physics
        this.physicsWorld.update(deltaTime);
        
        // Update players (pass io for respawn broadcasts)
        this.playerManager.update(deltaTime, this.mapData, this.io);
        
        // Check flag interactions
        this.playerManager.getAllPlayers().forEach((player) => {
          if (player.eliminated) return;
          
          // Check flag pickup
          this.handleFlagPickup(player.id, 'red');
          this.handleFlagPickup(player.id, 'blue');
          
          // Check flag capture
          this.checkFlagCapture(player.id);
        });
        
        // Broadcast player states
        const playerStates = this.playerManager.getPlayerStates();
        this.io.emit('playerUpdate', playerStates);
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
