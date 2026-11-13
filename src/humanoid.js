import * as THREE from 'three';
import {clayAttachments,snapshotModel} from './avatar.js';
import {bindClayBody,clayBodyName} from './clay-body.js';

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
  const markers={
    chin:joint('Head'),
    groin:midpoint(joint('ThighL'),joint('ThighR')),
  };
  markers.groin.y-=.06;

  for (const side of sides) {
    const elbow=joint('Forearm'+side);
    markers['elbow'+side]=elbow;
    markers['wrist'+side]=avatar.wrists[side].clone();
    markers['knee'+side]=joint('Shin'+side);
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
  const original=source.getObjectByName(clayBodyName);
  const {min,max}=new THREE.Box3().setFromObject(original);
  const headTop=max.y;
  const tipOfHead=markers.chin.clone();
  tipOfHead.y=Math.max(headTop,tipOfHead.y+.1);
  for (let i=0;i<torso.length;i++) segments[torso[i]]=points[torso[i+1]]??tipOfHead;

  for (const side of sides) {
    const upper=jointPoint('UpperArm'+side);
    const elbow=markers['elbow'+side];
    const wrist=markers['wrist'+side];
    const hip=jointPoint('Thigh'+side).add(markers.groin.clone().sub(midpoint(jointPoint('ThighL'),jointPoint('ThighR'))));
    const knee=markers['knee'+side];
    const ankle=avatar.ankles[side];
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
      ['Foot'+side]:ankle.clone().add(new THREE.Vector3(sign*.035,-.12,.09)),
    });
  }

  model.name='GardenCreature';
  const geometry=original.geometry.clone().applyMatrix4(original.matrixWorld);
  const body=bindClayBody(geometry,original.material,model,joints,segments);

  const attachments={...clayAttachments,ExtensionPivot:source.getObjectByName('ExtensionPivot').parent.name};
  for (const [name,parent] of Object.entries(attachments)) {
    const part=source.getObjectByName(name);
    joints[parent].attach(part);
  }
  const directions=Object.fromEntries(Object.entries(segments).map(([name,tip])=>[
    name,tip.clone().sub(points[name]).normalize(),
  ]));
  const restHip=joints.Pelvis.position.clone();
  return {model,joints,rest,directions,restHip,height:headTop-min.y,
    dispose() {
      geometry.dispose();
      body.skeleton.dispose();
      for (const name of ['Moving clay','NosePivot clay','TailPivot clay']) {
        model.getObjectByName(name)?.skeleton.dispose();
      }
    },
  };
}
