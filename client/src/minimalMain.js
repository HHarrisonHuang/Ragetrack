console.log("📦 minimalMain.js script started loading...");

import * as THREE from "three";
import { connect, sendInput, setupKeyboardInput, getMyId, getPlayers, setOnSnapshot } from "./minimalClient.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 20, 30);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
const appElement = document.getElementById("app");
if (appElement) appElement.appendChild(renderer.domElement);
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(50, 100, 50);
scene.add(directionalLight);
const groundGeometry = new THREE.PlaneGeometry(200, 200);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const gridHelper = new THREE.GridHelper(200, 20, 0x666666, 0x333333);
scene.add(gridHelper);
const playerMeshes = new Map();
function createPlayerMesh(id) {
  const geometry = new THREE.BoxGeometry(2, 1, 4);
  const material = new THREE.MeshStandardMaterial({ color: id === getMyId() ? 0x00ff00 : 0x0088ff });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 2, 0);
  scene.add(mesh);
  return mesh;
}
const joinButton = document.getElementById("joinButton");
const connectionStatus = document.getElementById("connectionStatus");
const playerCount = document.getElementById("playerCount");
const lobby = document.getElementById("lobby");
const gameInfo = document.getElementById("gameInfo");
if (joinButton) {
  joinButton.addEventListener("click", () => {
    console.log("🔵 Connect button clicked!");
    connect();
    setupKeyboardInput();
    joinButton.disabled = true;
    joinButton.textContent = "Connecting...";
    if (connectionStatus) {
      connectionStatus.textContent = "Connecting to server...";
      connectionStatus.style.color = "#ff9800";
    }
  });
}
setOnSnapshot((snapshot) => {
  if (connectionStatus) {
    connectionStatus.textContent = "Connected";
    connectionStatus.style.color = "#4CAF50";
  }
  const myId = getMyId();
  const playerCountNum = Object.keys(snapshot).length;
  if (playerCount) playerCount.textContent = `Players: ${playerCountNum}`;
  if (lobby) lobby.style.display = "none";
  if (gameInfo) gameInfo.style.display = "block";
  if (gameInfo) {
    const currentPlayersEl = document.getElementById("currentPlayers");
    if (currentPlayersEl) currentPlayersEl.textContent = playerCountNum;
  }
  Object.entries(snapshot).forEach(([id, state]) => {
    if (!playerMeshes.has(id)) {
      const mesh = createPlayerMesh(id);
      playerMeshes.set(id, mesh);
    }
    const mesh = playerMeshes.get(id);
    mesh.position.set(state.x, state.y, state.z);
    mesh.rotation.y = state.rotation;
  });
  if (myId && snapshot[myId]) {
    const myState = snapshot[myId];
    camera.position.set(myState.x + 10, myState.y + 15, myState.z + 20);
    camera.lookAt(myState.x, myState.y, myState.z);
  }
});
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
console.log("✅ minimalMain.js loaded successfully");
