import * as THREE from 'three';
import { PhysicsWorld } from '../physics/physicsWorld.js';
import { Car } from '../gameplay/car.js';
import { CameraController } from '../core/cameraController.js';
import { NetworkManager } from '../network/networkManager.js';
import { MapLoader } from '../gameplay/mapLoader.js';
import { InputHandler } from '../gameplay/inputHandler.js';
import { MapEditor } from '../gameplay/mapEditor.js';
import { PHYSICS } from '../../../shared/constants.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const DEATH_THRESHOLD = PHYSICS.DEATH_THRESHOLD;

export class Game {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.physicsWorld = null;
    this.car = null;
    this.remotePlayers = new Map(); // playerId -> { mesh, team }
    this.cameraController = null;
    this.networkManager = null;
    this.mapLoader = null;
    this.inputHandler = null;
    this.mapEditor = null;
    this.isMultiplayer = false;
    this.playerId = null;
    this.team = null;
    this.gameState = 'lobby'; // lobby, waiting, playing, ended
    this.respawnTime = 0; // Timestamp when player will respawn
    this.respawnTimerInterval = null;
    
    this.animationFrameId = null;
    this.lastTime = 0;

    // Cache car models for remote players (per team)
    this.remoteCarTemplates = { red: null, blue: null };
    this.remoteCarTemplatePromises = { red: null, blue: null };

    // Snapshot interpolation: estimate server-time -> local-time offset
    this.netTimeOffsetMs = null; // localNow - serverNow (smoothed)

    // Audio
    this.backgroundMusic = null; // HTML Audio fallback
    this.deathSound = null; // HTML Audio fallback
    this.audioUnlocked = false;
    this.musicEnabled = true;
    this.pendingDeathSound = false;
    this.lastMusicLoopAt = 0;
    this.audioCtx = null;
    this.bgBuffer = null;
    this.bgSource = null;
    this.bgGain = null;
    this.deathBuffer = null;
    this.useWebAudio = true; // Try Web Audio first, fallback to HTML Audio
  }

  init() {
    console.log('🔧 Game.init() called');
    try {
      this.setupScene();
      console.log('✅ Scene setup complete');
      // Start rendering immediately (needed for lobby/editor views too)
      if (!this.animationFrameId) {
        console.log('🎬 Starting animation loop (no car yet)');
        this.animate();
      }
      this.setupNetwork();
      console.log('✅ Network setup complete');
      this.setupUI();
      console.log('✅ UI setup complete');
      this.setupAudio();
      console.log('✅ Audio setup complete');
    } catch (error) {
      console.error('❌ Error in init():', error);
      throw error;
    }
  }

  setupScene() {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Sky blue
    this.scene.fog = new THREE.Fog(0x87ceeb, 100, 500);
    console.log('🌍 Scene created');

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    // Set initial camera position (will be updated when car spawns)
    // Position camera to see the origin where things spawn
    this.camera.position.set(0, 10, 15);
    this.camera.lookAt(0, 2, 0); // Look at spawn height
    console.log('📷 Camera initialized at:', this.camera.position, 'looking at:', [0, 2, 0]);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const appElement = document.getElementById('app');
    if (appElement) {
      appElement.appendChild(this.renderer.domElement);
      console.log('✅ Renderer added to DOM');
    } else {
      console.error('❌ App element not found!');
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    this.scene.add(directionalLight);

    // Physics world
    this.physicsWorld = new PhysicsWorld();
    this.physicsWorld.init().catch(err => {
      console.error('Failed to initialize physics world:', err);
    });

    // Map loader
    this.mapLoader = new MapLoader(this.scene, this.physicsWorld);
    
    // Load a simple default map immediately for testing
    // This ensures something is visible even before game starts
    this.mapLoader.loadDefaultMap().then(() => {
      console.log('✅ Default map loaded for initial view');
    }).catch((error) => {
      console.error('❌ Failed to load default map:', error);
    });
    
    // Input handler
    this.inputHandler = new InputHandler();
    
    // Map editor
    this.mapEditor = new MapEditor(this.scene, this.physicsWorld);
    this.mapEditor.setCamera(this.camera);
    this.mapEditor.setDomElement?.(this.renderer.domElement);
    // Set callbacks after network is set up (in setupNetwork)
    
    // Camera controller
    this.cameraController = new CameraController(this.camera);

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());
  }

  setupUI() {
    console.log('🔧 Setting up UI...');
    console.log('NetworkManager exists at setupUI time:', !!this.networkManager);
    
    const joinButton = document.getElementById('joinButton');
    if (!joinButton) {
      console.error('❌ Join button not found!');
      console.log('Available buttons:', document.querySelectorAll('button').length);
      console.log('Document body:', document.body.innerHTML.substring(0, 200));
      return;
    }
    
    console.log('✅ Join button found:', joinButton);
    console.log('Button text:', joinButton.textContent);
    
    // Remove any existing listeners
    const newButton = joinButton.cloneNode(true);
    joinButton.parentNode.replaceChild(newButton, joinButton);
    const btn = document.getElementById('joinButton');
    
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('🔵🔵🔵 Join button clicked! 🔵🔵🔵');
      console.log('Event:', e);
      console.log('NetworkManager exists:', !!this.networkManager);
      console.log('NetworkManager:', this.networkManager);
      
      if (!this.networkManager) {
        console.error('❌ NetworkManager is null!');
        alert('Network manager not initialized. Please refresh the page.');
        return;
      }
      
      console.log('Calling networkManager.joinGame()...');
      try {
        this.networkManager.joinGame();
        btn.disabled = true;
        // Change button image to show connecting state
        const img = btn.querySelector('img');
        if (img) {
          img.style.opacity = '0.5';
        }
        
        // Update connection status
        const statusEl = document.getElementById('connectionStatus');
        if (statusEl) {
          statusEl.textContent = 'Connecting to server...';
          statusEl.style.color = '#ff9800';
        }
        console.log('✅ joinGame() called successfully');
      } catch (error) {
        console.error('❌ Error calling joinGame:', error);
        console.error('Error stack:', error.stack);
        alert('Error joining game: ' + error.message);
      }
    });
    
    console.log('✅ Join button handler attached successfully');

    // Lobby Map Editor button (blank editor session)
    const lobbyEditorBtn = document.getElementById('lobbyEditorBtn');
    if (lobbyEditorBtn) {
      lobbyEditorBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.enterMapEditorFromLobby();
      });
    }
    
    const readyButton = document.getElementById('readyButton');
    const notReadyButton = document.getElementById('notReadyButton');
    if (readyButton) {
      readyButton.addEventListener('click', () => {
        if (this.networkManager) {
          this.networkManager.sendReady();
        }
      });
    }
    if (notReadyButton) {
      notReadyButton.addEventListener('click', () => {
        if (this.networkManager) {
          this.networkManager.sendReady();
        }
      });
    }
    
    // Map editor button (disabled during gameplay, only works in lobby)
    const editorBtn = document.getElementById('editorBtn');
    if (editorBtn) {
      editorBtn.addEventListener('click', () => {
        // Only allow editor in lobby, not during gameplay
        if (this.gameState !== 'lobby' && this.gameState !== 'waiting') {
          alert('Map editor is only available in the lobby. Please wait for the game to end.');
          return;
        }
        if (this.mapEditor) {
          if (this.mapEditor.isEditing) {
            this.mapEditor.stopEditing();
            editorBtn.textContent = 'Open Map Editor';
          } else {
            this.mapEditor.startEditing();
            editorBtn.textContent = 'Close Map Editor';
          }
        }
      });
    }

    // Back to spawn button
    const respawnBtn = document.getElementById('respawnBtn');
    if (respawnBtn) {
      respawnBtn.addEventListener('click', () => {
        // Only allow respawn during gameplay
        if (this.gameState !== 'playing') {
          return;
        }
        if (this.networkManager) {
          this.networkManager.sendRespawnRequest();
        }
      });
    }
  }

  enterMapEditorFromLobby() {
    console.log('🗺️ Entering Map Editor from lobby (blank map)');

    // Hide lobby UI, show only editor overlay UI
    const lobby = document.getElementById('lobby');
    if (lobby) lobby.style.display = 'none';
    const gameInfo = document.getElementById('gameInfo');
    const scoreboard = document.getElementById('scoreboard');
    if (gameInfo) gameInfo.style.display = 'none';
    if (scoreboard) scoreboard.style.display = 'none';

    // Make sure no car / remote players are displayed
    if (this.car) {
      this.car.destroy?.();
      this.car = null;
    }
    this.remotePlayers?.forEach?.((remote) => {
      if (remote?.mesh) this.scene?.remove?.(remote.mesh);
      if (remote?.flagIndicator) this.scene?.remove?.(remote.flagIndicator);
    });
    this.remotePlayers?.clear?.();

    // Clear any map objects that were loaded for the initial view
    this.mapLoader?.clearMap?.();

    // Start editor in blank mode (MapEditor will create its own ground/grid)
    if (this.mapEditor) {
      this.mapEditor.startEditing({ blank: true });
    } else {
      console.warn('⚠️ mapEditor is not initialized');
    }

    // Ensure render loop is running (editor needs it even without a car)
    if (!this.animationFrameId) {
      console.log('🎬 Starting animation loop (editor)');
      this.animate();
    }
  }

  returnToLobbyFromEditor() {
    console.log('🏠 Returning to lobby from editor');
    
    // Show lobby UI
    const lobby = document.getElementById('lobby');
    if (lobby) lobby.style.display = 'flex';
    
    // Hide game UI elements
    const gameInfo = document.getElementById('gameInfo');
    const scoreboard = document.getElementById('scoreboard');
    if (gameInfo) gameInfo.style.display = 'none';
    if (scoreboard) scoreboard.style.display = 'none';
    
    // Re-enable map editor button (we're back in lobby)
    const editorBtn = document.getElementById('editorBtn');
    if (editorBtn) {
      editorBtn.disabled = false;
      editorBtn.style.opacity = '1';
      editorBtn.style.cursor = 'pointer';
    }
    
    // Clear editor objects but keep the scene ready
    // (MapEditor.stopEditing already handles cleanup)
  }

  setupNetwork() {
    console.log('🔧 Setting up network...');
    this.networkManager = new NetworkManager();
    console.log('✅ NetworkManager created:', this.networkManager);
    
    // Wire up map editor to network manager
    if (this.mapEditor) {
      this.mapEditor.setNetworkManager(this.networkManager);
      this.mapEditor.setReturnToLobbyCallback(() => {
        this.returnToLobbyFromEditor();
      });
    }
    
    this.networkManager.on('socketConnected', () => {
      console.log('📡 Socket connected event received');
      const statusEl = document.getElementById('connectionStatus');
      if (statusEl) {
        statusEl.textContent = 'Connected to server';
        statusEl.style.color = '#4CAF50';
      }
    });
    
    this.networkManager.on('connected', (data) => {
      this.playerId = data.playerId;
      console.log('✅ Connected as player:', this.playerId);
      const joinButton = document.getElementById('joinButton');
      const statusEl = document.getElementById('connectionStatus');
      if (joinButton) {
        // Change button image to joined state
        const img = joinButton.querySelector('img');
        if (img) {
          img.src = '/images/joinedButton.png';
          img.style.opacity = '1';
        }
        joinButton.disabled = true;
      }
      if (statusEl) {
        statusEl.textContent = 'Connected';
        statusEl.style.color = '#4CAF50';
      }
    });

    this.networkManager.on('gameState', (stateData) => {
      this.handleGameState(stateData);
    });

    const applySnapshot = (updates) => {
      if (!this.isMultiplayer || !updates) return;

      // Update local player from server snapshot (minimal multiplayer style)
      const myState = this.playerId ? updates[this.playerId] : null;
      if (myState && Number.isFinite(Number(myState.t))) {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const st = Number(myState.t);
        const estOffset = now - st;
        this.netTimeOffsetMs = (this.netTimeOffsetMs == null) ? estOffset : (this.netTimeOffsetMs * 0.9 + estOffset * 0.1);
      }
      if (myState && this.car && typeof this.car.applyServerState === 'function') {
        this.car.applyServerState(myState);
        this.car.setEliminated?.(!!myState.eliminated);
        // Update flag visual on local car
        if (myState.carryingFlag) {
          console.log('🚩 Local player carrying flag:', myState.carryingFlag);
        }
        this.updateCarFlagVisual(this.car, myState.carryingFlag);
      }

      // Update remote players
      Object.entries(updates).forEach(([playerId, state]) => {
        if (playerId === this.playerId) return;

        const remote = this.remotePlayers.get(playerId);
        if (!remote) {
          // If we somehow missed the spawn event, create a simple visual now
          const team = state.team || 'red';
          this.spawnRemotePlayer({
            playerId,
            team,
            position: state.position || [0, 2, 0],
            rotation: state.rotation || [0, 0, 0, 1],
          });
          return;
        }

        const mesh = remote.mesh;
        if (!mesh) return;

        const pos = state.position || [0, 2, 0];
        // Store snapshot history for interpolation (prevents big-turn jitter)
        remote.netHistory = remote.netHistory || [];
        remote.netRenderDelayMs = remote.netRenderDelayMs ?? 150;
        remote.netSmoothedPos = remote.netSmoothedPos || null;
        remote.netSmoothedQuat = remote.netSmoothedQuat || null;
        const nowLocal = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const st = Number(state.t);
        const nowServer = (Number.isFinite(st) ? st : ((this.netTimeOffsetMs == null) ? nowLocal : (nowLocal - this.netTimeOffsetMs)));
        remote.netHistory.push({
          t: nowServer,
          pos: new THREE.Vector3(pos[0], pos[1], pos[2]),
          rot: state.rotation || [0, 0, 0, 1],
        });
        if (remote.netHistory.length > 10) remote.netHistory.splice(0, remote.netHistory.length - 10);

        mesh.visible = !state.eliminated;
        
        // Update flag visual on remote player
        this.updateRemoteFlagVisual(remote, state.carryingFlag);
      });
    };

    // Legacy (main server) + minimal-style event (minimal server pattern)
    // IMPORTANT: Our server currently emits BOTH `playerUpdate` and `snapshot` each tick.
    // Feeding both into interpolation buffers causes jitter (especially on sharp turns).
    // Prefer `snapshot`, but fall back to `playerUpdate` if snapshot isn't used.
    this._usingSnapshotEvent = false;
    this.networkManager.on('snapshot', (updates) => {
      this._usingSnapshotEvent = true;
      applySnapshot(updates);
    });
    this.networkManager.on('playerUpdate', (updates) => {
      if (this._usingSnapshotEvent) return;
      applySnapshot(updates);
    });

    this.networkManager.on('spawn', (data) => {
      this.spawnPlayer(data);
    });

    this.networkManager.on('eliminated', () => {
      this.handleElimination();
    });

    this.networkManager.on('gameStart', (data) => {
      this.startGame(data);
    });

    this.networkManager.on('gameEnd', (data) => {
      this.endGame(data);
    });

    this.networkManager.on('scoreUpdate', (scores) => {
      this.updateScoreboard(scores);
    });

    this.networkManager.on('flagUpdate', (data) => {
      this.handleFlagUpdate(data);
    });

    this.networkManager.on('serverDebug', (data) => {
      console.log('🧩 serverDebug:', data);
    });
  }

  handleFlagUpdate(data) {
    const { team, carriedBy, position } = data;
    console.log(`🚩 Flag update: ${team} flag`, carriedBy ? `carried by ${carriedBy}` : `at base`);
    
    if (this.mapLoader) {
      if (carriedBy) {
        // Flag is being carried - hide it at the base
        this.mapLoader.setFlagVisible(team, false);
      } else if (position) {
        // Flag returned to base - show it and update position
        this.mapLoader.setFlagVisible(team, true);
        this.mapLoader.updateFlagPosition(team, position);
      }
    }
  }

  // Create flag indicator mesh (reusable)
  createFlagIndicator() {
    const flagGroup = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, 4, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(0, 2, 0);
    
    const bannerGeo = new THREE.PlaneGeometry(2, 1.2);
    const bannerMat = new THREE.MeshStandardMaterial({ 
      color: 0xff0000, 
      side: THREE.DoubleSide,
      emissive: 0xff0000,
      emissiveIntensity: 0.6
    });
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(1, 3.4, 0);
    
    flagGroup.add(pole);
    flagGroup.add(banner);
    flagGroup.visible = false;
    
    return { flagGroup, banner };
  }

  // Update flag visual on local player's car
  updateCarFlagVisual(car, carryingFlag) {
    if (!car) return;
    
    // Get or create flag indicator mesh - add to scene, update position in render loop
    if (!car.flagIndicator) {
      const { flagGroup, banner } = this.createFlagIndicator();
      car.flagIndicator = flagGroup;
      car.flagBanner = banner;
      car.carryingFlagTeam = null;
      this.scene.add(flagGroup);
    }
    
    car.carryingFlagTeam = carryingFlag;
    
    if (carryingFlag) {
      // Show flag with correct color
      const color = carryingFlag === 'red' ? 0xff0000 : 0x0000ff;
      car.flagBanner.material.color.setHex(color);
      car.flagBanner.material.emissive.setHex(color);
      car.flagIndicator.visible = true;
    } else {
      car.flagIndicator.visible = false;
    }
  }

  // Update flag visual on remote players
  updateRemoteFlagVisual(remote, carryingFlag) {
    if (!remote) return;
    
    // Get or create flag indicator mesh - add to scene, update position in render loop
    if (!remote.flagIndicator) {
      const { flagGroup, banner } = this.createFlagIndicator();
      remote.flagIndicator = flagGroup;
      remote.flagBanner = banner;
      remote.carryingFlagTeam = null;
      this.scene.add(flagGroup);
    }
    
    remote.carryingFlagTeam = carryingFlag;
    
    if (carryingFlag) {
      // Show flag with correct color
      const color = carryingFlag === 'red' ? 0xff0000 : 0x0000ff;
      remote.flagBanner.material.color.setHex(color);
      remote.flagBanner.material.emissive.setHex(color);
      remote.flagIndicator.visible = true;
    } else {
      remote.flagIndicator.visible = false;
    }
  }

  // Update flag positions to follow cars (called in render loop)
  updateFlagIndicatorPositions() {
    // Update local car's flag position
    if (this.car && this.car.flagIndicator && this.car.carryingFlagTeam) {
      const carPos = this.car.position || (this.car.tempMesh ? this.car.tempMesh.position : null);
      if (carPos) {
        this.car.flagIndicator.position.set(carPos.x, carPos.y + 2, carPos.z);
      }
    }
    
    // Update remote players' flag positions
    this.remotePlayers.forEach((remote) => {
      if (remote.flagIndicator && remote.carryingFlagTeam && remote.mesh) {
        const meshPos = remote.mesh.position;
        remote.flagIndicator.position.set(meshPos.x, meshPos.y + 2, meshPos.z);
      }
    });
  }

  handleGameState(stateData) {
    console.log('Game state update:', stateData);
    const playerCountEl = document.getElementById('playerCount');
    const readySection = document.getElementById('readySection');
    const readyButton = document.getElementById('readyButton');
    const readyStatus = document.getElementById('readyStatus');
    const readyCountEl = document.getElementById('readyCount');
    const totalPlayersEl = document.getElementById('totalPlayers');
    
    const gameState = stateData.state || 'lobby';
    const playerCount = stateData.playerCount || 0;
    const readyCount = stateData.readyCount || 0;
    const canReady = stateData.canReady || false;
    
    if (playerCountEl) {
      playerCountEl.textContent = `Players: ${playerCount}/${this.networkManager.maxPlayers || 10}`;
    }
    
    if (gameState === 'waiting' || gameState === 'lobby') {
      if (canReady && playerCount >= 2) {
        if (readySection) {
          readySection.style.display = 'block';
        }
        if (readyButton) {
          readyButton.disabled = false;
        }
        if (readyCountEl) readyCountEl.textContent = readyCount;
        if (totalPlayersEl) totalPlayersEl.textContent = playerCount;
        
        const notReadyButton = document.getElementById('notReadyButton');
        if (this.networkManager.isReady) {
          if (readyButton) readyButton.style.display = 'none';
          if (notReadyButton) notReadyButton.style.display = 'inline-block';
        } else {
          if (readyButton) readyButton.style.display = 'inline-block';
          if (notReadyButton) notReadyButton.style.display = 'none';
        }
      } else {
        if (readySection) readySection.style.display = 'none';
        if (playerCount < 2 && playerCountEl) {
          playerCountEl.textContent = `Waiting for players... (${playerCount}/2)`;
        }
      }
    } else {
      if (readySection) readySection.style.display = 'none';
    }
  }

  spawnPlayer(data) {
    console.log('🎮 spawnPlayer called:', data);
    console.log('  - playerId:', data.playerId, 'my playerId:', this.playerId);
    console.log('  - position:', data.position);
    console.log('  - rotation:', data.rotation);
    if (data.playerId === this.playerId) {
      console.log('✅ This is my spawn! Creating car...');
      this.team = data.team;
      this.createCar(data.position, data.rotation);
      this.updateUI();
      
      // Hide respawn overlay if it's showing
      const respawnOverlay = document.getElementById('respawnOverlay');
      if (respawnOverlay) {
        respawnOverlay.style.display = 'none';
      }
      if (this.respawnTimerInterval) {
        clearInterval(this.respawnTimerInterval);
        this.respawnTimerInterval = null;
      }
    } else {
      console.log('👀 Spawn event for remote player, creating visual car:', data.playerId);
      this.spawnRemotePlayer(data);
    }
  }

  spawnRemotePlayer(data) {
    const { playerId, team, position, rotation } = data;

    // If remote player already exists, update position/rotation instead of creating new one
    if (this.remotePlayers.has(playerId)) {
      console.log('ℹ️ Remote player already exists, updating position:', playerId);
      const existing = this.remotePlayers.get(playerId);
      const mesh = existing.mesh;
      if (mesh) {
        const pos = Array.isArray(position) ? position : [position.x || 0, position.y || 2, position.z || 0];
        const rot = Array.isArray(rotation) ? rotation : [rotation?.x || 0, rotation?.y || 0, rotation?.z || 0, rotation?.w ?? 1];
        mesh.position.set(pos[0], pos[1], pos[2]);
        if (Array.isArray(rot) && rot.length === 4) {
          mesh.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
        } else {
          mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
        }
        existing.team = team || existing.team;
      }
      return;
    }

    const pos = Array.isArray(position) ? position : [position.x || 0, position.y || 2, position.z || 0];

    // Load the real car model for remote players (same as local), then clone it per player.
    const rot = Array.isArray(rotation) ? rotation : [rotation?.x || 0, rotation?.y || 0, rotation?.z || 0, rotation?.w ?? 1];
    this.loadRemoteCarTemplate(team || 'red').then((template) => {
      const obj = template.clone(true);
      obj.position.set(pos[0], pos[1], pos[2]);
      if (rot.length === 4) {
        obj.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
      } else {
        obj.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
      }
      obj.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      obj.userData.isRemotePlayer = true;
      obj.userData.playerId = playerId;
      this.scene.add(obj);
      this.remotePlayers.set(playerId, { mesh: obj, team: team || 'red' });
    }).catch((err) => {
      console.warn('⚠️ Failed to load remote car model, using box fallback:', err);
      const geometry = new THREE.BoxGeometry(4, 2, 8);
      const color = team === 'blue' ? 0x0000ff : 0xff0000;
      const material = new THREE.MeshStandardMaterial({ color });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(pos[0], pos[1] + 1, pos[2]);
      if (rot.length === 4) {
        mesh.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
      } else {
        mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
      }
      this.scene.add(mesh);
      this.remotePlayers.set(playerId, { mesh, team: team || 'red' });
    });
  }

  loadRemoteCarTemplate(team) {
    const t = team === 'blue' ? 'blue' : 'red';
    if (this.remoteCarTemplates[t]) return Promise.resolve(this.remoteCarTemplates[t]);
    if (this.remoteCarTemplatePromises[t]) return this.remoteCarTemplatePromises[t];

    const modelPath = t === 'blue' ? '/models/blueCar.glb' : '/models/redCar.glb';
    const loader = new GLTFLoader();
    this.remoteCarTemplatePromises[t] = new Promise((resolve, reject) => {
      loader.load(
        modelPath,
        (gltf) => {
          const scene = gltf.scene;
          // Match the same sizing logic as local car: scale to target length 8.
          const box = new THREE.Box3().setFromObject(scene);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const targetZ = 8;
          const scale = targetZ / Math.max(0.0001, size.z);
          scene.scale.set(scale, scale, scale);
          scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
          this.remoteCarTemplates[t] = scene;
          resolve(scene);
        },
        undefined,
        (err) => reject(err)
      );
    });
    return this.remoteCarTemplatePromises[t];
  }

  createCar(position, rotation) {
    if (this.car) {
      this.car.destroy();
    }

    // Convert arrays to Three.js objects if needed
    let posVector, rotEuler;
    if (Array.isArray(position)) {
      posVector = new THREE.Vector3(position[0], position[1], position[2]);
    } else if (position instanceof THREE.Vector3) {
      posVector = position;
    } else {
      posVector = new THREE.Vector3(position.x || 0, position.y || 5, position.z || 0);
    }
    
    if (Array.isArray(rotation)) {
      rotEuler = new THREE.Euler(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
    } else if (rotation instanceof THREE.Euler) {
      rotEuler = rotation;
    } else {
      rotEuler = new THREE.Euler(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    }

    console.log('🚗 Creating car at position:', posVector, 'rotation:', rotEuler);
    console.log('  - Team:', this.team);
    console.log('  - Scene children before:', this.scene.children.length);
    this.car = new Car(this.scene, this.physicsWorld, posVector, rotEuler, this.team);
    console.log('✅ Car created:', this.car);
    console.log('  - Scene children after:', this.scene.children.length);
    console.log('  - Car position:', this.car.position);
    console.log('  - Car tempMesh:', this.car.tempMesh);
    if (this.car.tempMesh) {
      console.log('  - TempMesh position:', this.car.tempMesh.position);
      console.log('  - TempMesh visible:', this.car.tempMesh.visible);
      console.log('  - TempMesh in scene:', this.scene.children.includes(this.car.tempMesh));
      console.log('  - TempMesh parent:', this.car.tempMesh.parent);
      console.log('  - TempMesh material:', this.car.tempMesh.material);
      const worldPos = new THREE.Vector3();
      this.car.tempMesh.getWorldPosition(worldPos);
      console.log('  - TempMesh world position:', worldPos);
      
      // Try to make it even more visible
      this.car.tempMesh.visible = true;
      // Team color is already set in Car constructor, don't override it
      this.car.tempMesh.updateMatrixWorld(true);
    } else {
      console.log('  - ⚠️ TempMesh is null!');
    }
    console.log('  - Car model:', this.car.model);
    console.log('  - Car mesh:', this.car.mesh);
    
    // Immediately update camera to look at car - position it directly behind and above
    // Use a simple offset that works regardless of rotation
    this.camera.position.set(
      posVector.x + 5,  // To the side
      posVector.y + 10, // Above
      posVector.z + 15  // Behind
    );
    this.camera.lookAt(posVector);
    this.camera.updateProjectionMatrix();
    console.log('📷 Camera moved to:', this.camera.position, 'looking at:', posVector);
    console.log('  - Distance from car:', this.camera.position.distanceTo(posVector));
    
    // Temporarily disable camera controller to see car immediately
    this.cameraController.smoothness = 1.0; // Instant movement
    
    this.cameraController.setTarget(this.car);
    console.log('✅ Camera target set to car');
    
    // Force camera update immediately
    this.cameraController.update();
    
    // Restore smoothness after a moment
    setTimeout(() => {
      this.cameraController.positionSmoothness = 0.4;
      this.cameraController.rotationSmoothness = 0.3;
    }, 2000);
    
    // Start game loop
    if (!this.animationFrameId) {
      console.log('🎬 Starting animation loop');
      this.animate();
    }
  }

  startGame(data) {
    console.log('🎮 startGame called:', data);
    this.gameState = 'playing';
    this.isMultiplayer = true;
    
    // Don't auto-start music here; it's handled on page load or by the sound button
    
    // Disable map editor button during gameplay
    const editorBtn = document.getElementById('editorBtn');
    if (editorBtn) {
      editorBtn.disabled = true;
      editorBtn.style.opacity = '0.5';
      editorBtn.style.cursor = 'not-allowed';
    }

    // Hide respawn button initially (will show when flipped)
    const respawnBtnOverlay = document.getElementById('respawnBtnOverlay');
    if (respawnBtnOverlay) {
      respawnBtnOverlay.style.display = 'none';
    }
    
    // Use custom map data if provided, otherwise load from file
    if (data.mapData) {
      console.log('📦 Using custom map data from server');
      this.mapLoader.clearMap();
      this.mapLoader.createMapGeometry(data.mapData);
      this.mapLoader.createFlags(data.mapData).then(() => {
        console.log('✅ Custom map loaded');
        document.getElementById('lobby').style.display = 'none';
        document.getElementById('gameInfo').style.display = 'block';
        document.getElementById('scoreboard').style.display = 'block';
      });
    } else {
      // Load map from file
      const mapName = data.map || 'defaultMap.json';
      console.log('📦 Loading map:', mapName);
      console.log('📦 Scene children BEFORE loading map:', this.scene.children.length);
      
      this.mapLoader.loadMap(mapName).then((mapData) => {
        console.log('✅ Map loaded:', mapData);
        console.log('📦 Scene children AFTER loading map:', this.scene.children.length);
        console.log('🚩 Flags after map load:', { 
          red: !!this.mapLoader.flags.red, 
          blue: !!this.mapLoader.flags.blue 
        });
        
        // Debug: List all flags in scene
        let flagCount = 0;
        this.scene.traverse((obj) => {
          if (obj.userData && obj.userData.isFlag) {
            flagCount++;
            const worldPos = new THREE.Vector3();
            obj.getWorldPosition(worldPos);
            console.log(`🚩 Flag in scene after load: team=${obj.userData.team}, pos=`, worldPos);
          }
        });
        console.log(`🚩 Total flags in scene: ${flagCount}`);
        
        document.getElementById('lobby').style.display = 'none';
        document.getElementById('gameInfo').style.display = 'block';
        document.getElementById('scoreboard').style.display = 'block';
      }).catch((error) => {
        console.error('❌ Failed to load map:', error);
        // Try loading default map
        this.mapLoader.loadDefaultMap().then(() => {
          console.log('📦 Default map loaded as fallback');
          console.log('📦 Scene children after fallback:', this.scene.children.length);
          document.getElementById('lobby').style.display = 'none';
          document.getElementById('gameInfo').style.display = 'block';
          document.getElementById('scoreboard').style.display = 'block';
        }).catch((err) => {
          console.error('❌ Failed to load default map:', err);
          document.getElementById('lobby').style.display = 'none';
          document.getElementById('gameInfo').style.display = 'block';
          document.getElementById('scoreboard').style.display = 'block';
        });
      });
    }

    // Update scoreboard
    this.updateScoreboard(data.scores || { red: 0, blue: 0 });
  }

  endGame(data) {
    this.gameState = 'ended';
    const winner = data.winner;
    const scores = data.scores || { red: 0, blue: 0 };
    
    // Re-enable map editor button when game ends (will return to lobby)
    const editorBtn = document.getElementById('editorBtn');
    if (editorBtn) {
      editorBtn.disabled = false;
      editorBtn.style.opacity = '1';
      editorBtn.style.cursor = 'pointer';
    }
    
    // Hide game UI
    const gameInfo = document.getElementById('gameInfo');
    const scoreboard = document.getElementById('scoreboard');
    const respawnBtnOverlay = document.getElementById('respawnBtnOverlay');
    if (gameInfo) gameInfo.style.display = 'none';
    if (scoreboard) scoreboard.style.display = 'none';
    if (respawnBtnOverlay) respawnBtnOverlay.style.display = 'none';
    
    // Show win/lose overlay
    const overlay = document.getElementById('gameEndOverlay');
    const victoryBg = document.getElementById('victoryBackground');
    const defeatBg = document.getElementById('defeatBackground');
    const title = document.getElementById('gameEndTitle');
    const message = document.getElementById('gameEndMessage');
    const scoresEl = document.getElementById('gameEndScores');
    const returnBtn = document.getElementById('returnToLobby');
    
    if (overlay && message && scoresEl) {
      // Determine if player won
      const playerWon = winner && winner === this.team;
      
      // Show appropriate background (title is in background image)
      if (playerWon) {
        if (victoryBg) victoryBg.style.display = 'block';
        if (defeatBg) defeatBg.style.display = 'none';
        message.textContent = `Your team (${winner.toUpperCase()}) captured 3 flags!`;
        message.style.color = this.team === 'red' ? '#ff4444' : '#4444ff';
      } else if (winner && winner !== 'none') {
        if (victoryBg) victoryBg.style.display = 'none';
        if (defeatBg) defeatBg.style.display = 'block';
        message.textContent = `${winner.toUpperCase()} team captured 3 flags!`;
        message.style.color = '#ccc';
      } else {
        if (victoryBg) victoryBg.style.display = 'none';
        if (defeatBg) defeatBg.style.display = 'block';
        message.textContent = 'The game has ended.';
        message.style.color = '#ccc';
      }
      
      scoresEl.innerHTML = `
        <div class="team-score red-team" style="margin-bottom: 10px;">Red: ${scores.red}</div>
        <div class="team-score blue-team">Blue: ${scores.blue}</div>
      `;
      
      overlay.style.display = 'block';
      
      // Return to lobby button
      if (returnBtn) {
        returnBtn.onclick = () => {
          location.reload();
        };
        // Add hover effect
        const img = returnBtn.querySelector('img');
        if (img) {
          returnBtn.addEventListener('mouseenter', () => {
            img.style.transform = 'scale(1.05)';
          });
          returnBtn.addEventListener('mouseleave', () => {
            img.style.transform = 'scale(1)';
          });
        }
      }
    }
  }

  updateUI() {
    if (this.team) {
      document.getElementById('teamName').textContent = this.team.toUpperCase();
      document.getElementById('teamName').style.color = this.team === 'red' ? '#ff4444' : '#4444ff';
    }
  }

  updateScoreboard(scores) {
    document.getElementById('redScore').textContent = scores.red || 0;
    document.getElementById('blueScore').textContent = scores.blue || 0;
  }

  updateRespawnButtonVisibility() {
    const respawnBtnOverlay = document.getElementById('respawnBtnOverlay');
    if (!respawnBtnOverlay || !this.car || this.gameState !== 'playing') {
      if (respawnBtnOverlay) respawnBtnOverlay.style.display = 'none';
      return;
    }

    // Don't show button if car is below platform (falling/eliminated)
    // Platform top is at Y=0.5, so check if car is above Y=-5 (reasonable threshold)
    const carPos = this.car.position || (this.car.tempMesh ? this.car.tempMesh.position : null);
    if (!carPos || carPos.y < -5) {
      respawnBtnOverlay.style.display = 'none';
      return;
    }

    // Check if car is flipped by checking the car's up vector
    let carQuaternion;
    const visual = this.car.model || this.car.mesh || this.car.tempMesh;
    if (visual?.quaternion) {
      carQuaternion = visual.quaternion.clone();
    } else if (this.car.rigidBody) {
      const rot = this.car.rigidBody.rotation();
      carQuaternion = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    } else {
      // Fallback to Euler rotation
      const targetRotation = this.car.rotation || new THREE.Euler(0, 0, 0);
      carQuaternion = new THREE.Quaternion().setFromEuler(targetRotation);
    }

    // Calculate the car's up vector (Y axis in local space)
    const up = new THREE.Vector3(0, 1, 0);
    up.applyQuaternion(carQuaternion);

    // Car is flipped if up vector Y component is negative (pointing down)
    // Use a threshold (0.3) to account for slight tilts
    const isFlipped = up.y < 0.3;

    // Show overlay only when flipped AND above platform
    respawnBtnOverlay.style.display = isFlipped ? 'block' : 'none';
  }

  setupAudio() {
    // Initialize background music (Web Audio for gapless loop)
    this.initBackgroundMusic();

    // Initialize death sound (Web Audio buffer)
    this.initDeathSound();

    // Set up sound button toggle
    const soundButton = document.getElementById('soundButton');
    if (soundButton) {
      soundButton.addEventListener('click', () => {
        this.audioUnlocked = true;
        if (this.pendingDeathSound) {
          this.pendingDeathSound = false;
          this.playDeathSound();
        }
        this.toggleMusic();
      });
      this.updateSoundButton();
    }

    // Unlock audio on first user interaction (required by browsers)
    const unlockAudio = () => {
      this.audioUnlocked = true;
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      if (this.pendingDeathSound) {
        this.pendingDeathSound = false;
        this.playDeathSound();
      }
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });
  }

  async initBackgroundMusic() {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const audioPath = '/audio/RagetrackBackground.mp3';
      console.log('Loading background music from:', audioPath);
      const response = await fetch(audioPath);
      if (!response.ok) {
        console.error(`Failed to load background music (Web Audio) from ${audioPath}:`, response.status, response.statusText);
        this.useWebAudio = false;
        this.initBackgroundMusicHTML();
        return;
      }
      const arrayBuffer = await response.arrayBuffer();
      this.bgBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
      console.log('Background music loaded successfully (Web Audio)');
      this.startBackgroundMusic();
    } catch (err) {
      console.error('Background music load failed (Web Audio), using HTML Audio fallback:', err);
      this.useWebAudio = false;
      this.initBackgroundMusicHTML();
    }
  }

  initBackgroundMusicHTML() {
    // HTML Audio fallback
    this.backgroundMusic = new Audio('/audio/RagetrackBackground.mp3');
    this.backgroundMusic.loop = true;
    this.backgroundMusic.volume = 0.5;
    this.backgroundMusic.preload = 'auto';
    this.backgroundMusic.addEventListener('play', () => {
      this.audioUnlocked = true;
      this.updateSoundButton();
    });
    this.backgroundMusic.addEventListener('pause', () => {
      this.updateSoundButton();
    });
    this.startBackgroundMusic();
  }

  async initDeathSound() {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const audioPath = '/audio/deathSound.mp3';
      console.log('Loading death sound from:', audioPath);
      const response = await fetch(audioPath);
      if (!response.ok) {
        console.error(`Failed to load death sound (Web Audio) from ${audioPath}:`, response.status, response.statusText);
        // HTML Audio fallback will be created on-demand in playDeathSound
        return;
      }
      const arrayBuffer = await response.arrayBuffer();
      this.deathBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
      console.log('Death sound loaded successfully (Web Audio)');
    } catch (err) {
      console.error('Death sound load failed (Web Audio), will use HTML Audio fallback:', err);
    }
  }

  startBackgroundMusic() {
    if (!this.musicEnabled || !this.audioUnlocked) {
      this.updateSoundButton();
      return;
    }
    
    if (this.useWebAudio && this.audioCtx && this.bgBuffer) {
      // Use Web Audio
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      if (this.bgSource) {
        this.updateSoundButton();
        return;
      }
      this.bgSource = this.audioCtx.createBufferSource();
      this.bgSource.buffer = this.bgBuffer;
      this.bgSource.loop = true;
      this.bgGain = this.audioCtx.createGain();
      this.bgGain.gain.value = 0.5;
      this.bgSource.connect(this.bgGain).connect(this.audioCtx.destination);
      this.bgSource.start(0);
    } else if (this.backgroundMusic) {
      // Use HTML Audio fallback
      if (this.backgroundMusic.paused) {
        this.backgroundMusic.play().catch(err => {
          console.log('Could not play background music:', err);
        });
      }
    }
    this.updateSoundButton();
  }

  stopBackgroundMusic() {
    if (this.useWebAudio && this.bgSource) {
      try {
        this.bgSource.stop(0);
      } catch (e) {
        // ignore
      }
      this.bgSource.disconnect();
      this.bgSource = null;
    } else if (this.backgroundMusic) {
      this.backgroundMusic.pause();
    }
    this.updateSoundButton();
  }

  toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    if (this.musicEnabled) {
      this.startBackgroundMusic();
    } else {
      this.stopBackgroundMusic();
    }
    this.updateSoundButton();
  }

  updateSoundButton() {
    const soundButton = document.getElementById('soundButton');
    if (soundButton) {
      let isPlaying = false;
      if (this.useWebAudio) {
        isPlaying = this.musicEnabled && !!this.bgSource;
      } else {
        isPlaying = this.musicEnabled && this.backgroundMusic && !this.backgroundMusic.paused;
      }
      
      if (!isPlaying) {
        soundButton.textContent = '🔇';
        soundButton.title = 'Start Music';
      } else {
        soundButton.textContent = '🔊';
        soundButton.title = 'Stop Music';
      }
    }
  }

  playDeathSound() {
    if (!this.audioUnlocked) {
      this.pendingDeathSound = true;
      return;
    }
    
    // Try Web Audio first (gapless)
    if (this.audioCtx && this.deathBuffer) {
      try {
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
        }
        const source = this.audioCtx.createBufferSource();
        source.buffer = this.deathBuffer;
        const gain = this.audioCtx.createGain();
        gain.gain.value = 0.7;
        source.connect(gain).connect(this.audioCtx.destination);
        source.start(0);
        return;
      } catch (err) {
        console.error('Web Audio death sound failed:', err);
      }
    }
    
    // Fallback to HTML Audio
    try {
      const sound = new Audio('/audio/deathSound.mp3');
      sound.volume = 0.7;
      sound.play().catch(err => {
        console.error('Could not play death sound:', err);
      });
    } catch (err) {
      console.error('Failed to create death sound:', err);
    }
  }

  handleElimination() {
    if (this.car) {
      this.car.setEliminated(true);
      // Hide flag indicator when eliminated
      this.updateCarFlagVisual(this.car, null);
    }

    // Play death sound
    this.playDeathSound();

    // Hide respawn button when eliminated
    const respawnBtnOverlay = document.getElementById('respawnBtnOverlay');
    if (respawnBtnOverlay) {
      respawnBtnOverlay.style.display = 'none';
    }
    
    // Show respawn overlay with countdown
    const respawnOverlay = document.getElementById('respawnOverlay');
    const respawnTimer = document.getElementById('respawnTimer');
    
    if (respawnOverlay && respawnTimer) {
      respawnOverlay.style.display = 'block';
      
      // Set respawn time (5 seconds from now)
      this.respawnTime = Date.now() + 5000;
      
      // Clear any existing timer
      if (this.respawnTimerInterval) {
        clearInterval(this.respawnTimerInterval);
      }
      
      // Update countdown every 100ms for smooth display
      this.respawnTimerInterval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((this.respawnTime - Date.now()) / 1000));
        respawnTimer.textContent = remaining;
        
        // Hide overlay when respawn time is reached
        if (remaining === 0) {
          clearInterval(this.respawnTimerInterval);
          this.respawnTimerInterval = null;
          respawnOverlay.style.display = 'none';
        }
      }, 100);
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate(currentTime = 0) {
    this.animationFrameId = requestAnimationFrame((time) => {
      const deltaTime = Math.min((time - this.lastTime) / 1000, 0.1);
      this.lastTime = time;

      // Map editor camera controls need per-frame update for damping.
      if (this.mapEditor?.isEditing && this.mapEditor.controls) {
        this.mapEditor.controls.update();
      }

      if (this.car) {
        // Update input from keyboard
        const inputState = this.inputHandler.getInputState();
        this.car.setInput(inputState.throttle, inputState.brake, inputState.steer);

        // Minimal-style multiplayer: server simulates, client only renders snapshots.
        if (!this.isMultiplayer) {
          if (this.physicsWorld) {
            this.physicsWorld.update(deltaTime);
          }
          this.car.update(deltaTime);
        } else {
          // Smoothly render the latest server snapshot (prevents shaky/laggy feeling)
          this.car.interpolateFromNetwork?.(deltaTime);

          // Smooth remote players too (snapshot interpolation with small render delay)
          this.remotePlayers.forEach((remote) => {
            if (!remote?.mesh || !remote.netHistory || remote.netHistory.length === 0) return;
            const nowLocal = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const nowServer = (this.netTimeOffsetMs == null) ? nowLocal : (nowLocal - this.netTimeOffsetMs);
            const renderT = nowServer - (remote.netRenderDelayMs || 0);

            let a = null;
            let b = null;
            for (let i = 0; i < remote.netHistory.length; i++) {
              const s = remote.netHistory[i];
              if (s.t <= renderT) a = s;
              if (s.t >= renderT) { b = s; break; }
            }
            if (!a) a = remote.netHistory[0];
            if (!b) b = remote.netHistory[remote.netHistory.length - 1];

            let alpha = 0;
            const span = (b.t - a.t);
            if (span > 0.0001) alpha = Math.max(0, Math.min(1, (renderT - a.t) / span));

            const interpPos = a.pos.clone().lerp(b.pos, alpha);

            const qa = new THREE.Quaternion();
            const qb = new THREE.Quaternion();
            const ra = a.rot;
            const rb = b.rot;
            if (Array.isArray(ra) && ra.length === 4) qa.set(ra[0], ra[1], ra[2], ra[3]);
            else if (Array.isArray(ra) && ra.length >= 3) qa.setFromEuler(new THREE.Euler(ra[0], ra[1], ra[2]));
            if (Array.isArray(rb) && rb.length === 4) qb.set(rb[0], rb[1], rb[2], rb[3]);
            else if (Array.isArray(rb) && rb.length >= 3) qb.setFromEuler(new THREE.Euler(rb[0], rb[1], rb[2]));

            const interpQuat = qa.slerp(qb, alpha);

            // Apply exponential smoothing to reduce jitter/shaking
            const smoothingFactor = 0.3; // Lower = smoother but more lag
            if (!remote.netSmoothedPos) {
              remote.netSmoothedPos = interpPos.clone();
              remote.netSmoothedQuat = interpQuat.clone();
            } else {
              remote.netSmoothedPos.lerp(interpPos, smoothingFactor);
              remote.netSmoothedQuat.slerp(interpQuat, smoothingFactor);
            }

            remote.mesh.position.copy(remote.netSmoothedPos);
            remote.mesh.quaternion.copy(remote.netSmoothedQuat);
          });
        }
        
        // Check for fall
        if (this.car.position.y < DEATH_THRESHOLD) {
          if (!this.car.isEliminated) {
            // Play death sound when falling
            this.playDeathSound();
            this.car.setEliminated(true);
            // Hide flag indicator when falling
            this.updateCarFlagVisual(this.car, null);
            if (this.networkManager) {
              this.networkManager.sendFall();
            }
          }
        }

        // Check if car is flipped and show/hide respawn button
        this.updateRespawnButtonVisibility();

        // Send input to server in multiplayer
        if (this.isMultiplayer && this.networkManager) {
          this.networkManager.sendInput(inputState);
        }
      } else {
        // Log once per second if no car
        if (Math.floor(time / 1000) !== Math.floor((time - deltaTime * 1000) / 1000)) {
          console.log('⚠️ No car in scene. Waiting for spawn...');
        }
      }

      if (this.cameraController && this.car) {
        // Only update camera if we have a car
        this.cameraController.update();
        
        // Debug: Log camera position occasionally to see if it's updating
        if (Math.floor(time / 3000) !== Math.floor((time - deltaTime * 1000) / 3000)) {
          console.log('📷 Camera debug:', {
            position: this.camera.position,
            carPosition: this.car.position,
            distance: this.camera.position.distanceTo(this.car.position)
          });
        }
      }

      // Always render, even if no car (for debugging)
      if (this.renderer && this.scene && this.camera) {
        try {
          this.renderer.render(this.scene, this.camera);
          
          // Update flag indicator positions to follow cars
          this.updateFlagIndicatorPositions();
          
          // Debug: Log scene children count occasionally
          if (Math.floor(time / 2000) !== Math.floor((time - deltaTime * 1000) / 2000)) {
            const carPos = this.car?.position;
            const tempMeshPos = this.car?.tempMesh?.position;
            const distance = carPos ? this.camera.position.distanceTo(carPos) : null;
            const tempMeshInScene = this.car?.tempMesh ? this.scene.children.includes(this.car.tempMesh) : false;
            
            console.log('📊 Scene stats:', {
              children: this.scene.children.length,
              hasCar: !!this.car,
              carPos: carPos,
              tempMeshPos: tempMeshPos,
              tempMeshVisible: this.car?.tempMesh?.visible,
              tempMeshInScene: tempMeshInScene,
              tempMeshExists: !!this.car?.tempMesh,
              cameraPos: this.camera.position,
              distanceToCar: distance,
              sceneChildren: this.scene.children.map(c => c.type || c.constructor.name).slice(0, 10)
            });
            
            // If tempMesh exists but not visible, try to fix it
            if (this.car?.tempMesh && !this.car.tempMesh.visible) {
              console.warn('⚠️ TempMesh exists but not visible, forcing visible...');
              this.car.tempMesh.visible = true;
              this.car.tempMesh.updateMatrixWorld(true);
            }
            
            // If tempMesh exists but not in scene, re-add it
            if (this.car?.tempMesh && !tempMeshInScene) {
              console.warn('⚠️ TempMesh exists but not in scene, re-adding...');
              this.scene.add(this.car.tempMesh);
            }
          }
        } catch (error) {
          console.error('Render error:', error);
        }
      }
      
      // Continue animation loop
      this.animate(time);
    });
  }

  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.respawnTimerInterval) {
      clearInterval(this.respawnTimerInterval);
      this.respawnTimerInterval = null;
    }
    if (this.car) {
      this.car.destroy();
    }
    if (this.physicsWorld) {
      this.physicsWorld.destroy();
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}
