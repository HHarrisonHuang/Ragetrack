import { CAR } from '../../shared/constants.js';

export class Car {
  constructor(physicsWorld, position = [0, 5, 0], rotation = [0, 0, 0]) {
    this.physicsWorld = physicsWorld;
    this.position = { x: position[0], y: position[1], z: position[2] };
    this.rotation = { x: rotation[0], y: rotation[1], z: rotation[2] };
    
    this.inputState = {
      throttle: 0,
      brake: 0,
      steer: 0,
    };

    this.rigidBody = null;
    this.collider = null;
    this.hasFlag = false;

    // Wait for physics world to be ready before creating physics
    if (physicsWorld.rapierLoaded) {
      this.createPhysics();
    } else {
      // Delay physics creation until RAPIER is loaded
      setTimeout(() => {
        if (physicsWorld.rapierLoaded) {
          this.createPhysics();
        }
      }, 100);
    }
  }

  createPhysics() {
    const world = this.physicsWorld.getWorld();
    const RAPIER = this.physicsWorld.getRAPIER();
    if (!RAPIER || !world) {
      console.error('RAPIER or world not loaded yet');
      return;
    }
    
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.position.x, this.position.y, this.position.z)
      .setRotation({
        x: this.rotation.x,
        y: this.rotation.y,
        z: this.rotation.z,
        w: 1,
      });
    
    this.rigidBody = world.createRigidBody(rigidBodyDesc);
    
    const colliderDesc = RAPIER.ColliderDesc.cuboid(1, 0.5, 2)
      .setMass(CAR.MASS)
      .setFriction(0.7)
      .setRestitution(0.3);
    
    this.collider = world.createCollider(colliderDesc, this.rigidBody);
  }

  setInput(throttle, brake, steer) {
    this.inputState.throttle = Math.max(-1, Math.min(1, throttle));
    this.inputState.brake = Math.max(0, Math.min(1, brake));
    this.inputState.steer = Math.max(-1, Math.min(1, steer));
  }

  update(deltaTime) {
    if (!this.rigidBody) return;

    const body = this.rigidBody;
    const linvel = body.linvel();
    const rotation = body.rotation();
    
    const RAPIER = this.physicsWorld.getRAPIER();
    if (!RAPIER) return;
    
    // Get forward direction
    const forward = { x: 0, y: 0, z: -1 };
    // Apply rotation quaternion to forward vector
    const q = new RAPIER.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const forwardRotated = q.rotate({ x: 0, y: 0, z: -1 });
    
    // Apply throttle/brake
    const speed = Math.sqrt(linvel.x ** 2 + linvel.y ** 2 + linvel.z ** 2);
    let acceleration = 0;
    
    if (this.inputState.throttle > 0) {
      acceleration = CAR.ACCELERATION * this.inputState.throttle;
    } else if (this.inputState.brake > 0) {
      acceleration = -CAR.BRAKE_FORCE * this.inputState.brake;
    }

    // Apply force
    const force = {
      x: forwardRotated.x * acceleration,
      y: forwardRotated.y * acceleration,
      z: forwardRotated.z * acceleration,
    };
    body.applyImpulse(force, true);

    // Apply steering
    // Check if car is moving forward or backward
    // Dot product of velocity and forward direction: positive = forward, negative = backward
    const forwardSpeed = linvel.x * forwardRotated.x + linvel.y * forwardRotated.y + linvel.z * forwardRotated.z;
    const isMovingBackward = forwardSpeed < 0;
    
    const steerForce = this.inputState.steer * CAR.STEER_FORCE;
    const handlingMultiplier = this.hasFlag ? CAR.FLAG_CARRIER_HANDLING_PENALTY : 1.0;
    
    // Invert steering when going backward (swap left/right)
    const finalSteerForce = isMovingBackward 
      ? -steerForce * handlingMultiplier * (1 + speed / CAR.MAX_SPEED)
      : steerForce * handlingMultiplier * (1 + speed / CAR.MAX_SPEED);
    
    body.applyTorqueImpulse({
      x: 0,
      y: finalSteerForce,
      z: 0,
    }, true);

    // Apply friction
    const friction = {
      x: -linvel.x * CAR.FRICTION,
      y: 0,
      z: -linvel.z * CAR.FRICTION,
    };
    body.applyImpulse(friction, true);

    // Limit max speed
    if (speed > CAR.MAX_SPEED) {
      const scale = CAR.MAX_SPEED / speed;
      body.setLinvel({
        x: linvel.x * scale,
        y: linvel.y * scale,
        z: linvel.z * scale,
      }, true);
    }
  }

  getPosition() {
    if (!this.rigidBody) return { x: 0, y: 0, z: 0 };
    // Handle both wrapper and raw body types
    if (typeof this.rigidBody.translation === 'function') {
      const translation = this.rigidBody.translation();
      return { x: translation.x, y: translation.y, z: translation.z };
    }
    return { x: 0, y: 0, z: 0 };
  }

  getRotation() {
    if (!this.rigidBody) return { x: 0, y: 0, z: 0 };
    // Handle both wrapper and raw body types
    if (typeof this.rigidBody.rotation === 'function') {
      const rotation = this.rigidBody.rotation();
      return { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
    }
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  respawn(position, rotation) {
    if (this.rigidBody) {
      this.rigidBody.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
      this.rigidBody.setRotation({
        x: rotation[0] || 0,
        y: rotation[1] || 0,
        z: rotation[2] || 0,
        w: 1,
      }, true);
      this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  destroy() {
    if (this.rigidBody && this.physicsWorld) {
      const world = this.physicsWorld.getWorld();
      world.removeRigidBody(this.rigidBody);
    }
  }
}
