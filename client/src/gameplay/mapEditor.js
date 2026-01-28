import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';

export class MapEditor {
  constructor(scene, physicsWorld, onSave) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.onSave = onSave;
    
    this.blocks = [];
    this.selectedBlock = null;
    this.gridSize = 1;
    this.snapToGrid = true;
    
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.camera = null;
    
    this.isEditing = false;
    this.currentBlockType = 'platform';
    this.currentRotation = 0; // 0, 90, 180, 270 degrees
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('click', (e) => this.onMouseClick(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  setCamera(camera) {
    this.camera = camera;
  }

  startEditing() {
    this.isEditing = true;
    this.showEditorUI();
  }

  stopEditing() {
    this.isEditing = false;
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
      <div>
        <label>Block Type: </label>
        <select id="blockType">
          <option value="platform">Platform</option>
          <option value="ramp">Ramp</option>
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
        <p>R: Rotate block</p>
        <p>Delete: Remove block</p>
        <p>ESC: Exit editor</p>
      </div>
    `;
    document.body.appendChild(editorDiv);
    
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
    
    document.getElementById('validateBtn').addEventListener('click', () => {
      this.validateMap();
    });
    
    document.getElementById('gridSnap').addEventListener('change', (e) => {
      this.snapToGrid = e.target.checked;
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
        
        // Check if clicking on existing block
        const block = this.blocks.find(b => b.mesh === object);
        if (block) {
          this.selectBlock(block);
        } else {
          // Place new block
          this.placeBlock(intersect.point, intersect.face.normal);
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

  placeBlock(position, normal) {
    let pos = position.clone();
    
    if (this.snapToGrid) {
      pos.x = Math.round(pos.x / this.gridSize) * this.gridSize;
      pos.y = Math.round(pos.y / this.gridSize) * this.gridSize;
      pos.z = Math.round(pos.z / this.gridSize) * this.gridSize;
    }
    
    // Default block size
    const size = this.currentBlockType === 'ramp' ? [5, 1, 5] : [5, 1, 5];
    
    // Create visual block
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const material = new THREE.MeshStandardMaterial({ 
      color: this.currentBlockType === 'ramp' ? 0x8888ff : 0x888888,
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
    
    // Check for flags and bases (would need to be added separately)
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
    const mapData = {
      blocks: this.blocks.map(block => ({
        type: block.type,
        position: block.position,
        size: block.size,
        rotation: block.rotation,
      })),
      spawnPoints: {
        red: [{ position: [-8, 2, 0], rotation: [0, Math.PI / 2, 0] }],
        blue: [{ position: [8, 2, 0], rotation: [0, -Math.PI / 2, 0] }],
      },
      flags: {
        red: { position: [-10, 2, 0] },
        blue: { position: [10, 2, 0] },
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
        const material = new THREE.MeshStandardMaterial({
          color: blockData.type === 'ramp' ? 0x8888ff : 0x888888,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...blockData.position);
        mesh.rotation.set(...blockData.rotation);
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
          rotation: blockData.rotation,
          mesh,
          body,
          collider,
        });
      });
    }
  }

  destroy() {
    this.hideEditorUI();
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('click', this.onMouseClick);
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
