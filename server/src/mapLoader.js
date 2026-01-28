import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class MapLoader {
  constructor() {
    this.loadedMap = null;
  }

  async loadMap(mapName) {
    try {
      const mapPath = join(__dirname, '../../shared/maps', mapName);
      const mapData = JSON.parse(readFileSync(mapPath, 'utf-8'));
      this.loadedMap = mapData;
      return mapData;
    } catch (error) {
      console.error('Error loading map:', error);
      return this.loadDefaultMap();
    }
  }

  loadDefaultMap() {
    const defaultMap = {
      blocks: [
        { type: 'platform', position: [0, 0, 0], size: [60, 1, 60] },
        { type: 'platform', position: [-30, 0, -30], size: [15, 1, 15] },
        { type: 'platform', position: [30, 0, -30], size: [15, 1, 15] },
        { type: 'platform', position: [-30, 0, 30], size: [15, 1, 15] },
        { type: 'platform', position: [30, 0, 30], size: [15, 1, 15] },
      ],
      spawnPoints: {
        red: [
          { position: [-8, 2, 0], rotation: [0, Math.PI / 2, 0] },
          { position: [-8, 2, -5], rotation: [0, Math.PI / 2, 0] },
        ],
        blue: [
          { position: [8, 2, 0], rotation: [0, -Math.PI / 2, 0] },
          { position: [8, 2, -5], rotation: [0, -Math.PI / 2, 0] },
        ],
      },
      flags: {
        red: { position: [-10, 2, 0] },
        blue: { position: [10, 2, 0] },
      },
    };
    
    this.loadedMap = defaultMap;
    return defaultMap;
  }

  getMap() {
    return this.loadedMap;
  }
}
