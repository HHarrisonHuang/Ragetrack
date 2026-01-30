import { Car } from './car.js';
import { GAME, PHYSICS } from '../../shared/constants.js';

const DEATH_THRESHOLD = PHYSICS.DEATH_THRESHOLD;

export class PlayerManager {
  constructor(physicsWorld) {
    this.physicsWorld = physicsWorld;
    this.players = new Map(); // playerId -> Player
    this.teams = {
      red: [],
      blue: [],
    };
  }

  addPlayer(playerId, team, spawnPosition, spawnRotation) {
    // Ensure physics world is ready
    if (!this.physicsWorld.rapierLoaded) {
      console.warn('Physics world not ready, delaying player creation');
      // Try again after a short delay
      setTimeout(() => {
        this.addPlayer(playerId, team, spawnPosition, spawnRotation);
      }, 100);
      return null;
    }
    
    const car = new Car(this.physicsWorld, spawnPosition, spawnRotation);
    const player = {
      id: playerId,
      team,
      car,
      hasFlag: false,
      eliminated: false,
      invincibleUntil: 0,
      respawnTime: 0,
    };
    
    this.players.set(playerId, player);
    this.teams[team].push(playerId);
    
    return player;
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      player.car.destroy();
      this.players.delete(playerId);
      
      // Remove from team
      const teamIndex = this.teams[player.team].indexOf(playerId);
      if (teamIndex > -1) {
        this.teams[player.team].splice(teamIndex, 1);
      }
    }
  }

  getPlayer(playerId) {
    return this.players.get(playerId);
  }

  getAllPlayers() {
    return Array.from(this.players.values());
  }

  assignTeams(playerIds) {
    // Randomly and evenly assign players to teams
    const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
    this.teams.red = [];
    this.teams.blue = [];
    
    shuffled.forEach((playerId, index) => {
      const team = index % 2 === 0 ? 'red' : 'blue';
      this.teams[team].push(playerId);
    });
  }
  
  getTeamForPlayer(playerId) {
    if (this.teams.red.includes(playerId)) return 'red';
    if (this.teams.blue.includes(playerId)) return 'blue';
    return null;
  }

  update(deltaTime, mapData, io, playerSocketMap) {
    const currentTime = Date.now();
    
    this.players.forEach((player) => {
      // Update car physics
      player.car.update(deltaTime);
      
      // Check for elimination (falling)
      const position = player.car.getPosition();
      if (position.y < DEATH_THRESHOLD && !player.eliminated) {
        this.eliminatePlayer(player.id);
        
        // Emit 'eliminated' event to the player's socket
        if (io && playerSocketMap) {
          const socketId = playerSocketMap.get(player.id);
          if (socketId) {
            console.log(`💀 Server detected fall for player ${player.id}, emitting 'eliminated' to socket ${socketId}`);
            io.to(socketId).emit('eliminated', {});
          }
        }
      }
      
      // Handle respawn
      if (player.eliminated && player.respawnTime > 0 && currentTime >= player.respawnTime) {
        const respawnData = this.respawnPlayer(player.id, mapData);
        
        // Broadcast respawn to all clients
        if (respawnData && respawnData.respawned && io) {
          io.emit('spawn', {
            playerId: player.id,
            team: respawnData.team,
            position: respawnData.position,
            rotation: respawnData.rotation,
          });
          console.log(`📢 Player ${player.id} respawned`);
        }
      }
    });
  }

  eliminatePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player || player.eliminated) return;
    
    player.eliminated = true;
    player.respawnTime = Date.now() + GAME.RESPAWN_DELAY * 1000;
    
    // Drop flag if carrying
    if (player.hasFlag) {
      player.hasFlag = false;
      return { droppedFlag: true, team: player.team };
    }
    
    return { eliminated: true };
  }

  respawnPlayer(playerId, mapData) {
    const player = this.players.get(playerId);
    if (!player) return;
    
    // Get spawn point for player's team
    const spawns = mapData.spawnPoints[player.team];
    if (!spawns || spawns.length === 0) return;
    
    const spawn = spawns[Math.floor(Math.random() * spawns.length)];
    
    // Respawn car
    player.car.respawn(spawn.position, spawn.rotation);
    player.eliminated = false;
    player.invincibleUntil = Date.now() + GAME.INVINCIBILITY_DURATION * 1000;
    
    return { 
      respawned: true,
      team: player.team,
      position: spawn.position,
      rotation: spawn.rotation
    };
  }

  getPlayerStates() {
    const states = {};
    this.players.forEach((player) => {
      const position = player.car.getPosition();
      const rotation = player.car.getRotation();
      states[player.id] = {
        position: [position.x, position.y, position.z],
        // Server rotation is a quaternion (x, y, z, w)
        rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
        team: player.team, // Include team in state updates
        hasFlag: player.hasFlag,
        eliminated: player.eliminated,
        invincible: Date.now() < player.invincibleUntil,
      };
    });
    return states;
  }
}
