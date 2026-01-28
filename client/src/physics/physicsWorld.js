import RAPIER from '@dimforge/rapier3d';
import { PHYSICS } from '../../../shared/constants.js';

export class PhysicsWorld {
  constructor() {
    this.world = null;
    this.gravity = null;
    this.accumulator = 0;
  }

  async init() {
    // Initialize Rapier if needed (some versions require this)
    if (RAPIER.init) {
      await RAPIER.init();
    }
    
    // Initialize Rapier physics world
    this.gravity = new RAPIER.Vector3(
      PHYSICS.GRAVITY.x,
      PHYSICS.GRAVITY.y,
      PHYSICS.GRAVITY.z
    );
    this.world = new RAPIER.World(this.gravity);
    this.accumulator = 0;
  }

  update(deltaTime) {
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
      // Rapier cleanup if needed
      this.world = null;
    }
  }
}
