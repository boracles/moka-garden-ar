import * as THREE from 'three';

export function createGrab(avatar,hits,radius,strength) {
  const {model}=avatar;
  const toModel=model.matrixWorld.clone().invert();
  const targets=new Map();
  for (const [side,{object,point}] of hits.entries()) {
    if (!targets.has(object)) {
      targets.set(object,{
        original:object.geometry.attributes.position.array.slice(),
        samples:[],
        toLocal:object.matrixWorld.clone().invert().multiply(model.matrixWorld),
      });
    }
    const target=targets.get(object);
    const center=object.worldToLocal(point.clone());
    const weights=new Float32Array(target.original.length/3);
    for (let i=0;i<weights.length;i++) {
      const offset=i*3;
      const x=target.original[offset]-center.x;
      const y=target.original[offset+1]-center.y;
      const z=target.original[offset+2]-center.z;
      const t=1-(x*x+y*y+z*z)/(radius*radius);
      if (t>0) weights[i]=t*t;
    }
    target.samples.push({side,weights,delta:new THREE.Vector3()});
  }

  const changes=new Map();
  const delta=new THREE.Vector3();
  const combined=new THREE.Vector3();
  return {
    changes,
    move(worldDelta) {
      delta.copy(worldDelta).applyMatrix3(directionMatrix.setFromMatrix4(toModel)).multiplyScalar(strength);
      if (!changes.size && delta.lengthSq()<1e-8) return;
      for (const [mesh,{original,samples,toLocal}] of targets) {
        const positions=mesh.geometry.attributes.position;
        const matrix=localMatrix.setFromMatrix4(toLocal);
        for (const sample of samples) {
          sample.delta.copy(delta);
          if (sample.side===1) sample.delta.x*=-1;
          sample.delta.applyMatrix3(matrix);
        }
        for (let i=0;i<positions.count;i++) {
          const offset=i*3;
          let weight=0,maximum=0;
          combined.set(0,0,0);
          for (const sample of samples) {
            const amount=sample.weights[i];
            weight+=amount;
            maximum=Math.max(maximum,amount);
            combined.addScaledVector(sample.delta,amount);
          }
          if (!weight) continue;
          combined.multiplyScalar(maximum/weight);
          positions.setXYZ(i,original[offset]+combined.x,original[offset+1]+combined.y,original[offset+2]+combined.z);
        }
        changes.set(mesh,original);
        positions.needsUpdate=true;
        mesh.geometry.computeVertexNormals();
      }
    },
    finish() {
      for (const mesh of changes.keys()) {
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
        if (mesh.isSkinnedMesh) {
          mesh.boundingSphere=null;
          mesh.boundingBox=null;
        }
      }
    },
  };
}

const directionMatrix=new THREE.Matrix3();
const localMatrix=new THREE.Matrix3();
