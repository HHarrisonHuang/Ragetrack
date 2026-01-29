import * as THREE from 'three';

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.target = null;
    // Offset: behind the car (positive Z = behind), above, and to the side
    // The camera will face the tail (back) of the car
    this.offset = new THREE.Vector3(0, 6, 12); // Closer to the car
    this.positionSmoothness = 0.4; // Faster position following (higher = faster response)
    this.rotationSmoothness = 0.3; // Faster rotation (higher = faster response)
    this.currentLookAt = new THREE.Vector3();
  }

  setTarget(car) {
    this.target = car;
    // Initialize look-at position to car position
    if (car && car.position) {
      this.currentLookAt.copy(car.position);
      this.currentLookAt.y += 1.5;
    }
  }

  update() {
    if (!this.target) return;

    const targetPosition = this.target.position.clone();
    
    // Get the car's rotation as a quaternion
    let carQuaternion;
    // IMPORTANT: In multiplayer, visuals are updated from server snapshots while the client rigidBody
    // may not be stepped. Prefer the rendered object's quaternion so "behind/tail" stays correct.
    const visual = this.target.model || this.target.mesh || this.target.tempMesh;
    if (visual?.quaternion) {
      carQuaternion = visual.quaternion.clone();
    } else if (this.target.rigidBody) {
      const rot = this.target.rigidBody.rotation();
      carQuaternion = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    } else {
      // Fallback to Euler rotation
      const targetRotation = this.target.rotation || new THREE.Euler(0, 0, 0);
      carQuaternion = new THREE.Quaternion().setFromEuler(targetRotation);
    }

    // Calculate the car's forward direction (where it's facing)
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(carQuaternion);
    
    // Calculate the car's right direction
    const right = new THREE.Vector3(1, 0, 0);
    right.applyQuaternion(carQuaternion);
    
    // Calculate the car's up direction
    const up = new THREE.Vector3(0, 1, 0);
    up.applyQuaternion(carQuaternion);

    // Position camera behind the car (opposite of forward direction)
    // The offset is relative to the car's local space
    const localOffset = this.offset.clone();
    // Transform offset to world space using car's orientation
    const worldOffset = new THREE.Vector3();
    worldOffset.addScaledVector(forward, -localOffset.z); // Behind (negative forward)
    worldOffset.addScaledVector(up, localOffset.y); // Above
    worldOffset.addScaledVector(right, localOffset.x); // Side
    
    const desiredPosition = targetPosition.clone().add(worldOffset);

    // Smooth camera position movement (lower value = smoother but slower response)
    this.camera.position.lerp(desiredPosition, this.positionSmoothness);

    // Look at the car itself (from behind). This guarantees we face the tail visually.
    // (Looking "behind" the car can make the camera look away from it depending on offsets.)
    const lookAtPoint = targetPosition.clone();
    lookAtPoint.y += 1; // Slightly above ground to look at car center
    
    // Smooth the look-at target to prevent jittery rotation
    this.currentLookAt.lerp(lookAtPoint, this.rotationSmoothness);
    
    // Look at the back of the car
    this.camera.lookAt(this.currentLookAt);
    
    // Debug logging occasionally
    if (Math.random() < 0.01) { // 1% chance per frame
      console.log('📷 Camera update:', {
        targetPos: targetPosition,
        cameraPos: this.camera.position,
        lookAt: this.currentLookAt.clone()
      });
    }
  }
}
