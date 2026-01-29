import { PhysicsWorld } from './physicsWorld.js';

async function main() {
  const pw = new PhysicsWorld();
  await pw.init();
  const RAPIER = pw.getRAPIER();
  const world = pw.getWorld();

  // Floor: fixed rigid body + cuboid collider (120 x 1 x 120) centered at y=0
  const floorBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0)
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setFriction(0.7).setRestitution(0.1), floorBody);

  // Dynamic box above floor
  const boxBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0).setRotation({ x: 0, y: 0, z: 0, w: 1 })
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setFriction(0.7).setRestitution(0.1), boxBody);

  // Step physics for ~2 seconds at 60Hz.
  for (let i = 0; i < 120; i++) {
    world.step();
  }

  const p = boxBody.translation();
  console.log(JSON.stringify({ finalY: p.y, expectedAtOrAbove: 0.5 }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

