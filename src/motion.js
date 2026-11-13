import * as THREE from 'three';

const tracked = [
  'Pelvis','Spine','Chest','Head','UpperArmL','ForearmL','HandL','UpperArmR','ForearmR','HandR',
  'ThighL','ShinL','FootL','ThighR','ShinR','FootR',
];
const wasm = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const model = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const duration = 3;

function midpoint(a,b) {
  return a.clone().add(b).multiplyScalar(.5);
}

function basis(right,up) {
  const x = right.normalize();
  const z = x.clone().cross(up).normalize();
  if (z.lengthSq()<.01) return null;
  const y = z.clone().cross(x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
}

function applyWorldRotation(bone,target,smoothing) {
  const parentRotation = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.slerp(parentRotation.multiply(target),smoothing);
  bone.updateMatrixWorld(true);
}

export function applyPose(avatar,landmarks,imageLandmarks) {
  if (!landmarks || ![11,12,23,24].every(i=>landmarks[i]?.visibility>=.45)) return false;
  const visible=(...indices)=>indices.every(i=>landmarks[i]?.visibility>=.45);
  const p=landmarks.map(v=>new THREE.Vector3(v.x,-v.y,-v.z));
  const shoulder=midpoint(p[11],p[12]);
  const hip=midpoint(p[23],p[24]);
  const torsoUp=shoulder.clone().sub(hip);
  const hipRotation=basis(p[23].clone().sub(p[24]),new THREE.Vector3(0,1,0));
  const torsoRotation=basis(p[11].clone().sub(p[12]),torsoUp);
  const {joints,directions,restHip}=avatar;
  if (hipRotation) applyWorldRotation(joints.Pelvis,hipRotation,.24);
  if (torsoRotation) {
    applyWorldRotation(joints.Spine,hipRotation?.clone().slerp(torsoRotation,.5)??torsoRotation,.32);
    applyWorldRotation(joints.Chest,torsoRotation,.32);
  }

  if (visible(7,8)) {
    const headUp=midpoint(p[7],p[8]).sub(shoulder);
    const headRotation=basis(p[7].clone().sub(p[8]),headUp);
    if (headRotation) applyWorldRotation(joints.Head,headRotation,.35);
  }

  const segments=[
    ['UpperArmL',11,13],['ForearmL',13,15],['HandL',15,19],
    ['UpperArmR',12,14],['ForearmR',14,16],['HandR',16,20],
    ['ThighL',23,25],['ShinL',25,27],['FootL',27,31],
    ['ThighR',24,26],['ShinR',26,28],['FootR',28,32],
  ];
  for (const [name,a,b] of segments) {
    if (!visible(a,b)) continue;
    const direction=p[b].clone().sub(p[a]);
    if (direction.lengthSq()<.00005) continue;
    const bone=joints[name];
    direction.normalize().applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    const target=new THREE.Quaternion().setFromUnitVectors(directions[name],direction);
    bone.quaternion.slerp(target,.36);
    bone.updateMatrixWorld(true);
  }

  if (imageLandmarks?.[24]) {
    const center=new THREE.Vector2(
      (imageLandmarks[23].x+imageLandmarks[24].x)/2,
      (imageLandmarks[23].y+imageLandmarks[24].y)/2,
    );
    const shoulderY=(imageLandmarks[11].y+imageLandmarks[12].y)/2;
    avatar.captureOrigin??={center,scale:Math.max(center.y-shoulderY,.08)};
    const {center:origin,scale}=avatar.captureOrigin;
    const units=avatar.height*.28/scale;
    const target=restHip.clone();
    target.x+=THREE.MathUtils.clamp((center.x-origin.x)*units,-.8,.8);
    target.y+=THREE.MathUtils.clamp((origin.y-center.y)*units,-.35,.55);
    joints.Pelvis.position.lerp(target,.28);
    joints.Pelvis.updateMatrixWorld(true);
  }
  return true;
}

function sample(avatar) {
  const pose=Object.fromEntries(tracked.map(name=>[name,avatar.joints[name].quaternion.toArray()]));
  pose.position=avatar.joints.Pelvis.position.toArray();
  return pose;
}

export function clipFromFrames(frames) {
  const times=frames.map(frame=>frame.time);
  const tracks=tracked.map(name=>new THREE.QuaternionKeyframeTrack(
    name+'.quaternion',times,frames.flatMap(frame=>frame.pose[name]),
  ));
  tracks.push(new THREE.VectorKeyframeTrack(
    'Pelvis.position',times,frames.flatMap(frame=>frame.pose.position),
  ));
  return new THREE.AnimationClip('My movement',times.at(-1),tracks);
}

async function loadLandmarker() {
  const {FilesetResolver,PoseLandmarker} = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(wasm);
  return PoseLandmarker.createFromOptions(vision,{
    baseOptions:{modelAssetPath:model,delegate:'CPU'},
    runningMode:'VIDEO',
    numPoses:1,
    minPoseDetectionConfidence:.55,
    minPosePresenceConfidence:.55,
    minTrackingConfidence:.5,
  });
}

export class MotionCapture {
  constructor(video,avatar,events) {
    this.video=video;
    this.avatar=avatar;
    this.events=events;
    this.generation=0;
    this.lastFrame=-1;
    this.lastUpdate=-Infinity;
    this.seesPose=false;
  }

  async open() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저에서 카메라를 열 수 없어요. HTTPS 주소를 확인해 주세요.');
    this.stop();
    const generation=this.generation;
    this.detectorPromise ??= loadLandmarker().catch(error=>{
      this.detectorPromise=null;
      throw error;
    });
    const streamPromise=navigator.mediaDevices.getUserMedia({
      audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:24}},
    }).then(stream=>{
      if (generation!==this.generation) {
        stream.getTracks().forEach(track=>track.stop());
        return null;
      }
      this.video.srcObject=stream;
      return this.video.play().then(()=>stream);
    });
    try {
      const [stream,detector]=await Promise.all([streamPromise,this.detectorPromise]);
      if (!stream || generation!==this.generation) return false;
      this.detector=detector;
      this.active=true;
      return true;
    } catch(error) {
      if (generation!==this.generation) return false;
      this.stop();
      throw error;
    }
  }

  stop() {
    this.generation++;
    this.active=false;
    this.recording=null;
    this.seesPose=false;
    this.avatar.captureOrigin=null;
    this.lastFrame=-1;
    this.lastUpdate=-Infinity;
    this.video.srcObject?.getTracks().forEach(track=>track.stop());
    this.video.srcObject=null;
  }

  record(now) {
    if (!this.active || !this.seesPose || this.recording) return false;
    this.recording={startsAt:now+2100,frames:[],reported:null};
    this.events.status('2초 뒤 녹화를 시작해요.');
    return true;
  }

  update(now) {
    if (!this.active) return;
    const {video}=this;
    let detected=false;
    if (video.readyState>=2 && video.currentTime!==this.lastFrame && now-this.lastUpdate>=57) {
      this.lastFrame=video.currentTime;
      this.lastUpdate=now;
      try {
        const result=this.detector.detectForVideo(video,now);
        detected=applyPose(this.avatar,result.worldLandmarks[0],result.landmarks[0]);
      } catch(error) {
        this.stop();
        this.events.error('동작을 읽는 중 오류가 났어요. 앞 카메라를 다시 켜 주세요.');
        console.error(error);
        return;
      }
      if (detected!==this.seesPose) {
        this.seesPose=detected;
        this.events.tracking(detected);
      }
    }
    const recording=this.recording;
    if (!recording) return;
    const seconds=(now-recording.startsAt)/1000;
    if (seconds<0) {
      const remaining=Math.ceil(-seconds);
      if (remaining!==recording.reported) {
        recording.reported=remaining;
        this.events.status(`${remaining}초 뒤 녹화해요.`);
      }
      return;
    }
    if (seconds<duration) {
      const remaining=Math.ceil(duration-seconds);
      if (remaining!==recording.reported || !recording.started) {
        recording.started=true;
        recording.reported=remaining;
        this.events.status(`녹화 중 · ${remaining}초`);
      }
      if (detected) recording.frames.push({time:seconds,pose:sample(this.avatar)});
      return;
    }
    this.recording=null;
    const frames=recording.frames;
    if (frames.length<5 || frames.at(-1).time-frames[0].time<1.35) {
      this.events.error('동작을 충분히 읽지 못했어요. 머리부터 발끝까지 화면에 들어오게 다시 찍어 주세요.');
      return;
    }
    if (frames[0].time>0) frames.unshift({time:0,pose:frames[0].pose});
    if (frames.at(-1).time<duration) frames.push({time:duration,pose:frames.at(-1).pose});
    this.events.complete(clipFromFrames(frames));
  }
}

