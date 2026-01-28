import * as THREE from 'three';
import { PhysicsWorld } from '../physics/physicsWorld.js';
import { Car } from '../gameplay/car.js';
import { CameraController } from '../core/cameraController.js';
import { NetworkManager } from '../network/networkManager.js';
import { MapLoader } from '../gameplay/mapLoader.js';
import { InputHandler } from '../gameplay/inputHandler.js';
import { MapEditor } from '../gameplay/mapEditor.js';
import { PHYSICS } from '../../../shared/constants.js';

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
  }

  init() {
    console.log('🔧 Game.init() called');
    try {
      this.setupScene();
      console.log('✅ Scene setup complete');
      this.setupNetwork();
      console.log('✅ Network setup complete');
      this.setupUI();
      console.log('✅ UI setup complete');
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
    // Note: loadDefaultMap is synchronous, so we call it directly
    try {
      this.mapLoader.loadDefaultMap();
      console.log('✅ Default map loaded for initial view');
    } catch (error) {
      console.error('❌ Failed to load default map:', error);
    }
    
    // Add a test cube at origin to verify rendering works
    const testGeometry = new THREE.BoxGeometry(5, 5, 5);
    const testMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    const testCube = new THREE.Mesh(testGeometry, testMaterial);
    testCube.position.set(0, 5, 0);
    this.scene.add(testCube);
    console.log('🧪 Test cube added at origin (0, 5, 0) - should be visible');
    
    // Input handler
    this.inputHandler = new InputHandler();
    
    // Map editor
    this.mapEditor = new MapEditor(this.scene, this.physicsWorld);
    this.mapEditor.setCamera(this.camera);
    
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
        btn.textContent = 'Connecting...';
        
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
    
    const readyButton = document.getElementById('readyButton');
    if (readyButton) {
      readyButton.addEventListener('click', () => {
        if (this.networkManager) {
          this.networkManager.sendReady();
        }
      });
    }
    
    // Map editor button (for development/testing)
    const editorBtn = document.getElementById('editorBtn');
    if (editorBtn) {
      editorBtn.addEventListener('click', () => {
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
  }

  setupNetwork() {
    console.log('🔧 Setting up network...');
    this.networkManager = new NetworkManager();
    console.log('✅ NetworkManager created:', this.networkManager);
    
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
        joinButton.textContent = 'Joined!';
      }
      if (statusEl) {
        statusEl.textContent = 'Connected';
        statusEl.style.color = '#4CAF50';
      }
    });

    this.networkManager.on('gameState', (stateData) => {
      this.handleGameState(stateData);
    });

    this.networkManager.on('playerUpdate', (updates) => {
      // Handle other players' updates in multiplayer (server-authoritative)
      if (!this.isMultiplayer || !updates) return;

      Object.entries(updates).forEach(([playerId, state]) => {
        if (playerId === this.playerId) return; // local player handled separately

        const remote = this.remotePlayers.get(playerId);
        if (!remote) {
          // If we somehow missed the spawn event, create a simple visual now
          const team = state.team || 'red';
          this.spawnRemotePlayer({
            playerId,
            team,
            position: state.position || [0, 2, 0],
            rotation: state.rotation || [0, 0, 0],
          });
          return;
        }

        const mesh = remote.mesh;
        if (!mesh) return;

        const pos = state.position || [0, 2, 0];
        const rot = state.rotation || [0, 0, 0];

        mesh.position.set(pos[0], pos[1], pos[2]);
        mesh.rotation.set(rot[0], rot[1], rot[2]);
        mesh.visible = !state.eliminated;
      });
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
        
        if (this.networkManager.isReady) {
          if (readyButton) {
            readyButton.textContent = 'Not Ready';
            readyButton.style.background = '#f44336';
          }
        } else {
          if (readyButton) {
            readyButton.textContent = 'Ready';
            readyButton.style.background = '#4CAF50';
          }
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
        const rot = Array.isArray(rotation) ? rotation : [rotation?.x || 0, rotation?.y || 0, rotation?.z || 0];
        mesh.position.set(pos[0], pos[1], pos[2]);
        mesh.rotation.set(rot[0], rot[1], rot[2]);
        existing.team = team || existing.team;
      }
      return;
    }

    const pos = Array.isArray(position) ? position : [position.x || 0, position.y || 2, position.z || 0];

    // Simple visual representation for remote players: taller colored box matching team
    // Make it clearly above the floor so it doesn't look like a flat patch
    const geometry = new THREE.BoxGeometry(4, 2, 8);
    const color = team === 'blue' ? 0x0000ff : 0xff0000;
    const material = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Raise it slightly so the bottom sits on the platform instead of intersecting it
    mesh.position.set(pos[0], pos[1] + 1, pos[2]);

    // Apply rotation if provided
    const rot = Array.isArray(rotation) ? rotation : [rotation?.x || 0, rotation?.y || 0, rotation?.z || 0];
    mesh.rotation.set(rot[0], rot[1], rot[2]);

    mesh.userData.isRemotePlayer = true;
    mesh.userData.playerId = playerId;

    this.scene.add(mesh);
    this.remotePlayers.set(playerId, { mesh, team });

    console.log('✅ Remote player visual created:', {
      playerId,
      team,
      position: mesh.position.clone(),
      rotation: mesh.rotation.clone(),
    });
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
      this.cameraController.smoothness = 0.3;
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
    
    // Load map
    console.log('📦 Loading map:', data.map || 'defaultMap.json');
    this.mapLoader.loadMap(data.map || 'defaultMap.json').then((mapData) => {
      console.log('✅ Map loaded:', mapData);
      document.getElementById('lobby').style.display = 'none';
      document.getElementById('gameInfo').style.display = 'block';
      document.getElementById('scoreboard').style.display = 'block';
    }).catch((error) => {
      console.error('❌ Failed to load map:', error);
      // Try loading default map
      this.mapLoader.loadDefaultMap();
      document.getElementById('lobby').style.display = 'none';
      document.getElementById('gameInfo').style.display = 'block';
      document.getElementById('scoreboard').style.display = 'block';
    });

    // Update scoreboard
    this.updateScoreboard(data.scores || { red: 0, blue: 0 });
  }

  endGame(data) {
    this.gameState = 'ended';
    const winner = data.winner;
    alert(`Game Over! ${winner} team wins!`);
    
    // Reset after delay
    setTimeout(() => {
      location.reload();
    }, 5000);
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

  handleElimination() {
    if (this.car) {
      this.car.setEliminated(true);
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
      
      if (this.physicsWorld) {
        this.physicsWorld.update(deltaTime);
      }

      if (this.car) {
        // Update input from keyboard
        const inputState = this.inputHandler.getInputState();
        this.car.setInput(inputState.throttle, inputState.brake, inputState.steer);
        
        this.car.update(deltaTime);
        
        // Check for fall
        if (this.car.position.y < DEATH_THRESHOLD) {
          if (!this.car.isEliminated) {
            this.car.setEliminated(true);
            if (this.networkManager) {
              this.networkManager.sendFall();
            }
          }
        }

        // Send input to server in multiplayer
        if (this.isMultiplayer && this.networkManager) {
          this.networkManager.sendInput(this.car.getInputState());
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
