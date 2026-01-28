# Installing Rapier for Node.js Server

The `@dimforge/rapier3d` package has ESM import issues in Node.js. To fix this, you have two options:

## Option 1: Install rapier3d-node (Recommended)

Run this command in the `server` directory:

```bash
cd server
npm install rapier3d-node
```

Then update `server/src/physicsWorld.js` to use:
```javascript
const rapierModule = await import('rapier3d-node');
RAPIER = rapierModule.default || rapierModule;
```

## Option 2: Use the current wrapper (Temporary)

The current code uses a minimal wrapper around the Raw WASM classes. This works but has limited functionality.

## Option 3: Use a bundler

You can use esbuild or similar to bundle the server code, which will resolve the relative imports.
