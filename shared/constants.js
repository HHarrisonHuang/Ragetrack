// Shared constants between client and server

export const PHYSICS = {
  FIXED_TIMESTEP: 1 / 60, // 60 FPS
  MAX_SUBSTEPS: 10,
  GRAVITY: { x: 0, y: -9.81, z: 0 },
  DEATH_THRESHOLD: -50, // Y position below which player is eliminated
};

export const CAR = {
  MASS: 1200,
  ACCELERATION: 1000, // Increased from 30 for faster acceleration
  MAX_SPEED: 4000, // Increased from 50 for higher top speed
  BRAKE_FORCE: 70,
  STEER_FORCE: 0.01, // Reduced for smaller, more controlled turns
  FRICTION: 10,
  FLAG_CARRIER_HANDLING_PENALTY: 0.7, // Reduced handling when carrying flag
  // Server + client must agree on collision shape size.
  // This is a cuboid using HALF-EXTENTS (Rapier cuboid uses half-extents).
  COLLIDER_HALF_EXTENTS: { x: 2, y: 1, z: 4 },
  // Visual target full size for car models (used to scale GLBs to match collider).
  VISUAL_TARGET_SIZE: { x: 4, y: 2, z: 8 },
};

export const GAME = {
  RESPAWN_DELAY: 5, // seconds
  INVINCIBILITY_DURATION: 2, // seconds after respawn
  WIN_SCORE: 3, // flags needed to win
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 10,
  TEAM_COLORS: {
    RED: 0xff0000,
    BLUE: 0x0000ff,
  },
};

export const NETWORK = {
  TICK_RATE: 60, // Server updates per second
  CLIENT_SEND_RATE: 60, // Client input sends per second
};
