import * as THREE from 'three';

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.target = null;
    // Offset: behind the car (positive Z = behind), above, and to the side
    // The camera will face the tail (back) of the car
    this.offset = new THREE.Vector3(0, 8, 15); // Behind and above the car
    this.smoothness = 0.1;
  }

  setTarget(car) {
    this.target = car;
  }

  update() {
    if (!this.target) return;

    const targetPosition = this.target.position.clone();
    
    // Get the car's rotation as a quaternion
    let carQuaternion;
    if (this.target.rigidBody) {
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

    // Smooth camera movement (increase smoothness for faster response)
    this.camera.position.lerp(desiredPosition, 0.3); // Increased from 0.1

    // Look at the tail of the car (behind the car position)
    // Calculate tail position: car position minus forward direction
    const tailPosition = targetPosition.clone();
    tailPosition.addScaledVector(forward, -2); // 2 units behind the car center
    tailPosition.y += 1; // Slightly above ground
    
    // Look at the tail
    this.camera.lookAt(tailPosition);
    
    // Debug logging occasionally
    if (Math.random() < 0.01) { // 1% chance per frame
      console.log('📷 Camera update:', {
        targetPos: targetPosition,
        cameraPos: this.camera.position,
        lookAt: tailPosition
      });
    }
  }
}
