import * as THREE from 'three';

const tracked = [
  'Pelvis','Spine','Head','UpperArmL','ForearmL','UpperArmR','ForearmR',
  'ThighL','ShinL','ThighR','ShinR',
];
const down = new THREE.Vector3(0,-1,0);
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

export function applyPose(avatar,landmarks) {
  if (!landmarks || ![11,12,23,24].every(i=>landmarks[i]?.visibility>=.45)) return false;
  const p = landmarks.map(v=>new THREE.Vector3(v.x,-v.y,-v.z));
  const shoulder = midpoint(p[11],p[12]);
  const hip = midpoint(p[23],p[24]);
  const torsoUp = shoulder.clone().sub(hip);
  const hipRotation = basis(p[11].clone().sub(p[12]),new THREE.Vector3(0,1,0));
  const torsoRotation = basis(p[11].clone().sub(p[12]),torsoUp);
  const {joints} = avatar;
  if (hipRotation) applyWorldRotation(joints.Pelvis,hipRotation,.24);
  if (torsoRotation) applyWorldRotation(joints.Spine,torsoRotation,.32);

  if ([7,8].every(i=>landmarks[i].visibility>=.45)) {
    const headUp = midpoint(p[7],p[8]).sub(shoulder);
    const headRotation = basis(p[7].clone().sub(p[8]),headUp);
    if (headRotation) applyWorldRotation(joints.Head,headRotation,.35);
  }

  const segments = [
    ['UpperArmL',11,13],['ForearmL',13,15],['UpperArmR',12,14],['ForearmR',14,16],
    ['ThighL',23,25],['ShinL',25,27],['ThighR',24,26],['ShinR',26,28],
  ];
  for (const [name,a,b] of segments) {
    if (landmarks[a].visibility<.45 || landmarks[b].visibility<.45) continue;
    const direction = p[b].clone().sub(p[a]);
    if (direction.lengthSq()<.00005) continue;
    const bone = joints[name];
    direction.normalize().applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    const target = new THREE.Quaternion().setFromUnitVectors(down,direction);
    bone.quaternion.slerp(target,.36);
    bone.updateMatrixWorld(true);
  }
  return true;
}

function sample(avatar) {
  return Object.fromEntries(tracked.map(name=>[name,avatar.joints[name].quaternion.toArray()]));
}

export function clipFromFrames(frames) {
  const times = frames.map(frame=>frame.time);
  const tracks = tracked.map(name=>new THREE.QuaternionKeyframeTrack(
    name+'.quaternion',times,frames.flatMap(frame=>frame.pose[name]),
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
        const landmarks=this.detector.detectForVideo(video,now).worldLandmarks[0];
        detected=applyPose(this.avatar,landmarks);
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
      this.events.error('동작을 충분히 읽지 못했어요. 팔과 몸이 화면에 들어오게 다시 찍어 주세요.');
      return;
    }
    if (frames[0].time>0) frames.unshift({time:0,pose:frames[0].pose});
    if (frames.at(-1).time<duration) frames.push({time:duration,pose:frames.at(-1).pose});
    this.events.complete(clipFromFrames(frames));
  }
}

