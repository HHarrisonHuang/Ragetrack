import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class MapEditor {
  constructor(scene, physicsWorld, onSave) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.onSave = onSave;
    this.networkManager = null;
    this.onReturnToLobby = null;
    
    this.blocks = [];
    this.selectedBlock = null;
    this.selectedMarker = null;
    this.gridSize = 1;
    this.snapToGrid = true;
    
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.camera = null;
    this.domElement = null;
    this.controls = null;
    
    this.isEditing = false;
    this.currentRotation = 0; // 0, 90, 180, 270 degrees

    // Editor tools
    this.currentTool = 'platform'; // platform | obstacle | spawn | flag | base
    this.currentTeam = 'red'; // for spawn/flag/base

    // Spawn + flag markers
    this.spawnPoints = { red: null, blue: null }; // { position:[x,y,z], rotation:[x,y,z] }
    this.flags = { red: null, blue: null }; // { position:[x,y,z] }
    this.markers = {
      spawn: { red: null, blue: null },
      flag: { red: null, blue: null },
    };

    // Spawn preview car templates (GLTF)
    this.spawnCarTemplates = { red: null, blue: null };
    this.spawnCarTemplatePromises = { red: null, blue: null };

    // Editor-only helpers (ground/grid)
    this.editorObjects = [];

    // Shape editing state (2D for platform, 3D for wall)
    this.shapeEdit = {
      active: false,
      block: null,
      mode: '2d', // '2d' for platform (top-down), '3d' for wall
      outline: null,
      handles: [],
      draggingHandle: null,
      dragStart: null,
      original: null,
      savedControls: null,
      planeY: 0,
    };

    // Bind handlers so removeEventListener works
    this._onMouseMove = (e) => this.onMouseMove(e);
    this._onMouseClick = (e) => this.onMouseClick(e);
    this._onKeyDown = (e) => this.onKeyDown(e);
    this._onPointerDown = (e) => this.onPointerDown(e);
    this._onPointerMove = (e) => this.onPointerMove(e);
    this._onPointerUp = (e) => this.onPointerUp(e);
    this._onContextMenu = (e) => {
      if (this.isEditing) e.preventDefault();
    };
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
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
    
    // If platform tool is selected, enter top-view mode
    if (this.currentTool === 'platform') {
      // Small delay to ensure camera/controls are set up
      setTimeout(() => {
        if (this.isEditing && this.currentTool === 'platform') {
          this.enterPlatformTopView();
        }
      }, 100);
    }
  }

  stopEditing() {
    this.isEditing = false;
    // Ensure any shape-edit gizmos are removed
    if (this.shapeEdit?.active) {
      this.exitShapeEditMode();
    }
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
          <option value="platform">Platform</option>
          <option value="wall">Wall</option>
          <option value="obstacle">Obstacle</option>
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
        <p>Left click: Select</p>
        <p>Right click: Place</p>
        <p>Platform tool: Auto top-view mode</p>
        <p>Tool=Spawn/Flag/Base: Right click to set position</p>
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
        const oldTool = this.currentTool;
        this.currentTool = e.target.value;
        
        // Auto-enter top-view for platform tool, exit for others
        if (this.currentTool === 'platform') {
          // If we have a selected block and it's a platform, enter shape edit mode
          if (this.selectedBlock && this.selectedBlock.type === 'platform') {
            if (!this.shapeEdit.active) {
              this.enterShapeEditMode(this.selectedBlock);
            }
          } else if (!this.shapeEdit.active) {
            // Enter a general top-view mode for platform tool (no specific block selected)
            this.enterPlatformTopView();
          }
        } else {
          // Exit top-view when switching away from platform tool
          if (this.shapeEdit.active && oldTool === 'platform') {
            this.exitShapeEditMode();
          }
        }
      });
    }
    const teamSel = document.getElementById('editorTeam');
    if (teamSel) {
      teamSel.value = this.currentTeam;
      teamSel.addEventListener('change', (e) => {
        this.currentTeam = e.target.value;
      });
    }
    
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

  onPointerMove(event) {
    // Keep mouse coords updated for pointer interactions too
    this.onMouseMove(event);

    if (!this.isEditing || !this.shapeEdit.active) return;
    if (!this.shapeEdit.draggingHandle) return;

    this._updateShapeEditDrag();
  }

  onPointerDown(event) {
    if (!this.isEditing || !this.camera) return;

    // Ignore clicks on UI elements (editor overlay, buttons, dropdowns, etc.)
    const editorDiv = document.getElementById('mapEditor');
    if (editorDiv && editorDiv.contains(event.target)) {
      return; // Click was on UI, don't process as map interaction
    }

    // Update mouse coords for raycasting
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // If in shape edit mode, pointerdown is used to grab handles (left click)
    if (this.shapeEdit.active && event.button === 0) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.shapeEdit.handles || [], true);
      if (intersects.length > 0) {
        const hit = intersects[0].object;
        const corner = hit?.userData?.shapeCorner;
        if (corner) {
          this.shapeEdit.draggingHandle = corner;
          this.shapeEdit.dragStart = { x: event.clientX, y: event.clientY };
          
          // Disable camera controls while dragging handles
          if (this.controls) {
            this.controls.enabled = false;
          }
          
          event.preventDefault();
          return;
        }
      }
    }

    // Outside shape edit or no handle hit:
    // - Left click selects
    // - Right click places (and should not open context menu)
    if (event.button === 2) {
      event.preventDefault();
    }

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    // Helper to check if object or any ancestor is an editor helper (grid, etc.)
    const isEditorHelper = (obj) => {
      let cur = obj;
      while (cur) {
        if (cur.userData?.isEditorHelper) return true;
        cur = cur.parent;
      }
      return false;
    };

    if (event.button === 0) {
      // Left click: select or deselect
      // Filter out editor helpers unless they are spawn/flag markers
      const selectableHits = intersects.filter(h => {
        const markerInfo = this._findMarkerFromObject(h.object);
        if (markerInfo) return true;
        return !isEditorHelper(h.object);
      });
      const hit = selectableHits[0] || null;
      
      if (!hit) {
        this.deselectBlock();
        // If in platform tool top-view mode, stay in top-view
        if (this.currentTool === 'platform' && this.shapeEdit.active && !this.shapeEdit.block) {
          // Already in platform top-view, just deselect
        } else if (this.currentTool === 'platform' && this.shapeEdit.active) {
          // Exit shape edit mode when deselecting
          this.exitShapeEditMode();
        }
        return;
      }

      const object = hit.object;
      const block = this._findBlockFromObject(object);
      const markerInfo = this._findMarkerFromObject(object);

      if (block) {
        // Exit shape edit mode if we're switching to a different block
        if (this.shapeEdit.active && this.shapeEdit.block !== block) {
          this.exitShapeEditMode();
        }
        
        this.selectBlock(block);
        // If platform tool is active and we selected a platform, enter 2D shape edit mode
        if (this.currentTool === 'platform' && block.type === 'platform') {
          if (!this.shapeEdit.active) {
            this.enterShapeEditMode(block);
          }
        } else if (this.currentTool === 'wall' && block.type === 'wall') {
          // If wall tool is active and we selected a wall, enter 3D shape edit mode
          if (!this.shapeEdit.active) {
            this.enterWallShapeEditMode(block);
          }
        } else if (this.shapeEdit.active) {
          // Selected a different block type, exit shape edit
          this.exitShapeEditMode();
        }
      } else if (markerInfo) {
        this.deselectBlock();
        // Handle marker selection (e.g. for rotation)
        console.log('📍 Selected marker:', markerInfo.kind, markerInfo.team);
        // For now, we just set the tool/team to match the marker so 'R' works
        this.currentTool = markerInfo.kind;
        this.currentTeam = markerInfo.team;
        
        // Update UI dropdowns
        const toolSel = document.getElementById('editorTool');
        if (toolSel) toolSel.value = this.currentTool;
        const teamSel = document.getElementById('editorTeam');
        if (teamSel) teamSel.value = this.currentTeam;

        // Highlight marker
        if (markerInfo.marker.material) {
          markerInfo.marker.material.emissive = new THREE.Color(0x666666);
          // Store reference to deselect later
          this.selectedMarker = markerInfo;
        }

        if (this.currentTool === 'platform' && this.shapeEdit.active) {
          this.exitShapeEditMode();
        }
      } else {
        this.deselectBlock();
        // If in platform tool top-view mode, stay in top-view
        if (this.currentTool === 'platform' && this.shapeEdit.active && !this.shapeEdit.block) {
          // Already in platform top-view, just deselect
        } else if (this.currentTool === 'platform' && this.shapeEdit.active) {
          // Exit shape edit mode when deselecting
          this.exitShapeEditMode();
        }
      }
      return;
    }

    // For right click placement, use the first hit (can be grid for placement)
    const hit = intersects[0] || null;

    if (event.button === 2) {
      // Right click: place (spawn/flag/base/block)
      
      // For platform tool in top-view mode, use plane intersection
      if (this.currentTool === 'platform' && this.shapeEdit.active) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.shapeEdit.planeY);
        const hitPoint = new THREE.Vector3();
        const ok = this.raycaster.ray.intersectPlane(plane, hitPoint);
        if (ok) {
          const normal = new THREE.Vector3(0, 1, 0);
          this.placeBlock(hitPoint, normal, null);
        }
        return;
      }

      if (!hit) return;

      const intersect = hit;
      const object = intersect.object;

      // Tool actions
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

      // Platform/Obstacle tool placement:
      const clickedBlock = this._findBlockFromObject(object);
      const normal = intersect.face?.normal || new THREE.Vector3(0, 1, 0);

      // Special case: placing on foundation should place instead of select
      if (clickedBlock?.isFoundation) {
        this.placeBlock(intersect.point, normal, null);
        return;
      }

      // Obstacle stacking special case
      if (this.currentTool === 'obstacle' && clickedBlock?.type === 'obstacle') {
        this.placeBlock(intersect.point, normal, clickedBlock);
        return;
      }

      // Default: place new block
      this.placeBlock(intersect.point, normal, null);
      return;
    }
  }

  onPointerUp() {
    if (!this.isEditing || !this.shapeEdit.active) return;
    
    if (this.shapeEdit.draggingHandle) {
      // Re-enable camera controls after dragging
      if (this.controls) {
        this.controls.enabled = true;
      }
      this.shapeEdit.draggingHandle = null;
      this.shapeEdit.dragStart = null;
    }
  }

  // Note: placement/selection is handled in onPointerDown so right-click can be used.
  onMouseClick() {}

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

  // ===========================
  // Rect/footprint helpers
  // ===========================
  _findBlockFromObject(obj) {
    // Raycaster can hit child meshes (especially GLTF). Walk up parents to find the owning block mesh.
    let cur = obj;
    while (cur) {
      const b = this.blocks.find((blk) => blk.mesh === cur);
      if (b) return b;
      cur = cur.parent;
    }
    return null;
  }

  _findMarkerFromObject(obj) {
    let cur = obj;
    while (cur) {
      for (const kind in this.markers) {
        for (const team in this.markers[kind]) {
          if (this.markers[kind][team] === cur) {
            return { kind, team, marker: cur };
          }
        }
      }
      cur = cur.parent;
    }
    return null;
  }

  _rectIntersect(a, b) {
    const minX = Math.max(a.minX, b.minX);
    const maxX = Math.min(a.maxX, b.maxX);
    const minZ = Math.max(a.minZ, b.minZ);
    const maxZ = Math.min(a.maxZ, b.maxZ);
    if (maxX <= minX || maxZ <= minZ) return null;
    return { minX, maxX, minZ, maxZ };
  }

  // Returns up to 4 rects representing a - (a ∩ b)
  _rectSubtract(a, b, minSize = 0.001) {
    const i = this._rectIntersect(a, b);
    if (!i) return [a];

    const out = [];

    // Left strip
    if (i.minX - a.minX > minSize) {
      out.push({ minX: a.minX, maxX: i.minX, minZ: a.minZ, maxZ: a.maxZ });
    }
    // Right strip
    if (a.maxX - i.maxX > minSize) {
      out.push({ minX: i.maxX, maxX: a.maxX, minZ: a.minZ, maxZ: a.maxZ });
    }
    // Bottom strip
    if (i.minZ - a.minZ > minSize) {
      out.push({ minX: i.minX, maxX: i.maxX, minZ: a.minZ, maxZ: i.minZ });
    }
    // Top strip
    if (a.maxZ - i.maxZ > minSize) {
      out.push({ minX: i.minX, maxX: i.maxX, minZ: i.maxZ, maxZ: a.maxZ });
    }

    return out;
  }

  _platformFootprintRect(blockLike) {
    const pos = blockLike.position; // [x,y,z]
    const size = blockLike.size; // [x,y,z]
    const rot = blockLike.rotation || [0, 0, 0];
    const rotY = rot[1] || 0;
    const rotDeg = Math.round((rotY * 180) / Math.PI);
    const ninety = Math.abs(((rotDeg % 180) + 180) % 180 - 90) < 1;

    const sx = ninety ? size[2] : size[0];
    const sz = ninety ? size[0] : size[2];

    return {
      minX: pos[0] - sx / 2,
      maxX: pos[0] + sx / 2,
      minZ: pos[2] - sz / 2,
      maxZ: pos[2] + sz / 2,
      topY: pos[1] + size[1] / 2,
      height: size[1],
    };
  }

  _createBlock(type, pos, size, rotationYRad = 0, extra = {}) {
    // Create visual block
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);

    let color = 0x888888; // Default platform gray
    if (type === 'ramp') color = 0x8888ff;
    if (type === 'obstacle') color = 0x666666;
    if (type === 'wall') color = 0xaaaaaa; // Wall gray (slightly lighter)
    if (type === 'base') color = extra.team === 'blue' ? 0x3366ff : 0xff3333;

    const material = new THREE.MeshStandardMaterial({ color, wireframe: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(pos);
    mesh.rotation.y = rotationYRad;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.isMapObject = true;
    this.scene.add(mesh);

    // Create physics collider
    const world = this.physicsWorld.getWorld();
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, rotationYRad, 0)
    );
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
    const body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2);
    const collider = world.createCollider(colliderDesc, body);

    const block = {
      type,
      position: [pos.x, pos.y, pos.z],
      size,
      rotation: [0, rotationYRad, 0],
      mesh,
      body,
      collider,
      ...extra,
    };

    this.blocks.push(block);
    return block;
  }

  placeBlock(position, normal, clickedBlock = null) {
    let pos = position.clone();
    
    // Determine block type and size based on current tool
    let blockType;
    let size;
    if (this.currentTool === 'obstacle') {
      blockType = 'obstacle';
      size = [2, 2, 2]; // Obstacles are cube-shaped
    } else if (this.currentTool === 'platform') {
      blockType = 'platform';
      size = [5, 1, 5]; // Platform
    } else if (this.currentTool === 'wall') {
      blockType = 'wall';
      size = [5, 5, 1]; // Wall: 5 units wide (x), 5 units tall (y), 1 unit thick (z)
    } else {
      // Should not happen, but fallback
      blockType = 'platform';
      size = [5, 1, 5];
    }
    
    // Handle obstacle placement
    if (this.currentTool === 'obstacle') {
      if (clickedBlock && clickedBlock.type === 'obstacle') {
        // Clicked on another obstacle - place on top of it
        pos.y = clickedBlock.position[1] + clickedBlock.size[1] / 2 + size[1] / 2;
      } else {
        // Place on surface (default platform is at y=0.5 center, height 1, so top is at y=1.0)
        // For obstacles, place so bottom sits on the surface (center at y=1.0 + size[1]/2)
        pos.y = Math.max(1.0, pos.y) + size[1] / 2;
      }
    } else if (this.currentTool === 'platform') {
      // For platforms: align with default platform (below grid line)
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
    } else if (this.currentTool === 'wall') {
      // For walls: place vertically, aligned with the surface normal
      // Wall is 1 unit thick, so center it on the surface
      // Default wall height is 5 units, so center vertically at clicked point
      pos.y = Math.max(2.5, pos.y); // Ensure wall bottom is at least 2.5 units above ground
      // Align wall to surface normal (will be rotated based on currentRotation)
    }
    
    if (this.snapToGrid) {
      pos.x = Math.round(pos.x / this.gridSize) * this.gridSize;
      pos.y = Math.round(pos.y / this.gridSize) * this.gridSize;
      pos.z = Math.round(pos.z / this.gridSize) * this.gridSize;
    }

    // Platform overlap cutout: if placing a new platform on top of existing platforms,
    // remove the overlapping area from the NEW platform by splitting into rectangles.
    if (this.currentTool === 'platform') {
      const newBlockLike = {
        position: [pos.x, pos.y, pos.z],
        size,
        rotation: [0, (this.currentRotation * Math.PI) / 180, 0],
      };

      const newRect0 = this._platformFootprintRect(newBlockLike);
      const epsY = 0.02;
      const minDim = Math.max(0.25, this.gridSize * 0.25);

      const existingRects = this.blocks
        .filter((b) => b.type === 'platform' && !b.isFoundation)
        .map((b) => this._platformFootprintRect(b))
        .filter((r) => Math.abs(r.topY - newRect0.topY) < epsY && Math.abs(r.height - newRect0.height) < epsY);

      let rects = [{ minX: newRect0.minX, maxX: newRect0.maxX, minZ: newRect0.minZ, maxZ: newRect0.maxZ }];
      for (const ex of existingRects) {
        const b = { minX: ex.minX, maxX: ex.maxX, minZ: ex.minZ, maxZ: ex.maxZ };
        rects = rects.flatMap((r) => this._rectSubtract(r, b, minDim));
        if (rects.length === 0) break;
      }

      // Create blocks for each remaining rect (skip tiny slivers)
      let last = null;
      for (const r of rects) {
        const sx = r.maxX - r.minX;
        const sz = r.maxZ - r.minZ;
        if (sx < minDim || sz < minDim) continue;
        const cx = (r.minX + r.maxX) / 2;
        const cz = (r.minZ + r.maxZ) / 2;
        const p = new THREE.Vector3(cx, pos.y, cz);
        last = this._createBlock('platform', p, [sx, size[1], sz], 0);
      }

      if (last) {
        this.selectBlock(last);
        // If in platform tool, ensure shape edit mode targets the newly placed platform
        if (this.shapeEdit.active && this.shapeEdit.block !== last) {
          this.exitShapeEditMode();
        }
        if (!this.shapeEdit.active) {
          this.enterShapeEditMode(last);
        }
      }
      return;
    }
    
    const block = this._createBlock(
      blockType,
      pos,
      size,
      (this.currentRotation * Math.PI) / 180
    );
    this.selectBlock(block);
    
    // If wall tool, enter 3D shape edit mode
    if (this.currentTool === 'wall') {
      if (this.shapeEdit.active && this.shapeEdit.block !== block) {
        this.exitShapeEditMode();
      }
      if (!this.shapeEdit.active) {
        this.enterWallShapeEditMode(block);
      }
    }
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

    if (this.selectedMarker && this.selectedMarker.marker.material) {
      this.selectedMarker.marker.material.emissive = new THREE.Color(0x000000);
    }
    this.selectedMarker = null;
  }

  // ===========================
  // Shape edit mode (top-down)
  // Rectangle-only: resize footprint in XZ
  // ===========================
  toggleShapeEditMode() {
    if (this.shapeEdit.active) {
      this.exitShapeEditMode();
      return;
    }
    if (!this.selectedBlock) {
      alert('Select a platform/obstacle first.');
      return;
    }
    if (this.selectedBlock.type !== 'platform' && this.selectedBlock.type !== 'obstacle') {
      alert('Shape edit is only for platform/obstacle blocks.');
      return;
    }
    this.enterShapeEditMode(this.selectedBlock);
  }

  enterPlatformTopView() {
    // Enter top-view mode for platform tool (no specific block selected)
    if (!this.camera || !this.controls) return;
    if (this.shapeEdit.active) return; // Already in shape edit mode

    // Save current controls/camera state
    this.shapeEdit.savedControls = {
      enableRotate: this.controls.enableRotate,
      enablePan: this.controls.enablePan,
      enableZoom: this.controls.enableZoom,
      target: this.controls.target?.clone?.() || new THREE.Vector3(),
      cameraPos: this.camera.position.clone(),
      cameraQuat: this.camera.quaternion.clone(),
    };

    // Set camera to top-down view centered on origin
    const planeY = 0.5; // Default platform top
    this.shapeEdit.planeY = planeY + 0.01;
    this.camera.position.set(0, planeY + 50, 0);
    this.camera.lookAt(0, planeY, 0);
    this.controls.target.set(0, planeY, 0);
    this.controls.enableRotate = false;
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.update();

    // Mark as active but without a specific block
    this.shapeEdit.active = true;
    this.shapeEdit.block = null; // No specific block selected
  }

  enterShapeEditMode(block) {
    if (!this.camera || !this.controls) return;

    this.shapeEdit.active = true;
    this.shapeEdit.block = block;
    this.shapeEdit.mode = '2d';

    // Save current controls/camera state
    this.shapeEdit.savedControls = {
      enableRotate: this.controls.enableRotate,
      enablePan: this.controls.enablePan,
      enableZoom: this.controls.enableZoom,
      target: this.controls.target?.clone?.() || new THREE.Vector3(),
      cameraPos: this.camera.position.clone(),
      cameraQuat: this.camera.quaternion.clone(),
    };

    const cx = block.position[0];
    const cy = block.position[1];
    const cz = block.position[2];
    const topY = cy + block.size[1] / 2;
    this.shapeEdit.planeY = topY + 0.01;

    // Force a top-down view
    this.camera.position.set(cx, topY + 50, cz);
    this.camera.lookAt(cx, topY, cz);
    this.controls.target.set(cx, topY, cz);
    this.controls.enableRotate = false;
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.update();

    // Build initial rect (axis-aligned, rotation ignored in edit mode)
    const rect = {
      minX: cx - block.size[0] / 2,
      maxX: cx + block.size[0] / 2,
      minZ: cz - block.size[2] / 2,
      maxZ: cz + block.size[2] / 2,
    };
    this.shapeEdit.original = { rect };

    this._createShapeEditGizmos(rect);
  }

  enterWallShapeEditMode(block) {
    if (!this.camera || !this.controls) return;

    this.shapeEdit.active = true;
    this.shapeEdit.block = block;
    this.shapeEdit.mode = '3d';

    // Save current controls/camera state
    this.shapeEdit.savedControls = {
      enableRotate: this.controls.enableRotate,
      enablePan: this.controls.enablePan,
      enableZoom: this.controls.enableZoom,
      target: this.controls.target?.clone?.() || new THREE.Vector3(),
      cameraPos: this.camera.position.clone(),
      cameraQuat: this.camera.quaternion.clone(),
    };

    // Keep current camera view (3D editing, don't force top-down)
    this.controls.enableRotate = true;
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.update();

    // Build initial box bounds (3D)
    const cx = block.position[0];
    const cy = block.position[1];
    const cz = block.position[2];
    const rotY = block.rotation[1] || 0;
    
    // For walls, size is [width, height, thickness]
    // After rotation, we need to account for the rotation
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    
    // Calculate dimensions
    const width = block.size[0];
    const height = block.size[1];
    const thickness = block.size[2];
    
    // Store original box bounds
    const box = {
      centerX: cx,
      centerY: cy,
      centerZ: cz,
      thickness: thickness,
      height: height,
      width: width,
      rotationY: rotY,
    };
    this.shapeEdit.original = { box };

    this._createWallShapeEditGizmos(box);
  }

  exitShapeEditMode() {
    if (!this.shapeEdit.active) return;

    // Clean up gizmos
    if (this.shapeEdit.outline) {
      this.scene.remove(this.shapeEdit.outline);
      this.shapeEdit.outline.geometry?.dispose?.();
      this.shapeEdit.outline.material?.dispose?.();
      this.shapeEdit.outline = null;
    }
    (this.shapeEdit.handles || []).forEach((h) => {
      this.scene.remove(h);
      h.geometry?.dispose?.();
      h.material?.dispose?.();
    });
    this.shapeEdit.handles = [];

    // Restore controls/camera
    if (this.controls && this.shapeEdit.savedControls) {
      this.controls.enableRotate = this.shapeEdit.savedControls.enableRotate;
      this.controls.enablePan = this.shapeEdit.savedControls.enablePan;
      this.controls.enableZoom = this.shapeEdit.savedControls.enableZoom;
      if (this.shapeEdit.savedControls.target) this.controls.target.copy(this.shapeEdit.savedControls.target);
      this.controls.update();
    }
    if (this.camera && this.shapeEdit.savedControls?.cameraPos) {
      this.camera.position.copy(this.shapeEdit.savedControls.cameraPos);
      this.camera.quaternion.copy(this.shapeEdit.savedControls.cameraQuat);
    }

    this.shapeEdit.active = false;
    this.shapeEdit.block = null;
    this.shapeEdit.mode = '2d';
    this.shapeEdit.draggingHandle = null;
    this.shapeEdit.dragStart = null;
    this.shapeEdit.original = null;
    this.shapeEdit.savedControls = null;
  }

  _createShapeEditGizmos(rect) {
    // Outline
    const y = this.shapeEdit.planeY;
    const pts = [
      new THREE.Vector3(rect.minX, y, rect.minZ),
      new THREE.Vector3(rect.maxX, y, rect.minZ),
      new THREE.Vector3(rect.maxX, y, rect.maxZ),
      new THREE.Vector3(rect.minX, y, rect.maxZ),
      new THREE.Vector3(rect.minX, y, rect.minZ),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xffff00 });
    const line = new THREE.Line(geo, mat);
    line.userData.isEditorHelper = true;
    this.scene.add(line);
    this.shapeEdit.outline = line;

    // Handles (corners)
    const handleGeo = new THREE.SphereGeometry(0.5, 12, 12);
    const handleMat = new THREE.MeshBasicMaterial({ color: 0xffee00 });
    const corners = [
      { corner: 'bl', x: rect.minX, z: rect.minZ },
      { corner: 'br', x: rect.maxX, z: rect.minZ },
      { corner: 'tr', x: rect.maxX, z: rect.maxZ },
      { corner: 'tl', x: rect.minX, z: rect.maxZ },
    ];
    this.shapeEdit.handles = corners.map((c) => {
      const m = new THREE.Mesh(handleGeo, handleMat.clone());
      m.position.set(c.x, y, c.z);
      m.userData.isEditorHelper = true;
      m.userData.shapeCorner = c.corner;
      this.scene.add(m);
      return m;
    });
  }

  _updateShapeEditGizmos(rect) {
    const y = this.shapeEdit.planeY;
    if (this.shapeEdit.outline) {
      const pts = [
        new THREE.Vector3(rect.minX, y, rect.minZ),
        new THREE.Vector3(rect.maxX, y, rect.minZ),
        new THREE.Vector3(rect.maxX, y, rect.maxZ),
        new THREE.Vector3(rect.minX, y, rect.maxZ),
        new THREE.Vector3(rect.minX, y, rect.minZ),
      ];
      this.shapeEdit.outline.geometry.setFromPoints(pts);
      this.shapeEdit.outline.geometry.attributes.position.needsUpdate = true;
    }
    const byCorner = {
      bl: [rect.minX, rect.minZ],
      br: [rect.maxX, rect.minZ],
      tr: [rect.maxX, rect.maxZ],
      tl: [rect.minX, rect.maxZ],
    };
    (this.shapeEdit.handles || []).forEach((h) => {
      const c = h.userData.shapeCorner;
      const p = byCorner[c];
      if (!p) return;
      h.position.set(p[0], y, p[1]);
    });
  }

  _createWallShapeEditGizmos(box) {
    // Create wireframe box outline
    const geometry = new THREE.BoxGeometry(box.width, box.height, box.thickness);
    const edges = new THREE.EdgesGeometry(geometry);
    const material = new THREE.LineBasicMaterial({ color: 0xffff00 });
    const wireframe = new THREE.LineSegments(edges, material);
    
    // Apply rotation and position
    wireframe.rotation.y = box.rotationY;
    wireframe.position.set(box.centerX, box.centerY, box.centerZ);
    wireframe.userData.isEditorHelper = true;
    this.scene.add(wireframe);
    this.shapeEdit.outline = wireframe;

    // Create only 2 handles at the ends of the wall (for length editing)
    const handleGeo = new THREE.SphereGeometry(0.5, 12, 12);
    const handleMat = new THREE.MeshBasicMaterial({ color: 0xffee00 });
    
    const cosY = Math.cos(box.rotationY);
    const sinY = Math.sin(box.rotationY);
    const halfW = box.width / 2;
    
    // Two handles: left end and right end (along the width/length dimension)
    // Positioned at the middle height and middle thickness
    const handles = [
      { corner: 'left', local: [-halfW, 0, 0] },  // Left end
      { corner: 'right', local: [halfW, 0, 0] },  // Right end
    ];
    
    this.shapeEdit.handles = handles.map((h) => {
      const m = new THREE.Mesh(handleGeo, handleMat.clone());
      // Rotate local position by rotationY (only X affects world X/Z)
      const x = h.local[0] * cosY - h.local[2] * sinY;
      const z = h.local[0] * sinY + h.local[2] * cosY;
      m.position.set(
        box.centerX + x,
        box.centerY + h.local[1],
        box.centerZ + z
      );
      m.userData.isEditorHelper = true;
      m.userData.shapeCorner = h.corner;
      this.scene.add(m);
      return m;
    });
  }

  _updateWallShapeEditGizmos(box) {
    if (this.shapeEdit.outline) {
      // Update wireframe box
      const geometry = new THREE.BoxGeometry(box.width, box.height, box.thickness);
      const edges = new THREE.EdgesGeometry(geometry);
      this.shapeEdit.outline.geometry.dispose();
      this.shapeEdit.outline.geometry = edges;
      this.shapeEdit.outline.rotation.y = box.rotationY;
      this.shapeEdit.outline.position.set(box.centerX, box.centerY, box.centerZ);
    }
    
    // Update handle positions (only 2 handles: left and right ends)
    const cosY = Math.cos(box.rotationY);
    const sinY = Math.sin(box.rotationY);
    const halfW = box.width / 2;
    
    const handlePositions = {
      left: [-halfW, 0, 0],
      right: [halfW, 0, 0],
    };
    
    (this.shapeEdit.handles || []).forEach((h) => {
      const corner = h.userData.shapeCorner;
      const local = handlePositions[corner];
      if (!local) return;
      
      const x = local[0] * cosY - local[2] * sinY;
      const z = local[0] * sinY + local[2] * cosY;
      h.position.set(
        box.centerX + x,
        box.centerY + local[1],
        box.centerZ + z
      );
    });
  }

  _updateShapeEditDrag() {
    const block = this.shapeEdit.block;
    if (!block || !this.camera) return;

    if (this.shapeEdit.mode === '3d') {
      // 3D wall editing - only edit length (width)
      this.raycaster.setFromCamera(this.mouse, this.camera);
      
      const handle = this.shapeEdit.draggingHandle; // 'left' or 'right'
      const box0 = this.shapeEdit.original?.box;
      if (!box0) return;
      
      const cosY = Math.cos(box0.rotationY);
      const sinY = Math.sin(box0.rotationY);
      
      // The length axis is along the wall's local X direction
      const lengthAxis = new THREE.Vector3(cosY, 0, sinY).normalize();
      
      // Use a plane that is perpendicular to the camera's up or side direction
      // but contains the wall's center. A horizontal plane (Y=centerY) is usually best
      // for walls since they are vertical.
      const planeNormal = new THREE.Vector3(0, 1, 0);
      const planePoint = new THREE.Vector3(box0.centerX, box0.centerY, box0.centerZ);
      
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint);
      const hit = new THREE.Vector3();
      const ok = this.raycaster.ray.intersectPlane(plane, hit);
      if (!ok) return;

      if (this.snapToGrid) {
        // Project hit point onto the length axis for snapping
        const toHit = hit.clone().sub(planePoint);
        const projectedDist = toHit.dot(lengthAxis);
        const snappedDist = Math.round(projectedDist / this.gridSize) * this.gridSize;
        hit.copy(planePoint).add(lengthAxis.clone().multiplyScalar(snappedDist));
      }

      const minSize = Math.max(this.gridSize, 0.5);
      let { centerX, centerY, centerZ, thickness, height, width, rotationY } = box0;
      
      // Get the fixed end (opposite handle) in local space
      const fixedEndLocalX = handle === 'left' ? width / 2 : -width / 2;
      
      // Transform hit point to local space (relative to wall center)
      const dx = hit.x - centerX;
      const dz = hit.z - centerZ;
      const localX = dx * cosY + dz * sinY;
      
      // Calculate new width from fixed end to dragged end
      const draggedEndLocalX = localX;
      width = Math.max(minSize, Math.abs(draggedEndLocalX - fixedEndLocalX));
      
      // Calculate new center (midpoint between fixed end and dragged end)
      const newLocalX = (draggedEndLocalX + fixedEndLocalX) / 2;
      
      // Transform back to world space
      const newWorldX = centerX + newLocalX * cosY;
      const newWorldZ = centerZ + newLocalX * sinY;
      
      const box = { 
        centerX: newWorldX, 
        centerY: centerY,  // Keep Y fixed
        centerZ: newWorldZ, 
        thickness,  // Keep thickness fixed
        height,  // Keep height fixed
        width,  // Only width changes
        rotationY 
      };
      this._applyBoxToWall(block, box);
      this._updateWallShapeEditGizmos(box);
      
      // Allow continued drags from new shape
      this.shapeEdit.original = { box };
    } else {
      // 2D platform editing (existing code)
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.shapeEdit.planeY);
      const hit = new THREE.Vector3();
      const ok = this.raycaster.ray.intersectPlane(plane, hit);
      if (!ok) return;

      if (this.snapToGrid) {
        hit.x = Math.round(hit.x / this.gridSize) * this.gridSize;
        hit.z = Math.round(hit.z / this.gridSize) * this.gridSize;
      }

      const minSize = Math.max(this.gridSize, 1);
      const rect0 = this.shapeEdit.original?.rect;
      if (!rect0) return;

      // Opposite corner stays fixed from rect0; dragged corner moves with hit
      let { minX, maxX, minZ, maxZ } = rect0;
      const corner = this.shapeEdit.draggingHandle;
      if (corner === 'bl') {
        minX = Math.min(hit.x, maxX - minSize);
        minZ = Math.min(hit.z, maxZ - minSize);
      } else if (corner === 'br') {
        maxX = Math.max(hit.x, minX + minSize);
        minZ = Math.min(hit.z, maxZ - minSize);
      } else if (corner === 'tr') {
        maxX = Math.max(hit.x, minX + minSize);
        maxZ = Math.max(hit.z, minZ + minSize);
      } else if (corner === 'tl') {
        minX = Math.min(hit.x, maxX - minSize);
        maxZ = Math.max(hit.z, minZ + minSize);
      }

      const rect = { minX, maxX, minZ, maxZ };
      this._applyRectToBlock(block, rect);
      this._updateShapeEditGizmos(rect);

      // Allow continued drags from new shape
      this.shapeEdit.original = { rect };
    }
  }

  _applyRectToBlock(block, rect) {
    const sx = Math.max(0.001, rect.maxX - rect.minX);
    const sz = Math.max(0.001, rect.maxZ - rect.minZ);
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;

    block.size[0] = sx;
    block.size[2] = sz;
    block.position[0] = cx;
    block.position[2] = cz;
    block.rotation[1] = 0;

    // Update mesh
    if (block.mesh) {
      block.mesh.geometry.dispose();
      block.mesh.geometry = new THREE.BoxGeometry(sx, block.size[1], sz);
      block.mesh.position.set(cx, block.position[1], cz);
      block.mesh.rotation.y = 0;
    }

    // Rebuild physics collider (fixed body)
    const world = this.physicsWorld.getWorld();
    if (block.body) {
      world.removeRigidBody(block.body);
    }
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(cx, block.position[1], cz);
    const body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(sx / 2, block.size[1] / 2, sz / 2);
    const collider = world.createCollider(colliderDesc, body);
    block.body = body;
    block.collider = collider;
  }

  _applyBoxToWall(block, box) {
    // For walls: size is [width, height, thickness] to match Three.js BoxGeometry(width, height, depth)
    block.size[0] = Math.max(0.001, box.width);
    block.size[1] = Math.max(0.001, box.height);
    block.size[2] = Math.max(0.001, box.thickness);
    block.position[0] = box.centerX;
    block.position[1] = box.centerY;
    block.position[2] = box.centerZ;
    block.rotation[1] = box.rotationY;

    // Update mesh
    if (block.mesh) {
      block.mesh.geometry.dispose();
      block.mesh.geometry = new THREE.BoxGeometry(block.size[0], block.size[1], block.size[2]);
      block.mesh.position.set(block.position[0], block.position[1], block.position[2]);
      block.mesh.rotation.y = block.rotation[1];
    }

    // Rebuild physics collider (fixed body)
    const world = this.physicsWorld.getWorld();
    if (block.body) {
      world.removeRigidBody(block.body);
    }
    
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(block.rotation[0], block.rotation[1], block.rotation[2])
    );
    
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(block.position[0], block.position[1], block.position[2])
      .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
    
    const body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(block.size[0] / 2, block.size[1] / 2, block.size[2] / 2);
    const collider = world.createCollider(colliderDesc, body);
    block.body = body;
    block.collider = collider;
  }

  rotateBlock() {
    // If we're editing spawn placement, rotate the spawn preview car instead.
    if (!this.selectedBlock && this.currentTool === 'spawn') {
      const team = this.currentTeam;
      const sp = this.spawnPoints?.[team];
      if (!sp) return;
      const next = ((sp.rotation?.[1] || 0) + Math.PI / 2);
      sp.rotation = [0, next, 0];
      if (this.markers.spawn[team]) {
        this.markers.spawn[team].rotation.y = next;
      }
      // Update UI label
      const rotateBtn = document.getElementById('rotateBtn');
      if (rotateBtn) {
        this.currentRotation = (this.currentRotation + 90) % 360;
        rotateBtn.textContent = `Rotate (${this.currentRotation}°)`;
      }
      return;
    }

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

    if (this.shapeEdit.active && this.shapeEdit.block === this.selectedBlock) {
      this.exitShapeEditMode();
    }
    
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
    if (this.shapeEdit?.active) {
      this.exitShapeEditMode();
    }
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
      if (this.markers.spawn.red) this.markers.spawn.red.rotation.y = this.spawnPoints.red.rotation?.[1] || 0;
    }
    if (spB?.position) {
      this.spawnPoints.blue = { position: spB.position, rotation: spB.rotation || [0, -Math.PI / 2, 0] };
      this.ensureSpawnMarker('blue');
      this.markers.spawn.blue.position.set(spB.position[0], spB.position[1], spB.position[2]);
      if (this.markers.spawn.blue) this.markers.spawn.blue.rotation.y = this.spawnPoints.blue.rotation?.[1] || 0;
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

  _loadSpawnCarTemplate(team) {
    const t = team === 'blue' ? 'blue' : 'red';
    if (this.spawnCarTemplates[t]) return Promise.resolve(this.spawnCarTemplates[t]);
    if (this.spawnCarTemplatePromises[t]) return this.spawnCarTemplatePromises[t];

    const modelPath = t === 'blue' ? '/models/blueCar.glb' : '/models/redCar.glb';
    const loader = new GLTFLoader();
    this.spawnCarTemplatePromises[t] = new Promise((resolve, reject) => {
      loader.load(
        modelPath,
        (gltf) => {
          const scene = gltf.scene;
          // Scale similarly to gameplay previews: scale to a target length.
          const box = new THREE.Box3().setFromObject(scene);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const targetZ = 8;
          const scale = targetZ / Math.max(0.0001, size.z);
          scene.scale.set(scale, scale, scale);
          scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

          // Keep it lightweight in editor
          scene.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = false;
              child.receiveShadow = false;
            }
          });

          this.spawnCarTemplates[t] = scene;
          resolve(scene);
        },
        undefined,
        (err) => reject(err)
      );
    });

    return this.spawnCarTemplatePromises[t];
  }

  ensureSpawnMarker(team) {
    if (this.markers.spawn[team]) return;

    // Temporary placeholder (box) so user sees *something* immediately
    const color = team === 'red' ? 0xff4444 : 0x4444ff;
    const placeholderGeo = new THREE.BoxGeometry(3, 1.2, 6);
    const placeholderMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.15 });
    const placeholder = new THREE.Mesh(placeholderGeo, placeholderMat);
    placeholder.userData.isMapObject = true;
    placeholder.userData.isEditorHelper = true;
    this.scene.add(placeholder);
    this.markers.spawn[team] = placeholder;

    // Replace with GLTF car once loaded
    this._loadSpawnCarTemplate(team)
      .then((template) => {
        // Marker might have been cleared while loading
        if (!this.markers.spawn[team]) return;

        // Remove placeholder
        this.scene.remove(this.markers.spawn[team]);
        this.clearMarker('spawn', team);

        const car = template.clone(true);
        car.userData.isMapObject = true;
        car.userData.isEditorHelper = true;
        this.scene.add(car);
        this.markers.spawn[team] = car;

        // Apply current spawn state if it exists
        const sp = this.spawnPoints?.[team];
        if (sp?.position) {
          car.position.set(sp.position[0], sp.position[1], sp.position[2]);
        }
        const rotY = sp?.rotation?.[1] || (team === 'red' ? Math.PI / 2 : -Math.PI / 2);
        car.rotation.y = rotY;
      })
      .catch((err) => {
        console.warn('⚠️ Failed to load spawn car model:', err);
      });
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
    // Dispose meshes inside groups too
    m.traverse?.((child) => {
      if (child?.isMesh) {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((mat) => mat?.dispose?.());
        else child.material?.dispose?.();
      }
    });
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
    if (this.markers.spawn[team]) {
      this.markers.spawn[team].position.copy(pos);
      this.markers.spawn[team].rotation.y = rotY;
    }
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
