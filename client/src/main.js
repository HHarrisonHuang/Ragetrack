console.log('📦 main.js script started loading...');

// Use dynamic import to catch import errors
import('./core/game.js')
  .then((module) => {
    console.log('✅ Game module loaded successfully');
    const { Game } = module;
    
    // Initialize game when DOM is ready
    function initGame() {
      console.log('🚀 DOM loaded, initializing game...');
      try {
        const game = new Game();
        console.log('✅ Game instance created');
        game.init();
        console.log('✅ Game.init() called');
        
        // Store game instance globally for debugging
        window.game = game;
      } catch (error) {
        console.error('❌ Error initializing game:', error);
        console.error('Error stack:', error.stack);
        alert('Failed to initialize game: ' + error.message + '\n\nCheck console for details.');
      }
    }
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initGame);
    } else {
      // DOM already loaded
      console.log('DOM already loaded, initializing immediately');
      initGame();
    }
  })
  .catch((error) => {
    console.error('❌ Failed to import Game module:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Failed URL:', error.url || 'unknown');
    alert('Failed to load game module!\n\nError: ' + error.message + '\n\nCheck browser console for details.');
  });
