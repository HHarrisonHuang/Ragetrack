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
    return {
      throttle: (this.keys['w'] || this.keys['arrowup']) ? 1 : 0,
      brake: (this.keys['s'] || this.keys['arrowdown']) ? 1 : 0,
      // Swapped: left key now steers right (1), right key now steers left (-1)
      steer: (this.keys['a'] || this.keys['arrowleft']) ? 1 : 
             (this.keys['d'] || this.keys['arrowright']) ? -1 : 0,
    };
  }

  destroy() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }
}
