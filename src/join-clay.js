import * as THREE from 'three';
import {clayBodyName} from './clay-body.js';

const fusedName='Joined clay';

export function hasClayFusion(model) {
  return Boolean(model.getObjectByName(fusedName));
}

export function claySources(model) {
  const sources=[];
  model.traverse(node=>{
    if (node.isMesh && node.name!==fusedName) sources.push(node);
  });
  return sources;
}

export function showClaySources(model,visible) {
  const fused=model.getObjectByName(fusedName);
  if (!fused) return;
  fused.visible=!visible;
  for (const mesh of claySources(model)) mesh.visible=visible;
}

export function clearClayFusion(model,{dispose=true}={}) {
  const fused=model.getObjectByName(fusedName);
  if (!fused) return;
  showClaySources(model,true);
  fused.removeFromParent();
  if (dispose) {
    fused.geometry.dispose();
    fused.skeleton.dispose();
  }
}

export function prepareClayFusion(model) {
  model.updateWorldMatrix(true,true);
  model.updateMatrixWorld(true);
  const meshes=claySources(model);
  const body=meshes.find(mesh=>mesh.name===clayBodyName);
  if (meshes.length<2 || !body) return null;
  const bones=[];
  const point=new THREE.Vector3();
  const toModel=model.matrixWorld.clone().invert();
  function boneIndex(bone) {
    const existing=bones.indexOf(bone);
    if (existing!==-1) return existing;
    bones.push(bone);
    return bones.length-1;
  }
  const inputs=meshes.map(mesh=>{
    const {position,color,skinIndex,skinWeight}=mesh.geometry.attributes;
    const positions=new Float32Array(position.count*3);
    const indices=new Uint16Array(position.count*4);
    const weights=new Float32Array(position.count*4);
    const lookup=mesh.isSkinnedMesh?mesh.skeleton.bones.map(boneIndex):[boneIndex(mesh.parent)];
    for (let i=0;i<position.count;i++) {
      mesh.getVertexPosition(i,point);
      point.applyMatrix4(mesh.matrixWorld).applyMatrix4(toModel).toArray(positions,i*3);
      if (skinIndex) {
        for (let slot=0;slot<4;slot++) {
          indices[i*4+slot]=lookup[skinIndex.getComponent(i,slot)];
          weights[i*4+slot]=skinWeight.getComponent(i,slot);
        }
      } else {
        indices[i*4]=lookup[0];
        weights[i*4]=1;
      }
    }
    return {positions,index:mesh.geometry.index.array.slice(),colors:color.array.slice(),skinIndex:indices,skinWeight:weights};
  });
  const inverses=bones.map(bone=>bone.matrixWorld.clone().invert());
  return {inputs,bones,inverses,bindMatrix:model.matrixWorld.clone(),material:body.material};
}

export function installClayFusion(model,{bones,inverses,bindMatrix,material},data) {
  clearClayFusion(model);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));
  geometry.setAttribute('color',new THREE.BufferAttribute(data.colors,3));
  geometry.setAttribute('skinIndex',new THREE.BufferAttribute(data.indices,4));
  geometry.setAttribute('skinWeight',new THREE.BufferAttribute(data.weights,4));
  geometry.setIndex(new THREE.BufferAttribute(data.index,1));
  const joined=new THREE.SkinnedMesh(geometry,material);
  joined.name=fusedName;
  joined.frustumCulled=false;
  joined.castShadow=true;
  model.add(joined);
  model.updateMatrixWorld(true);
  joined.bind(new THREE.Skeleton(bones,inverses),bindMatrix);
  showClaySources(model,false);
}

let worker;
let serial=0;
const pending=new Map();
let queue=Promise.resolve();

export function joinClay(model,stillCurrent=()=>true) {
  const job=queue.then(()=>{
    if (stillCurrent()) return runFusion(model,stillCurrent);
  });
  queue=job.catch(()=>{});
  return job;
}

function runFusion(model,stillCurrent) {
  const prepared=prepareClayFusion(model);
  if (!prepared) {
    clearClayFusion(model);
    return Promise.resolve();
  }
  if (!worker) {
    worker=new Worker(new URL('./clay-fusion-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{
      const request=pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.result);
    };
    worker.onerror=()=>{
      worker.terminate();
      worker=null;
      for (const request of pending.values()) request.reject(new Error('Clay fusion worker failed.'));
      pending.clear();
    };
  }
  const id=++serial;
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject});
    const {inputs,bones}=prepared;
    worker.postMessage({id,inputs,boneCount:bones.length},
      inputs.flatMap(input=>Object.values(input).map(array=>array.buffer)));
  }).then(data=>{
    if (stillCurrent()) installClayFusion(model,prepared,data);
  });
}
