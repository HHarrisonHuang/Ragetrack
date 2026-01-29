// Minimal wrapper around Rapier Raw classes for Node.js compatibility
// This works around ESM import issues with @dimforge/rapier3d

let wasmModule = null;
let initialized = false;

export async function initRapier() {
  if (initialized) return wasmModule;
  
  const { fileURLToPath } = await import('url');
  const { dirname, resolve } = await import('path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  const wasmPath = resolve(__dirname, '../node_modules/@dimforge/rapier3d/rapier_wasm3d.js');
  wasmModule = await import('file:///' + wasmPath.replace(/\\/g, '/'));
  
  initialized = true;
  return wasmModule;
}

// Minimal wrapper classes
export class Vector3 {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

export class Quaternion {
  constructor(x, y, z, w) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
  
  rotate(vec) {
    // Simple quaternion rotation (simplified)
    return { x: vec.x, y: vec.y, z: vec.z };
  }
}

export class World {
  constructor(gravity) {
    if (!wasmModule) {
      throw new Error('Rapier not initialized. Call initRapier() first.');
    }
    
    // Create the world using Raw classes
    this.rawBodies = new wasmModule.RawRigidBodySet();
    this.rawColliders = new wasmModule.RawColliderSet();
    this.rawBroadPhase = new wasmModule.RawBroadPhase();
    this.rawNarrowPhase = new wasmModule.RawNarrowPhase();
    this.rawIslands = new wasmModule.RawIslandManager();
    this.rawImpulseJoints = new wasmModule.RawImpulseJointSet();
    this.rawMultibodyJoints = new wasmModule.RawMultibodyJointSet();
    this.rawCCDSolver = new wasmModule.RawCCDSolver();
    this.rawQueryPipeline = new wasmModule.RawQueryPipeline();
    this.rawPhysicsPipeline = new wasmModule.RawPhysicsPipeline();
    
    this.gravity = new Vector3(gravity.x || 0, gravity.y || 0, gravity.z || 0);
    this.gravityVec = new wasmModule.RawVector(gravity.x || 0, gravity.y || 0, gravity.z || 0);
    
    // Integration parameters
    this.integrationParameters = new wasmModule.RawIntegrationParameters(1.0 / 60.0);
  }

  // Debug helpers
  numBodies() {
    return typeof this.rawBodies?.len === 'function' ? this.rawBodies.len() : null;
  }

  numColliders() {
    return typeof this.rawColliders?.len === 'function' ? this.rawColliders.len() : null;
  }
  
  step() {
    if (!this.rawPhysicsPipeline || !this.rawBodies) return;
    
    // Step physics using RawPhysicsPipeline
    // Signature: step(gravity, integrationParameters, islands, broadPhase, narrowPhase, bodies, colliders, joints, articulations, ccd_solver)
    this.rawPhysicsPipeline.step(
      this.gravityVec,
      this.integrationParameters,
      this.rawIslands,
      this.rawBroadPhase,
      this.rawNarrowPhase,
      this.rawBodies,
      this.rawColliders,
      this.rawImpulseJoints,
      this.rawMultibodyJoints,
      this.rawCCDSolver,
    );
  }
  
  createRigidBody(desc) {
    if (!this.rawBodies) return null;
    
    const rawTranslation = new wasmModule.RawVector(
      desc.translation.x,
      desc.translation.y,
      desc.translation.z
    );
    const rawRotation = new wasmModule.RawRotation(
      desc.rotation.x || 0,
      desc.rotation.y || 0,
      desc.rotation.z || 0,
      desc.rotation.w || 1
    );
    const rawLinvel = new wasmModule.RawVector(0, 0, 0);
    const rawAngvel = new wasmModule.RawVector(0, 0, 0);
    const rawCom = new wasmModule.RawVector(0, 0, 0);
    const rawPrincipalInertia = new wasmModule.RawVector(0, 0, 0);
    const rawInertiaFrame = new wasmModule.RawRotation(0, 0, 0, 1);
    
    const rbType = desc.isFixed ? wasmModule.RawRigidBodyType.Fixed : wasmModule.RawRigidBodyType.Dynamic;
    
    const handle = this.rawBodies.createRigidBody(
      true, // enabled
      rawTranslation,
      rawRotation,
      1.0, // gravity scale
      1.0, // mass
      false, // mass only
      rawCom,
      rawLinvel,
      rawAngvel,
      rawPrincipalInertia,
      rawInertiaFrame,
      true, true, true, // translation enabled
      true, true, true, // rotation enabled
      0.0, // linear damping
      0.0, // angular damping
      rbType,
      true, // can sleep
      false, // sleeping
      false, // ccd enabled
      0, // dominance group
      0, // additional solver iterations
    );
    
    // Create a wrapper object
    const body = {
      handle,
      rawBodies: this.rawBodies,
      translation: () => {
        const trans = this.rawBodies.rbTranslation(handle);
        return { x: trans.x, y: trans.y, z: trans.z };
      },
      rotation: () => {
        const rot = this.rawBodies.rbRotation(handle);
        return { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
      },
      linvel: () => {
        const vel = this.rawBodies.rbLinvel(handle);
        return { x: vel.x, y: vel.y, z: vel.z };
      },
      angvel: () => {
        const vel = this.rawBodies.rbAngvel(handle);
        return { x: vel.x, y: vel.y, z: vel.z };
      },
      setTranslation: (pos, wakeUp) => {
        const rawPos = new wasmModule.RawVector(pos.x, pos.y, pos.z);
        this.rawBodies.rbSetTranslation(handle, rawPos, wakeUp || false);
      },
      setRotation: (rot, wakeUp) => {
        const rawRot = new wasmModule.RawRotation(rot.x, rot.y, rot.z, rot.w);
        this.rawBodies.rbSetRotation(handle, rawRot, wakeUp || false);
      },
      setLinvel: (vel, wakeUp) => {
        const rawVel = new wasmModule.RawVector(vel.x, vel.y, vel.z);
        this.rawBodies.rbSetLinvel(handle, rawVel, wakeUp || false);
      },
      setAngvel: (vel, wakeUp) => {
        const rawVel = new wasmModule.RawVector(vel.x, vel.y, vel.z);
        this.rawBodies.rbSetAngvel(handle, rawVel, wakeUp || false);
      },
      applyImpulse: (impulse, wakeUp) => {
        const rawImp = new wasmModule.RawVector(impulse.x, impulse.y, impulse.z);
        this.rawBodies.rbApplyImpulse(handle, rawImp, wakeUp || false);
      },
      applyTorqueImpulse: (torque, wakeUp) => {
        const rawTorque = new wasmModule.RawVector(torque.x, torque.y, torque.z);
        this.rawBodies.rbApplyTorqueImpulse(handle, rawTorque, wakeUp || false);
      },
    };
    
    return body;
  }
  
  createCollider(desc, body) {
    if (!this.rawColliders || !body) return null;
    
    // Create shape using RawShape static method
    const rawShape = wasmModule.RawShape.cuboid(
      desc.halfExtents.x,
      desc.halfExtents.y,
      desc.halfExtents.z
    );
    
    const rawTranslation = new wasmModule.RawVector(0, 0, 0);
    const rawRotation = new wasmModule.RawRotation(0, 0, 0, 1);
    const rawCom = new wasmModule.RawVector(0, 0, 0);
    const rawPrincipalInertia = new wasmModule.RawVector(0, 0, 0);
    const rawInertiaFrame = new wasmModule.RawRotation(0, 0, 0, 1);
    
    const handle = this.rawColliders.createCollider(
      true, // enabled
      rawShape,
      rawTranslation,
      rawRotation,
      0, // mass props mode (density-based)
      desc.mass || 1.0,
      rawCom,
      rawPrincipalInertia,
      rawInertiaFrame,
      0, // density (not used if mass provided)
      desc.friction || 0.7,
      desc.restitution || 0.3,
      0, // friction combine rule
      0, // restitution combine rule
      false, // is sensor
      0xffffffff, // collision groups
      0xffffffff, // solver groups
      0xffff, // active collision types
      0, // active hooks
      0, // active events
      0.0, // contact force event threshold
      true, // has parent
      body.handle, // parent
      this.rawBodies, // bodies
    );
    
    return { handle };
  }
  
  removeRigidBody(body) {
    if (this.rawBodies && body && body.handle !== undefined && this.rawIslands) {
      // RawRigidBodySet.remove(handle, islands, colliders, joints, articulations)
      this.rawBodies.remove(
        body.handle,
        this.rawIslands,
        this.rawColliders,
        this.rawImpulseJoints,
        this.rawMultibodyJoints
      );
    }
  }
}

export class RigidBodyDesc {
  static dynamic() {
    return new RigidBodyDesc();
  }
  
  static fixed() {
    const desc = new RigidBodyDesc();
    desc.isFixed = true;
    return desc;
  }
  
  constructor() {
    this.translation = { x: 0, y: 0, z: 0 };
    this.rotation = { x: 0, y: 0, z: 0, w: 1 };
    this.isFixed = false;
  }
  
  setTranslation(x, y, z) {
    this.translation = { x, y, z };
    return this;
  }
  
  setRotation(rot) {
    this.rotation = rot;
    return this;
  }
}

export class ColliderDesc {
  static cuboid(hx, hy, hz) {
    const desc = new ColliderDesc();
    desc.shape = 'cuboid';
    desc.halfExtents = { x: hx, y: hy, z: hz };
    return desc;
  }
  
  constructor() {
    this.mass = 1;
    this.friction = 0.5;
    this.restitution = 0.0;
  }
  
  setMass(mass) {
    this.mass = mass;
    return this;
  }
  
  setFriction(friction) {
    this.friction = friction;
    return this;
  }
  
  setRestitution(restitution) {
    this.restitution = restitution;
    return this;
  }
}

// Export a combined RAPIER object
export function getRAPIER() {
  return {
    Vector3,
    Quaternion,
    World,
    RigidBodyDesc,
    ColliderDesc,
    RawWorld: wasmModule?.RawWorld,
    RawRigidBodySet: wasmModule?.RawRigidBodySet,
    RawColliderSet: wasmModule?.RawColliderSet,
  };
}
