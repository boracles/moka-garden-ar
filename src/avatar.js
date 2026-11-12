import * as THREE from 'three';

export const palette = [
  ['잎사귀 초록', '#719b75'],
  ['노을 분홍', '#ce847b'],
  ['푸른 회색', '#7a98ad'],
  ['흙 갈색', '#b48563'],
  ['연보라', '#9a89ae'],
];

const clay = new THREE.MeshStandardMaterial({color:palette[0][1],roughness:.75});
const belly = new THREE.MeshStandardMaterial({color:'#d9dfb5',roughness:.84});
const blush = new THREE.MeshStandardMaterial({color:'#db9e89',roughness:.85});
const eyes = new THREE.MeshStandardMaterial({color:'#24332b',roughness:.25});
const shine = new THREE.MeshBasicMaterial({color:'#fcfff1'});
const dark = new THREE.MeshStandardMaterial({color:'#3a5141',roughness:.7});

export function createAvatar() {
  const model = new THREE.Group();
  model.name = 'GardenCreature';
  const joints = {};
  const surfaces = [];
  const skin = clay.clone();
  const soft = belly.clone();

  function joint(parent,name,x=0,y=0,z=0) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x,y,z);
    parent.add(bone);
    joints[name] = bone;
    return bone;
  }

  function oval(parent,name,dimensions,position,material=skin,editable=false) {
    const geometry = new THREE.SphereGeometry(1,28,20);
    geometry.scale(...dimensions);
    const mesh = new THREE.Mesh(geometry,material);
    mesh.name = name;
    mesh.position.set(...position);
    parent.add(mesh);
    mesh.castShadow = true;
    if (editable) surfaces.push(mesh);
    return mesh;
  }

  const pelvis = joint(model,'Pelvis',0,.89,0);
  const spine = joint(pelvis,'Spine',0,.25,0);
  const head = joint(spine,'Head',0,.51,0);
  oval(pelvis,'Hips',[.33,.31,.245],[0,.06,0],skin,true);
  oval(spine,'Torso',[.41,.44,.28],[0,-.035,0],skin,true);
  oval(spine,'Belly',[.26,.31,.11],[0,-.052,.215],soft,true);
  oval(head,'Face',[.43,.37,.336],[0,.135,.014],skin,true);
  const nose = oval(head,'Nose',[.052,.035,.042],[0,.12,.339],dark);
  nose.rotation.z = -.07;
  const smile = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.078,.065,.326),new THREE.Vector3(-.037,.045,.343),
    new THREE.Vector3(0,.053,.348),new THREE.Vector3(.038,.045,.343),
    new THREE.Vector3(.08,.067,.326),
  ]);
  const mouth = new THREE.Mesh(new THREE.TubeGeometry(smile,16,.009,8,false),dark);
  head.add(mouth);

  for (const [side,sign] of [['L',1],['R',-1]]) {
    const ear = joint(head,'Ear'+side,sign*.24,.365,-.035);
    ear.rotation.z = -sign*.31;
    oval(ear,'OuterEar'+side,[.126,.315,.105],[0,.225,0],skin,true);
    oval(ear,'InnerEar'+side,[.082,.228,.039],[0,.247,.084],soft,true);
    oval(head,'Eye'+side,[.056,.070,.031],[sign*.16,.197,.314],eyes);
    oval(head,'EyeGlint'+side,[.014,.017,.010],[sign*.16-.011,.220,.342],shine);
    oval(head,'Cheek'+side,[.082,.033,.022],[sign*.246,.103,.291],blush);

    const arm = joint(spine,'UpperArm'+side,sign*.342,.208,-.011);
    const lowerArm = joint(arm,'Forearm'+side,0,-.35,0);
    arm.rotation.z = sign*.31;
    lowerArm.rotation.x = -.10;
    oval(arm,'UpperArmClay'+side,[.126,.255,.127],[0,-.158,0],skin,true);
    oval(lowerArm,'ForearmClay'+side,[.105,.208,.113],[0,-.115,0],skin,true);
    oval(lowerArm,'Paw'+side,[.115,.125,.121],[0,-.282,.014],soft,true);

    const leg = joint(pelvis,'Thigh'+side,sign*.207,-.17,0);
    const shin = joint(leg,'Shin'+side,0,-.32,0);
    leg.rotation.z = sign*.055;
    oval(leg,'ThighClay'+side,[.148,.222,.147],[0,-.135,0],skin,true);
    oval(shin,'ShinClay'+side,[.125,.184,.129],[0,-.105,0],skin,true);
    oval(shin,'Foot'+side,[.151,.094,.227],[0,-.315,.075],skin,true);
  }

  const tail = joint(pelvis,'Tail',0,-.043,-.23);
  tail.rotation.x = -.55;
  oval(tail,'TailClay',[.17,.218,.179],[0,.11,-.065],skin,true);
  const rest = Object.fromEntries(Object.entries(joints).map(([name,bone])=>[name,bone.quaternion.clone()]));
  return {model,joints,rest,surfaces,skin};
}

export function resetPose(avatar) {
  for (const [name,rotation] of Object.entries(avatar.rest)) {
    avatar.joints[name].quaternion.copy(rotation);
  }
  avatar.model.updateMatrixWorld(true);
}

export function setColor(avatar,color) {
  avatar.skin.color.set(color);
}

export function setSurface(geometry,positions) {
  const position = geometry.getAttribute('position');
  position.array.set(positions);
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}

export function deform(hit,distance,sign) {
  const mesh = hit.object;
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute('position').array;
  const center = mesh.worldToLocal(hit.point.clone());
  const normal = hit.face.normal.clone().normalize();
  const radius = .145;
  const radiusSquared = radius*radius;
  const amount = Math.min(.034,Math.max(.012,distance*.003)) * sign;
  const changed = new Float32Array(positions);
  for(let i=0;i<positions.length;i+=3) {
    const dx = positions[i]-center.x;
    const dy = positions[i+1]-center.y;
    const dz = positions[i+2]-center.z;
    const d = dx*dx+dy*dy+dz*dz;
    if (d>=radiusSquared) continue;
    const influence = (1-d/radiusSquared)**2*amount;
    changed[i] += normal.x*influence;
    changed[i+1] += normal.y*influence;
    changed[i+2] += normal.z*influence;
  }
  setSurface(geometry,changed);
}

export function snapshotModel(avatar) {
  const model = avatar.model.clone(true);
  model.name = 'GardenCreature';
  model.position.set(0,0,0);
  model.rotation.set(0,0,0);
  model.scale.setScalar(1);
  for (const [name,rotation] of Object.entries(avatar.rest)) {
    model.getObjectByName(name).quaternion.copy(rotation);
  }
  return model;
}

export function rigPreview() {
  const times=[0,.48,.96,1.5];
  const euler = new THREE.Euler();
  const rotation = new THREE.Quaternion();
  function track(name,angles) {
    const values = angles.flatMap(values=>rotation.setFromEuler(euler.set(...values)).toArray());
    return new THREE.QuaternionKeyframeTrack(name+'.quaternion',times,values);
  }
  return new THREE.AnimationClip('Rig preview',1.5,[
    track('Head',[[0,0,0],[0,-.12,.19],[0,.08,-.16],[0,0,0]]),
    track('UpperArmL',[[0,0,.31],[0,0,1.12],[0,0,1.02],[0,0,.31]]),
    track('ForearmL',[[-.10,0,0],[-.22,0,.60],[-.20,0,.32],[-.10,0,0]]),
  ]);
}

