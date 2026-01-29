import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class MapEditor {
  constructor(scene, physicsWorld, onSave) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.onSave = onSave;
    this.networkManager = null;
    this.onReturnToLobby = null;
    
    this.blocks = [];
    this.selectedBlock = null;
    this.gridSize = 1;
    this.snapToGrid = true;
    
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.camera = null;
    this.domElement = null;
    this.controls = null;
    
    this.isEditing = false;
    this.currentBlockType = 'platform';
    this.currentRotation = 0; // 0, 90, 180, 270 degrees

    // Editor tools
    this.currentTool = 'block'; // block | spawn | flag | base
    this.currentTeam = 'red'; // for spawn/flag/base

    // Spawn + flag markers
    this.spawnPoints = { red: null, blue: null }; // { position:[x,y,z], rotation:[x,y,z] }
    this.flags = { red: null, blue: null }; // { position:[x,y,z] }
    this.markers = {
      spawn: { red: null, blue: null },
      flag: { red: null, blue: null },
    };

    // Editor-only helpers (ground/grid)
    this.editorObjects = [];

    // Bind handlers so removeEventListener works
    this._onMouseMove = (e) => this.onMouseMove(e);
    this._onMouseClick = (e) => this.onMouseClick(e);
    this._onKeyDown = (e) => this.onKeyDown(e);
    this._onContextMenu = (e) => {
      if (this.isEditing) e.preventDefault();
    };
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('click', this._onMouseClick);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('contextmenu', this._onContextMenu);
  }

  setCamera(camera) {
    this.camera = camera;
  }

  setDomElement(domElement) {
    this.domElement = domElement;
  }

  setNetworkManager(networkManager) {
    this.networkManager = networkManager;
  }

  setReturnToLobbyCallback(callback) {
    this.onReturnToLobby = callback;
  }

  startEditing(options = {}) {
    this.isEditing = true;
    if (options.blank) {
      this.startNewBlankMap();
    }
    this.enableEditorCameraControls();
    this.showEditorUI();
  }

  stopEditing() {
    this.isEditing = false;
    this.disableEditorCameraControls();
    this.cleanupEditorHelpers();
    this.hideEditorUI();
  }

  showEditorUI() {
    // Create editor UI overlay
    const editorDiv = document.createElement('div');
    editorDiv.id = 'mapEditor';
    editorDiv.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 20px;
      border-radius: 5px;
      font-family: Arial, sans-serif;
      z-index: 1000;
    `;
    editorDiv.innerHTML = `
      <h3>Map Editor</h3>
      <div style="margin-top: 10px;">
        <label>Tool: </label>
        <select id="editorTool">
          <option value="block">Blocks</option>
          <option value="base">Base (colored)</option>
          <option value="spawn">Spawn</option>
          <option value="flag">Flag</option>
        </select>
      </div>
      <div style="margin-top: 10px;">
        <label>Team: </label>
        <select id="editorTeam">
          <option value="red">Red</option>
          <option value="blue">Blue</option>
        </select>
      </div>
      <div>
        <label>Block Type: </label>
        <select id="blockType">
          <option value="platform">Platform</option>
          <option value="ramp">Ramp</option>
          <option value="obstacle">Obstacle</option>
        </select>
      </div>
      <div style="margin-top: 10px;">
        <label>Rotation: </label>
        <button id="rotateBtn">Rotate (${this.currentRotation}°)</button>
      </div>
      <div style="margin-top: 10px;">
        <button id="deleteBtn">Delete Selected</button>
      </div>
      <div style="margin-top: 10px;">
        <button id="saveBtn">Save Map</button>
        <button id="loadBtn">Load Map</button>
        <button id="loadDefaultBtn">Load Default Map</button>
      </div>
      <div style="margin-top: 10px;">
        <button id="playBtn" style="background: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">▶ Play</button>
      </div>
      <div style="margin-top: 10px;">
        <button id="validateBtn">Validate Map</button>
      </div>
      <div style="margin-top: 10px;">
        <label>Grid Snap: </label>
        <input type="checkbox" id="gridSnap" checked>
      </div>
      <div style="margin-top: 20px; font-size: 12px;">
        <p>Controls:</p>
        <p>Click: Place/Select block</p>
        <p>Tool=Spawn/Flag/Base: Click to set position</p>
        <p>Mouse: Orbit camera (drag), Wheel: zoom</p>
        <p>R: Rotate block</p>
        <p>Delete: Remove block</p>
        <p>ESC: Exit editor</p>
      </div>
    `;
    document.body.appendChild(editorDiv);

    const toolSel = document.getElementById('editorTool');
    if (toolSel) {
      toolSel.value = this.currentTool;
      toolSel.addEventListener('change', (e) => {
        this.currentTool = e.target.value;
      });
    }
    const teamSel = document.getElementById('editorTeam');
    if (teamSel) {
      teamSel.value = this.currentTeam;
      teamSel.addEventListener('change', (e) => {
        this.currentTeam = e.target.value;
      });
    }
    
    document.getElementById('blockType').addEventListener('change', (e) => {
      this.currentBlockType = e.target.value;
    });
    
    document.getElementById('rotateBtn').addEventListener('click', () => {
      this.rotateBlock();
    });
    
    document.getElementById('deleteBtn').addEventListener('click', () => {
      this.deleteSelected();
    });
    
    document.getElementById('saveBtn').addEventListener('click', () => {
      this.saveMap();
    });
    
    document.getElementById('loadBtn').addEventListener('click', () => {
      this.loadMap();
    });
    
    document.getElementById('loadDefaultBtn').addEventListener('click', () => {
      this.loadDefaultMap();
    });
    
    document.getElementById('validateBtn').addEventListener('click', () => {
      this.validateMap();
    });
    
    document.getElementById('gridSnap').addEventListener('change', (e) => {
      this.snapToGrid = e.target.checked;
    });
    
    document.getElementById('playBtn').addEventListener('click', () => {
      this.playMap();
    });
  }

  hideEditorUI() {
    const editorDiv = document.getElementById('mapEditor');
    if (editorDiv) {
      editorDiv.remove();
    }
  }

  onMouseMove(event) {
    if (!this.isEditing || !this.camera) return;
    
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Update preview block position
    this.updatePreview();
  }

  onMouseClick(event) {
    if (!this.isEditing) return;
    
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);
    
    if (event.button === 0) { // Left click
      if (intersects.length > 0) {
        const intersect = intersects[0];
        const object = intersect.object;
        
        // Tool actions that don't select blocks
        if (this.currentTool === 'spawn') {
          this.setSpawnPoint(this.currentTeam, intersect.point);
          return;
        }
        if (this.currentTool === 'flag') {
          this.setFlagPosition(this.currentTeam, intersect.point);
          return;
        }
        if (this.currentTool === 'base') {
          this.placeBaseBlock(this.currentTeam, intersect.point);
          return;
        }

        // Check if clicking on existing block
        const block = this.blocks.find(b => b.mesh === object);
        if (block) {
          // Special case: the starter floor platform should not prevent placing blocks.
          // If user is in block tool and clicks the foundation, place a block instead of selecting the floor.
          if (this.currentTool === 'block' && block.isFoundation) {
            this.placeBlock(intersect.point, intersect.face?.normal || new THREE.Vector3(0, 1, 0), null);
            return;
          }
          // If placing obstacle on another obstacle, place on top instead of selecting
          if (this.currentTool === 'block' && this.currentBlockType === 'obstacle' && block.type === 'obstacle') {
            this.placeBlock(intersect.point, intersect.face?.normal || new THREE.Vector3(0, 1, 0), block);
            return;
          }
          this.selectBlock(block);
        } else {
          // Place new block
          const normal = intersect.face?.normal || new THREE.Vector3(0, 1, 0);
          this.placeBlock(intersect.point, normal, null);
        }
      }
    } else if (event.button === 2) { // Right click
      // Deselect
      this.deselectBlock();
    }
  }

  onKeyDown(event) {
    if (!this.isEditing) return;
    
    switch (event.key.toLowerCase()) {
      case 'r':
        this.rotateBlock();
        break;
      case 'delete':
      case 'backspace':
        this.deleteSelected();
        break;
      case 'escape':
        this.stopEditing();
        break;
    }
  }

  updatePreview() {
    // Show preview of where block will be placed
    // This could be enhanced with a ghost block visualization
  }

  placeBlock(position, normal, clickedBlock = null) {
    let pos = position.clone();
    
    // Default block size
    let size;
    if (this.currentBlockType === 'ramp') {
      size = [5, 1, 5];
    } else if (this.currentBlockType === 'obstacle') {
      size = [2, 2, 2]; // Obstacles are cube-shaped
    } else {
      size = [5, 1, 5]; // Platform
    }
    
    // Handle obstacle placement
    if (this.currentBlockType === 'obstacle') {
      if (clickedBlock && clickedBlock.type === 'obstacle') {
        // Clicked on another obstacle - place on top of it
        pos.y = clickedBlock.position[1] + clickedBlock.size[1] / 2 + size[1] / 2;
      } else {
        // Place on surface (default platform is at y=0.5 center, height 1, so top is at y=1.0)
        // For obstacles, place so bottom sits on the surface (center at y=1.0 + size[1]/2)
        pos.y = Math.max(1.0, pos.y) + size[1] / 2;
      }
    } else {
      // For platforms/ramps: align with default platform (below grid line)
      // Default platform center is at y=0, height=1, so top surface is at y=0.5
      // Grid is at y=0.51 (above the platform)
      // Place new platform so its top aligns with the clicked surface, but ensure it's below grid
      // If clicking on default platform or below, align top at y=0.5 (matching default platform)
      const defaultPlatformTop = 0.5;
      const gridY = 0.51;
      
      // Calculate where the top of the new platform should be
      let targetTopY = Math.max(pos.y, defaultPlatformTop);
      
      // Ensure it's below the grid line
      if (targetTopY >= gridY) {
        targetTopY = defaultPlatformTop;
      }
      
      // Set center position so top aligns with targetTopY
      pos.y = targetTopY - size[1] / 2;
    }
    
    if (this.snapToGrid) {
      pos.x = Math.round(pos.x / this.gridSize) * this.gridSize;
      pos.y = Math.round(pos.y / this.gridSize) * this.gridSize;
      pos.z = Math.round(pos.z / this.gridSize) * this.gridSize;
    }
    
    // Create visual block
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    let color = 0x888888; // Default gray
    if (this.currentBlockType === 'ramp') {
      color = 0x8888ff;
    } else if (this.currentBlockType === 'obstacle') {
      color = 0x666666; // Darker gray for obstacles
    }
    const material = new THREE.MeshStandardMaterial({ 
      color,
      wireframe: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(pos);
    mesh.rotation.y = (this.currentRotation * Math.PI) / 180;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.isMapObject = true;
    this.scene.add(mesh);
    
    // Create physics collider
    const world = this.physicsWorld.getWorld();
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
      pos.x,
      pos.y,
      pos.z
    );
    const body = world.createRigidBody(bodyDesc);
    
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      size[0] / 2,
      size[1] / 2,
      size[2] / 2
    );
    const collider = world.createCollider(colliderDesc, body);
    
    const block = {
      type: this.currentBlockType,
      position: [pos.x, pos.y, pos.z],
      size: size,
      rotation: [0, this.currentRotation * Math.PI / 180, 0],
      mesh,
      body,
      collider,
    };
    
    this.blocks.push(block);
    this.selectBlock(block);
  }

  selectBlock(block) {
    this.deselectBlock();
    this.selectedBlock = block;
    
    // Highlight selected block
    if (block.mesh) {
      block.mesh.material.emissive = new THREE.Color(0x444444);
    }
  }

  deselectBlock() {
    if (this.selectedBlock && this.selectedBlock.mesh) {
      this.selectedBlock.mesh.material.emissive = new THREE.Color(0x000000);
    }
    this.selectedBlock = null;
  }

  rotateBlock() {
    if (this.selectedBlock) {
      this.currentRotation = (this.currentRotation + 90) % 360;
      this.selectedBlock.rotation[1] = (this.currentRotation * Math.PI) / 180;
      this.selectedBlock.mesh.rotation.y = this.selectedBlock.rotation[1];
      
      // Update UI
      const rotateBtn = document.getElementById('rotateBtn');
      if (rotateBtn) {
        rotateBtn.textContent = `Rotate (${this.currentRotation}°)`;
      }
    }
  }

  deleteSelected() {
    if (!this.selectedBlock) return;
    
    const index = this.blocks.indexOf(this.selectedBlock);
    if (index > -1) {
      // Remove visual
      this.scene.remove(this.selectedBlock.mesh);
      this.selectedBlock.mesh.geometry.dispose();
      this.selectedBlock.mesh.material.dispose();
      
      // Remove physics
      const world = this.physicsWorld.getWorld();
      world.removeRigidBody(this.selectedBlock.body);
      
      this.blocks.splice(index, 1);
      this.selectedBlock = null;
    }
  }

  validateMap() {
    const errors = [];
    const warnings = [];
    
    // Check for overlapping blocks
    for (let i = 0; i < this.blocks.length; i++) {
      for (let j = i + 1; j < this.blocks.length; j++) {
        const block1 = this.blocks[i];
        const block2 = this.blocks[j];
        
        const distance = Math.sqrt(
          (block1.position[0] - block2.position[0]) ** 2 +
          (block1.position[1] - block2.position[1]) ** 2 +
          (block1.position[2] - block2.position[2]) ** 2
        );
        
        if (distance < 1) {
          errors.push(`Blocks at ${block1.position} and ${block2.position} overlap`);
        }
      }
    }
    
    // Check for required objects (spawn + flags)
    if (!this.spawnPoints.red || !this.spawnPoints.blue) {
      errors.push('Missing spawn point(s): set both red and blue spawns');
    }
    if (!this.flags.red || !this.flags.blue) {
      errors.push('Missing flag position(s): set both red and blue flags');
    }
    // Check for symmetry (simplified check)
    const redBlocks = this.blocks.filter(b => b.position[0] < 0);
    const blueBlocks = this.blocks.filter(b => b.position[0] > 0);
    
    if (Math.abs(redBlocks.length - blueBlocks.length) > 2) {
      warnings.push('Map may not be symmetric');
    }
    
    // Display results
    let message = '';
    if (errors.length > 0) {
      message += 'Errors:\n' + errors.join('\n') + '\n\n';
    }
    if (warnings.length > 0) {
      message += 'Warnings:\n' + warnings.join('\n') + '\n\n';
    }
    if (errors.length === 0 && warnings.length === 0) {
      message = 'Map validation passed!';
    }
    
    alert(message || 'No issues found');
  }

  saveMap() {
    // Export in the same schema the game expects.
    const baseRed = this.blocks.find(b => b.type === 'base' && b.team === 'red') || null;
    const baseBlue = this.blocks.find(b => b.type === 'base' && b.team === 'blue') || null;

    const mapData = {
      blocks: this.blocks
        .filter(b => b.type !== 'base')
        .map(block => ({
          type: block.type,
          position: block.position,
          size: block.size,
          rotation: block.rotation,
        })),
      bases: {
        red: baseRed ? { position: baseRed.position, size: baseRed.size } : { position: [-40, 0.6, 0], size: [15, 0.2, 14] },
        blue: baseBlue ? { position: baseBlue.position, size: baseBlue.size } : { position: [40, 0.6, 0], size: [15, 0.2, 14] },
      },
      spawnPoints: {
        red: [this.spawnPoints.red || { position: [-35, 2, 0], rotation: [0, Math.PI / 2, 0] }],
        blue: [this.spawnPoints.blue || { position: [35, 2, 0], rotation: [0, -Math.PI / 2, 0] }],
      },
      flags: {
        red: this.flags.red || { position: [-40, 1, 0] },
        blue: this.flags.blue || { position: [40, 1, 0] },
      },
    };
    
    // Create download
    const dataStr = JSON.stringify(mapData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'customMap.json';
    link.click();
    URL.revokeObjectURL(url);
    
    if (this.onSave) {
      this.onSave(mapData);
    }
  }

  async playMap() {
    // Validate map first
    const errors = [];
    if (!this.spawnPoints.red || !this.spawnPoints.blue) {
      errors.push('Missing spawn point(s): set both red and blue spawns');
    }
    if (!this.flags.red || !this.flags.blue) {
      errors.push('Missing flag position(s): set both red and blue flags');
    }
    
    if (errors.length > 0) {
      alert('Cannot play map:\n' + errors.join('\n'));
      return;
    }

    // Get map data (same as saveMap but don't download)
    const baseRed = this.blocks.find(b => b.type === 'base' && b.team === 'red') || null;
    const baseBlue = this.blocks.find(b => b.type === 'base' && b.team === 'blue') || null;

    const mapData = {
      blocks: this.blocks
        .filter(b => b.type !== 'base')
        .map(block => ({
          type: block.type,
          position: block.position,
          size: block.size,
          rotation: block.rotation,
        })),
      bases: {
        red: baseRed ? { position: baseRed.position, size: baseRed.size } : { position: [-40, 0.6, 0], size: [15, 0.2, 14] },
        blue: baseBlue ? { position: baseBlue.position, size: baseBlue.size } : { position: [40, 0.6, 0], size: [15, 0.2, 14] },
      },
      spawnPoints: {
        red: [this.spawnPoints.red || { position: [-35, 2, 0], rotation: [0, Math.PI / 2, 0] }],
        blue: [this.spawnPoints.blue || { position: [35, 2, 0], rotation: [0, -Math.PI / 2, 0] }],
      },
      flags: {
        red: this.flags.red || { position: [-40, 1, 0] },
        blue: this.flags.blue || { position: [40, 1, 0] },
      },
    };

    // Ensure connected to server
    if (!this.networkManager) {
      alert('Network manager not initialized. Please refresh the page.');
      return;
    }

    // Connect if not connected
    if (!this.networkManager.socket || !this.networkManager.connected) {
      console.log('🔌 Connecting to server...');
      this.networkManager.connect();
      
      // Wait for connection (with timeout)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 5000);
        
        if (this.networkManager.socket) {
          this.networkManager.socket.once('connect', () => {
            clearTimeout(timeout);
            console.log('✅ Connected to server');
            resolve();
          });
          
          this.networkManager.socket.once('connect_error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        } else {
          clearTimeout(timeout);
          reject(new Error('Socket not created'));
        }
      }).catch((error) => {
        alert('Failed to connect to server. Make sure the server is running on port 3001.\n\nError: ' + error.message);
        throw error;
      });
    }

    // Send map to server
    if (this.networkManager.socket) {
      console.log('📤 Sending custom map to server');
      this.networkManager.socket.emit('customMap', mapData);
      console.log('✅ Custom map sent successfully');
    } else {
      alert('Failed to connect to server. Please try again.');
      return;
    }

    // Stop editing and return to lobby
    this.stopEditing();
    if (this.onReturnToLobby) {
      this.onReturnToLobby();
    }
  }

  loadMap() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const mapData = JSON.parse(event.target.result);
          this.loadMapData(mapData);
        } catch (error) {
          alert('Error loading map: ' + error.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  async loadDefaultMap() {
    try {
      console.log('📦 Loading default map in editor');
      const response = await fetch('/maps/defaultMap.json');
      if (!response.ok) {
        throw new Error('Default map not found');
      }
      const mapData = await response.json();
      console.log('✅ Default map data loaded:', mapData);
      
      // Clear the initial platform (foundation) if it exists
      this.blocks.forEach(block => {
        if (block.isFoundation) {
          this.scene.remove(block.mesh);
          block.mesh.geometry.dispose();
          block.mesh.material.dispose();
          const world = this.physicsWorld.getWorld();
          world.removeRigidBody(block.body);
        }
      });
      this.blocks = this.blocks.filter(b => !b.isFoundation);
      
      // Load the default map data (this will add all blocks from the map)
      this.loadMapData(mapData);
      
      alert('Default map loaded successfully!');
    } catch (error) {
      console.error('❌ Error loading default map:', error);
      alert('Error loading default map: ' + error.message);
    }
  }

  loadMapData(mapData) {
    // Clear existing blocks
    this.blocks.forEach(block => {
      this.scene.remove(block.mesh);
      block.mesh.geometry.dispose();
      block.mesh.material.dispose();
      const world = this.physicsWorld.getWorld();
      world.removeRigidBody(block.body);
    });
    this.blocks = [];
    
    // Load blocks
    if (mapData.blocks) {
      mapData.blocks.forEach(blockData => {
        const geometry = new THREE.BoxGeometry(
          blockData.size[0],
          blockData.size[1],
          blockData.size[2]
        );
        let color = 0x888888;
        if (blockData.type === 'ramp') {
          color = 0x8888ff;
        } else if (blockData.type === 'obstacle') {
          color = 0x666666;
        }
        const material = new THREE.MeshStandardMaterial({
          color,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...blockData.position);
        const rotation = blockData.rotation || [0, 0, 0];
        mesh.rotation.set(...rotation);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.isMapObject = true;
        this.scene.add(mesh);
        
        const world = this.physicsWorld.getWorld();
        const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
          blockData.position[0],
          blockData.position[1],
          blockData.position[2]
        );
        const body = world.createRigidBody(bodyDesc);
        
        const colliderDesc = RAPIER.ColliderDesc.cuboid(
          blockData.size[0] / 2,
          blockData.size[1] / 2,
          blockData.size[2] / 2
        );
        const collider = world.createCollider(colliderDesc, body);
        
        this.blocks.push({
          type: blockData.type,
          position: blockData.position,
          size: blockData.size,
          rotation: rotation,
          mesh,
          body,
          collider,
        });
      });
    }

    // Load bases/spawns/flags (editor markers only)
    if (mapData.bases?.red) this.createOrMoveBasePreview('red', mapData.bases.red.position, mapData.bases.red.size);
    if (mapData.bases?.blue) this.createOrMoveBasePreview('blue', mapData.bases.blue.position, mapData.bases.blue.size);
    const spR = mapData.spawnPoints?.red?.[0];
    const spB = mapData.spawnPoints?.blue?.[0];
    if (spR?.position) {
      this.spawnPoints.red = { position: spR.position, rotation: spR.rotation || [0, Math.PI / 2, 0] };
      this.ensureSpawnMarker('red');
      this.markers.spawn.red.position.set(spR.position[0], spR.position[1], spR.position[2]);
    }
    if (spB?.position) {
      this.spawnPoints.blue = { position: spB.position, rotation: spB.rotation || [0, -Math.PI / 2, 0] };
      this.ensureSpawnMarker('blue');
      this.markers.spawn.blue.position.set(spB.position[0], spB.position[1], spB.position[2]);
    }
    const fR = mapData.flags?.red?.position;
    const fB = mapData.flags?.blue?.position;
    if (fR) {
      this.flags.red = { position: fR };
      this.ensureFlagMarker('red');
      this.markers.flag.red.position.set(fR[0], fR[1], fR[2]);
    }
    if (fB) {
      this.flags.blue = { position: fB };
      this.ensureFlagMarker('blue');
      this.markers.flag.blue.position.set(fB[0], fB[1], fB[2]);
    }
  }

  startNewBlankMap() {
    // Clear blocks
    this.loadMapData({ blocks: [] });
    // Clear markers/state
    this.spawnPoints = { red: null, blue: null };
    this.flags = { red: null, blue: null };
    this.clearMarker('spawn', 'red');
    this.clearMarker('spawn', 'blue');
    this.clearMarker('flag', 'red');
    this.clearMarker('flag', 'blue');

    // Add a starter platform so the editor doesn't start "empty"
    // (this is the floor / main platform)
    this.placeInitialPlatform();

    // Add a grid helper for alignment
    const grid = new THREE.GridHelper(200, 200, 0x444444, 0x333333);
    grid.position.set(0, 0.51, 0); // slightly above floor so it's visible
    grid.userData.isMapObject = true;
    grid.userData.isEditorHelper = true;
    this.scene.add(grid);
    this.editorObjects.push(grid);

    // Put camera in a good editing angle
    if (this.camera) {
      this.camera.position.set(0, 60, 60);
      this.camera.lookAt(0, 0, 0);
    }
  }

  placeInitialPlatform() {
    const pos = new THREE.Vector3(0, 0, 0);
    const size = [100, 1, 40];

    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const material = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(pos);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.isMapObject = true;
    this.scene.add(mesh);

    const world = this.physicsWorld.getWorld();
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    const body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2);
    const collider = world.createCollider(colliderDesc, body);

    const block = {
      type: 'platform',
      position: [pos.x, pos.y, pos.z],
      size,
      rotation: [0, 0, 0],
      mesh,
      body,
      collider,
      isFoundation: true,
    };
    this.blocks.push(block);
  }

  enableEditorCameraControls() {
    if (!this.camera || !this.domElement) return;
    if (this.controls) return;
    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  disableEditorCameraControls() {
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }
  }

  cleanupEditorHelpers() {
    this.editorObjects.forEach((obj) => {
      this.scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) obj.material.dispose?.();
    });
    this.editorObjects = [];
  }

  ensureSpawnMarker(team) {
    if (this.markers.spawn[team]) return;
    const color = team === 'red' ? 0xff4444 : 0x4444ff;
    const geo = new THREE.ConeGeometry(1.2, 3, 12);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.isMapObject = true;
    mesh.userData.isEditorHelper = true;
    this.scene.add(mesh);
    this.markers.spawn[team] = mesh;
  }

  ensureFlagMarker(team) {
    if (this.markers.flag[team]) return;
    const color = team === 'red' ? 0xff0000 : 0x0000ff;
    const geo = new THREE.SphereGeometry(1.0, 12, 12);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.isMapObject = true;
    mesh.userData.isEditorHelper = true;
    this.scene.add(mesh);
    this.markers.flag[team] = mesh;
  }

  clearMarker(kind, team) {
    const m = this.markers?.[kind]?.[team];
    if (!m) return;
    this.scene.remove(m);
    if (m.geometry) m.geometry.dispose?.();
    if (m.material) m.material.dispose?.();
    this.markers[kind][team] = null;
  }

  setSpawnPoint(team, point) {
    const pos = point.clone();
    if (this.snapToGrid) {
      pos.x = Math.round(pos.x / this.gridSize) * this.gridSize;
      pos.y = Math.round(pos.y / this.gridSize) * this.gridSize;
      pos.z = Math.round(pos.z / this.gridSize) * this.gridSize;
    }
    // Force spawn above ground a bit
    pos.y = Math.max(pos.y, 2);
    const rotY = team === 'red' ? Math.PI / 2 : -Math.PI / 2;
    this.spawnPoints[team] = { position: [pos.x, pos.y, pos.z], rotation: [0, rotY, 0] };
    this.ensureSpawnMarker(team);
    this.markers.spawn[team].position.copy(pos);
  }

  setFlagPosition(team, point) {
    const pos = point.clone();
    if (this.snapToGrid) {
      pos.x = Math.round(pos.x / this.gridSize) * this.gridSize;
      pos.y = Math.round(pos.y / this.gridSize) * this.gridSize;
      pos.z = Math.round(pos.z / this.gridSize) * this.gridSize;
    }
    pos.y = Math.max(pos.y, 1);
    this.flags[team] = { position: [pos.x, pos.y, pos.z] };
    this.ensureFlagMarker(team);
    this.markers.flag[team].position.copy(pos);
  }

  placeBaseBlock(team, point) {
    // Place a thin colored base “block”
    const pos = point.clone();
    if (this.snapToGrid) {
      pos.x = Math.round(pos.x / this.gridSize) * this.gridSize;
      pos.y = Math.round(pos.y / this.gridSize) * this.gridSize;
      pos.z = Math.round(pos.z / this.gridSize) * this.gridSize;
    }
    pos.y = 0.6;
    const size = [15, 0.2, 14];

    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const color = team === 'red' ? 0xff4444 : 0x4444ff;
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.15 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(pos);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.isMapObject = true;
    this.scene.add(mesh);

    const world = this.physicsWorld.getWorld();
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    const body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2);
    const collider = world.createCollider(colliderDesc, body);

    // Remove previous base for this team if present
    const existing = this.blocks.find(b => b.type === 'base' && b.team === team);
    if (existing) {
      this.scene.remove(existing.mesh);
      existing.mesh.geometry.dispose();
      existing.mesh.material.dispose();
      world.removeRigidBody(existing.body);
      this.blocks.splice(this.blocks.indexOf(existing), 1);
    }

    this.blocks.push({
      type: 'base',
      team,
      position: [pos.x, pos.y, pos.z],
      size,
      rotation: [0, 0, 0],
      mesh,
      body,
      collider,
    });
  }

  createOrMoveBasePreview(team, position, size) {
    // Load base into the editor as a base block
    const pos = new THREE.Vector3(position[0], position[1], position[2]);
    this.placeBaseBlock(team, pos);
    // Ensure size matches loaded size
    const base = this.blocks.find(b => b.type === 'base' && b.team === team);
    if (base && Array.isArray(size)) {
      base.size = size;
    }
  }

  destroy() {
    this.hideEditorUI();
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('click', this._onMouseClick);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('contextmenu', this._onContextMenu);
    this.disableEditorCameraControls();
    this.cleanupEditorHelpers();
  }
}
