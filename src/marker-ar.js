import * as THREE from 'three';
import jsQR from 'jsqr';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PartRule,partActions} from './part-rules.js';

const markerPattern=/^moka-garden-(?:0[1-9]|[1-9]\d)$/;
const scannedCorners=['topLeftCorner','topRightCorner','bottomRightCorner','bottomLeftCorner'];
const square=[[-.5,.5],[.5,.5],[.5,-.5],[-.5,-.5]];
const verticalFov=54;
const storageName='moka-garden-works';
const publicSite=new URL('https://boracles.github.io/moka-garden-ar/');
export const markerCount=10;

export function markerId(value) {
  if (!/^\d{1,2}$/.test(String(value).trim())) return null;
  const n=Number(value);
  return n>=1 && n<=markerCount ? 'moka-garden-'+String(n).padStart(2,'0') : null;
}

export function classDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date=new Date(value+'T00:00:00Z');
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0,10)!==value ? null : value;
}

export function workLabel(date,id) {
  return date+' · '+id.slice(-2)+'번';
}

export async function showMarker(canvas,date,id) {
  const {default:qr}=await import('qrcode');
  const url=new URL(publicSite);
  url.searchParams.set('date',date);
  url.searchParams.set('view',id.slice(-2));
  await qr.toCanvas(canvas,url.href,{width:420,margin:4,errorCorrectionLevel:'M'});
}

function readMarker(text) {
  if (markerPattern.test(text)) return {id:text,date:null};
  try {
    const url=new URL(text);
    const id=markerId(url.searchParams.get('view'));
    const date=classDate(url.searchParams.get('date'));
    if (id && date && url.origin===publicSite.origin && url.pathname===publicSite.pathname) return {id,date};
  } catch {
    // Other QR codes do not identify garden works.
  }
  return null;
}

function readSavedWork(date,id) {
  return withWorks('readonly',store=>store.get(date+'/'+id));
}

function withWorks(mode,request) {
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open(storageName,1);
    open.onupgradeneeded=()=>open.result.createObjectStore('markers');
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result;
      const tx=db.transaction('markers',mode);
      const result=request(tx.objectStore('markers'));
      tx.oncomplete=()=>{db.close();resolve(result.result);};
      tx.onabort=()=>{db.close();reject(tx.error);};
    };
  });
}

export function saveMarkerWork(date,id,file) {
  return withWorks('readwrite',store=>store.put(file,date+'/'+id));
}

export async function registeredMarkerWork(date,id) {
  const file=await readSavedWork(date,id);
  if (!file) throw new Error('이 기기에서 등록한 작품을 찾지 못했어요. 다시 등록해 주세요.');
  const work=await loadWork(await file.arrayBuffer());
  if (work.id!==id || work.date!==date) throw new Error('등록한 작품의 날짜와 QR 번호를 확인해 주세요.');
  return {file,work};
}

async function fetchWork(date,id) {
  const response=await fetch(new URL('works/'+date+'/'+id+'.glb',document.baseURI),{cache:'no-cache'});
  return response.ok ? response.blob() : null;
}

export async function exhibitionWork(date,id) {
  const read=async file=>{
    if (!file) return null;
    const work=await loadWork(await file.arrayBuffer()).catch(()=>null);
    return work?.date===date && work.id===id ? work : null;
  };
  const published=await read(await fetchWork(date,id).catch(()=>null));
  if (published && !published.model.userData.gardenDemo) return published;
  const saved=await read(await readSavedWork(date,id).catch(()=>null));
  return saved??published;
}

export function markerPose(location,width,height) {
  const focal=height/(2*Math.tan(THREE.MathUtils.degToRad(verticalFov/2)));
  const rows=[];
  for (const [index,name] of scannedCorners.entries()) {
    const [x,y]=square[index];
    const point=location[name];
    const u=(point.x-width/2)/focal;
    const v=(height/2-point.y)/focal;
    rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);
  }
  for (let column=0;column<8;column++) {
    let pivot=column;
    for (let i=column+1;i<8;i++) {
      if (Math.abs(rows[i][column])>Math.abs(rows[pivot][column])) pivot=i;
    }
    if (Math.abs(rows[pivot][column])<1e-7) return null;
    [rows[column],rows[pivot]]=[rows[pivot],rows[column]];
    const row=rows[column];
    const divisor=row[column];
    for (let i=column;i<=8;i++) row[i]/=divisor;
    for (let j=0;j<8;j++) {
      if (j===column) continue;
      const weight=rows[j][column];
      for (let i=column;i<=8;i++) rows[j][i]-=weight*row[i];
    }
  }
  const h=rows.map(row=>row[8]);
  const right=new THREE.Vector3(h[0],h[3],-h[6]);
  const markerUp=new THREE.Vector3(h[1],h[4],-h[7]);
  const scale=2/(right.length()+markerUp.length());
  if (!Number.isFinite(scale)||scale<.2||scale>50) return null;
  right.normalize();
  const up=right.clone().cross(markerUp).normalize();
  const forward=right.clone().cross(up).normalize();
  const position=new THREE.Vector3(h[2],h[5],-1).multiplyScalar(scale);
  const rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,forward));
  return {position,rotation};
}

function loadWork(buffer) {
  return new GLTFLoader().parseAsync(buffer,'').then(gltf=>{
    const model=gltf.scene.children.find(node=>markerPattern.test(node.userData.gardenMarker??''));
    if (!model) throw new Error('이 파일에는 모카가든 표식 번호가 없어요.');
    const settings=model.userData.gardenWork??{};
    const {rule}=settings;
    const allowed=rule && partActions[rule.part]?.some(([action])=>action===rule.action);
    if (!allowed || !['tap','place'].includes(rule.trigger) ||
      (rule.action==='recorded' && !gltf.animations.some(clip=>clip.name===rule.animation))) delete settings.rule;
    return {id:model.userData.gardenMarker,date:classDate(model.userData.gardenDate),model,animations:gltf.animations,settings};
  });
}

export class MarkerAR {
  constructor(video,canvas,status,onVisibility) {
    this.video=video;
    this.canvas=canvas;
    this.report=status;
    this.onVisibility=onVisibility;
    this.generation=0;
    this.frame=this.frame.bind(this);
    canvas.addEventListener('pointerup',event=>this.touch(event));
  }

  status(message) {
    if (message===this.message) return;
    this.message=message;
    this.report(message);
  }

  async open({work,id,date,publicView=false,onTestRendered}) {
    this.stop();
    this.date=date;
    this.publicView=publicView;
    this.onTestRendered=onTestRendered;
    this.lockedId=id;
    this.id=id;
    const generation=this.generation;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('카메라를 사용할 수 있는 HTTPS 주소에서 열어 주세요.');
    let stream;
    try {
      stream=await navigator.mediaDevices.getUserMedia({
        audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},
      });
      if (generation!==this.generation) {
        stream.getTracks().forEach(track=>track.stop());
        return;
      }
      this.video.srcObject=stream;
      await this.video.play();
      if (generation!==this.generation) return;

      this.renderer??=new THREE.WebGLRenderer({canvas:this.canvas,alpha:true,antialias:true});
      this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
      this.scene=new THREE.Scene();
      this.scene.add(new THREE.HemisphereLight(0xffffff,0xb0c5ad,2.4));
      const light=new THREE.DirectionalLight(0xffedd8,2.1);
      light.position.set(-4,6,4);
      this.scene.add(light);
      this.camera=new THREE.PerspectiveCamera(verticalFov,1,.02,75);
      this.anchor=new THREE.Group();
      this.anchor.visible=false;
      this.scene.add(this.anchor);
      this.scan=document.createElement('canvas');
      this.context=this.scan.getContext('2d',{willReadFrequently:true});
      this.lastScan=-Infinity;
      this.lastSeen=-Infinity;
      this.lastFrame=null;
      this.lastVideoTime=-1;
      this.detectedId=null;
      this.attemptedId=null;
      this.message=null;
      if (work) this.useWork(work);
      this.status(onTestRendered?'등록한 QR의 네 모서리가 화면에 들어오도록 비춰요.'
        : publicView?'같은 QR이 화면에 들어오도록 비춰요.':date+' 작품을 볼 거예요. 가든 QR 표식 전체를 비춰요.');
      this.raf=requestAnimationFrame(this.frame);
    } catch(error) {
      if (generation!==this.generation) return;
      this.stop();
      if (error.name==='NotAllowedError') throw new Error('브라우저에서 카메라 권한을 허용해 주세요.');
      if (!stream) throw new Error('뒤 카메라를 열 수 없어요. 카메라 상태를 확인해 주세요.');
      throw error;
    }
  }

  useWork({model,animations,settings}) {
    this.setVisible(false);
    this.anchor.clear();
    this.body?.stopAllAction();
    this.rule?.stop();
    model.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(model);
    const size=1.65/Math.max(bounds.max.y-bounds.min.y,.01);
    const center=bounds.getCenter(new THREE.Vector3());
    model.scale.multiplyScalar(size);
    model.position.set(-center.x*size,-bounds.min.y*size,-center.z*size);
    this.anchor.add(model);
    this.settings=settings;
    const movement=animations.find(clip=>clip.name===settings.motion);
    this.body=movement?new THREE.AnimationMixer(model):null;
    this.bodyAction=movement?this.body.clipAction(movement).setEffectiveTimeScale(settings.speed??1):null;
    const rule=settings.rule;
    this.rule=rule?new PartRule(model,{...rule,clip:animations.find(clip=>clip.name===rule.animation)}):null;
  }

  async loadFile(file,remember=true,expectedId=this.detectedId) {
    const generation=this.generation;
    const work=await loadWork(await file.arrayBuffer());
    if (generation!==this.generation || !this.anchor || expectedId!==this.detectedId) return;
    if (this.detectedId && work.id!==this.detectedId) {
      throw new Error('이 작품은 '+work.id.slice(-2)+'번 표식에 연결돼 있어요.');
    }
    if (work.date && work.date!==this.date) {
      throw new Error('이 작품은 '+workLabel(work.date,work.id)+' 작품이에요. 관람 날짜를 바꿔 주세요.');
    }
    this.id=work.id;
    this.useWork(work);
    this.onFileNeeded?.(null);
    this.status(workLabel(this.date,work.id)+' 작품을 열었어요.');
    if (remember) await saveMarkerWork(this.date,work.id,file).catch(()=>{});
  }

  setVisible(visible) {
    if (!this.anchor || this.anchor.visible===visible) return;
    this.anchor.visible=visible;
    if (visible) {
      this.bodyAction?.reset().play();
      if (this.settings.rule?.trigger==='place') this.rule?.trigger();
    } else {
      this.rule?.stop();
    }
    this.onVisibility?.(visible,this.settings);
  }

  async findWork(id,generation) {
    try {
      let file=await readSavedWork(this.date,id).catch(()=>null);
      if (!file) file=await fetchWork(this.date,id);
      if (file && generation===this.generation && !this.id && this.detectedId===id) await this.loadFile(file,false,id);
    } catch {
      // The file picker remains available when a shared work cannot be opened.
    }
  }

  scanMarker(now) {
    const {video,scan,context}=this;
    const width=Math.min(video.videoWidth,640);
    const height=Math.round(video.videoHeight*width/video.videoWidth);
    if (scan.width!==width || scan.height!==height) {
      scan.width=width;
      scan.height=height;
    }
    context.drawImage(video,0,0,width,height);
    const code=jsQR(context.getImageData(0,0,width,height).data,width,height,{inversionAttempts:'dontInvert'});
    const marker=code && readMarker(code.data);
    if (!marker) return;
    const {id,date}=marker;
    if ((this.publicView || this.onTestRendered || date) && date!==this.date) {
      this.setVisible(false);
      this.status(this.publicView?'웹앱을 열 때 찍었던 QR을 다시 비춰 주세요.':'선택한 수업 날짜의 QR을 비춰 주세요.');
      return;
    }
    this.detectedId=id;
    if (!this.lockedId && this.id && id!==this.id) {
      this.setVisible(false);
      this.id=null;
      this.attemptedId=null;
    }
    if (!this.id) {
      if (this.attemptedId===id) return;
      this.attemptedId=id;
      this.onFileNeeded?.(id);
      this.status(workLabel(this.date,id)+' 작품이 이 기기에 없으면 파일을 열어 주세요.');
      const generation=this.generation;
      this.findWork(id,generation);
      return;
    }
    if (id!==this.id) {
      this.setVisible(false);
      this.status(this.publicView?'웹앱을 열 때 찍었던 QR을 다시 비춰 주세요.':'이 작품은 '+this.id.slice(-2)+'번 표식에 연결돼 있어요.');
      return;
    }
    const pose=markerPose(code.location,width,height);
    if (!pose) return;
    this.lastSeen=now;
    const amount=this.anchor.visible ? .42 : 1;
    this.anchor.position.lerp(pose.position,amount);
    this.anchor.quaternion.slerp(pose.rotation,amount);
    this.setVisible(true);
    const label=this.publicView?'':workLabel(this.date,this.id)+' · ';
    this.status(label+(this.settings.rule?.trigger==='tap'
      ? '캐릭터를 터치해 보세요.'
      : '작품이 표식 위에 나타났어요.'));
  }

  frame(now) {
    const elapsed=this.lastFrame===null?0:Math.min((now-this.lastFrame)/1000,.08);
    this.lastFrame=now;
    const {video}=this;
    if (video.readyState>=2 && video.videoWidth) {
      const width=this.canvas.clientWidth;
      const height=this.canvas.clientHeight;
      const videoRatio=video.videoWidth/video.videoHeight;
      const scale=Math.max(width/video.videoWidth,height/video.videoHeight);
      const imageWidth=Math.round(video.videoWidth*scale);
      const imageHeight=Math.round(video.videoHeight*scale);
      if (width>0 && height>0 && (this.width!==width || this.height!==height || this.videoRatio!==videoRatio)) {
        this.width=width;
        this.height=height;
        this.videoRatio=videoRatio;
        this.camera.aspect=videoRatio;
        this.camera.setViewOffset(imageWidth,imageHeight,(imageWidth-width)/2,(imageHeight-height)/2,width,height);
        this.renderer.setSize(width,height,false);
      }
      if (video.currentTime!==this.lastVideoTime && now-this.lastScan>95) {
        this.lastScan=now;
        this.lastVideoTime=video.currentTime;
        this.scanMarker(now);
      }
      if (this.anchor.visible && now-this.lastSeen>420) {
        this.setVisible(false);
        this.status(this.id.slice(-2)+'번 표식을 다시 비춰요.');
      }
      this.rule?.clearPose();
      if (this.anchor.visible) {
        this.body?.update(elapsed);
        this.rule?.update(elapsed);
      }
      this.renderer.render(this.scene,this.camera);
      if (this.onTestRendered && this.anchor.visible) {
        const onTestRendered=this.onTestRendered;
        this.onTestRendered=null;
        onTestRendered();
      }
    }
    this.raf=requestAnimationFrame(this.frame);
  }

  touch(event) {
    if (!this.anchor?.visible || this.settings.rule?.trigger!=='tap') return;
    const rect=this.canvas.getBoundingClientRect();
    const point=new THREE.Vector2(2*(event.clientX-rect.left)/rect.width-1,1-2*(event.clientY-rect.top)/rect.height);
    const ray=new THREE.Raycaster();
    ray.setFromCamera(point,this.camera);
    if (ray.intersectObject(this.anchor,true).length) this.rule.trigger();
  }

  stop() {
    this.generation++;
    this.onTestRendered=null;
    cancelAnimationFrame(this.raf);
    this.video.srcObject?.getTracks().forEach(track=>track.stop());
    this.video.srcObject=null;
    this.body?.stopAllAction();
    this.rule?.stop();
    this.anchor=null;
    this.body=null;
    this.rule=null;
    this.scene=null;
    this.settings=null;
    this.id=null;
    this.width=null;
    this.onVisibility?.(false);
    this.onFileNeeded?.(null);
  }
}
