import * as THREE from 'three';
import {snapshotModel} from './avatar.js';

const sides=['L','R'];
const midpoint=(a,b)=>a.clone().lerp(b,.5);

export const markerGroups=[
  {id:'chin',label:'턱',color:'#28b9dc',points:['chin']},
  {id:'wrists',label:'손목',color:'#49bd58',points:['wristL','wristR']},
  {id:'elbows',label:'팔꿈치',color:'#e8bf32',points:['elbowL','elbowR']},
  {id:'knees',label:'무릎',color:'#ef8a36',points:['kneeL','kneeR']},
  {id:'groin',label:'가랑이',color:'#da62a4',points:['groin']},
];

export function defaultMarkers(avatar) {
  avatar.model.updateMatrixWorld(true);
  const joint=name=>avatar.joints[name].getWorldPosition(new THREE.Vector3());
  const head=new THREE.Box3().setFromObject(avatar.parts.get('head')[0]);
  const markers={
    chin:head.getCenter(new THREE.Vector3()),
    groin:midpoint(joint('ThighL'),joint('ThighR')),
  };
  markers.chin.y=head.min.y+(head.max.y-head.min.y)*.13;

  for (const side of sides) {
    const arm=avatar.parts.get('arms').find(mesh=>mesh.name.endsWith(side));
    arm.geometry.computeBoundingBox();
    const bounds=arm.geometry.boundingBox;
    const end=new THREE.Vector3(0,bounds.min.y+(bounds.max.y-bounds.min.y)*.16,0);
    markers['wrist'+side]=arm.localToWorld(end);
    markers['elbow'+side]=midpoint(joint('UpperArm'+side),markers['wrist'+side]);
    const foot=avatar.parts.get('legs').find(mesh=>mesh.name==='Foot clay '+side);
    markers['knee'+side]=midpoint(joint('Thigh'+side),foot.getWorldPosition(new THREE.Vector3()));
  }
  return markers;
}

export function buildHumanoid(avatar,markers) {
  const source=snapshotModel(avatar);
  source.updateMatrixWorld(true);
  const model=new THREE.Group();
  const joints={};
  const points={};
  const segments={};
  const rest={};
  const geometries=[];
  const jointPoint=name=>source.getObjectByName(name).getWorldPosition(new THREE.Vector3());

  function bone(name,parent,point) {
    const node=new THREE.Bone();
    node.name=name;
    node.position.copy(point);
    if (parent) node.position.sub(points[parent]);
    (joints[parent]??model).add(node);
    joints[name]=node;
    points[name]=point;
    rest[name]=node.quaternion.clone();
  }

  const shoulder=midpoint(jointPoint('UpperArmL'),jointPoint('UpperArmR'));
  const hips=markers.groin.clone().addScaledVector(new THREE.Vector3(0,1,0),
    THREE.MathUtils.clamp((shoulder.y-markers.groin.y)*.28,.08,.24));
  if (shoulder.y<=hips.y+.12 || markers.chin.y<=shoulder.y+.05) {
    throw new Error('턱은 어깨 위에, 가랑이는 몸통 아래에 맞춰 주세요.');
  }
  bone('Pelvis',null,hips);
  bone('Spine','Pelvis',midpoint(hips,shoulder));
  bone('Chest','Spine',shoulder);
  bone('Neck','Chest',shoulder.clone().lerp(markers.chin,.66));
  bone('Head','Neck',markers.chin);
  const torso=['Pelvis','Spine','Chest','Neck','Head'];
  const headMesh=avatar.parts.get('head')[0];
  const headTop=new THREE.Box3().setFromObject(headMesh).max.y;
  const tipOfHead=markers.chin.clone();
  tipOfHead.y=Math.max(headTop,tipOfHead.y+.1);
  for (let i=0;i<torso.length;i++) segments[torso[i]]=points[torso[i+1]]??tipOfHead;

  for (const side of sides) {
    const upper=jointPoint('UpperArm'+side);
    const elbow=markers['elbow'+side];
    const wrist=markers['wrist'+side];
    const hip=jointPoint('Thigh'+side).add(markers.groin.clone().sub(midpoint(jointPoint('ThighL'),jointPoint('ThighR'))));
    const knee=markers['knee'+side];
    const foot=jointPoint('Foot clay '+side);
    const ankle=foot.clone().add(new THREE.Vector3(0,.025,-.055));
    const sign=side==='L'?1:-1;
    if ((elbow.x-shoulder.x)*sign<.05 || (wrist.x-shoulder.x)*sign<.05 ||
        (knee.x-markers.groin.x)*sign<.025 || knee.y>=hip.y-.055 ||
        knee.y<=ankle.y+.055 || upper.distanceTo(elbow)<.075 ||
        elbow.distanceTo(wrist)<.075 || wrist.distanceTo(upper)<.15) {
      throw new Error('양쪽 손목·팔꿈치·무릎을 해당 팔다리 위에서 서로 떨어뜨려 놓아 주세요.');
    }
    bone('Clavicle'+side,'Chest',shoulder.clone().lerp(upper,.25));
    bone('UpperArm'+side,'Clavicle'+side,upper);
    bone('Forearm'+side,'UpperArm'+side,elbow);
    bone('Hand'+side,'Forearm'+side,wrist);
    bone('Thigh'+side,'Pelvis',hip);
    bone('Shin'+side,'Thigh'+side,knee);
    bone('Foot'+side,'Shin'+side,ankle);
    Object.assign(segments,{
      ['Clavicle'+side]:upper,['UpperArm'+side]:elbow,['Forearm'+side]:wrist,
      ['Hand'+side]:wrist.clone().add(wrist.clone().sub(elbow).normalize().multiplyScalar(.14)),
      ['Thigh'+side]:knee,['Shin'+side]:ankle,
      ['Foot'+side]:ankle.clone().add(new THREE.Vector3(0,-.025,.20)),
    });
  }

  model.name='GardenCreature';
  model.updateMatrixWorld(true);
  const skeleton=new THREE.Skeleton(Object.values(joints));
  const jointIndex=Object.fromEntries(Object.keys(joints).map((name,index)=>[name,index]));

  function skin(name,candidates) {
    const original=source.getObjectByName(name);
    const geometry=original.geometry.clone().applyMatrix4(original.matrixWorld);
    geometries.push(geometry);
    const positions=geometry.getAttribute('position');
    const indices=new Uint16Array(positions.count*4);
    const weights=new Float32Array(positions.count*4);
    const vertex=new THREE.Vector3();
    const closest=new THREE.Vector3();
    const lines=candidates.map(name=>({
      index:jointIndex[name],line:new THREE.Line3(points[name],segments[name]),
    }));
    for (let i=0;i<positions.count;i++) {
      vertex.fromBufferAttribute(positions,i);
      const influences=lines.map(({index,line})=>{
        line.closestPointToPoint(vertex,true,closest);
        const distance=vertex.distanceToSquared(closest);
        return {index,weight:1/(.009+distance)**2.5};
      }).sort((a,b)=>b.weight-a.weight).slice(0,4);
      const total=influences.reduce((sum,item)=>sum+item.weight,0);
      influences.forEach(({index,weight},offset)=>{
        indices[i*4+offset]=index;
        weights[i*4+offset]=weight/total;
      });
    }
    geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
    geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    const mesh=new THREE.SkinnedMesh(geometry,original.material);
    mesh.name=name;
    mesh.frustumCulled=false;
    mesh.castShadow=true;
    model.add(mesh);
    mesh.bind(skeleton);
  }

  skin('Clay sphere',torso.slice(0,4));
  skin('Head clay',['Neck','Head']);
  for (const side of sides) {
    skin('arms clay '+side,['Clavicle','UpperArm','Forearm','Hand'].map(name=>name+side));
    const leg=['Thigh','Shin','Foot'].map(name=>name+side);
    skin('legs clay '+side,leg);
    skin('Foot clay '+side,[leg[2]]);
  }

  for (const name of ['EarL','EarR','ExtensionPivot']) {
    const part=source.getObjectByName(name);
    joints[part.parent.name].attach(part);
  }
  const directions=Object.fromEntries(Object.entries(segments).map(([name,tip])=>[
    name,tip.clone().sub(points[name]).normalize(),
  ]));
  const restHip=joints.Pelvis.position.clone();
  return {model,joints,rest,directions,restHip,height:headTop-Math.min(points.FootL.y,points.FootR.y),
    dispose() {
      geometries.forEach(geometry=>geometry.dispose());
      skeleton.dispose();
      model.getObjectByName('Moving clay')?.skeleton.dispose();
    },
  };
}
