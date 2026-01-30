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
    // Create a simple default map - matches defaultMap.json
    const defaultMap = {
      blocks: [
        { type: 'platform', position: [0, 0, 0], size: [200, 1, 80] },
        { type: 'platform', position: [0, 2, 0], size: [8, 4, 8] },
      ],
      bases: {
        red: { position: [-80, 0.6, 0], size: [15, 0.2, 14] },
        blue: { position: [80, 0.6, 0], size: [15, 0.2, 14] },
      },
      spawnPoints: {
        red: [{ position: [-75, 2, 0], rotation: [0, Math.PI * 3 / 2, 0] }],
        blue: [{ position: [75, 2, 0], rotation: [0, Math.PI / 2, 0] }],
      },
      flags: {
        red: { position: [-80, 1, 0] },
        blue: { position: [80, 1, 0] },
      },
    };
    
    this.loadedMap = defaultMap;
    this.clearMap();
    this.createMapGeometry(defaultMap);
    await this.createFlags(defaultMap);
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
        
        const color = 0x888888; // Default gray
        const material = new THREE.MeshStandardMaterial({ color });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...block.position);
        if (block.rotation) {
          mesh.rotation.set(...block.rotation);
        }
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.userData.isMapObject = true;
        this.scene.add(mesh);
        
        // Create physics collider
        if (world) {
          try {
            const colliderDesc = RAPIER.ColliderDesc.cuboid(
              block.size[0] / 2,
              block.size[1] / 2,
              block.size[2] / 2
            );
            
            const isTallBlock = block.size[1] > 1;
            if (isTallBlock) {
              colliderDesc.setFriction(0.3);
              colliderDesc.setRestitution(0.5);
            } else {
              colliderDesc.setFriction(0.7);
              colliderDesc.setRestitution(0.1);
            }
            
            const rotation = block.rotation || [0, 0, 0];
            const quaternion = new THREE.Quaternion().setFromEuler(
              new THREE.Euler(rotation[0], rotation[1], rotation[2])
            );
            
            const bodyDesc = RAPIER.RigidBodyDesc.fixed()
              .setTranslation(
                block.position[0],
                block.position[1],
                block.position[2]
              )
              .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
            
            const body = world.createRigidBody(bodyDesc);
            world.createCollider(colliderDesc, body);
          } catch (error) {
            console.error(`❌ Error creating physics for block ${index}:`, error);
          }
        }
      });
      console.log(`✅ Created ${mapData.blocks.length} map blocks`);
    }
    
    // Create team bases from the bases field
    this.createTeamBases(mapData, world);
  }
  
  createTeamBases(mapData, world) {
    if (!mapData.bases) {
      console.warn('⚠️ No bases defined in map');
      return;
    }
    
    // Create red base
    if (mapData.bases.red) {
      const base = mapData.bases.red;
      const geometry = new THREE.BoxGeometry(base.size[0], base.size[1], base.size[2]);
      const material = new THREE.MeshStandardMaterial({ 
        color: 0xff4444,
        emissive: 0xff0000,
        emissiveIntensity: 0.2
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(base.position[0], base.position[1], base.position[2]);
      mesh.receiveShadow = true;
      mesh.userData.isMapObject = true;
      mesh.userData.isTeamBase = true;
      mesh.userData.team = 'red';
      this.scene.add(mesh);
      console.log('✅ Created red team base at', base.position);
    }
    
    // Create blue base
    if (mapData.bases.blue) {
      const base = mapData.bases.blue;
      const geometry = new THREE.BoxGeometry(base.size[0], base.size[1], base.size[2]);
      const material = new THREE.MeshStandardMaterial({ 
        color: 0x4444ff,
        emissive: 0x0000ff,
        emissiveIntensity: 0.2
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(base.position[0], base.position[1], base.position[2]);
      mesh.receiveShadow = true;
      mesh.userData.isMapObject = true;
      mesh.userData.isTeamBase = true;
      mesh.userData.team = 'blue';
      this.scene.add(mesh);
      console.log('✅ Created blue team base at', base.position);
    }
  }

  async createFlags(mapData) {
    if (!mapData.flags) {
      console.warn('⚠️ No flags in map data');
      return;
    }
    console.log('🚩 Creating flags from map data:', mapData.flags);

    // Create red flag
    if (mapData.flags.red) {
      this.createPlaceholderFlag('red', mapData.flags.red.position);
    }

    // Create blue flag
    if (mapData.flags.blue) {
      this.createPlaceholderFlag('blue', mapData.flags.blue.position);
    }
    
    console.log('🚩 Flags created:', { red: !!this.flags.red, blue: !!this.flags.blue });
  }

  createPlaceholderFlag(team, position) {
    const color = team === 'red' ? 0xff0000 : 0x0000ff;
    
    // Create a group and position it at the flag location
    const flagGroup = new THREE.Group();
    flagGroup.position.set(position[0], position[1], position[2]);
    
    // Smaller flag pole (appropriate size for CTF)
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, 4, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(0, 2, 0); // Pole center at 2 units up
    
    // Flag banner
    const bannerGeo = new THREE.PlaneGeometry(2, 1.2);
    const bannerMat = new THREE.MeshStandardMaterial({ 
      color, 
      side: THREE.DoubleSide, 
      emissive: color, 
      emissiveIntensity: 0.3 
    });
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(1, 3.4, 0); // Banner at top of pole
    
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
    console.log(`🚩 Created ${team} flag at`, position);
  }
  
  // Hide flag when it's picked up (carried by a player)
  setFlagVisible(team, visible) {
    console.log(`🚩 setFlagVisible: ${team} = ${visible}, flagExists: ${!!this.flags[team]}`);
    if (this.flags[team]) {
      this.flags[team].visible = visible;
      console.log(`🚩 Flag ${team} visibility set to ${visible}`);
    } else {
      console.warn(`🚩 Flag ${team} not found in mapLoader.flags`);
    }
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
    console.log('🧹 clearMap() called - removing all map objects');
    // Remove all map meshes (keep player objects)
    // This is a simple implementation - in production, track map objects
    const objectsToRemove = [];
    this.scene.traverse((object) => {
      if (object.userData.isMapObject) {
        objectsToRemove.push(object);
      }
    });
    console.log(`🧹 Found ${objectsToRemove.length} objects to remove`);
    objectsToRemove.forEach((obj) => {
      if (obj.userData.isFlag) {
        console.log(`🧹 Removing flag: team=${obj.userData.team}`);
      }
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
    console.log('🧹 clearMap() complete, scene children:', this.scene.children.length);
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
