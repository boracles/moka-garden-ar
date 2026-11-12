import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {applyBrush,createAvatar,palette,resetPose,restoreBrushAttribute,rigPreview,snapshotModel} from './avatar.js';
import {MotionCapture} from './motion.js';
import {GardenAR,warmUpAR} from './garden-ar.js';

const ui=id=>document.getElementById(id);
const intro = {
  make:'실험실을 탈출한 생명체들이 모카가든에 자리 잡았어요. 그중 하나에 내 특징을 담아 봐요.',
  move:'내 특징이 잘 드러나는 동작을 골라 내가 만든 생명체에 입혀요.',
  place:'모카가든에서 내가 만든 생명체가 살 자리를 골라요.',
};
const labels={make:'형태 편집 중',move:'동작 미리 보기',place:'내 자화상'};
const avatar=createAvatar();
const scene=new THREE.Scene();
scene.add(avatar.model);
const camera=new THREE.OrthographicCamera(-2,2,1.75,-1.75,.1,25);
camera.position.set(2.15,1.86,6.7);
let renderer;
try {
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.3;
  ui('viewport').append(renderer.domElement);
} catch(error) {
  ui('graphics-error').hidden=false;
  console.error(error);
}

const key=new THREE.DirectionalLight(0xfff4d4,3.1);
key.position.set(-3,6,4);
const rim=new THREE.DirectionalLight(0xe1fff0,2.05);
rim.position.set(3,4,-4);
scene.add(key,rim,new THREE.HemisphereLight(0xfff7e5,0x829e8b,2.12));
const orbit=renderer ? new OrbitControls(camera,renderer.domElement) : null;
if (orbit) {
  orbit.target.set(0,1.28,0);
  orbit.enableDamping=true;
  orbit.enablePan=false;
  orbit.enableZoom=true;
  orbit.minZoom=.72;
  orbit.maxZoom=3.5;
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
const paintColor=new THREE.Color(palette[1][1]);
let motionClip=null;
let mixer=null;
let cameraRequest=0;
let openingCamera=false;
let brush=null;
let transientOrbit=null;
let example=null;
let showingExample=false;
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

function frameModel(model) {
  if (!orbit) return;
  model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) return;
  const center=bounds.getCenter(new THREE.Vector3());
  const size=bounds.getSize(new THREE.Vector3());
  orbit.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(1.55,.62,6.8));
  camera.zoom=Math.min(2.06,(camera.top-camera.bottom)/Math.max(size.y*1.28,1),
    (camera.right-camera.left)/Math.max(size.x*1.36,1));
  camera.updateProjectionMatrix();
  orbit.update();
}

function refreshEditor() {
  ui('undo').disabled=showingExample||!undoStack.length;
  ui('rig-preview').disabled=!avatar.parts.size;
  for (const button of document.querySelectorAll('[data-part]')) {
    button.disabled=avatar.parts.has(button.dataset.part);
  }
  if (step==='make') ui('stage-label').textContent=showingExample?'완성 예시':avatar.parts.size?'작업 중':'점토 구';
}

function setExample(visible) {
  if (showingExample===visible) return;
  stopPreview();
  showingExample=visible;
  const toggle=ui('show-example');
  toggle.setAttribute('aria-pressed',String(visible));
  toggle.textContent=visible?'작업판으로 돌아가기':'예시 보기';
  ui('sculpt-options').hidden=visible;
  ui('example-info').hidden=!visible;
  ui('brush-cursor').hidden=true;
  for (const button of document.querySelectorAll('[data-tool]')) button.disabled=visible;
  if (visible) {
    example??=createAvatar({example:true});
    scene.remove(avatar.model);
    scene.add(example.model);
  } else {
    scene.remove(example.model);
    scene.add(avatar.model);
  }
  if (orbit) orbit.enabled=visible||tool==='orbit';
  ui('viewport').classList.toggle('orbit-mode',visible||tool==='orbit');
  refreshEditor();
  frameModel(visible?example.model:avatar.model);
}

function setStep(value) {
  if (!intro[value] || step===value) return;
  if (showingExample) setExample(false);
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
  ui('stage-hint').hidden=value!=='make';
  ui('brush-rail').hidden=value!=='make';
  ui('stage-toolbar').hidden=value!=='make';
  ui('brush-cursor').hidden=true;
  ui('workspace').classList.toggle('sculpt-mode',value==='make');
  if (orbit) orbit.enabled=step!=='make' || tool==='orbit';
  ui('viewport').classList.toggle('orbit-mode',value!=='make'||tool==='orbit');
  if (step==='place') {
    ui('place-status').textContent=motionClip
      ? '정원에서 고른 자리를 태블릿으로 비춰요.'
      : '동작을 먼저 녹화하면 정원에 놓을 수 있어요.';
    if (motionClip && matchMedia('(pointer: coarse)').matches) warmUpAR().catch(()=>{});
  }
  refreshEditor();
  updateMotionButtons();
}

for (const button of document.querySelectorAll('[data-step]')) {
  button.addEventListener('click',()=>setStep(button.dataset.step));
}

function selectTool(value) {
  tool=value;
  stopPreview();
  if (orbit) orbit.enabled=tool==='orbit';
  ui('viewport').classList.toggle('orbit-mode',tool==='orbit');
  ui('brush-cursor').hidden=true;
  for (const item of document.querySelectorAll('[data-tool]')) {
    item.setAttribute('aria-pressed',String(item.dataset.tool===tool));
  }
}

function rememberEdit(edit) {
  undoStack.push(edit);
  if (undoStack.length>25) undoStack.shift();
  refreshEditor();
}

for (const button of document.querySelectorAll('[data-tool]')) {
  button.addEventListener('click',()=>selectTool(button.dataset.tool));
}

for (const button of document.querySelectorAll('[data-part]')) {
  button.addEventListener('click',()=>{
    stopPreview();
    if (!avatar.addPart(button.dataset.part)) return;
    rememberEdit({part:button.dataset.part});
    frameModel(avatar.model);
  });
}

ui('show-example').addEventListener('click',()=>setExample(!showingExample));

for (const [name,color] of palette) {
  const button=document.createElement('button');
  button.type='button';
  button.className='color';
  button.title=name;
  button.style.setProperty('--swatch',color);
  button.setAttribute('aria-label',name);
  button.setAttribute('aria-pressed',String(color===palette[1][1]));
  button.addEventListener('click',()=>{
    paintColor.set(color);
    selectTool('paint');
    for (const item of ui('colors').children) item.setAttribute('aria-pressed',String(item===button));
  });
  ui('colors').append(button);
}

if (renderer) {
  const canvas=renderer.domElement;
  const raycaster=new THREE.Raycaster();
  const cursor=ui('brush-cursor');
  const radius=()=>.065+Number(ui('brush-size').value)*.021;
  function intersect(event) {
    const bounds=canvas.getBoundingClientRect();
    const p=new THREE.Vector2((event.clientX-bounds.left)/bounds.width*2-1,1-(event.clientY-bounds.top)/bounds.height*2);
    raycaster.setFromCamera(p,camera);
    return raycaster.intersectObjects(avatar.surfaces,false)[0];
  }
  function makeMark(hit,distance) {
    const mesh=hit.object;
    if (!brush.changes.has(mesh)) {
      brush.changes.set(mesh,mesh.geometry.getAttribute(brush.attribute).array.slice());
    }
    applyBrush(hit,brush.tool,brush.radius,distance,brush.color,brush.strength);
  }
  function positionCursor(event,hit) {
    cursor.hidden=!hit;
    if (!hit) return;
    const rect=canvas.getBoundingClientRect();
    const size=(brush?.radius??radius())*2*camera.zoom*rect.height/(camera.top-camera.bottom);
    cursor.style.left=(event.clientX-rect.left)+'px';
    cursor.style.top=(event.clientY-rect.top)+'px';
    cursor.style.width=cursor.style.height=size+'px';
  }
  canvas.addEventListener('pointerdown',event=>{
    if (step!=='make'||showingExample||tool==='orbit'||brush||transientOrbit!==null||event.button>0) return;
    stopPreview();
    const hit=intersect(event);
    if (!hit) {
      transientOrbit=event.pointerId;
      orbit.enabled=true;
      cursor.hidden=true;
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    brush={
      id:event.pointerId,x:event.clientX,y:event.clientY,changes:new Map(),tool,
      attribute:tool==='paint'?'color':'position',
      radius:radius(),
      color:paintColor.clone(),
      strength:.26+Number(ui('brush-strength').value)*.124,
    };
    positionCursor(event,hit);
    if (tool==='paint') makeMark(hit,1);
  },true);
  canvas.addEventListener('pointermove',event=>{
    if (step!=='make'||showingExample||tool==='orbit'||transientOrbit!==null) return;
    const hit=intersect(event);
    positionCursor(event,hit);
    if (event.pointerId!==brush?.id) return;
    const distance=Math.hypot(event.clientX-brush.x,event.clientY-brush.y);
    if (distance<4) return;
    brush.x=event.clientX;
    brush.y=event.clientY;
    if (!hit) return;
    makeMark(hit,distance);
  });
  function finishBrush(event) {
    if (transientOrbit===event.pointerId) {
      transientOrbit=null;
      orbit.enabled=showingExample||step!=='make'||tool==='orbit';
    }
    if (event.pointerId!==brush?.id) return;
    if (brush.changes.size) rememberEdit({attribute:brush.attribute,changes:brush.changes});
    brush=null;
    if (event.pointerType==='touch') cursor.hidden=true;
  }
  for (const name of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(name,finishBrush);
  canvas.addEventListener('pointerleave',()=>{cursor.hidden=true;});
}

ui('undo').addEventListener('click',()=>{
  const last=undoStack.pop();
  if (!last) return;
  if (last.part) {
    stopPreview();
    avatar.removePart(last.part);
    frameModel(avatar.model);
  } else {
    for (const [mesh,values] of last.changes) restoreBrushAttribute(mesh,last.attribute,values);
  }
  refreshEditor();
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
frameModel(avatar.model);
refreshEditor();
updateMotionButtons();

