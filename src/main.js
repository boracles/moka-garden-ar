import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {applyBrush,bendableParts,clayPartLabels,createAvatar,extensionClip,palette,partReaction,reflectedBrush,resetPose,restoreBrushAttribute,rigPreview,snapshotModel} from './avatar.js';
import {buildHumanoid,defaultMarkers,markerGroups} from './humanoid.js';
import {MotionCapture} from './motion.js';
import {PartRule,partActions} from './part-rules.js';
import {MarkerAR,classDate,exhibitionWork,markerCount,markerId,publishMarkerWork,registeredMarkerWork,saveMarkerWork,showMarker,workLabel} from './marker-ar.js';
import {clearClayFusion,hasClayFusion,joinClay,showClaySources} from './join-clay.js';
import {createGrab} from './grab-clay.js';

const ui=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const publicMode=params.has('view');
if (publicMode) document.body.classList.add('public-mode');
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const initialDate=classDate(params.get('date'))??today;
for (const id of ['work-date','view-date','print-date']) ui(id).value=initialDate;
const intro = {
  make:'바나바와 친구들이 자리 잡은 공원은 모카가든이에요. 좋아하는 일이나 자주 하는 행동을 떠올려 봐요. 그 모습을 몸의 모양과 움직임으로 만들어 봐요.',
  move:'평소 내 모습을 떠올리며, 만든 몸에 입힐 동작을 3초 동안 녹화해요.',
  ability:'만든 몸의 어느 부분이 언제, 어떻게 움직일지 정해요.',
  place:'모카가든에서 ‘또 다른 나’를 놓을 자리를 골라요.',
};
const labels={make:'형태 편집 중',move:'동작 미리 보기',ability:'기능 미리 보기',place:'또 다른 나'};
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
if (!publicMode) {
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
let tool='sculpt';
const paintColor=new THREE.Color(palette[1][1]);
let motionClip=null;
const clayClips=new Map();
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
const clayFusionJobs=new WeakMap();
const undoStack=[];
let registration=null;
let registering=false;
let workRevision=0;
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
    invalidateRegistration();
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
  const joining=Boolean(clayFusionJobs.get(displayAvatar().model)?.pending);
  ui('open-camera').disabled=!riggedAvatar || joining || openingCamera || Boolean(motion.recording);
  ui('open-camera').textContent=motion.active ? '앞 카메라 끄기' : '앞 카메라 켜기';
  ui('record').disabled=!motion.active || !motion.seesPose || Boolean(motion.recording);
  ui('replay').disabled=!motionClip || openingCamera || Boolean(motion.recording);
  ui('download').disabled=!riggedAvatar || joining || openingCamera || motion.active;
  ui('rig-edit').disabled=openingCamera || Boolean(motion.recording);
  ui('start-ar').disabled=!renderer||!registration;
  ui('view-garden').disabled=!renderer;
}

function stopPreview() {
  mixer?.stopAllAction();
  mixer=null;
  playingClay=false;
  resetPose(displayAvatar());
}

function preview(clip,speed=1,isClay=false) {
  stopPreview();
  playingClay=isClay;
  mixer=new THREE.AnimationMixer(displayAvatar().model);
  const action=mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce,1);
  action.timeScale=speed;
  mixer.addEventListener('finished',stopPreview);
  action.play();
}

function frameModel(model,front=false,rear=false) {
  if (!orbit) return;
  model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) return;
  const center=bounds.getCenter(new THREE.Vector3());
  const size=bounds.getSize(new THREE.Vector3());
  orbit.target.copy(center);
  camera.position.copy(center).add(front?new THREE.Vector3(0,0,6.8):new THREE.Vector3(1.55,.62,rear?-6.8:6.8));
  camera.zoom=Math.min(2.06,(camera.top-camera.bottom)/Math.max(size.y*1.28,1),
    (camera.right-camera.left)/Math.max(size.x*1.36,1));
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  orbit.update();
  camera.updateMatrixWorld();
}

function refreshEditor() {
  ui('undo').disabled=showingExample||!undoStack.length;
  ui('rig-preview').disabled=!avatar.bodyMesh;
  ui('extension-place-setting').hidden=!avatar.parts.has('extension');
  for (const button of document.querySelectorAll('[data-part]')) {
    button.disabled=avatar.parts.has(button.dataset.part);
  }
  if (step==='make') ui('stage-label').textContent=showingExample?'완성 예시':'내 점토 인형';
}

function addClayPart(part) {
  stopPreview();
  if (!avatar.addPart(part)) return;
  rememberEdit({part});
  if (riggedAvatar) setRiggedAvatar(buildHumanoid(avatar,rigMarkers));
  updateClayFusion(avatar.model);
  frameModel(displayAvatar().model,false,part==='tail');
}

function updateClayFusion(model) {
  const request={pending:true};
  clayFusionJobs.set(model,request);
  clearClayFusion(model);
  const status=ui('clay-fusion-status');
  status.hidden=avatar.parts.size===0;
  status.textContent='점토를 부드럽게 잇는 중이에요.';
  updateMotionButtons();
  const isCurrent=()=>clayFusionJobs.get(model)===request;
  request.ready=joinClay(model,isCurrent).then(()=>{
    if (isCurrent() && model===displayAvatar().model) status.hidden=true;
  }).catch(error=>{
    if (!isCurrent()) return;
    if (model===displayAvatar().model) status.textContent='점토를 잇지 못했어요. 빚기를 계속할 수 있어요.';
    console.error(error);
  }).finally(()=>{
    request.pending=false;
    if (isCurrent()) updateMotionButtons();
  });
}

function waitForClayFusion() {
  return clayFusionJobs.get(displayAvatar().model)?.ready;
}

function displayRig() {
  const active=step==='move';
  const ready=Boolean(avatar.bodyMesh && renderer);
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
  }
  if (previous) {
    clayFusionJobs.delete(previous.model);
    previous.dispose();
  }
  if (next) updateClayFusion(next.model);
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
    invalidateRegistration();
    ui('motion-status').textContent='뼈대가 연결됐어요. 앞 카메라를 켜서 함께 움직여 봐요.';
    waitForClayFusion()?.then(()=>{
      if (step==='move' && riggedAvatar && !ui('open-camera').disabled) ui('open-camera').focus();
    });
  } catch(error) {
    ui('rig-status').textContent=error.message;
  }
});

ui('rig-edit').addEventListener('click',()=>{
  invalidateRegistration();
  closeCamera();
  motionClip=null;
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
    clip:action==='recorded'?clayClips.get(part):null,
  };
}

function clearReactionPreview() {
  previewRule?.stop();
  previewRule=null;
  for (const part of bendableParts) partReaction(displayAvatar().model,part)(0);
}

function setChoices(select,choices,placeholder) {
  const selected=select.value;
  select.replaceChildren(new Option(placeholder,''),...choices.map(([value,label])=>new Option(label,value)));
  if (choices.some(([value])=>value===selected)) select.value=selected;
}

function updateRuleOptions() {
  const parts=Object.entries(clayPartLabels).filter(([part])=>{
    if (part==='hands') return Boolean(riggedAvatar);
    if (part==='feet') return Boolean(riggedAvatar) && avatar.parts.has('feet');
    return avatar.parts.has(part);
  });
  parts.push(['head','머리']);
  setChoices(ui('rule-part'),parts,'고르기');
  const part=ui('rule-part').value;
  const bendable=bendableParts.includes(part);
  const clayClip=clayClips.get(part);
  const actions=(partActions[part]??[]).filter(([value])=>value!=='recorded'||clayClip);
  setChoices(ui('rule-action'),actions,'고르기');
  const isRecording=Boolean(clayRecording);
  ui('rule-options').hidden=!selectedRule();
  ui('rule-size-options').hidden=ui('rule-action').value==='recorded';
  ui('extension-settings').hidden=!bendable;
  if (bendable) ui('clay-recording-title').textContent=clayPartLabels[part]+' 움직임 직접 녹화하기';
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
  ui('movement-help').hidden=Boolean(motionClip);
  ui('movement-options').hidden=!motionClip;
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
  ui('mirror-cursor').hidden=true;
  for (const button of document.querySelectorAll('[data-tool]')) button.disabled=visible;
  if (visible) {
    example??=createAvatar({example:true});
    scene.remove(avatar.model);
    scene.add(example.model);
  } else {
    scene.remove(example.model);
    scene.add(avatar.model);
  }
  if (orbit) orbit.enabled=visible;
  ui('viewport').classList.toggle('orbit-mode',visible);
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
  ui('clay-fusion-status').hidden=!clayFusionJobs.get(nextModel)?.pending;
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
  ui('mirror-cursor').hidden=true;
  ui('workspace').classList.toggle('sculpt-mode',value==='make');
  ui('workspace').classList.toggle('ability-mode',value==='ability');
  if (orbit) orbit.enabled=step!=='make';
  ui('viewport').classList.toggle('orbit-mode',value!=='make');
  if (step==='place') {
    updateMarkerNumber();
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

function updateBrushHint() {
  const hints={
    sculpt:ui('sculpt-direction-in').checked?'표면을 문질러 오목하게':'표면을 문질러 볼록하게',
    grab:'점토를 잡고 끄는 방향으로 늘리기',
    smooth:'표면을 문질러 매끈하게',
    paint:'표면에 고른 색 칠하기',
  };
  ui('stage-hint').textContent=hints[tool]+' · 빈 곳은 끌어서 돌리기';
}

function selectTool(value) {
  tool=value;
  stopPreview();
  ui('brush-shape').hidden=tool!=='sculpt';
  updateBrushHint();
  ui('brush-cursor').hidden=true;
  ui('mirror-cursor').hidden=true;
  for (const item of document.querySelectorAll('[data-tool]')) {
    item.setAttribute('aria-pressed',String(item.dataset.tool===tool));
  }
}

function rememberEdit(edit) {
  invalidateRegistration();
  undoStack.push(edit);
  if (undoStack.length>25) undoStack.shift();
  refreshEditor();
}

for (const button of document.querySelectorAll('[data-tool]')) {
  button.addEventListener('click',()=>selectTool(button.dataset.tool));
}
ui('brush-shape').addEventListener('change',updateBrushHint);

for (const button of document.querySelectorAll('[data-part]')) {
  button.addEventListener('click',()=>addClayPart(button.dataset.part));
}

ui('show-example').addEventListener('click',()=>setExample(!showingExample));

const customColor=ui('custom-color');
customColor.value=palette[1][1];
function choosePaint(color,button) {
  paintColor.set(color);
  selectTool('paint');
  for (const item of ui('colors').children) item.setAttribute('aria-pressed',String(item===button));
}
customColor.addEventListener('input',()=>choosePaint(customColor.value));

for (const [name,color] of palette) {
  const button=document.createElement('button');
  button.type='button';
  button.className='color';
  button.title=name;
  button.style.setProperty('--swatch',color);
  button.setAttribute('aria-label',name);
  button.setAttribute('aria-pressed',String(color===palette[1][1]));
  button.addEventListener('click',()=>{
    customColor.value=color;
    choosePaint(color,button);
  });
  ui('colors').append(button);
}

if (renderer) {
  const canvas=renderer.domElement;
  const raycaster=new THREE.Raycaster();
  const cursor=ui('brush-cursor');
  const mirrorCursor=ui('mirror-cursor');
  const symmetry=ui('brush-symmetry');
  function radius() {
    const size=Number(ui('brush-size').value);
    if (tool==='paint') return .045+(size-1)*.0255;
    return (.065+size*.021)*(tool==='grab'?1.7:1);
  }
  function pointRay(event) {
    const bounds=canvas.getBoundingClientRect();
    const p=new THREE.Vector2((event.clientX-bounds.left)/bounds.width*2-1,1-(event.clientY-bounds.top)/bounds.height*2);
    raycaster.setFromCamera(p,camera);
    return raycaster.ray;
  }
  function intersect(event) {
    pointRay(event);
    return raycaster.intersectObjects(avatar.surfaces,false)[0];
  }
  function brushHits(hit) {
    if (!hit) return [];
    const reflected=(brush?.symmetry??symmetry.checked)?reflectedBrush(avatar,hit):null;
    return reflected?[hit,reflected]:[hit];
  }
  function makeMark(hits,distance) {
    for (const {object:mesh} of hits) {
      if (!brush.changes.has(mesh)) {
        brush.changes.set(mesh,mesh.geometry.getAttribute(brush.attribute).array.slice());
      }
    }
    applyBrush(hits,brush.tool,brush.radius,distance,brush.color,brush.strength);
  }
  function positionCursors(hits) {
    const rect=canvas.getBoundingClientRect();
    const size=(brush?.radius??radius())*2*camera.zoom*rect.height/(camera.top-camera.bottom);
    for (const [index,indicator] of [cursor,mirrorCursor].entries()) {
      const hit=hits[index];
      indicator.hidden=!hit || (index===1 && hit.point.distanceToSquared(hits[0].point)<.000025);
      if (indicator.hidden) continue;
      const point=hit.point.clone().project(camera);
      indicator.style.left=(point.x+1)*rect.width/2+'px';
      indicator.style.top=(1-point.y)*rect.height/2+'px';
      indicator.style.width=indicator.style.height=size+'px';
    }
  }
  symmetry.addEventListener('change',()=>positionCursors([]));
  canvas.addEventListener('pointerdown',event=>{
    if (step!=='make'||showingExample||brush||transientOrbit!==null||event.button>0) return;
    stopPreview();
    const hit=intersect(event);
    if (!hit) {
      transientOrbit=event.pointerId;
      orbit.enabled=true;
      positionCursors([]);
      return;
    }
    clayFusionJobs.delete(avatar.model);
    showClaySources(avatar.model,true);
    canvas.setPointerCapture(event.pointerId);
    brush={
      id:event.pointerId,x:event.clientX,y:event.clientY,changes:new Map(),
      tool:tool==='sculpt'?ui('sculpt-direction-in').checked?'push':'pull':tool,
      attribute:tool==='paint'?'color':'position',
      symmetry:symmetry.checked,
      radius:radius(),
      color:paintColor.clone(),
      strength:.26+Number(ui('brush-strength').value)*.124,
    };
    const hits=brushHits(hit);
    positionCursors(hits);
    if (tool==='grab') {
      const normal=camera.getWorldDirection(new THREE.Vector3());
      const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,hit.point);
      const grab=createGrab(avatar,hits,brush.radius,brush.strength);
      brush.grab={plane,origin:hit.point.clone(),...grab};
      brush.changes=grab.changes;
      canvas.classList.add('grabbing-clay');
    }
    if (tool==='paint') makeMark(hits,1);
  },true);
  canvas.addEventListener('pointermove',event=>{
    if (step!=='make'||showingExample||transientOrbit!==null) return;
    if (brush?.grab) {
      if (event.pointerId!==brush.id) return;
      if (Math.hypot(event.clientX-brush.x,event.clientY-brush.y)<2 && !brush.changes.size) return;
      const point=pointRay(event).intersectPlane(brush.grab.plane,new THREE.Vector3());
      if (point) brush.grab.move(point.sub(brush.grab.origin));
      positionCursors([]);
      return;
    }
    const hits=brushHits(intersect(event));
    positionCursors(hits);
    if (event.pointerId!==brush?.id) return;
    const distance=Math.hypot(event.clientX-brush.x,event.clientY-brush.y);
    if (distance<(brush.tool==='paint'?2:4)) return;
    brush.x=event.clientX;
    brush.y=event.clientY;
    if (!hits.length) return;
    makeMark(hits,distance);
  });
  function finishBrush(event) {
    if (transientOrbit===event.pointerId) {
      transientOrbit=null;
      orbit.enabled=showingExample||step!=='make';
    }
    if (event.pointerId!==brush?.id) return;
    if (event.type==='pointerup' && brush.grab && brush.changes.size) {
      const point=pointRay(event).intersectPlane(brush.grab.plane,new THREE.Vector3());
      if (point) brush.grab.move(point.sub(brush.grab.origin));
    }
    brush.grab?.finish();
    canvas.classList.remove('grabbing-clay');
    const changed=brush.changes.size>0;
    if (changed) {
      rememberEdit({attribute:brush.attribute,changes:brush.changes});
      invalidateBodyRig();
    }
    if (changed || !hasClayFusion(avatar.model)) updateClayFusion(avatar.model);
    else showClaySources(avatar.model,false);
    brush=null;
    if (event.pointerType==='touch') positionCursors([]);
  }
  for (const name of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(name,finishBrush);
  canvas.addEventListener('pointerleave',()=>positionCursors([]));
}

ui('undo').addEventListener('click',()=>{
  const last=undoStack.pop();
  if (!last) return;
  invalidateRegistration();
  if (last.part) {
    stopPreview();
    avatar.removePart(last.part);
    if (riggedAvatar) setRiggedAvatar(buildHumanoid(avatar,rigMarkers));
    clayClips.delete(last.part);
    updateAbilities();
    frameModel(avatar.model);
  } else {
    for (const [mesh,values] of last.changes) restoreBrushAttribute(mesh,last.attribute,values);
    invalidateBodyRig();
  }
  updateClayFusion(avatar.model);
  refreshEditor();
});

ui('rig-preview').addEventListener('click',()=>preview(rigPreview(avatar)));
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
  const animations=[motionClip,...clayClips.values()].filter(Boolean);
  const settings={
    motion:motionClip?.name??null,
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

async function downloadWork(status) {
  try {
    await waitForClayFusion();
    const {model,animations}=gardenWork();
    if (!riggedAvatar && !animations.length) return;
    const glb=await new GLTFExporter().parseAsync(model,{binary:true,animations});
    const file=new Blob([glb],{type:'model/gltf-binary'});
    const url=URL.createObjectURL(file);
    const link=document.createElement('a');
    link.href=url;
    link.download='moka-garden-creature.glb';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
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
  const {part}=clayRecording;
  if (moved) {
    clayClips.set(part,extensionClip(frames,part));
    invalidateRegistration();
  }
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
  const part=ui('rule-part').value;
  if (clayRecording || !bendableParts.includes(part)) return;
  stopPreview();
  clearReactionPreview();
  clayRecording={part,start:performance.now(),frames:[{time:0,amount:clayBend()}]};
  ui('clay-recording-status').textContent='녹화 중이에요. 슬라이더를 움직여요.';
  updateAbilities();
});
ui('replay-clay').addEventListener('click',()=>{
  clearReactionPreview();
  const clayClip=clayClips.get(ui('rule-part').value);
  if (clayClip) preview(clayClip,1,true);
});

for (const id of ['rule-trigger','rule-part','rule-action','rule-count']) {
  ui(id).addEventListener('change',()=>{
    if (id==='rule-part') {
      stopPreview();
      ui('clay-bend').value='0';
      ui('clay-recording-status').textContent=clayClips.has(ui(id).value)
        ? '저장한 동작이 있어요.' : '녹화를 누르고 슬라이더를 움직여요.';
    }
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
  invalidateRegistration();
  avatar.positionExtension(event.target.value);
  if (riggedAvatar) setRiggedAvatar(buildHumanoid(avatar,rigMarkers));
  updateClayFusion(avatar.model);
  frameModel(displayAvatar().model);
});
ui('use-sound').addEventListener('change',updateAbilities);
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

function updateMarkerNumber() {
  const input=ui('marker-number');
  const id=markerId(input.value);
  const date=classDate(ui('work-date').value);
  ui('save-marker-work').disabled=!id||!date||registering||Boolean(registration);
  updateMotionButtons();
  input.setAttribute('aria-invalid',String(Boolean(input.value && !id)));
  ui('marker-number-help').textContent=id&&date
    ? workLabel(date,id)+' QR에 연결해요.'
    : '01번부터 10번까지 입력할 수 있어요.';
  return id;
}

function invalidateRegistration() {
  workRevision++;
  if (!registration) return;
  URL.revokeObjectURL(registration.url);
  registration=null;
  ui('registered-marker').hidden=true;
  ui('registered-marker-image').replaceChildren();
  ui('download-marker-work').removeAttribute('href');
  ui('place-status').textContent='작품이 바뀌었어요. 다시 등록하고 QR을 테스트해 주세요.';
  updateMarkerNumber();
}

for (const id of ['marker-number','work-date','place-note','rule-trigger','rule-part','rule-action',
  'rule-count','rule-size','use-sound','sound-pitch','motion-speed']) {
  ui(id).addEventListener('input',()=>{
    invalidateRegistration();
    if (id==='marker-number'||id==='work-date') updateMarkerNumber();
  });
}
ui('marker-number').addEventListener('blur',event=>{
  const id=markerId(event.currentTarget.value);
  if (id) event.currentTarget.value=id.slice(-2);
});

const printDialog=ui('marker-print');
let printRequest=0;
async function renderPrintMarkers() {
  const request=++printRequest;
  const date=classDate(ui('print-date').value);
  const grid=ui('marker-print-grid');
  grid.replaceChildren();
  ui('print-markers').disabled=true;
  ui('marker-print-date').textContent=date??'';
  const status=ui('marker-print-status');
  status.hidden=false;
  if (!date) {
    status.textContent='수업 날짜를 선택해 주세요.';
    return;
  }
  const cards=Array.from({length:markerCount},(_,index)=>{
    const id=markerId(index+1);
    const number=id.slice(-2);
    const card=document.createElement('div');
    card.className='marker-print-card';
    const canvas=document.createElement('canvas');
    canvas.setAttribute('aria-label',number+'번 QR');
    const label=document.createElement('strong');
    label.textContent=number;
    card.append(canvas,label);
    return {id,card,canvas};
  });
  status.textContent='인쇄용 QR을 준비하고 있어요.';
  try {
    await Promise.all(cards.map(({id,canvas})=>showMarker(canvas,date,id)));
    if (request!==printRequest) return;
    grid.replaceChildren(...cards.map(({card})=>card));
    status.hidden=true;
    ui('print-markers').disabled=false;
  } catch {
    if (request!==printRequest) return;
    status.textContent='QR을 그리지 못했어요. 닫고 다시 열어 주세요.';
  }
}

function openMarkerPrint() {
  printDialog.showModal();
  renderPrintMarkers();
}

ui('open-marker-print').addEventListener('click',event=>{
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openMarkerPrint();
});
ui('print-markers').addEventListener('click',()=>window.print());
ui('close-marker-print').addEventListener('click',()=>printDialog.close());
ui('print-date').addEventListener('input',renderPrintMarkers);

ui('save-marker-work').addEventListener('click',async()=>{
  const id=markerId(ui('marker-number').value);
  const date=classDate(ui('work-date').value);
  if (!id || !date || registering || registration) return;
  const revision=workRevision;
  const status=ui('place-status');
  if (!motionClip || !selectedRule()) {
    status.textContent=!motionClip
      ? '동작 녹화에서 전신 동작을 녹화한 뒤 등록해 주세요.'
      : '기능 붙이기에서 언제, 어느 부위가, 어떻게 움직일지 고른 뒤 등록해 주세요.';
    return;
  }
  registering=true;
  updateMarkerNumber();
  status.textContent='작품을 등록하고 있어요.';
  try {
    await waitForClayFusion();
    if (revision!==workRevision || step!=='place') return;
    const {model,animations}=gardenWork();
    model.userData.gardenMarker=id;
    model.userData.gardenDate=date;
    const canvas=document.createElement('canvas');
    const [glb]=await Promise.all([
      new GLTFExporter().parseAsync(model,{binary:true,animations}),
      showMarker(canvas,date,id),
    ]);
    if (revision!==workRevision || step!=='place') return;
    await saveMarkerWork(date,id,new Blob([glb],{type:'model/gltf-binary'}));
    const {file,work}=await registeredMarkerWork(date,id);
    if (revision!==workRevision || step!=='place') return;
    const url=URL.createObjectURL(file);
    registration={id,date,file,work,url,published:false};
    const label=workLabel(date,id);
    canvas.setAttribute('aria-label',label+' 작품 QR');
    ui('registered-marker-label').textContent=label+' 작품 QR';
    ui('registered-marker-image').replaceChildren(canvas);
    const download=ui('download-marker-work');
    download.href=url;
    download.download=date+'-'+id+'.glb';
    ui('registered-marker').hidden=false;
    ui('start-ar').textContent='QR 테스트하기';
    status.textContent='작품을 등록했어요. QR에서 전신 동작과 추가한 반응을 확인해 주세요.';
  } catch(error) {
    status.textContent='작품을 등록하지 못했어요. 다시 눌러 주세요.';
    console.error(error);
  } finally {
    registering=false;
    if (!registration && status.textContent==='작품을 등록하고 있어요.') status.textContent='작품을 다시 등록해 주세요.';
    updateMarkerNumber();
  }
});

let arReturnFocus=null;
async function openMarkerAR(work,id,date,{publicView=false,onTestProgress}={}) {
  arReturnFocus=document.activeElement;
  closeCamera();
  stopPreview();
  clearReactionPreview();
  ui('ar-overlay').hidden=false;
  ui('finish-ar-test').hidden=true;
  ui('ar-test-checks').hidden=true;
  ui('ar-publication-status').hidden=true;
  ui('ar-status').textContent='뒤 카메라를 준비하고 있어요.';
  ui('close-ar').focus();
  try {
    await ar.open({work,id,date,publicView,onTestProgress});
  } catch(error) {
    if (!ui('ar-overlay').hidden) ui('ar-status').textContent=error.message;
    console.error(error);
  }
}

ui('start-ar').addEventListener('click',()=>{
  const current=registration;
  if (!current || !renderer) return;
  const {id,date,work}=current;
  openMarkerAR({...work,model:snapshotModel({model:work.model,rest:{}})},id,date,{
    onTestProgress:({motion,rule})=>{
      if (current!==registration) return;
      ui('ar-test-checks').hidden=false;
      ui('ar-test-motion').textContent=motion?'✓ 녹화한 전신 동작 확인':'녹화한 전신 동작 재생 대기';
      ui('ar-test-rule').textContent=rule?'✓ 추가한 반응 확인'
        :work.settings.rule?.trigger==='tap'?'캐릭터를 터치해 반응 확인':'표식에서 나타날 때 반응 확인';
      if (!motion || !rule) return;
      ui('finish-ar-test').hidden=false;
      ui('finish-ar-test').textContent=current.published?'돌아가기':'작품 확정';
      if (!current.published) ui('place-status').textContent='QR 테스트를 마쳤어요. 작품을 확정하면 관객도 볼 수 있어요.';
      ui('start-ar').textContent='QR 다시 테스트하기';
    },
  });
});
ui('view-garden').addEventListener('click',()=>{
  if (renderer) ui('garden-date').showModal();
});
ui('close-garden-date').addEventListener('click',()=>ui('garden-date').close());
ui('garden-date-form').addEventListener('submit',event=>{
  event.preventDefault();
  const date=classDate(ui('view-date').value);
  if (!date) return;
  ui('garden-date').close();
  openMarkerAR(null,null,date);
});

async function openPublicViewer() {
  ui('public-viewer').hidden=false;
  ui('close-ar').textContent='카메라 닫기';
  const status=ui('public-viewer-status');
  const id=markerId(params.get('view'));
  const date=classDate(params.get('date'));
  if (!id || !date) {
    status.textContent='가든의 QR을 다시 찍어 주세요.';
    return;
  }
  status.textContent='작품을 찾고 있어요.';
  const work=await exhibitionWork(date,id).catch(()=>null);
  if (!work) {
    status.textContent='아직 이 QR에 공개된 작품이 없어요.';
    return;
  }
  if (work.model.userData.gardenDemo) ui('public-viewer-title').textContent='가든 테스트 작품';
  status.textContent='카메라를 켜고 같은 QR을 다시 비춰 주세요.';
  const button=ui('public-start');
  button.hidden=false;
  button.addEventListener('click',()=>openMarkerAR({
    ...work,model:snapshotModel({model:work.model,rest:{}}),
  },id,date,{publicView:true}));
}
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
  if (ui('finish-ar-test').disabled) return;
  ar.stop();
  ui('ar-overlay').hidden=true;
  ui('finish-ar-test').hidden=true;
  arReturnFocus?.focus();
}
ui('close-ar').addEventListener('click',closeAR);
ui('finish-ar-test').addEventListener('click',async event=>{
  const finish=event.currentTarget;
  const current=registration;
  if (!current || finish.disabled || finish.hidden) return;
  if (current.published) return closeAR();
  const status=ui('ar-publication-status');
  status.hidden=true;
  finish.disabled=true;
  ui('close-ar').disabled=true;
  finish.textContent='작품을 공개하고 있어요';
  try {
    await publishMarkerWork(current.date,current.id,current.file);
    current.published=true;
    ui('place-status').textContent='완료 · 관객도 같은 QR로 내 작품을 볼 수 있어요.';
  } catch(error) {
    status.textContent=error.message;
    status.hidden=false;
  } finally {
    finish.disabled=false;
    ui('close-ar').disabled=false;
    finish.textContent='작품 확정';
  }
  if (current.published) closeAR();
});
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
      const part=ui('rule-part').value;
      if (!previewRule?.active && !playingClay && bendableParts.includes(part) && ui('extension-settings').open) {
        partReaction(displayAvatar().model,part)(clayBend());
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
frameModel(avatar.model,true);
refreshEditor();
updateMotionButtons();
updateAbilities();
if (publicMode) openPublicViewer();
else if (params.get('qr')==='1') openMarkerPrint();

