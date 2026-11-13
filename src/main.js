import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {applyBrush,createAvatar,extensionClip,palette,partReaction,resetPose,restoreBrushAttribute,rigPreview,snapshotModel} from './avatar.js';
import {buildHumanoid,defaultMarkers,markerGroups} from './humanoid.js';
import {MotionCapture} from './motion.js';
import {PartRule,partActions} from './part-rules.js';
import {MarkerAR,markerId,saveMarkerWork,showMarker} from './marker-ar.js';

const ui=id=>document.getElementById(id);
const intro = {
  make:'실험실을 탈출한 생명체들이 모카가든에 자리 잡았어요. 그중 하나에 내 특징을 담아 봐요.',
  move:'내 특징이 잘 드러나는 동작을 골라 내가 만든 생명체에 입혀요.',
  ability:'내가 만든 생명체가 정원에서 무엇을 하는지 골라 봐요.',
  place:'모카가든에서 내가 만든 생명체가 살 자리를 골라요.',
};
const labels={make:'형태 편집 중',move:'동작 미리 보기',ability:'기능 미리 보기',place:'내 자화상'};
const avatar=createAvatar();
const scene=new THREE.Scene();
scene.add(avatar.model);
const rigOverlay=document.createElement('div');
rigOverlay.className='rig-markers';
rigOverlay.hidden=true;
rigOverlay.setAttribute('role','group');
rigOverlay.setAttribute('aria-label','캐릭터 위의 관절 마커');
const rigAxis=document.createElement('div');
rigAxis.className='rig-axis';
rigOverlay.append(rigAxis);
ui('viewport').parentElement.append(rigOverlay);
const rigMarkerButtons=new Map();
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
    if (!rigOverlay.hidden) frameModel(avatar.model,true);
  }
  new ResizeObserver(resize).observe(viewport);
  resize();
}

let step='make';
let riggedAvatar=null;
let rigMarkers=null;
let selectedMarker='chin';
const displayAvatar=()=>step==='make'?avatar:(riggedAvatar??avatar);
let tool='pull';
const paintColor=new THREE.Color(palette[1][1]);
let motionClip=null;
let clayClip=null;
let clayRecording=null;
let mixer=null;
let playingClay=false;
let previewRule=null;
let audioContext;
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
      : '머리부터 발끝까지 화면 안에 보이게 서 주세요.';
  },
  error:message=>{
    ui('motion-status').textContent=message;
    if (!motion.active) closeCamera();
    updateMotionButtons();
  },
  complete:clip=>{
    if (!motionClip) ui('use-movement').checked=true;
    motionClip=clip;
    closeCamera();
    preview(clip);
    ui('motion-status').textContent='동작을 저장했어요. 기능 붙이기에서 속도를 바꿀 수 있어요.';
    updateMotionButtons();
    updateAbilities();
  },
});
const ar=new MarkerAR(ui('ar-video'),ui('ar-canvas'),message=>{ui('ar-status').textContent=message;},updateARAbilities);

function closeCamera() {
  cameraRequest++;
  openingCamera=false;
  motion.stop();
  resetPose(displayAvatar());
  ui('camera-tile').hidden=true;
  updateMotionButtons();
}

function updateMotionButtons() {
  ui('open-camera').disabled=!riggedAvatar || openingCamera || Boolean(motion.recording);
  ui('open-camera').textContent=motion.active ? '앞 카메라 끄기' : '앞 카메라 켜기';
  ui('record').disabled=!motion.active || !motion.seesPose || Boolean(motion.recording);
  ui('replay').disabled=!motionClip || openingCamera || Boolean(motion.recording);
  ui('download').disabled=!riggedAvatar || openingCamera || motion.active;
  ui('rig-edit').disabled=openingCamera || Boolean(motion.recording);
  ui('start-ar').disabled=!renderer||!markerId(ui('marker-number').value);
  ui('view-garden').disabled=!renderer;
}

function stopPreview() {
  mixer?.stopAllAction();
  mixer=null;
  playingClay=false;
  resetPose(displayAvatar());
}

function preview(clip,speed=1) {
  stopPreview();
  playingClay=clip===clayClip;
  mixer=new THREE.AnimationMixer(displayAvatar().model);
  const action=mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce,1);
  action.timeScale=speed;
  mixer.addEventListener('finished',stopPreview);
  action.play();
}

function frameModel(model,front=false) {
  if (!orbit) return;
  model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) return;
  const center=bounds.getCenter(new THREE.Vector3());
  const size=bounds.getSize(new THREE.Vector3());
  orbit.target.copy(center);
  camera.position.copy(center).add(front?new THREE.Vector3(0,0,6.8):new THREE.Vector3(1.55,.62,6.8));
  camera.zoom=Math.min(2.06,(camera.top-camera.bottom)/Math.max(size.y*1.28,1),
    (camera.right-camera.left)/Math.max(size.x*1.36,1));
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  orbit.update();
  camera.updateMatrixWorld();
}

function refreshEditor() {
  ui('undo').disabled=showingExample||!undoStack.length;
  ui('rig-preview').disabled=!avatar.parts.size;
  ui('extension-place-setting').hidden=!avatar.parts.has('extension');
  for (const button of document.querySelectorAll('[data-part]')) {
    button.disabled=avatar.parts.has(button.dataset.part);
  }
  if (step==='make') ui('stage-label').textContent=showingExample?'완성 예시':avatar.parts.size?'작업 중':'점토 구';
}

function addClayPart(part) {
  stopPreview();
  if (!avatar.addPart(part)) return;
  rememberEdit({part});
  if (['head','arms','legs'].includes(part)) invalidateBodyRig();
  else if (riggedAvatar) setRiggedAvatar(buildHumanoid(avatar,rigMarkers));
  frameModel(displayAvatar().model);
}

function displayRig() {
  const active=step==='move';
  const ready=['head','arms','legs'].every(part=>avatar.parts.has(part));
  const placing=active && ready && !riggedAvatar && Boolean(renderer);
  ui('body-rig').hidden=Boolean(riggedAvatar);
  ui('rig-motion').hidden=!riggedAvatar;
  ui('rig-controls').hidden=!ready || !renderer;
  ui('rig-help').hidden=ready;
  ui('rig-back').hidden=ready;
  rigOverlay.hidden=!placing;
  ui('workspace').classList.toggle('rig-mode',active && !riggedAvatar);
  if (orbit && active) orbit.enabled=Boolean(riggedAvatar);
}

function setRiggedAvatar(next) {
  stopPreview();
  const previous=riggedAvatar;
  const previousModel=displayAvatar().model;
  riggedAvatar=next;
  motion.avatar=displayAvatar();
  if (previousModel!==displayAvatar().model) {
    scene.remove(previousModel);
    scene.add(displayAvatar().model);
    previous?.dispose();
  }
  displayRig();
  frameModel(displayAvatar().model);
  updateMotionButtons();
}

function selectMarker(id) {
  selectedMarker=id;
  for (const button of ui('rig-marker-list').children) {
    button.setAttribute('aria-pressed',String(button.dataset.marker===id));
  }
  for (const button of rigMarkerButtons.values()) {
    button.setAttribute('aria-pressed',String(button.dataset.group===id));
  }
}

function updateRigMarkers() {
  if (rigOverlay.hidden) return;
  const project=point=>point.clone().project(camera);
  const axis=project(new THREE.Vector3(0,orbit.target.y,0));
  rigAxis.style.left=(axis.x*.5+.5)*100+'%';
  rigAxis.hidden=!ui('rig-symmetry').checked;
  for (const [name,button] of rigMarkerButtons) {
    const point=project(rigMarkers[name]);
    button.style.left=(point.x*.5+.5)*100+'%';
    button.style.top=(.5-point.y*.5)*100+'%';
  }
}

function startRigPlacement() {
  displayRig();
  if (rigOverlay.hidden) return;
  rigMarkers??=defaultMarkers(avatar);
  frameModel(avatar.model,true);
  selectMarker(selectedMarker);
  updateRigMarkers();
}

function moveRigMarker(name,event) {
  const bounds=rigOverlay.getBoundingClientRect();
  const x=THREE.MathUtils.clamp((event.clientX-bounds.left)/bounds.width,0,1);
  const y=THREE.MathUtils.clamp((event.clientY-bounds.top)/bounds.height,0,1);
  const point=new THREE.Vector3(x*2-1,1-y*2,0).unproject(camera);
  const marker=rigMarkers[name];
  marker.set(point.x,point.y,marker.z);
  const side=name.at(-1);
  if (ui('rig-symmetry').checked) {
    if (side==='L' || side==='R') {
      const other=rigMarkers[name.slice(0,-1)+(side==='L'?'R':'L')];
      other.x=-marker.x;
      other.y=marker.y;
    } else {
      marker.x=0;
    }
  }
  ui('rig-status').textContent='';
  updateRigMarkers();
}

for (const {id,label,color,points} of markerGroups) {
  const control=document.createElement('button');
  control.type='button';
  control.dataset.marker=id;
  control.textContent=label;
  control.style.setProperty('--marker-color',color);
  control.addEventListener('click',()=>selectMarker(id));
  ui('rig-marker-list').append(control);
  for (const name of points) {
    const marker=document.createElement('button');
    marker.type='button';
    marker.className='rig-marker';
    marker.dataset.group=id;
    const side=name.endsWith('L')?'캐릭터 왼쪽 ':name.endsWith('R')?'캐릭터 오른쪽 ':'';
    marker.setAttribute('aria-label',side+label);
    marker.style.setProperty('--marker-color',color);
    marker.addEventListener('pointerdown',event=>{
      if (event.button!==0) return;
      selectMarker(id);
      marker.setPointerCapture(event.pointerId);
    });
    marker.addEventListener('pointermove',event=>{
      if (marker.hasPointerCapture(event.pointerId)) moveRigMarker(name,event);
    });
    marker.addEventListener('keydown',event=>{
      const offset={ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,-5],ArrowDown:[0,5]}[event.key];
      if (!offset) return;
      event.preventDefault();
      selectMarker(id);
      const bounds=marker.getBoundingClientRect();
      moveRigMarker(name,{clientX:bounds.x+bounds.width/2+offset[0],clientY:bounds.y+bounds.height/2+offset[1]});
    });
    rigMarkerButtons.set(name,marker);
    rigOverlay.append(marker);
  }
}

rigOverlay.addEventListener('pointerdown',event=>{
  if (event.target!==rigOverlay || event.button!==0) return;
  const group=markerGroups.find(group=>group.id===selectedMarker);
  const rect=rigOverlay.getBoundingClientRect();
  const axis=rect.left+rect.width*(new THREE.Vector3(0,orbit.target.y,0).project(camera).x*.5+.5);
  const name=group.points.length===1?group.points[0]:group.points[event.clientX>=axis?0:1];
  moveRigMarker(name,event);
});

ui('rig-reset').addEventListener('click',()=>{
  rigMarkers=defaultMarkers(avatar);
  ui('rig-status').textContent='';
  updateRigMarkers();
});

ui('rig-symmetry').addEventListener('change',event=>{
  if (!event.target.checked) return;
  rigMarkers.chin.x=0;
  rigMarkers.groin.x=0;
  for (const {points} of markerGroups.filter(group=>group.points.length===2)) {
    const [left,right]=points.map(name=>rigMarkers[name]);
    right.x=-left.x;
    right.y=left.y;
  }
  updateRigMarkers();
});

ui('rig-apply').addEventListener('click',()=>{
  try {
    setRiggedAvatar(buildHumanoid(avatar,rigMarkers));
    ui('motion-status').textContent='뼈대가 연결됐어요. 앞 카메라를 켜서 함께 움직여 봐요.';
    ui('open-camera').focus();
  } catch(error) {
    ui('rig-status').textContent=error.message;
  }
});

ui('rig-edit').addEventListener('click',()=>{
  closeCamera();
  motionClip=null;
  ui('use-movement').checked=false;
  setRiggedAvatar(null);
  updateAbilities();
  startRigPlacement();
  ui('rig-apply').focus();
});

function invalidateBodyRig() {
  rigMarkers=null;
  ui('rig-status').textContent='';
  if (!riggedAvatar && !motionClip) return;
  motionClip=null;
  ui('use-movement').checked=false;
  setRiggedAvatar(null);
  updateAbilities();
}

function selectedRule() {
  const trigger=ui('rule-trigger').value;
  const part=ui('rule-part').value;
  const action=ui('rule-action').value;
  if (!part || !action || trigger==='none') return null;
  return {
    trigger,part,action,
    size:Number(ui('rule-size').value)/5,
    count:Number(ui('rule-count').value),
    clip:action==='recorded'?clayClip:null,
  };
}

function clearReactionPreview() {
  previewRule?.stop();
  previewRule=null;
  partReaction(displayAvatar().model,'extension')(0);
}

function setChoices(select,choices,placeholder) {
  const selected=select.value;
  select.replaceChildren(new Option(placeholder,''),...choices.map(([value,label])=>new Option(label,value)));
  if (choices.some(([value])=>value===selected)) select.value=selected;
}

function updateRuleOptions() {
  const parts=[
    ['extension','코·꼬리',avatar.parts.has('extension')],
    ['ears','귀',avatar.parts.has('ears')],
    ['head','머리',avatar.parts.has('head')],
    ['hands','손',Boolean(riggedAvatar)],
  ];
  setChoices(ui('rule-part'),parts.filter(([, ,available])=>available),'고르기');
  const part=ui('rule-part').value;
  const actions=(partActions[part]??[]).filter(([value])=>value!=='recorded'||clayClip);
  setChoices(ui('rule-action'),actions,'고르기');
  const isRecording=Boolean(clayRecording);
  const hasParts=parts.some(([, ,available])=>available);
  ui('rule-help').hidden=hasParts;
  ui('rule-blocks').hidden=!hasParts;
  ui('rule-options').hidden=!selectedRule();
  ui('rule-size-options').hidden=ui('rule-action').value==='recorded';
  ui('extension-settings').hidden=part!=='extension';
  ui('rule-trigger').disabled=isRecording;
  ui('rule-part').disabled=isRecording;
  ui('rule-action').disabled=!part||isRecording;
  ui('rule-preview').disabled=isRecording;
  ui('record-clay').disabled=isRecording;
  ui('replay-clay').disabled=!clayClip||isRecording;
  ui('download-clay').disabled=!clayClip||isRecording;
}

function updateAbilities() {
  updateRuleOptions();
  ui('use-movement').disabled=!motionClip;
  ui('movement-help').hidden=Boolean(motionClip);
  ui('movement-options').hidden=!motionClip || !ui('use-movement').checked;
  displayRig();
}

function updateARAbilities(visible,settings) {
  ui('ar-abilities').hidden=!visible || !settings?.sound;
  ui('sound-ar').dataset.pitch=settings?.sound??'';
}

function tryRule() {
  const rule=selectedRule();
  if (!rule || clayRecording) return;
  stopPreview();
  clearReactionPreview();
  previewRule=new PartRule(displayAvatar().model,rule);
  previewRule.trigger();
  ui('ability-status').hidden=false;
  ui('ability-status').textContent=rule.trigger==='tap'
    ? '정원에서는 캐릭터를 터치하면 이 동작을 해요.'
    : '정원 표식에서 나타날 때 이 동작을 해요.';
}

async function playCreatureSound(status,setting=Number(ui('sound-pitch').value)) {
  try {
    audioContext??=new AudioContext();
    if (audioContext.state!=='running') await audioContext.resume();
    const now=audioContext.currentTime;
    const oscillator=audioContext.createOscillator();
    const volume=audioContext.createGain();
    const pitch=165*2**((setting-1)/3);
    oscillator.type='triangle';
    oscillator.frequency.setValueAtTime(pitch,now);
    oscillator.frequency.exponentialRampToValueAtTime(pitch*1.35,now+.11);
    oscillator.frequency.exponentialRampToValueAtTime(pitch*.83,now+.35);
    volume.gain.setValueAtTime(.001,now);
    volume.gain.exponentialRampToValueAtTime(.12,now+.04);
    volume.gain.exponentialRampToValueAtTime(.001,now+.36);
    oscillator.connect(volume).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now+.37);
    oscillator.onended=()=>{oscillator.disconnect();volume.disconnect();};
  } catch(error) {
    const message='소리를 재생하지 못했어요. 기기의 소리 설정을 확인해 주세요.';
    status.textContent=message;
    status.hidden=false;
    console.error(error);
  }
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
  if (clayRecording) {
    clayRecording=null;
    ui('clay-recording-status').textContent='녹화를 멈췄어요. 다시 녹화할 수 있어요.';
  }
  stopPreview();
  clearReactionPreview();
  const previousModel=displayAvatar().model;
  step=value;
  const nextModel=displayAvatar().model;
  if (previousModel!==nextModel) {
    scene.remove(previousModel);
    scene.add(nextModel);
  }
  motion.avatar=displayAvatar();
  frameModel(nextModel);
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
  ui('workspace').classList.toggle('ability-mode',value==='ability');
  if (orbit) orbit.enabled=step!=='make' || tool==='orbit';
  ui('viewport').classList.toggle('orbit-mode',value!=='make'||tool==='orbit');
  if (step==='place') {
    ui('place-status').textContent='QR 표식을 평평한 곳에 놓아 주세요.';
    updateMarkerPreview();
  }
  if (step==='move') startRigPlacement();
  ui('ability-status').hidden=true;
  refreshEditor();
  updateMotionButtons();
  updateAbilities();
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
  button.addEventListener('click',()=>addClayPart(button.dataset.part));
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
    if (brush.changes.size) {
      rememberEdit({attribute:brush.attribute,changes:brush.changes});
      invalidateBodyRig();
    }
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
    if (['head','arms','legs'].includes(last.part)) invalidateBodyRig();
    else if (riggedAvatar) setRiggedAvatar(buildHumanoid(avatar,rigMarkers));
    if (last.part==='extension') {
      clayClip=null;
      ui('clay-bend').value='0';
      ui('clay-recording-status').textContent='녹화를 누르고 슬라이더를 움직여요.';
    }
    updateAbilities();
    frameModel(avatar.model);
  } else {
    for (const [mesh,values] of last.changes) restoreBrushAttribute(mesh,last.attribute,values);
    invalidateBodyRig();
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
  if (!renderer || !riggedAvatar) return;
  stopPreview();
  openingCamera=true;
  updateMotionButtons();
  const request=++cameraRequest;
  ui('camera-tile').hidden=false;
  ui('motion-status').textContent='카메라와 동작 추적을 준비하고 있어요.';
  try {
    const opened=await motion.open();
    if (!opened || request!==cameraRequest) return;
    if (!motion.seesPose) ui('motion-status').textContent='머리부터 발끝까지 화면 안에 보이게 서 주세요.';
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
function gardenWork() {
  const model=snapshotModel(displayAvatar());
  const rule=selectedRule();
  const animations=[motionClip,clayClip].filter(Boolean);
  const settings={
    motion:ui('use-movement').checked?motionClip?.name:null,
    speed:Number(ui('motion-speed').value),
    sound:ui('use-sound').checked?Number(ui('sound-pitch').value):null,
  };
  if (rule) {
    const {clip,...blocks}=rule;
    settings.rule={...blocks,animation:clip?.name};
  }
  model.userData.gardenPlace=ui('place-note').value.trim();
  model.userData.gardenWork=settings;
  return {model,animations,settings};
}

async function downloadWork(status,id) {
  const {model,animations}=gardenWork();
  if (!id && !riggedAvatar && !animations.length) return;
  try {
    if (id) model.userData.gardenMarker=id;
    const glb=await new GLTFExporter().parseAsync(model,{binary:true,animations});
    const file=new Blob([glb],{type:'model/gltf-binary'});
    if (id) await saveMarkerWork(id,file).catch(()=>{});
    const url=URL.createObjectURL(file);
    const link=document.createElement('a');
    link.href=url;
    link.download=id?id+'.glb':'moka-garden-creature.glb';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    if (id) {
      status.textContent='작품을 저장했어요. 다른 태블릿에서도 보려면 이 파일을 해당 태블릿에 전달해 주세요.';
      return;
    }
    status.textContent=animations.length?'동작이 담긴 3D 작품 파일을 저장했어요.':'뼈대가 담긴 3D 작품 파일을 저장했어요.';
  } catch(error) {
    status.textContent='작품 파일을 저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.';
    console.error(error);
  }
}
ui('download').addEventListener('click',()=>downloadWork(ui('motion-status')));
ui('download-clay').addEventListener('click',()=>downloadWork(ui('clay-recording-status')));

function clayBend() {
  return Number(ui('clay-bend').value)/100;
}

function sampleClay(now) {
  const frames=clayRecording.frames;
  const time=Math.min((now-clayRecording.start)/1000,3);
  if (time-frames.at(-1).time>=1/30 || time===3) frames.push({time,amount:clayBend()});
  if (time<3) return;
  const moved=frames.some(frame=>Math.abs(frame.amount-frames[0].amount)>.02);
  if (moved) clayClip=extensionClip(frames);
  clayRecording=null;
  ui('clay-recording-status').textContent=moved
    ? '구부리는 동작을 저장했어요.'
    : '녹화하는 동안 슬라이더를 움직여 주세요.';
  updateAbilities();
  updateMotionButtons();
}

ui('clay-bend').addEventListener('input',()=>{
  if (playingClay) stopPreview();
  clearReactionPreview();
});
ui('record-clay').addEventListener('click',()=>{
  if (clayRecording || ui('rule-part').value!=='extension') return;
  stopPreview();
  clearReactionPreview();
  clayRecording={start:performance.now(),frames:[{time:0,amount:clayBend()}]};
  ui('clay-recording-status').textContent='녹화 중이에요. 슬라이더를 움직여요.';
  updateAbilities();
});
ui('replay-clay').addEventListener('click',()=>{
  clearReactionPreview();
  if (clayClip) preview(clayClip);
});

for (const id of ['rule-trigger','rule-part','rule-action','rule-count']) {
  ui(id).addEventListener('change',()=>{
    clearReactionPreview();
    ui('ability-status').hidden=true;
    updateRuleOptions();
  });
}
ui('rule-preview').addEventListener('click',tryRule);
ui('extension-settings').addEventListener('toggle',()=>{
  if (!ui('extension-settings').open) clearReactionPreview();
});
ui('extension-place').addEventListener('change',event=>{
  avatar.positionExtension(event.target.value);
  if (riggedAvatar) setRiggedAvatar(buildHumanoid(avatar,rigMarkers));
  frameModel(displayAvatar().model);
});
for (const id of ['use-sound','use-movement']) ui(id).addEventListener('change',updateAbilities);
for (const id of ['rule-size','sound-pitch','motion-speed']) {
  ui(id).addEventListener('input',event=>{
    const value=event.target.value;
    ui(id+'-value').value=id==='motion-speed' ? value+'배' : value+' / 5';
  });
}

ui('sound-preview').addEventListener('click',()=>playCreatureSound(ui('ability-status')));
ui('movement-preview').addEventListener('click',()=>{
  clearReactionPreview();
  if (motionClip) preview(motionClip,Number(ui('motion-speed').value));
});

async function updateMarkerPreview() {
  const id=markerId(ui('marker-number').value);
  ui('save-marker-work').disabled=!id;
  ui('print-marker').disabled=!id;
  ui('start-ar').disabled=!renderer||!id;
  ui('marker-sheet').hidden=!id;
  if (!id) return;
  ui('marker-label').textContent='모카가든 '+id.slice(-2);
  try {
    await showMarker(ui('marker-qr'),id);
  } catch {
    ui('print-marker').disabled=true;
    ui('place-status').textContent='QR을 그리지 못했어요. 페이지를 새로고침해 주세요.';
  }
}

ui('marker-number').addEventListener('input',updateMarkerPreview);
ui('print-marker').addEventListener('click',()=>window.print());
ui('save-marker-work').addEventListener('click',()=>{
  const id=markerId(ui('marker-number').value);
  if (id) downloadWork(ui('place-status'),id);
});

let arReturnFocus=null;
async function openMarkerAR(work,id) {
  arReturnFocus=document.activeElement;
  closeCamera();
  stopPreview();
  clearReactionPreview();
  ui('ar-overlay').hidden=false;
  ui('ar-status').textContent='뒤 카메라를 준비하고 있어요.';
  ui('close-ar').focus();
  try {
    await ar.open({work,id});
  } catch(error) {
    if (!ui('ar-overlay').hidden) ui('ar-status').textContent=error.message;
    console.error(error);
  }
}

ui('start-ar').addEventListener('click',()=>{
  const id=markerId(ui('marker-number').value);
  if (!id || !renderer) return;
  openMarkerAR(gardenWork(),id);
});
ui('view-garden').addEventListener('click',()=>{
  if (renderer) openMarkerAR(null,null);
});
ui('ar-work-file').addEventListener('change',async event=>{
  const file=event.target.files[0];
  event.target.value='';
  if (!file) return;
  try {
    await ar.loadFile(file);
  } catch(error) {
    ui('ar-status').textContent=error.message;
  }
});
ar.onFileNeeded=id=>{
  ui('ar-file-label').hidden=!id;
  ui('ar-work-file').hidden=!id;
  ui('ar-file-label').textContent=id?'작품 파일 열기 ('+id+'.glb)':'작품 파일 열기';
};
function closeAR() {
  ar.stop();
  ui('ar-overlay').hidden=true;
  arReturnFocus?.focus();
}
ui('close-ar').addEventListener('click',closeAR);
ui('sound-ar').addEventListener('click',event=>playCreatureSound(ui('ar-status'),Number(event.currentTarget.dataset.pitch)));
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
    previewRule?.clearPose();
    if (motion.active) motion.update(now);
    else mixer?.update(elapsed);
    if (clayRecording) sampleClay(now);
    if (step==='ability') {
      if (!previewRule?.active && !playingClay && ui('rule-part').value==='extension' && ui('extension-settings').open) {
        partReaction(displayAvatar().model,'extension')(clayBend());
      }
      previewRule?.update(elapsed);
    }
    orbit.update();
    if (!rigOverlay.hidden) {
      camera.updateMatrixWorld();
      updateRigMarkers();
    }
    renderer.render(scene,camera);
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
frameModel(avatar.model);
refreshEditor();
updateMotionButtons();
updateAbilities();

