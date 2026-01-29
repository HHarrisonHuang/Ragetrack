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
        { type: 'platform', position: [0, 0, 0], size: [120, 1, 120] },
        { type: 'platform', position: [-60, 0, -60], size: [20, 1, 20] },
        { type: 'platform', position: [60, 0, -60], size: [20, 1, 20] },
        { type: 'platform', position: [-60, 0, 60], size: [20, 1, 20] },
        { type: 'platform', position: [60, 0, 60], size: [20, 1, 20] },
        { type: 'platform', position: [0, 2, 0], size: [10, 4, 10] },
      ],
      spawnPoints: {
        red: [
          { position: [-20, 2, 0], rotation: [0, Math.PI / 2, 0] },
          { position: [-20, 2, -10], rotation: [0, Math.PI / 2, 0] },
          { position: [-20, 2, 10], rotation: [0, Math.PI / 2, 0] },
        ],
        blue: [
          { position: [20, 2, 0], rotation: [0, -Math.PI / 2, 0] },
          { position: [20, 2, -10], rotation: [0, -Math.PI / 2, 0] },
          { position: [20, 2, 10], rotation: [0, -Math.PI / 2, 0] },
        ],
      },
      flags: {
        red: { position: [-25, 2, 0] },
        blue: { position: [25, 2, 0] },
      },
    };
    
    this.loadedMap = defaultMap;
    return defaultMap;
  }

  getMap() {
    return this.loadedMap;
  }
}
