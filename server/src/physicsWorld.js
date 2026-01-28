import { PHYSICS } from '../../shared/constants.js';
import { initRapier, getRAPIER } from './rapierWrapper.js';

let RAPIER = null;
let rapierPromise = null;

async function loadRapier() {
  if (!rapierPromise) {
    try {
      // Initialize the WASM module
      await initRapier();
      
      // Get the RAPIER wrapper
      RAPIER = getRAPIER();
      
      rapierPromise = Promise.resolve(RAPIER);
    } catch (error) {
      console.error('Failed to load Rapier:', error);
      throw new Error('Could not load Rapier physics engine. Error: ' + error.message);
    }
  } else {
    RAPIER = await rapierPromise;
  }
  return RAPIER;
}

export class PhysicsWorld {
  constructor() {
    this.world = null;
    this.gravity = null;
    this.accumulator = 0;
    this.rapierLoaded = false;
  }

  async init() {
    await loadRapier();
    
    this.gravity = new RAPIER.Vector3(
      PHYSICS.GRAVITY.x,
      PHYSICS.GRAVITY.y,
      PHYSICS.GRAVITY.z
    );
    this.world = new RAPIER.World(this.gravity);
    this.accumulator = 0;
    this.rapierLoaded = true;
  }

  getRAPIER() {
    return RAPIER;
  }

  update(deltaTime) {
    if (!this.rapierLoaded || !this.world) return;
    
    // Fixed timestep physics
    this.accumulator += deltaTime;

    while (this.accumulator >= PHYSICS.FIXED_TIMESTEP) {
      this.world.step();
      this.accumulator -= PHYSICS.FIXED_TIMESTEP;
    }
  }

  getWorld() {
    return this.world;
  }

  destroy() {
    if (this.world) {
      this.world = null;
    }
  }
}
