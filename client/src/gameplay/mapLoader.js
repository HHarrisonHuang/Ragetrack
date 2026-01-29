import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d';

export class MapLoader {
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.loadedMap = null;
    this.flags = { red: null, blue: null }; // Store flag meshes
    this.gltfLoader = new GLTFLoader();
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
      // Create flags
      await this.createFlags(mapData);
      console.log('✅ Map geometry created');
      
      return mapData;
    } catch (error) {
      console.error('❌ Error loading map:', error);
      console.log('📦 Falling back to default map');
      // Load default map if specified map fails
      return this.loadDefaultMap();
    }
  }

  async loadDefaultMap() {
    console.log('📦 Loading default map (fallback)');
    // Create a simple default map
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
    this.clearMap();
    this.createMapGeometry(defaultMap);
    await this.createFlags(defaultMap); // Create flags for default map too
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
            
            // Set physics properties based on block type
            if (block.type === 'obstacle') {
              // Obstacles: solid collisions like real life - cars hit and stop/bounce realistically
              colliderDesc.setFriction(0.5); // Moderate friction - cars can slide but also grip
              colliderDesc.setRestitution(0.5); // Higher bounciness - cars bounce back further
            } else {
              // Platforms: lower friction to prevent sticking, especially for vertical surfaces
              // If platform is tall (height > 1), treat it more like an obstacle
              const isTallBlock = block.size[1] > 1;
              if (isTallBlock) {
                colliderDesc.setFriction(0.3); // Lower friction for tall blocks - cars slide off
                colliderDesc.setRestitution(0.5); // Higher bounce for tall blocks - cars bounce back further
              } else {
                // Flat platforms: normal friction for driving
                colliderDesc.setFriction(0.7);
                colliderDesc.setRestitution(0.1);
              }
            }
            
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

  async createFlags(mapData) {
    if (!mapData.flags) {
      console.warn('⚠️ No flags in map data');
      return;
    }

    // Create red flag
    if (mapData.flags.red) {
      await this.loadFlag('red', mapData.flags.red.position);
    }

    // Create blue flag
    if (mapData.flags.blue) {
      await this.loadFlag('blue', mapData.flags.blue.position);
    }
  }

  async loadFlag(team, position) {
    try {
      const flagPath = team === 'red' ? '/models/redFlag.glb' : '/models/blueFlag.glb';
      console.log(`🚩 Loading ${team} flag from ${flagPath}`);
      
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(
          flagPath,
          (gltf) => resolve(gltf),
          undefined,
          (error) => reject(error)
        );
      });

      const flagModel = gltf.scene.clone();
      flagModel.position.set(position[0], position[1], position[2]);
      
      // Enable shadows
      flagModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      flagModel.userData.isMapObject = true;
      flagModel.userData.isFlag = true;
      flagModel.userData.team = team;
      
      // Remove old flag if it exists
      if (this.flags[team]) {
        this.scene.remove(this.flags[team]);
        // Dispose of old flag geometry/materials
        this.flags[team].traverse((child) => {
          if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
              } else {
                child.material.dispose();
              }
            }
          }
        });
      }

      this.scene.add(flagModel);
      this.flags[team] = flagModel;
      console.log(`✅ ${team} flag created at`, position);
    } catch (error) {
      console.error(`❌ Failed to load ${team} flag:`, error);
      // Create a simple placeholder flag
      this.createPlaceholderFlag(team, position);
    }
  }

  createPlaceholderFlag(team, position) {
    const color = team === 'red' ? 0xff0000 : 0x0000ff;
    const geometry = new THREE.CylinderGeometry(0.1, 0.1, 3, 8);
    const material = new THREE.MeshStandardMaterial({ color });
    const pole = new THREE.Mesh(geometry, material);
    pole.position.set(position[0], position[1] + 1.5, position[2]);
    
    // Create flag banner
    const flagGeometry = new THREE.PlaneGeometry(1, 0.8);
    const flagMaterial = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide });
    const banner = new THREE.Mesh(flagGeometry, flagMaterial);
    banner.position.set(position[0] + 0.5, position[1] + 2, position[2]);
    
    const flagGroup = new THREE.Group();
    flagGroup.add(pole);
    flagGroup.add(banner);
    flagGroup.userData.isMapObject = true;
    flagGroup.userData.isFlag = true;
    flagGroup.userData.team = team;
    
    pole.castShadow = true;
    pole.receiveShadow = true;
    banner.castShadow = true;
    banner.receiveShadow = true;

    if (this.flags[team]) {
      this.scene.remove(this.flags[team]);
    }
    
    this.scene.add(flagGroup);
    this.flags[team] = flagGroup;
    console.log(`✅ Placeholder ${team} flag created at`, position);
  }

  getFlagMesh(team) {
    return this.flags[team] || null;
  }

  updateFlagPosition(team, position) {
    const flag = this.flags[team];
    if (flag) {
      flag.position.set(position[0], position[1], position[2]);
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
      // Dispose of geometries and materials
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
      // For groups (like flags), traverse and dispose children
      if (obj.isGroup || obj.children) {
        obj.traverse((child) => {
          if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
              } else {
                child.material.dispose();
              }
            }
          }
        });
      }
    });
    // Clear flag references
    this.flags = { red: null, blue: null };
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
