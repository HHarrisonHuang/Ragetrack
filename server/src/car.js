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

  // Convert Euler rotation (rx, ry, rz) to a normalized quaternion.
  // Matches Three.js default Euler order: XYZ.
  static eulerToQuaternion(rx = 0, ry = 0, rz = 0) {
    const cx = Math.cos(rx * 0.5);
    const sx = Math.sin(rx * 0.5);
    const cy = Math.cos(ry * 0.5);
    const sy = Math.sin(ry * 0.5);
    const cz = Math.cos(rz * 0.5);
    const sz = Math.sin(rz * 0.5);

    return {
      x: sx * cy * cz + cx * sy * sz,
      y: cx * sy * cz - sx * cy * sz,
      z: cx * cy * sz + sx * sy * cz,
      w: cx * cy * cz - sx * sy * sz,
    };
  }

  static rotateVecByQuat(q, v) {
    // v' = 2*dot(u,v)*u + (s*s - dot(u,u))*v + 2*s*cross(u,v)
    const ux = q.x, uy = q.y, uz = q.z, s = q.w;
    const vx = v.x, vy = v.y, vz = v.z;

    const dotUV = ux * vx + uy * vy + uz * vz;
    const dotUU = ux * ux + uy * uy + uz * uz;

    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;

    return {
      x: 2 * dotUV * ux + (s * s - dotUU) * vx + 2 * s * cx,
      y: 2 * dotUV * uy + (s * s - dotUU) * vy + 2 * s * cy,
      z: 2 * dotUV * uz + (s * s - dotUU) * vz + 2 * s * cz,
    };
  }

  createPhysics() {
    const world = this.physicsWorld.getWorld();
    const RAPIER = this.physicsWorld.getRAPIER();
    if (!RAPIER || !world) {
      console.error('RAPIER or world not loaded yet');
      return;
    }

    // IMPORTANT: Rapier expects a quaternion, but our game uses Euler angles.
    // Passing Euler components into quaternion fields can break collisions (cars can fall through floor).
    const initialQuat = Car.eulerToQuaternion(this.rotation.x, this.rotation.y, this.rotation.z);
    
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
    // Rapier API uses setLinearDamping / setAngularDamping.
    if (this.rigidBody && typeof this.rigidBody.setLinearDamping === 'function') {
      this.rigidBody.setLinearDamping(0.1);
    }
    if (this.rigidBody && typeof this.rigidBody.setAngularDamping === 'function') {
      // Reduced angular damping so steering works when stationary
      this.rigidBody.setAngularDamping(2.0);
    }
    
    const he = CAR.COLLIDER_HALF_EXTENTS || { x: 2, y: 1, z: 4 };
    const colliderDesc = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
      .setMass(CAR.MASS)
      .setFriction(0.7)
      .setRestitution(0.6) // Increased for more bounce
      .setTranslation(-1, 1, 0); // Offset: 1 unit left, 1 unit up
    
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
    let linvel = body.linvel();
    let rotation = body.rotation();
    
    const RAPIER = this.physicsWorld.getRAPIER();
    if (!RAPIER) return;
    
    // Get forward direction (car's current facing)
    const forwardRotated = Car.rotateVecByQuat(rotation, { x: 0, y: 0, z: -1 });
    
    // --- Drive + steer (arcade-y, responsive, server-authoritative) ---
    // Steering bends the HORIZONTAL velocity vector, instead of relying on torque/inertia.
    // This makes forward steering reliable, and removes "lag" when reversing.
    const handlingMultiplier = this.hasFlag ? CAR.FLAG_CARRIER_HANDLING_PENALTY : 1.0;

    // 1) Apply throttle impulse along car facing (supports proper reverse)
    let driveDirX = forwardRotated.x;
    let driveDirZ = forwardRotated.z;
    const driveDirLen = Math.sqrt(driveDirX ** 2 + driveDirZ ** 2) || 1;
    driveDirX /= driveDirLen;
    driveDirZ /= driveDirLen;

    if (this.inputState.throttle !== 0) {
      // Reduce reverse speed (throttle < 0) while keeping forward speed the same
      const reverseSpeedMultiplier = 0.6; // Reverse is 60% of forward speed
      const throttleEffective = this.inputState.throttle > 0 
        ? this.inputState.throttle 
        : this.inputState.throttle * reverseSpeedMultiplier;
      const driveImpulse = CAR.ACCELERATION * throttleEffective;
      body.applyImpulse({ x: driveDirX * driveImpulse, y: 0, z: driveDirZ * driveImpulse }, true);
    }

    // 2) Brake (Space): dampen horizontal velocity
    linvel = body.linvel();
    const speed = Math.sqrt(linvel.x ** 2 + linvel.y ** 2 + linvel.z ** 2);
    if (this.inputState.brake > 0 && speed > 0.01) {
      const brakeScale = 1 - Math.min(0.35, 0.25 * this.inputState.brake);
      body.setLinvel({ x: linvel.x * brakeScale, y: linvel.y, z: linvel.z * brakeScale }, true);
    }

    // 3) Steering: bend the horizontal velocity direction (works for forward + reverse)
    linvel = body.linvel();
    const speedH = Math.sqrt(linvel.x ** 2 + linvel.z ** 2);
    if (this.inputState.steer !== 0 && speedH > 0.05) {
      // Constant turn rate regardless of speed (reduced for smoother, less shaky turns)
      const maxTurnRate = 0.6 * handlingMultiplier; // rad/s
      
      // Make FORWARD steering behave exactly like the current BACKWARD steering feel:
      // - Swap left/right when moving forward
      // - Keep backward steering unchanged
      // Determine if we're moving backward relative to where the car is facing.
      const forwardSpeed =
        linvel.x * forwardRotated.x +
        linvel.z * forwardRotated.z;
      const isMovingBackward = forwardSpeed < 0;
      let steerEffective = isMovingBackward ? this.inputState.steer : -this.inputState.steer;
      
      // Reduce steering sensitivity for normal turns (makes turns smaller/more gradual)
      // Full steering input still reaches maxTurnRate, but normal inputs are scaled down
      const steeringSensitivity = 0.65; // Lower = smaller normal turns
      steerEffective *= steeringSensitivity;

      const steerAngle = steerEffective * maxTurnRate * Math.max(0.0001, deltaTime); // radians this tick

      const cosA = Math.cos(steerAngle);
      const sinA = Math.sin(steerAngle);
      const newVx = linvel.x * cosA - linvel.z * sinA;
      const newVz = linvel.x * sinA + linvel.z * cosA;
      body.setLinvel({ x: newVx, y: linvel.y, z: newVz }, true);
    }
    
    // If we're moving FORWARD and the player releases A/D, kill any leftover curved heading.
    // (Backward already feels correct; forward used to "keep turning" because the velocity stayed bent.)
    linvel = body.linvel();
    const speedHRelease = Math.sqrt(linvel.x ** 2 + linvel.z ** 2);
    if (this.inputState.steer === 0 && speedHRelease > 0.05) {
      const forwardSpeed =
        linvel.x * forwardRotated.x +
        linvel.z * forwardRotated.z;
      const isMovingForward = forwardSpeed > 0;
      if (isMovingForward) {
        const fLen = Math.sqrt(forwardRotated.x ** 2 + forwardRotated.z ** 2) || 1;
        const fx = forwardRotated.x / fLen;
        const fz = forwardRotated.z / fLen;
        body.setLinvel({ x: fx * speedHRelease, y: linvel.y, z: fz * speedHRelease }, true);
      }
    }

    // 4) Rotate body to face the movement direction (visual rotation), independent from steering input
    // Make turn rate constant from start to middle (no ramp-up)
    linvel = body.linvel();
    const speedH2 = Math.sqrt(linvel.x ** 2 + linvel.z ** 2);
    if (speedH2 > 0.15) {
      const velDir = { x: linvel.x / speedH2, y: 0, z: linvel.z / speedH2 };

      // Refresh rotation -> forward to compute correct angleDiff
      rotation = body.rotation();
      const fwd = Car.rotateVecByQuat(rotation, { x: 0, y: 0, z: -1 });
      const dot = fwd.x * velDir.x + fwd.z * velDir.z;
      const cross = fwd.x * velDir.z - fwd.z * velDir.x;
      const angleDiff = Math.atan2(cross, dot);

      // Constant yaw rate based on steering input (not angle difference) for consistent turn feel
      // Higher rate for backward to match forward responsiveness
      const maxYawRate = 5.5; // rad/s (increased for better backward response)
      let targetYawRate = 0;
      
      // Check if moving backward
      const forwardSpeed = linvel.x * fwd.x + linvel.z * fwd.z;
      const isMovingBackward = forwardSpeed < 0;
      
      if (this.inputState.steer !== 0) {
        // Use steering input directly for immediate, constant turn rate
        let steerEffective = isMovingBackward ? this.inputState.steer : -this.inputState.steer;
        
        // Apply same steering sensitivity as velocity steering for consistency
        const steeringSensitivity = 0.65;
        steerEffective *= steeringSensitivity;
        
        // Boost backward steering slightly to reduce lag
        const backwardBoost = isMovingBackward ? 1.2 : 1.0;
        targetYawRate = steerEffective * maxYawRate * handlingMultiplier * backwardBoost;
      } else {
        // When not steering: only align body when moving FORWARD (prevents backward rotation snap-back)
        if (!isMovingBackward) {
          // Align to movement direction but at a slower rate
          targetYawRate = Math.max(-maxYawRate * 0.5, Math.min(maxYawRate * 0.5, angleDiff * 3.0));
        } else {
          // When going backward and not steering, don't auto-rotate (let it drift)
          targetYawRate = 0;
        }
      }
      
      const angvel = body.angvel();
      body.setAngvel({ x: angvel.x, y: targetYawRate, z: angvel.z }, true);
    }

    // Apply friction
    linvel = body.linvel();
    body.applyImpulse({ x: -linvel.x * CAR.FRICTION, y: 0, z: -linvel.z * CAR.FRICTION }, true);

    // Limit max speed
    linvel = body.linvel();
    const speedAfter = Math.sqrt(linvel.x ** 2 + linvel.y ** 2 + linvel.z ** 2);
    if (speedAfter > CAR.MAX_SPEED) {
      const scale = CAR.MAX_SPEED / speedAfter;
      body.setLinvel({ x: linvel.x * scale, y: linvel.y * scale, z: linvel.z * scale }, true);
    }

    // Limit angular velocity to prevent excessive spinning
    const angvel = body.angvel();
    const angularSpeed = Math.sqrt(angvel.x ** 2 + angvel.y ** 2 + angvel.z ** 2);
    const maxAngularSpeed = 8.0; // Radians per second - allows some spinning but not excessive
    if (angularSpeed > maxAngularSpeed) {
      const scale = maxAngularSpeed / angularSpeed;
      body.setAngvel({
        x: angvel.x * scale,
        y: angvel.y * scale,
        z: angvel.z * scale,
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
      const q = Car.eulerToQuaternion(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
      this.rigidBody.setRotation({
        x: q.x,
        y: q.y,
        z: q.z,
        w: q.w,
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
