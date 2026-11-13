import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

export const palette = [
  ['도자기색', '#e6ddc9'],
  ['황토 금색', '#c48b37'],
  ['짙은 녹색', '#34574c'],
  ['붉은 흙', '#a34f3d'],
  ['먹색', '#282e31'],
  ['회청색', '#77929a'],
];

const ceramic = new THREE.MeshStandardMaterial({vertexColors:true,roughness:.48});
const brass = new THREE.MeshStandardMaterial({vertexColors:true,roughness:.34,metalness:.28});
const neighbors = new WeakMap();

const stone = '#e4ded1';
const slate = '#365052';
const gold = '#bc873e';
const starterArmAngle=.82;
const earSpread=.68;
const extensionJoints=['ClayBase','ClayMiddle','ClayTip'];
const bendAngles=[.10,.66,.92];

function listeningEars(model) {
  const left=model.getObjectByName('EarL');
  const right=model.getObjectByName('EarR');
  return amount=>{
    const spread=earSpread*(1-amount);
    left.rotation.z=-spread;
    right.rotation.z=spread;
  };
}

export function partReaction(model,part) {
  if (part==='ears') return listeningEars(model);
  const bones=extensionJoints.map(name=>model.getObjectByName(name));
  return amount=>{
    bones.forEach((bone,index)=>{bone.rotation.z=bendAngles[index]*amount;});
  };
}

export function extensionClip(samples) {
  const times=samples.map(sample=>sample.time);
  const axis=new THREE.Vector3(0,0,1);
  const rotation=new THREE.Quaternion();
  const tracks=extensionJoints.map((name,index)=>{
    const values=samples.flatMap(({amount})=>rotation.setFromAxisAngle(axis,bendAngles[index]*amount).toArray());
    return new THREE.QuaternionKeyframeTrack(name+'.quaternion',times,values);
  });
  return new THREE.AnimationClip('Moving clay',times.at(-1),tracks);
}

function tint(geometry,color) {
  const count=geometry.getAttribute('position').count;
  const paint=new THREE.Color(color);
  const colors=new Float32Array(count*3);
  for (let i=0;i<count;i++) paint.toArray(colors,i*3);
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
}

function volume(x,y,z) {
  return new THREE.SphereGeometry(1,48,40).scale(x,y,z);
}

function writeSkin(geometry,weightsForHeight) {
  const position=geometry.getAttribute('position');
  const weights=new Float32Array(position.count*4);
  const indices=new Uint16Array(position.count*4);
  for (let i=0;i<position.count;i++) {
    for (const [joint,weight] of weightsForHeight(position.getY(i)).entries()) {
      indices[i*4+joint]=joint;
      weights[i*4+joint]=weight;
    }
  }
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
  geometry.setAttribute('skinWeight',new THREE.BufferAttribute(weights,4));
}

function fitLimbSkin(geometry,hinge) {
  writeSkin(geometry,y=>{
    const blend=THREE.MathUtils.smoothstep(-y,hinge-.145,hinge+.145);
    return [1-blend,blend];
  });
}

export function createAvatar({example=false}={}) {
  const model=new THREE.Group();
  model.name='GardenCreature';
  const joints={};
  const surfaces=[];
  const symmetryPairs=new Map();
  const parts=new Map();

  function joint(parent,name,x=0,y=0,z=0) {
    const bone=new THREE.Bone();
    bone.name=name;
    bone.position.set(x,y,z);
    parent.add(bone);
    joints[name]=bone;
    return bone;
  }

  function sculptable(parent,name,geometry,position,color=stone,material=ceramic) {
    tint(geometry,color);
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=name;
    mesh.position.set(...position);
    mesh.castShadow=true;
    parent.add(mesh);
    surfaces.push(mesh);
    return mesh;
  }

  function ornament(parent,geometry,position,color,material=ceramic) {
    tint(geometry,color);
    const mesh=new THREE.Mesh(geometry,material);
    mesh.position.set(...position);
    mesh.castShadow=true;
    parent.add(mesh);
    return mesh;
  }

  const pelvis=joint(model,'Pelvis',0,.88,0);
  const spine=joint(pelvis,'Spine',0,.23,0);
  const head=joint(spine,'Head',0,.57,0);
  const ears=[1,-1].map((side,index)=>{
    const ear=new THREE.Group();
    ear.name=index===0?'EarL':'EarR';
    ear.rotation.z=-side*earSpread;
    head.add(ear);
    return ear;
  });
  const extension=new THREE.Group();
  extension.name='ExtensionPivot';
  const extensionBones=extensionJoints.map(name=>Object.assign(new THREE.Bone(),{name}));
  extension.add(extensionBones[0]);
  extensionBones[0].add(extensionBones[1]);
  extensionBones[1].add(extensionBones[2]);
  extensionBones[1].position.y=.18;
  extensionBones[2].position.y=.21;
  let extensionPlace='top';
  function positionExtension(place=extensionPlace) {
    extensionPlace=place;
    const hasHead=parts.has('head');
    const onHead=hasHead && (place==='top' || place==='front');
    (onHead?head:spine).add(extension);
    const positions={
      top:[0,onHead?.42:.45,0],front:[0,onHead?.14:.03,onHead?.30:.45],
      side:[.45,.035,0],back:[0,-.14,-.43],
    };
    extension.position.set(...positions[place]);
    const tilt={front:1.05,back:-1.15};
    extension.rotation.set(tilt[place]??0,0,place==='side'?-1.05:0);
  }
  positionExtension();
  function positionEars() {
    const hasHead=parts.has('head');
    ears[0].position.set(hasHead?.255:.36,hasHead?.31:-.28,.05);
    ears[1].position.set(-ears[0].position.x,ears[0].position.y,ears[0].position.z);
  }
  positionEars();
  for (const [side,sign] of [['L',1],['R',-1]]) {
    const arm=joint(spine,'UpperArm'+side,sign*.32,.315,0);
    arm.rotation.z=sign*(example ? .26 : starterArmAngle);
    joint(arm,'Forearm'+side,0,-.34,0);
    const leg=joint(pelvis,'Thigh'+side,sign*.173,-.135,0);
    leg.rotation.z=sign*(example ? .035 : .18);
    joint(leg,'Shin'+side,0,-.355,0);
  }
  model.updateMatrixWorld(true);

  // The brush edits the same vertices that the upper and lower joint animate.
  function limb(name,upper,lower,isLeg,color=stone) {
    const geometry=volume(isLeg?.136:.132,isLeg?.425:.398,isLeg?.134:.124);
    geometry.translate(0,isLeg?-.291:-.294,0);
    fitLimbSkin(geometry,-lower.position.y);
    tint(geometry,color);
    const mesh=new THREE.SkinnedMesh(geometry,ceramic);
    mesh.name=name;
    mesh.frustumCulled=false;
    mesh.castShadow=true;
    model.updateMatrixWorld(true);
    const transform=model.matrixWorld.clone().invert().multiply(upper.matrixWorld);
    transform.decompose(mesh.position,mesh.quaternion,mesh.scale);
    model.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([upper,lower]));
    surfaces.push(mesh);
    return mesh;
  }

  function movingClay() {
    const geometry=volume(.127,.345,.119).translate(0,.27,0);
    writeSkin(geometry,y=>{
      const middle=THREE.MathUtils.smoothstep(y,.06,.29);
      const tip=THREE.MathUtils.smoothstep(y,.27,.52);
      return [1-middle,middle*(1-tip),middle*tip];
    });
    tint(geometry,stone);
    const mesh=new THREE.SkinnedMesh(geometry,ceramic);
    mesh.name='Moving clay';
    mesh.frustumCulled=false;
    mesh.castShadow=true;
    extension.add(mesh);
    model.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(extensionBones));
    surfaces.push(mesh);
    return mesh;
  }

  function addPart(kind) {
    if (example || parts.has(kind)) return false;
    const created=[];
    if (kind==='head') {
      created.push(sculptable(head,'Head clay',volume(.28,.32,.255),[0,.105,0]));
    } else if (kind==='ears') {
      for (const ear of ears) {
        created.push(sculptable(ear,ear.name+' clay',volume(.115,.205,.073),[0,.135,0]));
      }
    } else if (kind==='extension') {
      created.push(movingClay());
    } else if (kind==='arms' || kind==='legs') {
      const isLeg=kind==='legs';
      for (const side of ['L','R']) {
        const [upper,lower]=isLeg?[joints['Thigh'+side],joints['Shin'+side]]:[joints['UpperArm'+side],joints['Forearm'+side]];
        created.push(limb(kind+' clay '+side,upper,lower,isLeg));
        if (isLeg) created.push(sculptable(lower,'Foot clay '+side,volume(.139,.086,.189),[0,-.30,.051]));
      }
    }
    if (!created.length) return false;
    if (kind==='ears' || kind==='arms' || kind==='legs') {
      const half=created.length/2;
      for (let i=0;i<half;i++) {
        symmetryPairs.set(created[i],created[i+half]);
        symmetryPairs.set(created[i+half],created[i]);
      }
    }
    parts.set(kind,created);
    if (kind==='head') {
      positionEars();
      positionExtension();
    }
    return true;
  }

  function removePart(kind) {
    const meshes=parts.get(kind);
    if (!meshes) return;
    for (const mesh of meshes) {
      symmetryPairs.delete(mesh);
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.skeleton?.dispose();
      const index=surfaces.indexOf(mesh);
      if (index!==-1) surfaces.splice(index,1);
    }
    parts.delete(kind);
    if (kind==='head') {
      positionEars();
      positionExtension();
    }
  }

  if (!example) {
    sculptable(spine,'Body clay',volume(.39,.54,.25),[0,-.045,0]);
    for (const part of ['head','arms','legs']) addPart(part);
  } else {
    const body=volume(.385,.615,.302);
    const v=body.getAttribute('position');
    for(let i=0;i<v.count;i++){
      const height=(v.getY(i)+.615)/1.23;
      v.setX(i,v.getX(i)*(1.16-height*.40)+.13*(height-.5)**2);
      v.setZ(i,v.getZ(i)+.105*(height-.46));
    }
    body.computeVertexNormals();
    sculptable(spine,'Tapered porcelain body',body,[-.02,.014,0]);
    for (const side of ['L','R']) {
      limb('Porcelain arm '+side,joints['UpperArm'+side],joints['Forearm'+side],false);
      limb('Porcelain leg '+side,joints['Thigh'+side],joints['Shin'+side],true);
      sculptable(joints['Shin'+side],'Porcelain foot '+side,volume(.142,.083,.194),[0,-.306,.055],side==='L'?slate:stone);
    }

    sculptable(head,'Long head',volume(.259,.492,.292),[.008,.235,.037]).rotation.z=-.26;
    sculptable(head,'Projecting face',volume(.176,.102,.189),[-.072,.083,.252]).rotation.z=.18;
    const arc=new THREE.CatmullRomCurve3([
      new THREE.Vector3(.128,.43,-.039),new THREE.Vector3(.249,.56,-.04),
      new THREE.Vector3(.337,.725,-.053),new THREE.Vector3(.265,.857,-.042),
      new THREE.Vector3(.135,.825,-.02),new THREE.Vector3(.123,.729,.023),
    ]);
    ornament(head,new THREE.TubeGeometry(arc,42,.064,16,false),[0,0,0],slate);
    ornament(head,volume(.091,.091,.091),[.122,.725,.024],gold,brass);
    for (const [x,y,z,rotation] of [[-.116,.286,.296,.1],[.07,.31,.323,-.03]]) {
      const eye=ornament(head,volume(.029,.009,.013),[x,y,z],'#343733');
      eye.rotation.z=rotation;
    }
    const bodyInset=ornament(spine,volume(.050,.139,.027),[-.149,-.084,.282],gold,brass);
    bodyInset.rotation.z=-.19;
    for (let i=0;i<3;i++) {
      const offset=i*.033;
      const groove=new THREE.CatmullRomCurve3([
        new THREE.Vector3(.116+offset,-.278,.263-offset*.72),
        new THREE.Vector3(.132+offset,-.343,.241-offset*.68),
        new THREE.Vector3(.123+offset,-.405,.208-offset*.65),
      ]);
      ornament(spine,new THREE.TubeGeometry(groove,15,.006,7,false),[0,0,0],'#a39c89');
    }
  }

  const rest=Object.fromEntries(Object.entries(joints).map(([name,bone])=>[name,bone.quaternion.clone()]));
  function mirrorSurface(mesh) {
    if (mesh.parent===extension && extensionPlace==='side') return null;
    return symmetryPairs.get(mesh)??mesh;
  }

  return {model,joints,rest,surfaces,parts,addPart,removePart,positionExtension,mirrorSurface};
}

export function resetPose(avatar) {
  if (avatar.restHip) avatar.joints.Pelvis.position.copy(avatar.restHip);
  for (const [name,rotation] of Object.entries(avatar.rest)) {
    avatar.joints[name].quaternion.copy(rotation);
  }
  avatar.model.updateMatrixWorld(true);
}

function refreshAttribute(mesh,key) {
  const geometry=mesh.geometry;
  geometry.getAttribute(key).needsUpdate=true;
  if (key==='position') {
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    if (mesh.isSkinnedMesh) {
      mesh.boundingSphere=null;
      mesh.boundingBox=null;
    }
  }
}

export function restoreBrushAttribute(mesh,key,values) {
  mesh.geometry.getAttribute(key).array.set(values);
  refreshAttribute(mesh,key);
}

function surfaceNeighbors(geometry) {
  if (neighbors.has(geometry)) return neighbors.get(geometry);
  const positions=geometry.getAttribute('position');
  const groupIds=[];
  const groups=[];
  const groupByPosition=new Map();
  for (let i=0;i<positions.count;i++) {
    const key=[positions.getX(i),positions.getY(i),positions.getZ(i)]
      .map(value=>Math.round(value*100000)).join(',');
    let id=groupByPosition.get(key);
    if (id===undefined) {
      id=groups.length;
      groups.push({vertex:i,links:new Set()});
      groupByPosition.set(key,id);
    }
    groupIds.push(id);
  }
  const faces=geometry.index.array;
  for (let i=0;i<faces.length;i+=3) {
    const face=[groupIds[faces[i]],groupIds[faces[i+1]],groupIds[faces[i+2]]];
    for (let j=0;j<3;j++) {
      const a=face[j], b=face[(j+1)%3];
      if (a===b) continue;
      groups[a].links.add(b);
      groups[b].links.add(a);
    }
  }
  const links=groups.map(group=>[...group.links].map(id=>groups[id].vertex));
  const result=groupIds.map(id=>links[id]);
  neighbors.set(geometry,result);
  return result;
}

export function reflectedBrush(avatar,hit) {
  const object=avatar.mirrorSurface(hit.object);
  if (!object) return null;
  const {model}=avatar;
  model.updateWorldMatrix(true,true);
  const modelInverse=model.matrixWorld.clone().invert();
  const targetInverse=object.matrixWorld.clone().invert();
  const point=hit.point.clone().applyMatrix4(modelInverse);
  point.x=-point.x;
  point.applyMatrix4(model.matrixWorld);
  const normal=hit.face.normal.clone()
    .transformDirection(hit.object.matrixWorld)
    .transformDirection(modelInverse);
  normal.x=-normal.x;
  normal.transformDirection(model.matrixWorld).transformDirection(targetInverse);
  return {object,point,face:{normal}};
}

export function applyBrush(hits,tool,radius,distance,color,pressure=1) {
  const samplesByMesh=new Map();
  for (const {object,point,face} of hits) {
    if (!samplesByMesh.has(object)) samplesByMesh.set(object,[]);
    samplesByMesh.get(object).push({
      center:object.worldToLocal(point.clone()),
      normal:face.normal.clone().normalize(),
    });
  }
  for (const [mesh,samples] of samplesByMesh) {
    applyBrushSamples(mesh,samples,tool,radius,distance,color,pressure);
  }
}

function applyBrushSamples(mesh,samples,tool,radius,distance,color,pressure) {
  const geometry=mesh.geometry;
  const key=tool==='paint'?'color':'position';
  const attribute=geometry.getAttribute(key);
  const positions=geometry.getAttribute('position').array;
  const radiusSquared=radius*radius;
  const strength=Math.min(.027,Math.max(.008,distance*.0022))*pressure*(tool==='push'?-1:1);
  const adjacency=tool==='smooth'?surfaceNeighbors(geometry):null;
  const output=attribute.array.slice();
  const normal=new THREE.Vector3();
  for (let i=0;i<positions.length;i+=3) {
    let influence=0;
    let totalWeight=0;
    normal.set(0,0,0);
    for (const sample of samples) {
      const dx=positions[i]-sample.center.x;
      const dy=positions[i+1]-sample.center.y;
      const dz=positions[i+2]-sample.center.z;
      const d=dx*dx+dy*dy+dz*dz;
      if (d>=radiusSquared) continue;
      const weight=(1-d/radiusSquared)**2;
      influence=Math.max(influence,weight);
      totalWeight+=weight;
      normal.addScaledVector(sample.normal,weight);
    }
    if (!influence) continue;
    if (tool==='paint') {
      const coverage=Math.min(1,influence*2.15*pressure);
      output[i]+=(color.r-output[i])*coverage;
      output[i+1]+=(color.g-output[i+1])*coverage;
      output[i+2]+=(color.b-output[i+2])*coverage;
    } else if (adjacency) {
      const adjacent=adjacency[i/3];
      if (!adjacent.length) continue;
      for (let k=0;k<3;k++) {
        const mean=adjacent.reduce((sum,vertex)=>sum+positions[vertex*3+k],0)/adjacent.length;
        output[i+k]+=(mean-positions[i+k])*influence*.58*pressure;
      }
    } else {
      const displacement=strength*influence/totalWeight;
      output[i]+=normal.x*displacement;
      output[i+1]+=normal.y*displacement;
      output[i+2]+=normal.z*displacement;
    }
  }
  restoreBrushAttribute(mesh,key,output);
}

export function snapshotModel(avatar) {
  const model=clone(avatar.model);
  model.name='GardenCreature';
  model.position.set(0,0,0);
  model.rotation.set(0,0,0);
  model.scale.setScalar(1);
  if (avatar.restHip) model.getObjectByName('Pelvis').position.copy(avatar.restHip);
  for (const [name,rotation] of Object.entries(avatar.rest)) {
    model.getObjectByName(name).quaternion.copy(rotation);
  }
  partReaction(model,'ears')(0);
  partReaction(model,'extension')(0);
  return model;
}

export function rigPreview(avatar) {
  const times=[0,.48,.96,1.5];
  const euler=new THREE.Euler();
  const rotation=new THREE.Quaternion();
  const offset=new THREE.Quaternion();
  function track(name,angles) {
    const values=angles.flatMap(values=>rotation.copy(avatar.rest[name])
      .multiply(offset.setFromEuler(euler.set(...values))).toArray());
    return new THREE.QuaternionKeyframeTrack(name+'.quaternion',times,values);
  }
  return new THREE.AnimationClip('Rig preview',1.5,[
    track('Head',[[0,0,0],[0,-.12,.19],[0,.08,-.16],[0,0,0]]),
    track('Spine',[[0,0,0],[.05,0,.13],[0,0,-.08],[0,0,0]]),
    track('UpperArmL',[[0,0,0],[0,0,.52],[0,0,.42],[0,0,0]]),
    track('ForearmL',[[0,0,0],[-.22,0,.60],[-.20,0,.32],[0,0,0]]),
  ]);
}

