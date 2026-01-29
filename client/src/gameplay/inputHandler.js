export class InputHandler {
  constructor() {
    this.keys = {};
    this.setupEventListeners();
  }

  setupEventListeners() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });
  }

  getInputState() {
    const forward = (this.keys['w'] || this.keys['arrowup']) ? 1 : 0;
    const reverse = (this.keys['s'] || this.keys['arrowdown']) ? 1 : 0;
    return {
      // Signed throttle: forward = +1, reverse = -1
      throttle: forward ? 1 : (reverse ? -1 : 0),
      // Brake (separate from reverse): Space
      brake: this.keys[' '] ? 1 : 0,
      // Normal steering input:
      // - A / Left Arrow = steer left (-1)
      // - D / Right Arrow = steer right (+1)
      // The car physics handles reversing steering when moving backward.
      steer: (this.keys['a'] || this.keys['arrowleft']) ? -1 :
             (this.keys['d'] || this.keys['arrowright']) ? 1 : 0,
    };
  }

  destroy() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }
}
