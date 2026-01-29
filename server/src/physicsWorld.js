import { PHYSICS } from '../../shared/constants.js';
import RAPIER from '@dimforge/rapier3d-compat';

let rapierInitPromise = null;
async function ensureRapierInit() {
  if (!rapierInitPromise) {
    rapierInitPromise = RAPIER.init();
  }
  await rapierInitPromise;
}

export class PhysicsWorld {
  constructor() {
    this.world = null;
    this.gravity = null;
    this.accumulator = 0;
    this.rapierLoaded = false;
  }

  async init() {
    // IMPORTANT: init() can be called from multiple places (server bootstrap + GameServer).
    // Creating a new RAPIER.World here would wipe existing colliders/bodies and cause cars
    // to fall through the floor. So make init() idempotent.
    if (this.rapierLoaded && this.world) {
      return;
    }

    await ensureRapierInit();
    
    this.gravity = new RAPIER.Vector3(
      PHYSICS.GRAVITY.x,
      PHYSICS.GRAVITY.y,
      PHYSICS.GRAVITY.z
    );
    this.world = new RAPIER.World(this.gravity);
    // Ensure the world uses our fixed timestep.
    this.world.timestep = PHYSICS.FIXED_TIMESTEP;
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
      // Keep timestep consistent even if something modified it.
      this.world.timestep = PHYSICS.FIXED_TIMESTEP;
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
