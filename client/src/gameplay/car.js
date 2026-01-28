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
      
      // Get model dimensions
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      
      console.log('📐 Model dimensions:', size, 'center:', center);
      
      // Store model dimensions for physics creation
      this.modelSize = size;
      this.modelCenter = center;
      
      // Create tempMesh matching model dimensions
      const teamColor = this.team === 'blue' ? 0x0000ff : 0xff0000;
      const tempGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
      const tempMaterial = new THREE.MeshBasicMaterial({ 
        color: teamColor, 
        wireframe: false,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1.0
      });
      this.tempMesh = new THREE.Mesh(tempGeometry, tempMaterial);
      this.tempMesh.position.copy(this.position);
      // Adjust position to account for model center offset
      if (center.length() > 0.01) {
        this.tempMesh.position.sub(center);
      }
      this.tempMesh.rotation.copy(this.rotation);
      this.tempMesh.visible = true;
      this.tempMesh.renderOrder = 999;
      this.tempMesh.frustumCulled = false;
      this.tempMesh.matrixAutoUpdate = true;
      
      this.scene.add(this.tempMesh);
      this.tempMesh.updateMatrix();
      this.tempMesh.updateMatrixWorld(true);
      
      console.log('📦 Temporary car placeholder created matching model size:', size);
      
      // Also add helper sphere for debugging
      const helperGeometry = new THREE.SphereGeometry(1, 16, 16);
      const helperMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
      this.helperSphere = new THREE.Mesh(helperGeometry, helperMaterial);
      this.helperSphere.position.copy(this.position);
      this.helperSphere.renderOrder = 1000;
      this.scene.add(this.helperSphere);
    } catch (error) {
      console.warn('⚠️ Could not load model for tempMesh sizing, using default size:', error);
      // Fallback to default size
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
      
      // Scale and position the model
      // Adjust scale if needed based on your model
      // If model is very small or very large, adjust scale
      let scale = 1;
      if (size.length() < 0.1) {
        scale = 10; // Model is very small, scale up
        console.log('  - Model is very small, scaling up by 10x');
      } else if (size.length() > 100) {
        scale = 0.1; // Model is very large, scale down
        console.log('  - Model is very large, scaling down by 0.1x');
      }
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
      
      // If model is very small, scale it up more
      if (finalSize.length() < 0.5) {
        const additionalScale = 5 / finalSize.length(); // Scale to at least 5 units
        this.model.scale.multiplyScalar(additionalScale);
        console.log(`  - ⚠️ Model is very small (${finalSize.length().toFixed(2)}), scaling up by ${additionalScale.toFixed(2)}x`);
        console.log('  - New scale:', this.model.scale);
      }
      
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
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.position.x, this.position.y, this.position.z)
      .setRotation({
        x: this.rotation.x,
        y: this.rotation.y,
        z: this.rotation.z,
        w: 1,
      });
    
    this.rigidBody = world.createRigidBody(rigidBodyDesc);
    
    // Create collider matching model dimensions
    // Use model dimensions if available, otherwise use default
    let colliderSize;
    if (this.modelSize) {
      // Use half-extents (Rapier cuboid uses half-extents)
      colliderSize = {
        x: this.modelSize.x / 2,
        y: this.modelSize.y / 2,
        z: this.modelSize.z / 2
      };
      console.log('📐 Creating physics collider matching model size:', this.modelSize, 'half-extents:', colliderSize);
    } else {
      // Fallback to default size
      colliderSize = { x: 1, y: 0.5, z: 2 };
      console.warn('⚠️ No model size available, using default collider size');
    }
    
    const colliderDesc = RAPIER.ColliderDesc.cuboid(colliderSize.x, colliderSize.y, colliderSize.z)
      .setMass(CAR.MASS)
      .setFriction(0.7)
      .setRestitution(0.3);
    
    this.collider = world.createCollider(colliderDesc, this.rigidBody);
    console.log('✅ Physics collider created with size:', colliderSize);
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

    // Apply throttle/brake
    const speed = this.velocity.length();
    let acceleration = 0;
    
    if (this.inputState.throttle > 0) {
      acceleration = CAR.ACCELERATION * this.inputState.throttle;
    } else if (this.inputState.brake > 0) {
      acceleration = -CAR.BRAKE_FORCE * this.inputState.brake;
    }

    // Apply force in forward direction
    const force = forward.multiplyScalar(acceleration);
    body.applyImpulse({ x: force.x, y: force.y, z: force.z }, true);

    // Apply steering (torque around Y axis)
    // Steering only works when the car is moving (has velocity)
    // This makes turning realistic - you can't turn when stationary
    if (speed > 0.1) { // Only steer when moving (speed > 0.1)
      // Check if car is moving forward or backward
      // Dot product of velocity and forward direction: positive = forward, negative = backward
      const forwardSpeed = this.velocity.dot(forward);
      const isMovingBackward = forwardSpeed < 0;
      
      const steerForce = this.inputState.steer * CAR.STEER_FORCE;
      const handlingMultiplier = this.hasFlag ? CAR.FLAG_CARRIER_HANDLING_PENALTY : 1.0;
      
      // Invert steering when going backward (swap left/right)
      const finalSteerForce = isMovingBackward ? -steerForce * handlingMultiplier : steerForce * handlingMultiplier;
      
      body.applyTorqueImpulse({
        x: 0,
        y: finalSteerForce,
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
    // Always update tempMesh position/rotation so it follows the car
    if (this.tempMesh) {
      this.tempMesh.position.copy(this.position);
      this.tempMesh.quaternion.copy(quaternion);
      this.tempMesh.updateMatrixWorld(true);
      
      // If tempMesh is the permanent visual (model failed), also update it as mesh
      if (this.mesh === this.tempMesh) {
        // Already updated above - tempMesh IS the mesh
      }
    }
    
    // Update helper sphere
    if (this.helperSphere) {
      this.helperSphere.position.copy(this.position);
    }
  }

  setEliminated(eliminated) {
    this.isEliminated = eliminated;
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
