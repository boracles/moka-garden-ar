import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const cache=new WeakMap();

// A soft studio reflection so glossy and pearl finishes read on the clay.
export function softEnvironment(scene,renderer,intensity=.25) {
  if (!renderer) return;
  if (!cache.has(renderer)) {
    const pmrem=new THREE.PMREMGenerator(renderer);
    const room=new RoomEnvironment();
    cache.set(renderer,pmrem.fromScene(room,.04).texture);
    room.dispose?.();
    pmrem.dispose();
  }
  scene.environment=cache.get(renderer);
  scene.environmentIntensity=intensity;
}
