import * as THREE from 'three';

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
const ink = new THREE.MeshStandardMaterial({color:'#232a26',roughness:.47});
const neighbors = new WeakMap();

export function createAvatar() {
  const model = new THREE.Group();
  model.name = 'GardenCreature';
  const joints = {};
  const surfaces = [];

  function joint(parent,name,x=0,y=0,z=0) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x,y,z);
    parent.add(bone);
    joints[name] = bone;
    return bone;
  }

  function form(parent,name,dimensions,position,options={}) {
    const {color=palette[0][1],power=1,material=ceramic,editable=true}=options;
    const geometry=new THREE.SphereGeometry(1,48,32);
    const positions=geometry.getAttribute('position');
    if (power!==1) {
      for (let i=0;i<positions.array.length;i++) {
        const value=positions.array[i];
        positions.array[i]=Math.sign(value)*Math.abs(value)**power;
      }
    }
    geometry.scale(...dimensions);
    if (power!==1) geometry.computeVertexNormals();
    if (material.vertexColors) {
      const paint=new THREE.Color(color);
      const colors=new Float32Array(positions.count*3);
      for (let i=0;i<positions.count;i++) paint.toArray(colors,i*3);
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    }
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=name;
    mesh.position.set(...position);
    mesh.castShadow=true;
    parent.add(mesh);
    if (editable) surfaces.push(mesh);
    return mesh;
  }

  const pelvis=joint(model,'Pelvis',0,.89,0);
  const spine=joint(pelvis,'Spine',0,.27,0);
  const head=joint(spine,'Head',0,.55,0);
  form(pelvis,'Lower body',[.31,.29,.26],[0,.05,0],{power:.91});
  form(spine,'Vessel body',[.44,.52,.29],[0,-.025,0],{power:.90});
  form(spine,'Chest accent',[.13,.17,.038],[.095,-.095,.294],{
    color:'#c48b37',material:brass,
  }).rotation.z=-.33;
  form(spine,'Neck ring',[.215,.065,.204],[0,.438,0],{
    color:'#34574c',power:.78,
  });

  form(head,'Ceramic head',[.455,.405,.346],[.018,.155,0],{
    power:.77,
  }).rotation.z=-.08;
  form(head,'Face profile',[.182,.071,.110],[.105,.054,.333],{
    color:'#34574c',power:.66,
  }).rotation.z=.18;
  form(head,'Left eye',[.022,.032,.020],[.149,.228,.344],{material:ink,editable:false});
  form(head,'Right eye',[.020,.027,.019],[-.098,.245,.348],{material:ink,editable:false});

  const high=joint(head,'EarL',.302,.388,-.045);
  high.rotation.z=-.58;
  form(high,'High fin',[.178,.252,.100],[.026,.137,0],{power:.87});
  form(high,'High fin inset',[.106,.179,.039],[.026,.155,.083],{
    color:'#c48b37',material:brass,
  });
  const low=joint(head,'EarR',-.383,.127,-.024);
  low.rotation.z=.43;
  form(low,'Side fin',[.154,.193,.086],[-.061,.057,0],{power:.84});
  form(low,'Side fin inset',[.088,.100,.032],[-.076,.053,.071],{
    color:'#34574c',
  });

  for (const [side,sign] of [['L',1],['R',-1]]) {
    const arm=joint(spine,'UpperArm'+side,sign*.356,.202,-.035);
    const lowerArm=joint(arm,'Forearm'+side,0,-.35,0);
    arm.rotation.z=sign*.31;
    lowerArm.rotation.x=-.10;
    form(arm,'Upper arm '+side,[.124,.253,.119],[0,-.149,0],{power:.88});
    form(lowerArm,'Forearm '+side,[.092,.223,.107],[0,-.130,0],{power:.85});
    form(lowerArm,'Hand '+side,[.109,.137,.115],[0,-.278,.009],{
      color:side==='L'?'#c48b37':'#34574c',
      material:side==='L'?brass:ceramic,
      power:.72,
    });

    const leg=joint(pelvis,'Thigh'+side,sign*.203,-.17,0);
    const shin=joint(leg,'Shin'+side,0,-.32,0);
    leg.rotation.z=sign*.055;
    form(leg,'Thigh '+side,[.144,.224,.142],[0,-.132,0],{power:.87});
    form(shin,'Shin '+side,[.111,.211,.123],[0,-.112,0],{power:.79});
    form(shin,'Foot '+side,[.133,.096,.202],[0,-.314,.075],{
      color:'#34574c',power:.70,
    });
  }

  const tail=joint(pelvis,'Tail',0,.014,-.246);
  tail.rotation.x=-.44;
  form(tail,'Back fin',[.103,.197,.103],[0,.09,-.06],{color:'#34574c'});
  const rest=Object.fromEntries(Object.entries(joints).map(([name,bone])=>[name,bone.quaternion.clone()]));
  return {model,joints,rest,surfaces};
}

export function resetPose(avatar) {
  for (const [name,rotation] of Object.entries(avatar.rest)) {
    avatar.joints[name].quaternion.copy(rotation);
  }
  avatar.model.updateMatrixWorld(true);
}

function refreshAttribute(geometry,key) {
  geometry.getAttribute(key).needsUpdate=true;
  if (key==='position') {
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  }
}

export function restoreBrushAttribute(geometry,key,values) {
  geometry.getAttribute(key).array.set(values);
  refreshAttribute(geometry,key);
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

export function applyBrush(hit,tool,radius,distance,color) {
  const geometry=hit.object.geometry;
  const key=tool==='paint'?'color':'position';
  const attribute=geometry.getAttribute(key);
  const positions=geometry.getAttribute('position').array;
  const center=hit.object.worldToLocal(hit.point.clone());
  const normal=hit.face.normal.clone().normalize();
  const radiusSquared=radius*radius;
  const strength=Math.min(.027,Math.max(.008,distance*.0022))*(tool==='push'?-1:1);
  const adjacency=tool==='smooth'?surfaceNeighbors(geometry):null;
  const output=attribute.array.slice();
  for (let i=0;i<positions.length;i+=3) {
    const dx=positions[i]-center.x;
    const dy=positions[i+1]-center.y;
    const dz=positions[i+2]-center.z;
    const d=dx*dx+dy*dy+dz*dz;
    if (d>=radiusSquared) continue;
    const influence=(1-d/radiusSquared)**2;
    if (tool==='paint') {
      const coverage=Math.min(1,influence*2.15);
      output[i]+=(color.r-output[i])*coverage;
      output[i+1]+=(color.g-output[i+1])*coverage;
      output[i+2]+=(color.b-output[i+2])*coverage;
    } else if (adjacency) {
      const adjacent=adjacency[i/3];
      if (!adjacent.length) continue;
      for (let k=0;k<3;k++) {
        const mean=adjacent.reduce((sum,vertex)=>sum+positions[vertex*3+k],0)/adjacent.length;
        output[i+k]+=(mean-positions[i+k])*influence*.58;
      }
    } else {
      output[i]+=normal.x*strength*influence;
      output[i+1]+=normal.y*strength*influence;
      output[i+2]+=normal.z*strength*influence;
    }
  }
  restoreBrushAttribute(geometry,key,output);
}

export function snapshotModel(avatar) {
  const model=avatar.model.clone(true);
  model.name='GardenCreature';
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
  const euler=new THREE.Euler();
  const rotation=new THREE.Quaternion();
  function track(name,angles) {
    const values=angles.flatMap(values=>rotation.setFromEuler(euler.set(...values)).toArray());
    return new THREE.QuaternionKeyframeTrack(name+'.quaternion',times,values);
  }
  return new THREE.AnimationClip('Rig preview',1.5,[
    track('Head',[[0,0,0],[0,-.12,.19],[0,.08,-.16],[0,0,0]]),
    track('UpperArmL',[[0,0,.31],[0,0,1.12],[0,0,1.02],[0,0,.31]]),
    track('ForearmL',[[-.10,0,0],[-.22,0,.60],[-.20,0,.32],[-.10,0,0]]),
  ]);
}

