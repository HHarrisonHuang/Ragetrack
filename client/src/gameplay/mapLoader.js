import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';

export class MapLoader {
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.loadedMap = null;
  }

  async loadMap(mapName) {
    try {
      console.log('📦 Attempting to load map:', mapName);
      const response = await fetch(`/maps/${mapName}`);
      if (!response.ok) {
        console.warn(`⚠️ Map file not found: ${mapName}, using default map`);
        throw new Error('Map not found');
      }
      const mapData = await response.json();
      console.log('✅ Map data loaded:', mapData);
      this.loadedMap = mapData;
      
      // Clear existing map
      this.clearMap();
      
      // Create map geometry
      this.createMapGeometry(mapData);
      console.log('✅ Map geometry created');
      
      return mapData;
    } catch (error) {
      console.error('❌ Error loading map:', error);
      console.log('📦 Falling back to default map');
      // Load default map if specified map fails
      return this.loadDefaultMap();
    }
  }

  loadDefaultMap() {
    console.log('📦 Loading default map (fallback)');
    // Create a simple default map
    const defaultMap = {
      blocks: [
        { type: 'platform', position: [0, 0, 0], size: [20, 1, 20] },
      ],
      spawnPoints: {
        red: [{ position: [-5, 2, 0], rotation: [0, 0, 0] }],
        blue: [{ position: [5, 2, 0], rotation: [0, Math.PI, 0] }],
      },
      flags: {
        red: { position: [-8, 2, 0] },
        blue: { position: [8, 2, 0] },
      },
    };
    
    this.loadedMap = defaultMap;
    this.clearMap();
    this.createMapGeometry(defaultMap);
    console.log('✅ Default map loaded');
    return defaultMap;
  }

  createMapGeometry(mapData) {
    if (!this.physicsWorld || !this.physicsWorld.getWorld()) {
      console.error('❌ Physics world not ready for map creation');
      return;
    }
    
    const world = this.physicsWorld.getWorld();
    console.log('🏗️ Creating map geometry, blocks:', mapData.blocks?.length || 0);
    
    // Create blocks
    if (mapData.blocks && mapData.blocks.length > 0) {
      mapData.blocks.forEach((block, index) => {
        const geometry = new THREE.BoxGeometry(
          block.size[0],
          block.size[1],
          block.size[2]
        );
        const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...block.position);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.userData.isMapObject = true; // Mark as map object so it can be cleared later
        this.scene.add(mesh);
        console.log(`  ✅ Added block ${index + 1} at`, block.position);
        
        // Create physics collider
        if (world) {
          try {
            const colliderDesc = RAPIER.ColliderDesc.cuboid(
              block.size[0] / 2,
              block.size[1] / 2,
              block.size[2] / 2
            );
            const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
              block.position[0],
              block.position[1],
              block.position[2]
            );
            const body = world.createRigidBody(bodyDesc);
            world.createCollider(colliderDesc, body);
          } catch (error) {
            console.error(`❌ Error creating physics for block ${index}:`, error);
          }
        }
      });
      console.log(`✅ Created ${mapData.blocks.length} map blocks`);
    } else {
      console.warn('⚠️ No blocks in map data');
    }
  }

  clearMap() {
    // Remove all map meshes (keep player objects)
    // This is a simple implementation - in production, track map objects
    const objectsToRemove = [];
    this.scene.traverse((object) => {
      if (object.userData.isMapObject) {
        objectsToRemove.push(object);
      }
    });
    objectsToRemove.forEach((obj) => {
      this.scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }

  getSpawnPoint(team) {
    if (!this.loadedMap || !this.loadedMap.spawnPoints) {
      return { position: [0, 5, 0], rotation: [0, 0, 0] };
    }
    
    const spawns = this.loadedMap.spawnPoints[team];
    if (!spawns || spawns.length === 0) {
      return { position: [0, 5, 0], rotation: [0, 0, 0] };
    }
    
    // Return random spawn point for the team
    const spawn = spawns[Math.floor(Math.random() * spawns.length)];
    return {
      position: spawn.position,
      rotation: spawn.rotation || [0, 0, 0],
    };
  }

  getFlagPosition(team) {
    if (!this.loadedMap || !this.loadedMap.flags) {
      return team === 'red' ? [-8, 2, 0] : [8, 2, 0];
    }
    
    const flag = this.loadedMap.flags[team];
    return flag ? flag.position : (team === 'red' ? [-8, 2, 0] : [8, 2, 0]);
  }
}
