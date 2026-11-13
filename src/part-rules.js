import * as THREE from 'three';
import {partReaction} from './avatar.js';

export const partActions={
  extension:[['bend','구부리기'],['sway','좌우로 흔들기'],['recorded','내가 녹화한 움직임']],
  ears:[['open','귀 펼치기'],['flap','귀 파닥이기']],
  head:[['tilt','고개 갸웃하기'],['nod','끄덕이기']],
  hands:[['wave','손 흔들기'],['lift','손목 들어 올리기']],
};

export class PartRule {
  constructor(model,{part,action,size,count,clip}) {
    this.size=size;
    this.count=count;
    this.elapsed=0;
    this.active=false;
    this.restore=()=>{};
    if (clip) {
      this.mixer=new THREE.AnimationMixer(model);
      this.action=this.mixer.clipAction(clip).setLoop(THREE.LoopRepeat,count);
      this.mixer.addEventListener('finished',()=>{this.active=false;});
      return;
    }

    if (part==='extension' || part==='ears') {
      const move=partReaction(model,part);
      this.apply=move;
      this.restore=()=>move(0);
      this.alternate=action==='sway';
      this.flap=action==='flap';
      return;
    }

    const names=part==='head'?['Head']:['HandL','HandR'];
    const joints=names.map(name=>model.getObjectByName(name));
    const base=joints.map(()=>new THREE.Quaternion());
    const offset=new THREE.Quaternion();
    const axis=new THREE.Vector3(action==='nod'||action==='lift'?1:0,0,action==='nod'||action==='lift'?0:1);
    this.apply=amount=>{
      joints.forEach((joint,index)=>{
        base[index].copy(joint.quaternion);
        const sign=index===1?-1:1;
        joint.quaternion.multiply(offset.setFromAxisAngle(axis,amount*sign*.8));
      });
    };
    this.restore=()=>joints.forEach((joint,index)=>joint.quaternion.copy(base[index]));
    this.alternate=action==='wave';
  }

  trigger() {
    this.clearPose();
    this.elapsed=0;
    this.active=true;
    this.action?.reset().play();
  }

  clearPose() {
    if (!this.applied) return;
    this.restore();
    this.applied=false;
  }

  update(elapsed) {
    if (!this.active) return;
    if (this.mixer) {
      this.mixer.update(elapsed);
      return;
    }
    this.elapsed+=elapsed;
    const cycle=this.elapsed/.85;
    if (cycle>=this.count) {
      this.active=false;
      return;
    }
    const phase=(cycle%1)*Math.PI;
    const amount=this.alternate?Math.sin(phase*2)*Math.sin(phase):Math.sin(phase);
    this.apply(this.size*(this.flap?Math.sin(phase*3)**2:amount));
    this.applied=true;
  }

  stop() {
    this.clearPose();
    this.mixer?.stopAllAction();
    this.active=false;
  }
}
