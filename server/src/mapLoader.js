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
    // Matches shared/maps/defaultMap.json
    const defaultMap = {
      blocks: [
        { type: 'platform', position: [0, 0, 0], size: [100, 1, 40] },
        { type: 'platform', position: [0, 2, 0], size: [8, 4, 8] },
      ],
      bases: {
        red: { position: [-40, 0.6, 0], size: [15, 0.2, 14] },
        blue: { position: [40, 0.6, 0], size: [15, 0.2, 14] },
      },
      spawnPoints: {
        red: [{ position: [-35, 2, 0], rotation: [0, Math.PI / 2, 0] }],
        blue: [{ position: [35, 2, 0], rotation: [0, -Math.PI / 2, 0] }],
      },
      flags: {
        red: { position: [-40, 1, 0] },
        blue: { position: [40, 1, 0] },
      },
    };
    
    this.loadedMap = defaultMap;
    console.log('📦 Using default map with flags at:', defaultMap.flags);
    return defaultMap;
  }

  getMap() {
    return this.loadedMap;
  }
}
