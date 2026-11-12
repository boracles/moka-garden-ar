import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createAvatar,deform,palette,resetPose,rigPreview,setColor,setSurface,snapshotModel} from './avatar.js';
import {MotionCapture} from './motion.js';
import {GardenAR,warmUpAR} from './garden-ar.js';

const ui=id=>document.getElementById(id);
const intro = {
  make:'실험실을 나온 크리쳐들이 모카가든에 산다고 상상해요. 그중 하나를 내 특징을 담아 빚어요.',
  move:'내 특징이 잘 드러나는 동작을 골라 크리쳐에 입혀요.',
  place:'모카가든에서 내 크리쳐가 살 자리를 골라요.',
};
const labels={make:'형태 편집 중',move:'동작 미리 보기',place:'내 크리쳐'};
const avatar=createAvatar();
const scene=new THREE.Scene();
scene.add(avatar.model);
const camera=new THREE.OrthographicCamera(-2,2,1.75,-1.75,.1,25);
camera.position.set(2.15,1.86,6.7);
let renderer;
try {
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.3;
  ui('viewport').append(renderer.domElement);
} catch(error) {
  ui('graphics-error').hidden=false;
  console.error(error);
}

const key=new THREE.DirectionalLight(0xfff4d4,3.1);
key.position.set(-3,6,4);
key.castShadow=true;
key.shadow.mapSize.set(1024,1024);
key.shadow.camera.left=-2.7;
key.shadow.camera.right=2.7;
key.shadow.camera.top=3;
key.shadow.camera.bottom=-3;
key.shadow.bias=-.00025;
const rim=new THREE.DirectionalLight(0xe1fff0,2.05);
rim.position.set(3,4,-4);
scene.add(key,rim,new THREE.HemisphereLight(0xfff7e5,0x829e8b,2.12));
const plinth=new THREE.Mesh(new THREE.CylinderGeometry(1.03,1.06,.12,90),new THREE.MeshStandardMaterial({
  color:'#a4bca5',roughness:.95,
}));
plinth.position.y=-.018;
plinth.receiveShadow=true;
scene.add(plinth);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.ShadowMaterial({opacity:.21}));
ground.rotation.x=-Math.PI/2;
ground.position.y=-.08;
ground.receiveShadow=true;
scene.add(ground);

const orbit=renderer ? new OrbitControls(camera,renderer.domElement) : null;
if (orbit) {
  orbit.target.set(0,1.28,0);
  orbit.enableDamping=true;
  orbit.enablePan=false;
  orbit.enableZoom=false;
  orbit.minPolarAngle=.51;
  orbit.maxPolarAngle=1.68;
  orbit.enabled=false;
  orbit.update();
  const viewport=ui('viewport');
  function resize() {
    const {clientWidth:w,clientHeight:h}=viewport;
    if (!w || !h) return;
    const halfHeight=Math.max(1.59,1.06*h/w);
    camera.left=-halfHeight*w/h;
    camera.right=halfHeight*w/h;
    camera.top=halfHeight;
    camera.bottom=-halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(w,h,false);
  }
  new ResizeObserver(resize).observe(viewport);
  resize();
}

let step='make';
let tool='pull';
let motionClip=null;
let mixer=null;
let cameraRequest=0;
let openingCamera=false;
let brush=null;
const undoStack=[];
const motion=new MotionCapture(ui('motion-video'),avatar,{
  status:message=>{ui('motion-status').textContent=message;},
  tracking:visible=>{
    updateMotionButtons();
    if (!motion.recording) ui('motion-status').textContent=visible
      ? '몸짓이 보여요. 준비됐으면 3초 녹화를 눌러요.'
      : '팔과 몸이 화면 안에 보이게 움직여 주세요.';
  },
  error:message=>{
    ui('motion-status').textContent=message;
    if (!motion.active) closeCamera();
    updateMotionButtons();
  },
  complete:clip=>{
    motionClip=clip;
    closeCamera();
    preview(clip);
    ui('motion-status').textContent='동작을 저장했어요. 캐릭터를 다시 보거나 정원에 놓을 수 있어요.';
    updateMotionButtons();
  },
});
const ar=new GardenAR(ui('ar-canvas'),message=>{ui('ar-status').textContent=message;});

function closeCamera() {
  cameraRequest++;
  openingCamera=false;
  motion.stop();
  ui('camera-tile').hidden=true;
  updateMotionButtons();
}

function updateMotionButtons() {
  ui('open-camera').disabled=openingCamera || Boolean(motion.recording);
  ui('open-camera').textContent=motion.active ? '앞 카메라 끄기' : '앞 카메라 켜기';
  ui('record').disabled=!motion.active || !motion.seesPose || Boolean(motion.recording);
  ui('replay').disabled=!motionClip || openingCamera || Boolean(motion.recording);
  ui('download').disabled=!motionClip || openingCamera || Boolean(motion.recording);
  ui('start-ar').disabled=!motionClip || !renderer;
}

function stopPreview() {
  mixer?.stopAllAction();
  mixer=null;
  resetPose(avatar);
}

function preview(clip) {
  stopPreview();
  mixer=new THREE.AnimationMixer(avatar.model);
  const action=mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce,1);
  mixer.addEventListener('finished',stopPreview);
  action.play();
}

function setStep(value) {
  if (!intro[value] || step===value) return;
  if (step==='move') closeCamera();
  stopPreview();
  step=value;
  for (const [id] of Object.entries(intro)) {
    ui('panel-'+id).hidden=id!==value;
    const item=document.querySelector('.steps [data-step="'+id+'"]');
    if (id===value) item.setAttribute('aria-current','step');
    else item.removeAttribute('aria-current');
  }
  ui('intro-copy').textContent=intro[value];
  ui('stage-label').textContent=labels[value];
  if (orbit) orbit.enabled=step!=='make' || tool==='orbit';
  if (step==='place') {
    ui('place-status').textContent=motionClip
      ? '정원에서 고른 자리를 태블릿으로 비춰요.'
      : '동작을 먼저 녹화하면 정원에 놓을 수 있어요.';
    if (motionClip && matchMedia('(pointer: coarse)').matches) warmUpAR().catch(()=>{});
  }
  updateMotionButtons();
}

for (const button of document.querySelectorAll('[data-step]')) {
  button.addEventListener('click',()=>setStep(button.dataset.step));
}

for (const button of document.querySelectorAll('[data-tool]')) {
  button.addEventListener('click',()=>{
    tool=button.dataset.tool;
    stopPreview();
    if (orbit) orbit.enabled=tool==='orbit';
    for (const item of document.querySelectorAll('[data-tool]')) {
      item.setAttribute('aria-pressed',String(item===button));
    }
  });
}

for (const [name,color] of palette) {
  const button=document.createElement('button');
  button.type='button';
  button.className='color';
  button.title=name;
  button.style.setProperty('--swatch',color);
  button.setAttribute('aria-label',name);
  button.setAttribute('aria-pressed',String(color===palette[0][1]));
  button.addEventListener('click',()=>{
    setColor(avatar,color);
    for (const item of ui('colors').children) item.setAttribute('aria-pressed',String(item===button));
  });
  ui('colors').append(button);
}

if (renderer) {
  const canvas=renderer.domElement;
  const raycaster=new THREE.Raycaster();
  function intersect(event) {
    const bounds=canvas.getBoundingClientRect();
    const p=new THREE.Vector2((event.clientX-bounds.left)/bounds.width*2-1,1-(event.clientY-bounds.top)/bounds.height*2);
    raycaster.setFromCamera(p,camera);
    return raycaster.intersectObjects(avatar.surfaces,false)[0];
  }
  canvas.addEventListener('pointerdown',event=>{
    if (step!=='make' || tool==='orbit' || brush || event.button>0) return;
    stopPreview();
    const hit=intersect(event);
    if (!hit) return;
    canvas.setPointerCapture(event.pointerId);
    brush={id:event.pointerId,x:event.clientX,y:event.clientY,changes:new Map()};
  });
  canvas.addEventListener('pointermove',event=>{
    if (event.pointerId!==brush?.id) return;
    const distance=Math.hypot(event.clientX-brush.x,event.clientY-brush.y);
    if (distance<4) return;
    brush.x=event.clientX;
    brush.y=event.clientY;
    const hit=intersect(event);
    if (!hit) return;
    const geometry=hit.object.geometry;
    if (!brush.changes.has(geometry)) brush.changes.set(geometry,geometry.getAttribute('position').array.slice());
    deform(hit,distance,tool==='push'?-1:1);
  });
  function finishBrush(event) {
    if (event.pointerId!==brush?.id) return;
    if (brush.changes.size) {
      undoStack.push(brush.changes);
      if (undoStack.length>25) undoStack.shift();
      ui('undo').disabled=false;
    }
    brush=null;
  }
  for (const name of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(name,finishBrush);
}

ui('undo').addEventListener('click',()=>{
  const last=undoStack.pop();
  if (last) for (const [geometry,positions] of last) setSurface(geometry,positions);
  ui('undo').disabled=!undoStack.length;
});

ui('rig-preview').addEventListener('click',()=>preview(rigPreview()));
ui('open-camera').addEventListener('click',async()=>{
  if (motion.active) {
    closeCamera();
    ui('motion-status').textContent='앞 카메라를 껐어요.';
    return;
  }
  if (!renderer) return;
  stopPreview();
  openingCamera=true;
  updateMotionButtons();
  const request=++cameraRequest;
  ui('camera-tile').hidden=false;
  ui('motion-status').textContent='카메라와 동작 추적을 준비하고 있어요.';
  try {
    const opened=await motion.open();
    if (!opened || request!==cameraRequest) return;
    ui('motion-status').textContent='팔과 몸이 화면 안에 보이게 움직여 주세요.';
  } catch(error) {
    if (request!==cameraRequest) return;
    ui('camera-tile').hidden=true;
    const denied=error.name==='NotAllowedError'||error.name==='PermissionDeniedError';
    ui('motion-status').textContent=denied
      ? '카메라 권한을 허용한 뒤 다시 눌러 주세요.'
      : '카메라나 동작 추적을 열지 못했어요. 인터넷 연결과 카메라 상태를 확인해 주세요.';
    console.error(error);
  } finally {
    if (request===cameraRequest) {
      openingCamera=false;
      updateMotionButtons();
    }
  }
});

ui('record').addEventListener('click',()=>{
  if (motion.record(performance.now())) updateMotionButtons();
});
ui('replay').addEventListener('click',()=>{
  if (!motionClip) return;
  closeCamera();
  preview(motionClip);
});
ui('download').addEventListener('click',async()=>{
  if (!motionClip) return;
  try {
    const exportModel=snapshotModel(avatar);
    exportModel.userData.gardenPlace=ui('place-note').value.trim();
    const glb=await new GLTFExporter().parseAsync(exportModel,{binary:true,animations:[motionClip]});
    const url=URL.createObjectURL(new Blob([glb],{type:'model/gltf-binary'}));
    const link=document.createElement('a');
    link.href=url;
    link.download='moka-garden-creature.glb';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    ui('motion-status').textContent='동작이 담긴 3D 작품 파일을 저장했어요.';
  } catch(error) {
    ui('motion-status').textContent='작품 파일을 저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.';
    console.error(error);
  }
});

ui('start-ar').addEventListener('click',async()=>{
  if (!motionClip) return;
  closeCamera();
  stopPreview();
  ui('ar-overlay').hidden=false;
  ui('ar-status').textContent='뒤 카메라와 정원 위치 추적을 준비하고 있어요.';
  ui('close-ar').focus();
  try {
    await ar.open(snapshotModel(avatar),motionClip);
  } catch(error) {
    if (!ui('ar-overlay').hidden) ui('ar-status').textContent=error.message;
    console.error(error);
  }
});
function closeAR() {
  ar.stop();
  ui('ar-overlay').hidden=true;
  ui('start-ar').focus();
}
ui('close-ar').addEventListener('click',closeAR);
ui('smaller').addEventListener('click',()=>ar.resize(.82));
ui('larger').addEventListener('click',()=>ar.resize(1.22));
ui('rotate-ar').addEventListener('click',()=>ar.rotate());
ui('reset-ar').addEventListener('click',()=>ar.reset());
window.addEventListener('keydown',event=>{
  if (event.key==='Escape' && !ui('ar-overlay').hidden) closeAR();
});
window.addEventListener('pagehide',()=>{
  closeCamera();
  ar.stop();
});

let last=performance.now();
function draw(now) {
  const elapsed=Math.min((now-last)/1000,.06);
  last=now;
  if (renderer && ui('ar-overlay').hidden) {
    if (motion.active) motion.update(now);
    else mixer?.update(elapsed);
    orbit.update();
    renderer.render(scene,camera);
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
updateMotionButtons();

