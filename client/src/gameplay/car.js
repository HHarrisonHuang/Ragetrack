import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d';
import { CAR } from '../../../shared/constants.js';

export class Car {
  constructor(scene, physicsWorld, position = new THREE.Vector3(0, 5, 0), rotation = new THREE.Euler(0, 0, 0), team = 'red') {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.position = position.clone();
    this.rotation = rotation.clone();
    this.team = team; // 'red' or 'blue'
    
    // Input state
    this.inputState = {
      throttle: 0,
      brake: 0,
      steer: 0,
    };

    // Physics state
    this.rigidBody = null;
    this.collider = null;
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.angularVelocity = new THREE.Vector3(0, 0, 0);
    
    // Visual
    this.mesh = null;
    this.model = null; // The loaded GLB model
    this.isEliminated = false;
    this.hasFlag = false;
    this.invincibleUntil = 0;

    // We'll create physics after loading the model to match its dimensions
    this.rigidBody = null;
    this.collider = null;
    
    // We'll create tempMesh after loading the model to get its dimensions
    // tempMesh will be created in createTempMeshFromModel()
    this.tempMesh = null;
    this.helperSphere = null;

    // Multiplayer snapshot smoothing (client only renders server state)
    // Use a small snapshot buffer and render slightly "in the past" for smooth big turns.
    this.netHistory = []; // [{ t:number(ms), pos:THREE.Vector3, quat:THREE.Quaternion }]
    this.netRenderDelayMs = 150; // Increased delay for smoother interpolation
    this.netTimeOffsetMs = null; // localNow - serverNow (smoothed)
    this.netSnapImmediate = true; // snap on first state to avoid starting offset
    this.netSmoothedPos = null; // Exponential smoothing for position
    this.netSmoothedQuat = null; // Exponential smoothing for quaternion
    
    // Load visual model asynchronously
    // Use setTimeout to avoid blocking and allow browser to handle extension messages
    setTimeout(() => {
      // First, quickly load the model to get its dimensions for tempMesh and physics
      this.createTempMeshFromModel().then(() => {
        // Now create physics with model dimensions
        this.createPhysics();
        // Now load the full model
        return this.createVisual();
      }).then(() => {
        // DON'T remove tempMesh automatically - only remove it manually if model is confirmed visible
        // We'll check in the update loop or after a longer delay
        console.log('✅ Model loading promise resolved, but keeping tempMesh visible for now');
        
        // Check after 5 seconds if model is actually visible and rendering
        setTimeout(() => {
          if (this.tempMesh && this.model) {
            // Verify model is actually visible and has valid geometry
            let modelVisible = false;
            let modelHasGeometry = false;
            let modelInScene = this.scene.children.includes(this.model);
            
            this.model.traverse((child) => {
              if (child.isMesh) {
                modelHasGeometry = true;
                if (child.visible && child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
                  modelVisible = true;
                }
              }
            });
            
            console.log('🔍 Checking model visibility after 5 seconds:', {
              modelInScene,
              modelHasGeometry,
              modelVisible,
              modelPosition: this.model.position,
              modelScale: this.model.scale,
              modelVisible: this.model.visible
            });
            
            // Only remove tempMesh if model is definitely visible and rendering
            if (modelVisible && modelHasGeometry && modelInScene) {
              // Double-check: is model actually in view and has reasonable size?
              const modelBox = new THREE.Box3().setFromObject(this.model);
              const modelSize = modelBox.getSize(new THREE.Vector3());
              
              console.log('  - Model bounding box size:', modelSize);
              console.log('  - Model size length:', modelSize.length());
              
              if (modelSize.length() > 0.1) { // Model has reasonable size (at least 0.1 units)
                console.log('✅ Model confirmed visible and has reasonable size, removing temporary placeholder');
                // Make tempMesh slightly transparent first so we can see if model appears
                this.tempMesh.material.opacity = 0.3;
                this.tempMesh.material.transparent = true;
                
                // Wait another second to see if model is actually visible
                setTimeout(() => {
                  if (this.tempMesh) {
                    console.log('✅ Removing tempMesh now - model should be visible');
                    this.scene.remove(this.tempMesh);
                    this.tempMesh.geometry.dispose();
                    this.tempMesh.material.dispose();
                    this.tempMesh = null;
                  }
                }, 1000);
              } else {
                console.warn('⚠️ Model has no reasonable size, keeping tempMesh as car');
                this.mesh = this.tempMesh;
                // Keep team color (red or blue) - already set correctly
                this.tempMesh.material.opacity = 1.0;
                this.tempMesh.material.transparent = false;
              }
              } else {
                console.warn('⚠️ Model not confirmed visible, keeping tempMesh as car visual');
                // Keep tempMesh as the permanent visual
                this.mesh = this.tempMesh;
                // Keep team color (red or blue) - already set correctly
                this.tempMesh.material.opacity = 1.0;
                this.tempMesh.material.transparent = false;
              }
          } else if (this.tempMesh && !this.model) {
            // Model never loaded, keep tempMesh permanently
            console.log('✅ No model loaded, keeping tempMesh as permanent car visual');
            this.mesh = this.tempMesh;
            this.tempMesh.material.color.setHex(0xff8800);
          }
        }, 5000); // Wait 5 seconds to ensure model is fully rendered
      }).catch(err => {
        console.error('Failed to create car visual:', err);
        // Keep the temporary mesh visible if model fails - DON'T remove it
        if (this.tempMesh) {
          console.log('✅ Model failed to load, keeping tempMesh as permanent car visual');
          // Make it the permanent mesh
          this.mesh = this.tempMesh;
          // Keep team color (red or blue) - it's already set correctly
          // Don't remove it - it's now the car visual
        }
      }).catch(err => {
        console.error('Failed to create tempMesh from model:', err);
        // If tempMesh creation fails, create a default one
        this.modelSize = new THREE.Vector3(4, 2, 6); // Default car-like size
        this.modelCenter = new THREE.Vector3(0, 0, 0);
        
        const teamColor = this.team === 'blue' ? 0x0000ff : 0xff0000;
        const tempGeometry = new THREE.BoxGeometry(this.modelSize.x, this.modelSize.y, this.modelSize.z);
        const tempMaterial = new THREE.MeshBasicMaterial({ 
          color: teamColor, 
          wireframe: false,
          side: THREE.DoubleSide,
          transparent: false,
          opacity: 1.0
        });
        this.tempMesh = new THREE.Mesh(tempGeometry, tempMaterial);
        this.tempMesh.position.copy(this.position);
        this.tempMesh.position.x -= 1; // Match collider offset: 1 unit left
        this.tempMesh.position.y += 1; // Match collider offset: 1 unit up
        this.tempMesh.rotation.copy(this.rotation);
        this.tempMesh.visible = true;
        this.tempMesh.renderOrder = 999;
        this.tempMesh.frustumCulled = false;
        this.scene.add(this.tempMesh);
        
        // Create physics with default size
        this.createPhysics();
        
        // Try to load the full model anyway
        this.createVisual().catch(err => {
          console.error('Failed to create car visual after tempMesh fallback:', err);
        });
      });
    }, 100); // Small delay to let browser extensions settle
  }

  /**
   * Apply an authoritative server state (minimal multiplayer style).
   * Expected shape:
   * - state.position: [x, y, z]
   * - state.rotation: [x, y, z, w] quaternion (preferred) OR [x, y, z] Euler fallback
   */
  applyServerState(state) {
    if (!state) return;

    const pos = state.position;
    let nextPos = null;
    if (Array.isArray(pos) && pos.length >= 3) {
      const x = Number(pos[0]);
      const y = Number(pos[1]);
      const z = Number(pos[2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        nextPos = new THREE.Vector3(x, y, z);
      }
    }

    let q = null;
    const rot = state.rotation;
    if (Array.isArray(rot) && rot.length === 4) {
      const x = Number(rot[0]);
      const y = Number(rot[1]);
      const z = Number(rot[2]);
      const w = Number(rot[3]);
      if ([x, y, z, w].every(Number.isFinite)) {
        q = new THREE.Quaternion(x, y, z, w);
      }
    } else if (Array.isArray(rot) && rot.length >= 3) {
      // Fallback: treat as Euler (x, y, z)
      const ex = Number(rot[0]) || 0;
      const ey = Number(rot[1]) || 0;
      const ez = Number(rot[2]) || 0;
      const euler = new THREE.Euler(ex, ey, ez);
      q = new THREE.Quaternion().setFromEuler(euler);
    }

    // Push into snapshot history (timestamped)
    if (nextPos && q) {
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const st = Number(state.t);
      if (Number.isFinite(st)) {
        const estOffset = now - st;
        this.netTimeOffsetMs = (this.netTimeOffsetMs == null) ? estOffset : (this.netTimeOffsetMs * 0.9 + estOffset * 0.1);
        this.netHistory.push({ t: st, pos: nextPos, quat: q });
      } else {
        // Fallback (no server timestamp): use local receipt time
        this.netHistory.push({ t: now, pos: nextPos, quat: q });
      }
      if (this.netHistory.length > 10) this.netHistory.splice(0, this.netHistory.length - 10);
    }

    // On first snapshot, snap immediately so camera + visuals don't start offset.
    if (this.netHistory.length > 0 && this.netSnapImmediate) {
      const last = this.netHistory[this.netHistory.length - 1];
      this.position.copy(last.pos);
      const visuals = [this.tempMesh, this.model, this.mesh].filter(Boolean);
      visuals.forEach((obj) => {
        obj.position.copy(this.position);
        // Apply collider offset to tempMesh only (model has its own offset)
        if (obj === this.tempMesh) {
          obj.position.x -= 1; // Match collider offset: 1 unit left
          obj.position.y += 1; // Match collider offset: 1 unit up
        }
        obj.quaternion.copy(last.quat);
        obj.updateMatrixWorld?.(true);
      });
      this.netSnapImmediate = false;
    }
  }

  /**
   * Smoothly move visuals toward latest server snapshot.
   * Call every animation frame while in multiplayer.
   */
  interpolateFromNetwork(deltaTime) {
    if (!this.netHistory || this.netHistory.length === 0) return;

    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const serverNow = (this.netTimeOffsetMs == null) ? now : (now - this.netTimeOffsetMs);
    const renderT = serverNow - (this.netRenderDelayMs || 0);

    // Find snapshots surrounding renderT
    let a = null;
    let b = null;
    for (let i = 0; i < this.netHistory.length; i++) {
      const s = this.netHistory[i];
      if (s.t <= renderT) a = s;
      if (s.t >= renderT) { b = s; break; }
    }

    if (!a) a = this.netHistory[0];
    if (!b) b = this.netHistory[this.netHistory.length - 1];

    let alpha = 0;
    const span = (b.t - a.t);
    if (span > 0.0001) alpha = Math.max(0, Math.min(1, (renderT - a.t) / span));

    const interpPos = a.pos.clone().lerp(b.pos, alpha);
    const interpQuat = a.quat.clone().slerp(b.quat, alpha);

    // Apply exponential smoothing to reduce jitter/shaking
    const smoothingFactor = 0.3; // Lower = smoother but more lag
    if (this.netSmoothedPos === null) {
      this.netSmoothedPos = interpPos.clone();
      this.netSmoothedQuat = interpQuat.clone();
    } else {
      this.netSmoothedPos.lerp(interpPos, smoothingFactor);
      this.netSmoothedQuat.slerp(interpQuat, smoothingFactor);
    }

    this.position.copy(this.netSmoothedPos);
    const visuals = [this.tempMesh, this.model, this.mesh].filter(Boolean);
    visuals.forEach((obj) => {
      obj.position.copy(this.netSmoothedPos);
      // Apply collider offset to tempMesh only (model has its own offset)
      if (obj === this.tempMesh) {
        obj.position.x -= 1; // Match collider offset: 1 unit left
        obj.position.y += 1; // Match collider offset: 1 unit up
      }
      obj.quaternion.copy(this.netSmoothedQuat);
      obj.updateMatrixWorld?.(true);
    });
  }

  async createTempMeshFromModel() {
    // Quickly load the model just to get its dimensions
    try {
      const modelPath = this.team === 'blue' ? '/models/blueCar.glb' : '/models/redCar.glb';
      const loader = new GLTFLoader();
      
      const gltf = await new Promise((resolve, reject) => {
        loader.load(
          modelPath,
          (gltf) => resolve(gltf),
          undefined,
          (error) => reject(error)
        );
      });
      
      // Get model dimensions (unscaled)
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      
      console.log('📐 Model dimensions:', size, 'center:', center);
      
      // Store model dimensions (unscaled) for later scaling
      this.modelSize = size;
      this.modelCenter = center;
      
      // Create tempMesh matching model dimensions
      const teamColor = this.team === 'blue' ? 0x0000ff : 0xff0000;
      // Make tempMesh match the *final* desired collision size (server+client agreement).
      const tgt = CAR.VISUAL_TARGET_SIZE || { x: 4, y: 2, z: 8 };
      const tempGeometry = new THREE.BoxGeometry(tgt.x, tgt.y, tgt.z);
      const tempMaterial = new THREE.MeshBasicMaterial({ 
        color: teamColor, 
        wireframe: false,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1.0
      });
      this.tempMesh = new THREE.Mesh(tempGeometry, tempMaterial);
      this.tempMesh.position.copy(this.position);
      this.tempMesh.position.x -= 1; // Match collider offset: 1 unit left
      this.tempMesh.position.y += 1; // Match collider offset: 1 unit up
      this.tempMesh.rotation.copy(this.rotation);
      this.tempMesh.visible = true;
      this.tempMesh.renderOrder = 999;
      this.tempMesh.frustumCulled = false;
      this.tempMesh.matrixAutoUpdate = true;
      
      this.scene.add(this.tempMesh);
      this.tempMesh.updateMatrix();
      this.tempMesh.updateMatrixWorld(true);
      
      console.log('📦 Temporary car placeholder created matching model size:', size);
    } catch (error) {
      console.warn('⚠️ Could not load model for tempMesh sizing, using default size:', error);
      // Fallback to default size
      this.modelSize = new THREE.Vector3(4, 2, 8); // Default car-like size (matches VISUAL_TARGET_SIZE)
      this.modelCenter = new THREE.Vector3(0, 0, 0);
      
      const teamColor = this.team === 'blue' ? 0x0000ff : 0xff0000;
      const tgt = CAR.VISUAL_TARGET_SIZE || { x: this.modelSize.x, y: this.modelSize.y, z: this.modelSize.z };
      const tempGeometry = new THREE.BoxGeometry(tgt.x, tgt.y, tgt.z);
      const tempMaterial = new THREE.MeshBasicMaterial({ 
        color: teamColor, 
        wireframe: false,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1.0
      });
      this.tempMesh = new THREE.Mesh(tempGeometry, tempMaterial);
      this.tempMesh.position.copy(this.position);
      this.tempMesh.position.x -= 1; // Match collider offset: 1 unit left
      this.tempMesh.position.y += 1; // Match collider offset: 1 unit up
      this.tempMesh.rotation.copy(this.rotation);
      this.tempMesh.visible = true;
      this.tempMesh.renderOrder = 999;
      this.tempMesh.frustumCulled = false;
      this.tempMesh.matrixAutoUpdate = true;
      this.scene.add(this.tempMesh);
      this.tempMesh.updateMatrix();
      this.tempMesh.updateMatrixWorld(true);
    }
  }

  async createVisual() {
    try {
      // Load the correct model based on team
      const modelPath = this.team === 'blue' ? '/models/blueCar.glb' : '/models/redCar.glb';
      console.log(`📦 Loading car model from ${modelPath} for team: ${this.team}`);
      const loader = new GLTFLoader();
      
      // Add error handling for the loader
      const gltf = await new Promise((resolve, reject) => {
        loader.load(
          modelPath,
          (gltf) => resolve(gltf),
          (progress) => {
            if (progress.lengthComputable) {
              const percentComplete = (progress.loaded / progress.total) * 100;
              console.log('  - Loading progress:', percentComplete.toFixed(1) + '%');
            }
          },
          (error) => {
            console.error('  - Loader error:', error);
            reject(error);
          }
        );
      });
      
      console.log('✅ GLTF loaded, scene:', gltf.scene);
      
      // Get the model from the scene
      this.model = gltf.scene;
      
      // Enable shadows (models already have correct colors)
      this.model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          console.log('  - Mesh found:', child.name || 'unnamed');
        }
      });
      
      // Calculate bounding box to understand model size
      const box = new THREE.Box3().setFromObject(this.model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      console.log('  - Model bounding box size:', size);
      console.log('  - Model center:', center);
      
      // Scale model so it matches the collision box size (server + client agree).
      // Use the Z length as reference (car length).
      const tgt = CAR.VISUAL_TARGET_SIZE || { x: 4, y: 2, z: 8 };
      const baseLen = Math.max(0.0001, size.z);
      const scale = tgt.z / baseLen;
      this.model.scale.set(scale, scale, scale);
      
      // Center the model if it's offset
      this.model.position.copy(this.position);
      if (center.length() > 0.01) {
        this.model.position.sub(center.multiplyScalar(scale));
        console.log('  - Adjusted position to center model');
      }
      
      this.model.rotation.copy(this.rotation);
      
      // Ensure model is visible
      this.model.visible = true;
      this.model.traverse((child) => {
        child.visible = true;
      });
      
      // Use the model as the mesh for position updates
      this.mesh = this.model;
      this.scene.add(this.model);
      
      // Calculate final bounding box after scaling
      const finalBox = new THREE.Box3().setFromObject(this.model);
      const finalSize = finalBox.getSize(new THREE.Vector3());
      const finalCenter = finalBox.getCenter(new THREE.Vector3());
      
      console.log('  - Final model position:', this.model.position);
      console.log('  - Final model scale:', this.model.scale);
      console.log('  - Final bounding box size:', finalSize);
      console.log('  - Final bounding box center:', finalCenter);
      
      console.log('✅ Car 3D model loaded and added to scene');
      console.log('  - Position:', this.model.position);
      console.log('  - Scale:', this.model.scale);
      console.log('  - Children count:', this.model.children.length);
      console.log('  - TempMesh still exists:', !!this.tempMesh);
      console.log('  - TempMesh visible:', this.tempMesh?.visible);
      
      // Keep model scale driven by VISUAL_TARGET_SIZE so it matches collider.
      
      // Check if model is visible
      let hasVisibleMeshes = false;
      this.model.traverse((child) => {
        if (child.isMesh) {
          console.log(`  - Mesh "${child.name || 'unnamed'}" visible:`, child.visible);
          if (child.visible) hasVisibleMeshes = true;
        }
      });
      
      // Keep tempMesh visible for now - it will be removed after 5 seconds if model is confirmed visible
      // Don't remove it here - let the setTimeout in constructor handle it
      if (this.tempMesh) {
        if (hasVisibleMeshes) {
          console.log('  - Model has visible meshes, tempMesh will be checked in 5 seconds');
        } else {
          console.warn('  - ⚠️ Model has no visible meshes! Will keep tempMesh as car visual');
          // Model isn't visible, so keep tempMesh as the visual
          this.mesh = this.tempMesh;
          this.tempMesh.material.color.setHex(0xff8800); // Orange
        }
      }
    } catch (error) {
      console.error('❌ Failed to load car model, using fallback box:', error);
      console.error('Error details:', error.message, error.stack);
      // Fallback to box if model fails to load
      const geometry = new THREE.BoxGeometry(2, 1, 4);
      const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
      this.mesh = new THREE.Mesh(geometry, material);
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;
      this.mesh.position.copy(this.position);
      this.mesh.rotation.copy(this.rotation);
      this.scene.add(this.mesh);
      console.log('✅ Fallback box created at position:', this.mesh.position);
    }
  }

  createPhysics() {
    const world = this.physicsWorld.getWorld();
    
    // Create rigid body
    // IMPORTANT: Rapier expects a quaternion; our car stores Euler angles.
    const initialQuat = new THREE.Quaternion().setFromEuler(this.rotation);
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.position.x, this.position.y, this.position.z)
      .setRotation({
        x: initialQuat.x,
        y: initialQuat.y,
        z: initialQuat.z,
        w: initialQuat.w,
      });
    
    this.rigidBody = world.createRigidBody(rigidBodyDesc);
    
    // Set damping to prevent excessive spinning and sliding
    // Try to set damping on the rigid body (if methods exist)
    if (this.rigidBody && typeof this.rigidBody.setLinvelDamping === 'function') {
      this.rigidBody.setLinvelDamping(0.1); // Linear damping
    }
    if (this.rigidBody && typeof this.rigidBody.setAngvelDamping === 'function') {
      this.rigidBody.setAngvelDamping(5.0); // Strong angular damping to prevent wild spinning
    }
    
    // Create collider using shared constant so server + client match exactly.
    const he = CAR.COLLIDER_HALF_EXTENTS || { x: 2, y: 1, z: 4 };
    
    const colliderDesc = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
      .setMass(CAR.MASS)
      .setFriction(0.7)
      .setRestitution(0.6) // Increased for more bounce
      .setTranslation(-1, 1, 0); // Offset: 1 unit left, 1 unit up
    
    this.collider = world.createCollider(colliderDesc, this.rigidBody);
    console.log('✅ Physics collider created with half-extents:', he, 'offset: (-1, 1, 0)');
  }

  setInput(throttle, brake, steer) {
    this.inputState.throttle = Math.max(-1, Math.min(1, throttle));
    this.inputState.brake = Math.max(0, Math.min(1, brake));
    this.inputState.steer = Math.max(-1, Math.min(1, steer));
  }

  getInputState() {
    return { ...this.inputState };
  }

  update(deltaTime) {
    if (!this.rigidBody || this.isEliminated) return;

    const body = this.rigidBody;
    const linvel = body.linvel();
    const angvel = body.angvel();
    
    // Get current velocity
    this.velocity.set(linvel.x, linvel.y, linvel.z);
    this.angularVelocity.set(angvel.x, angvel.y, angvel.z);

    // Get forward direction from rotation
    const rotation = body.rotation();
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));
    
    const right = new THREE.Vector3(1, 0, 0);
    right.applyQuaternion(new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));

    // Apply throttle/brake with steering-based direction
    const speed = this.velocity.length();
    let acceleration = 0;
    
    // Signed throttle: forward(+), reverse(-)
    if (this.inputState.throttle !== 0) {
      acceleration = CAR.ACCELERATION * this.inputState.throttle;
    }

    // Steering changes the direction of movement (not body rotation)
    // Rotate forward direction by steering angle around Y axis
    const handlingMultiplier = this.hasFlag ? CAR.FLAG_CARRIER_HANDLING_PENALTY : 1.0;
    const steerAngle = this.inputState.steer * 0.3 * handlingMultiplier; // Max ~17 degrees per frame
    
    // Rotate forward vector around Y axis by steer angle
    const cosSteer = Math.cos(steerAngle);
    const sinSteer = Math.sin(steerAngle);
    const steeredForward = new THREE.Vector3(
      forward.x * cosSteer - forward.z * sinSteer,
      forward.y,
      forward.x * sinSteer + forward.z * cosSteer
    );

    // Apply force in steered direction
    if (acceleration !== 0) {
      const force = steeredForward.multiplyScalar(acceleration);
      body.applyImpulse({ x: force.x, y: force.y, z: force.z }, true);
    }

    // Extra braking: dampen velocity when Space is held.
    if (this.inputState.brake > 0 && speed > 0.01) {
      const brakeScale = 1 - Math.min(0.3, 0.2 * this.inputState.brake);
      body.setLinvel({ x: linvel.x * brakeScale, y: linvel.y, z: linvel.z * brakeScale }, true);
    }
    
    // Rotate car body to face movement direction (separate from steering)
    // This makes the car visually turn as it moves in the steered direction
    const currentVel = new THREE.Vector3(linvel.x, 0, linvel.z);
    const velLen = currentVel.length();
    if (velLen > 0.1) {
      // Normalize velocity to get direction the car is moving
      const velDir = currentVel.normalize();
      
      // Calculate angle between car's forward direction and movement direction
      // Using atan2 on the cross product gives us the signed angle
      const dot = forward.x * velDir.x + forward.z * velDir.z;
      const cross = forward.x * velDir.z - forward.z * velDir.x;
      const angleDiff = Math.atan2(cross, dot);
      
      // Apply proportional rotation torque - stronger when angle difference is larger
      // Use the angle directly (in radians) for smooth rotation
      const rotationTorque = angleDiff * 500; // Proportional control - adjust multiplier for responsiveness
      
      body.applyTorqueImpulse({
        x: 0,
        y: rotationTorque,
        z: 0,
      }, true);
    }

    // Apply friction
    const friction = this.velocity.clone().multiplyScalar(-CAR.FRICTION);
    body.applyImpulse({ x: friction.x, y: 0, z: friction.z }, true);

    // Limit max speed
    if (speed > CAR.MAX_SPEED) {
      const limitedVel = this.velocity.normalize().multiplyScalar(CAR.MAX_SPEED);
      body.setLinvel({ x: limitedVel.x, y: limitedVel.y, z: limitedVel.z }, true);
    }

    // Limit angular velocity to prevent excessive spinning
    const angularSpeed = this.angularVelocity.length();
    const maxAngularSpeed = 8.0; // Radians per second - allows some spinning but not excessive
    if (angularSpeed > maxAngularSpeed) {
      const scale = maxAngularSpeed / angularSpeed;
      const limitedAngVel = this.angularVelocity.clone().multiplyScalar(scale);
      body.setAngvel({ x: limitedAngVel.x, y: limitedAngVel.y, z: limitedAngVel.z }, true);
    }

    // Update visual position from physics
    const translation = body.translation();
    this.position.set(translation.x, translation.y, translation.z);
    
    // Get rotation from physics
    const rot = body.rotation();
    const quaternion = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    this.rotation.setFromQuaternion(quaternion);
    
    // Update the active visual (mesh, model, or tempMesh)
    if (this.mesh && this.mesh !== this.tempMesh) {
      // Regular mesh (not tempMesh)
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(quaternion);
    } else if (this.model) {
      // Model is loaded
      this.model.position.copy(this.position);
      this.model.quaternion.copy(quaternion);
    }
    
    // tempMesh is updated separately below (it might be the permanent visual)
    
    // Update temporary mesh if it exists (it might be the permanent visual if model failed)
    // Always update tempMesh position/rotation so it follows the car (with collider offset)
    if (this.tempMesh) {
      this.tempMesh.position.copy(this.position);
      this.tempMesh.position.x -= 1; // Match collider offset: 1 unit left
      this.tempMesh.position.y += 1; // Match collider offset: 1 unit up
      this.tempMesh.quaternion.copy(quaternion);
      this.tempMesh.updateMatrixWorld(true);
      
      // If tempMesh is the permanent visual (model failed), also update it as mesh
      if (this.mesh === this.tempMesh) {
        // Already updated above - tempMesh IS the mesh
      }
    }
    
  }

  setEliminated(eliminated) {
    this.isEliminated = eliminated;
    // In multiplayer we might be rendering from snapshots without calling `update()`,
    // and the visible object can be tempMesh/model/mesh depending on load timing.
    if (this.tempMesh) {
      this.tempMesh.visible = !eliminated;
    }
    if (this.mesh) {
      this.mesh.visible = !eliminated;
    }
    if (this.model && this.model !== this.mesh) {
      this.model.visible = !eliminated;
    }
  }

  setInvincible(duration) {
    this.invincibleUntil = Date.now() + duration * 1000;
    const target = this.model || this.mesh;
    if (target) {
      // Visual feedback for invincibility (flashing)
      const flashInterval = setInterval(() => {
        if (target && Date.now() < this.invincibleUntil) {
          target.visible = !target.visible;
        } else {
          clearInterval(flashInterval);
          if (target) target.visible = true;
        }
      }, 100);
    }
  }

  setHasFlag(hasFlag) {
    this.hasFlag = hasFlag;
    // Visual feedback for flag carrier
    if (this.mesh) {
      // Could add flag model or change color
    }
  }

  destroy() {
    if (this.tempMesh) {
      this.scene.remove(this.tempMesh);
      this.tempMesh.geometry.dispose();
      this.tempMesh.material.dispose();
      this.tempMesh = null;
    }
    if (this.helperSphere) {
      this.scene.remove(this.helperSphere);
      this.helperSphere.geometry.dispose();
      this.helperSphere.material.dispose();
      this.helperSphere = null;
    }
    if (this.model) {
      this.scene.remove(this.model);
      // Dispose of all geometries and materials in the model
      this.model.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(material => material.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
    } else if (this.mesh) {
      this.scene.remove(this.mesh);
      if (this.mesh.geometry) this.mesh.geometry.dispose();
      if (this.mesh.material) {
        if (Array.isArray(this.mesh.material)) {
          this.mesh.material.forEach(material => material.dispose());
        } else {
          this.mesh.material.dispose();
        }
      }
    }
    if (this.rigidBody && this.physicsWorld) {
      const world = this.physicsWorld.getWorld();
      world.removeRigidBody(this.rigidBody);
    }
  }
}
