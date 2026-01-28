// Shared constants between client and server

export const PHYSICS = {
  FIXED_TIMESTEP: 1 / 60, // 60 FPS
  MAX_SUBSTEPS: 10,
  GRAVITY: { x: 0, y: -9.81, z: 0 },
  DEATH_THRESHOLD: -50, // Y position below which player is eliminated
};

export const CAR = {
  MASS: 1200,
  ACCELERATION: 130, // Increased from 30 for faster acceleration
  MAX_SPEED: 200, // Increased from 50 for higher top speed
  BRAKE_FORCE: 70,
  STEER_FORCE: 0.03, // Reduced for smaller, more controlled turns
  FRICTION: 10,
  FLAG_CARRIER_HANDLING_PENALTY: 0.7, // Reduced handling when carrying flag
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
