import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {bindClayBody,clayBodyGeometry} from './clay-body.js';

export const palette = [
  ['도자기색', '#e6ddc9'],
  ['황토 금색', '#c48b37'],
  ['짙은 녹색', '#34574c'],
  ['붉은 흙', '#a34f3d'],
  ['먹색', '#282e31'],
  ['회청색', '#77929a'],
  ['분홍', '#ee8b9e'],
  ['빨강', '#da4c42'],
  ['주황', '#ed8339'],
  ['노랑', '#f3d54a'],
  ['연두', '#99be52'],
  ['초록', '#479355'],
  ['민트', '#6ad0ba'],
  ['하늘', '#62b8ed'],
  ['파랑', '#456ac8'],
  ['보라', '#9470be'],
  ['갈색', '#805643'],
  ['흰색', '#fff8ea'],
  ['연보라', '#c9b6f2'],
  ['라벤더', '#7b6cf6'],
  ['자홍', '#d94fa6'],
  ['복숭아', '#ffb38a'],
  ['레몬', '#fff27a'],
  ['청록', '#1fa3a3'],
];

export const finishes={
  clay:{label:'도자기',roughness:.48,clearcoat:0,clearcoatRoughness:0,iridescence:0,sheen:0},
  glossy:{label:'반들반들',roughness:.2,clearcoat:1,clearcoatRoughness:.06,iridescence:0,sheen:0},
  pearl:{label:'무지개 펄',roughness:.28,clearcoat:.85,clearcoatRoughness:.1,iridescence:1,sheen:0},
  velvet:{label:'보송보송',roughness:.9,clearcoat:0,clearcoatRoughness:0,iridescence:0,sheen:1},
  dreamy:{label:'몽글몽글',roughness:1,clearcoat:0,clearcoatRoughness:0,iridescence:0,sheen:.5,dreamy:1},
};

// Soft pastel look: flatter light, edges that fade into the background, and a fine grain.
function installDreamy(material,amount) {
  material.onBeforeCompile=shader=>{
    shader.uniforms.uDreamy=amount;
    shader.fragmentShader='uniform float uDreamy;\n'+shader.fragmentShader.replace('#include <opaque_fragment>',`#include <opaque_fragment>
      float dreamyFacing=saturate(abs(dot(normalize(normal),geometryViewDir)));
      float dreamySoft=smoothstep(.03,.78,dreamyFacing);
      gl_FragColor.rgb=mix(gl_FragColor.rgb,diffuseColor.rgb*1.12,.55*uDreamy);
      gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(1.),(1.-dreamySoft)*.38*uDreamy);
      gl_FragColor.a*=mix(1.,dreamySoft,uDreamy);
      float dreamyGrain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
      gl_FragColor.rgb+=(dreamyGrain-.5)*.08*uDreamy;`);
  };
  material.customProgramCacheKey=()=>'dreamy';
}

export function makeDreamy(material) {
  installDreamy(material,{value:1});
  Object.assign(material,{roughness:1,transparent:true});
  material.needsUpdate=true;
}

const ceramic = new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.48,
  iridescenceIOR:1.55,iridescenceThicknessRange:[180,720],sheenColor:new THREE.Color('#ffffff'),sheenRoughness:.45});
const dreamyAmount={value:0};
installDreamy(ceramic,dreamyAmount);

export function setFinish(name) {
  const {label,dreamy=0,...values}=finishes[name]??finishes.clay;
  Object.assign(ceramic,values);
  dreamyAmount.value=dreamy;
  ceramic.transparent=dreamy>0;
  ceramic.userData.finish=finishes[name]?name:'clay';
  ceramic.needsUpdate=true;
}
const brass = new THREE.MeshStandardMaterial({vertexColors:true,roughness:.34,metalness:.28});
const neighbors = new WeakMap();

const stone = '#e4ded1';
const slate = '#365052';
const gold = '#bc873e';
const earSpread=.68;
const extensionJoints=['ClayBase','ClayMiddle','ClayTip'];
const bendAngles=[.10,.66,.92];
export const bendableParts=['nose','tail','extension'];
export const clayPartLabels={ears:'귀',nose:'코',tail:'꼬리',hands:'손',feet:'발',extension:'자유 점토'};
const bendJoints=part=>part==='extension'?extensionJoints:extensionJoints.map(name=>part+'_'+name);
export const clayAttachments={
  HeadClay:'Head',EarL:'Head',EarR:'Head',NosePivot:'Head',TailPivot:'Pelvis',
  HandClayL:'HandL',HandClayR:'HandR',FootClayL:'FootL',FootClayR:'FootR',
};

function listeningEars(model) {
  const left=model.getObjectByName('EarL');
  const right=model.getObjectByName('EarR');
  return amount=>{
    const spread=earSpread*(1-amount);
    left.rotation.z=-spread;
    right.rotation.z=spread;
  };
}

export function partReaction(model,part) {
  if (part==='ears') return listeningEars(model);
  const bones=bendJoints(part).map(name=>model.getObjectByName(name));
  return amount=>{
    bones.forEach((bone,index)=>{if (bone) bone.rotation.z=bendAngles[index]*amount;});
  };
}

export function extensionClip(samples,part='extension') {
  const times=samples.map(sample=>sample.time);
  const axis=new THREE.Vector3(0,0,1);
  const rotation=new THREE.Quaternion();
  const tracks=bendJoints(part).map((name,index)=>{
    const values=samples.flatMap(({amount})=>rotation.setFromAxisAngle(axis,bendAngles[index]*amount).toArray());
    return new THREE.QuaternionKeyframeTrack(name+'.quaternion',times,values);
  });
  return new THREE.AnimationClip(part==='extension'?'Moving clay':clayPartLabels[part]+' 움직임',times.at(-1),tracks);
}

function tint(geometry,color) {
  const count=geometry.getAttribute('position').count;
  const paint=new THREE.Color(color);
  const colors=new Float32Array(count*3);
  for (let i=0;i<count;i++) paint.toArray(colors,i*3);
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
}

function volume(x,y,z) {
  return new THREE.SphereGeometry(1,48,40).scale(x,y,z);
}

function fanEarGeometry(side) {
  const geometry=volume(1,1,1);
  const positions=geometry.getAttribute('position');
  for (let index=0;index<positions.count;index++) {
    const x=positions.getX(index);
    const y=positions.getY(index);
    const z=positions.getZ(index);
    const progress=(y+1)*.5;
    const across=x*(.078+.31*progress);
    const angle=Math.atan2(across,.085+.48*progress);
    const fold=Math.cos(angle*24);
    const rim=.024*progress*progress*fold;
    const depth=z*(.073+.014*progress)+.031*progress*progress+.027*z*z*progress*fold;
    positions.setXYZ(index,side*across,.48*progress-.07+rim,depth);
  }
  if (side<0) {
    const indices=geometry.index.array;
    for (let i=0;i<indices.length;i+=3) {
      [indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    }
  }
  geometry.rotateZ(-side*.76);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function shapedEar(side,map,turn) {
  const geometry=volume(1,1,1);
  const positions=geometry.getAttribute('position');
  for (let index=0;index<positions.count;index++) {
    const [x,y,z]=map(positions.getX(index),positions.getY(index),positions.getZ(index),(positions.getY(index)+1)*.5);
    positions.setXYZ(index,side*x,y,z);
  }
  if (side<0) {
    const indices=geometry.index.array;
    for (let i=0;i<indices.length;i+=3) [indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  }
  geometry.rotateZ(-side*turn);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export const earShapes={fan:'부채 귀',long:'긴 토끼 귀',pointy:'뾰족 고양이 귀',round:'동그란 곰 귀',droopy:'축 늘어진 강아지 귀',wing:'날개 귀',bud:'꽃봉오리 귀',antenna:'동글 더듬이',horn:'뿔'};

function earGeometry(shape,side) {
  switch (shape) {
    case 'wing': return shapedEar(side,(x,y,z,p)=>{
      const tips=.75+.25*Math.cos(p*Math.PI*5);
      return [x*(.18-.09*p)*tips+.24*p,.46*p-.03,z*.055];
    },-.48);
    case 'bud': return shapedEar(side,(x,y,z,p)=>{
      const width=.19*Math.sin(Math.PI*p)**.65+.018;
      return [x*width-.12*p,.45*p-.04,z*.072];
    },-.12);
    case 'antenna': return shapedEar(side,(x,y,z,p)=>{
      // A thin stalk that swells into a round bead at the tip.
      const bead=Math.sqrt(Math.max(0,1-((p-.82)/.18)**2));
      const width=p<.64?.022:Math.max(.022,.072*bead);
      return [x*width+.07*p*p,.5*p-.04,z*width];
    },-.18);
    case 'horn': return shapedEar(side,(x,y,z,p)=>{
      const width=.082*(1-p)**1.1+.01;
      return [x*width+.1*p*p,.4*p-.03,z*width];
    },-.05);
    case 'long': return shapedEar(side,(x,y,z,p)=>{
      const width=.048+.07*Math.sin(Math.PI*Math.pow(p,.8));
      return [x*width,.64*p-.06,z*.048+.022*(1-x*x)*p];
    },-.45);
    case 'pointy': return shapedEar(side,(x,y,z,p)=>{
      const width=.22*(1-p)+.016;
      return [x*width,.44*p-.06,z*(.075*(1-p)+.022)+.02*p];
    },-.22);
    case 'round': return shapedEar(side,(x,y,z)=>[x*.19,y*.19+.15,z*.06],-.25);
    case 'droopy': return shapedEar(side,(x,y,z,p)=>{
      const width=.065+.07*Math.sin(Math.PI*p);
      return [x*width+.1+.12*p,-.6*p+.12,z*.05+.05*p];
    },-.95);
    default: return fanEarGeometry(side);
  }
}

const wave=(a,count,phase=Math.PI/2)=>.5+.5*Math.cos(count*(a-phase));

const heartOutline=(()=>{
  const bins=720;
  const table=new Float32Array(bins);
  const bin=a=>Math.floor(((a/(2*Math.PI))%1+1)%1*bins)%bins;
  for (let i=0;i<20000;i++) {
    const t=i/20000*Math.PI*2;
    const x=16*Math.sin(t)**3/16.5;
    const y=(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t)+3)/16.5;
    const index=bin(Math.atan2(y,x));
    table[index]=Math.max(table[index],Math.hypot(x,y));
  }
  for (let i=0;i<bins;i++) if (!table[i]) table[i]=table[(i+bins-1)%bins];
  return a=>table[bin(a)];
})();

const outlines={
  flower:a=>.4+.6*Math.abs(Math.cos(2.5*(a-Math.PI/2)))**.45,
  daisy:a=>.5+.5*Math.abs(Math.cos(4*(a-Math.PI/2)))**.45,
  star:a=>.56+.44*wave(a,5)**1.5,
  cloud:a=>.8+.2*wave(a,7)**.4,
  sun:a=>.7+.3*wave(a,12)**2.5,
  heart:heartOutline,
  dot:()=>1,
  bow:a=>.34+.66*Math.abs(Math.cos(a))**1.6,
};

// A sphere whose poles face forward is pressed into a thick tile with the given outline.
function pillowGeometry(outline,{radius=1,thickness=.2,stretch=[1,1],segments=128}={}) {
  const geometry=new THREE.SphereGeometry(1,segments,Math.round(segments/2.4)).rotateX(Math.PI/2);
  const positions=geometry.getAttribute('position');
  for (let i=0;i<positions.count;i++) {
    const x=positions.getX(i);
    const y=positions.getY(i);
    const z=positions.getZ(i);
    const angle=Math.atan2(y,x);
    const reach=outline(angle)*radius*Math.hypot(x,y);
    positions.setXYZ(i,Math.cos(angle)*reach*stretch[0],Math.sin(angle)*reach*stretch[1],Math.sign(z)*thickness*Math.abs(z)**.6);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function moonGeometry(radius,thickness) {
  const geometry=new THREE.SphereGeometry(1,48,112);
  const positions=geometry.getAttribute('position');
  for (let i=0;i<positions.count;i++) {
    const x=positions.getX(i);
    const y=positions.getY(i);
    const z=positions.getZ(i);
    const p=(y+1)/2;
    const angle=Math.PI+(p-.5)*4.5;
    const width=.3*Math.sin(Math.PI*p)**.8+.025;
    const reach=(.62+x*width)*radius;
    const depth=Math.sign(z)*thickness*Math.abs(z)**.6*(width/.325)**.45;
    positions.setXYZ(i,Math.cos(angle)*reach+.24*radius,Math.sin(angle)*reach,depth);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export const headShapes={flower:'다섯 꽃잎',daisy:'여덟 꽃잎',star:'별',cloud:'구름',sun:'해',moon:'달',heart:'하트'};

function headShapeGeometry(shape) {
  if (shape==='moon') return moonGeometry(.64,.27);
  return pillowGeometry(outlines[shape]??outlines.flower,{
    radius:{star:.7,cloud:.62,heart:.62}[shape]??.6,
    thickness:.3,
    stretch:shape==='cloud'?[1.4,.86]:[1,1],
  });
}

export const decorShapes={star:'별',flower:'꽃',heart:'하트',dot:'동그라미',bow:'리본'};

function decorGeometry(shape,size) {
  return pillowGeometry(outlines[shape]??outlines.star,{
    radius:(shape==='bow'?.1:.075)*size,
    thickness:.028*size,
    stretch:shape==='bow'?[1,.75]:[1,1],
    segments:56,
  });
}

function writeSkin(geometry,weightsForHeight) {
  const position=geometry.getAttribute('position');
  const weights=new Float32Array(position.count*4);
  const indices=new Uint16Array(position.count*4);
  for (let i=0;i<position.count;i++) {
    for (const [joint,weight] of weightsForHeight(position.getY(i)).entries()) {
      indices[i*4+joint]=joint;
      weights[i*4+joint]=weight;
    }
  }
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
  geometry.setAttribute('skinWeight',new THREE.BufferAttribute(weights,4));
}

function fitLimbSkin(geometry,hinge) {
  writeSkin(geometry,y=>{
    const blend=THREE.MathUtils.smoothstep(-y,hinge-.145,hinge+.145);
    return [1-blend,blend];
  });
}

export function createAvatar({example=false}={}) {
  const model=new THREE.Group();
  model.name='GardenCreature';
  const joints={};
  const surfaces=[];
  const symmetryPairs=new Map();
  const parts=new Map();

  function joint(parent,name,x=0,y=0,z=0) {
    const bone=new THREE.Bone();
    bone.name=name;
    bone.position.set(x,y,z);
    parent.add(bone);
    joints[name]=bone;
    return bone;
  }

  function sculptable(parent,name,geometry,position,color=stone,material=ceramic) {
    tint(geometry,color);
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=name;
    mesh.position.set(...position);
    mesh.castShadow=true;
    parent.add(mesh);
    surfaces.push(mesh);
    return mesh;
  }

  function ornament(parent,geometry,position,color,material=ceramic) {
    tint(geometry,color);
    const mesh=new THREE.Mesh(geometry,material);
    mesh.position.set(...position);
    mesh.castShadow=true;
    parent.add(mesh);
    return mesh;
  }

  const pelvis=joint(model,'Pelvis',0,.88,0);
  const spine=joint(pelvis,'Spine',0,.23,0);
  const head=joint(spine,'Head',0,.57,0);
  const headClay=new THREE.Group();
  headClay.name='HeadClay';
  headClay.position.set(0,.32,.05);
  head.add(headClay);
  const decorations=[];
  const ears=[1,-1].map((side,index)=>{
    const ear=new THREE.Group();
    ear.name=index===0?'EarL':'EarR';
    ear.rotation.z=-side*earSpread;
    head.add(ear);
    return ear;
  });
  function bendable(part,name,parent,position,tilt,length=1) {
    const pivot=new THREE.Group();
    pivot.name=name;
    pivot.position.set(...position);
    pivot.rotation.x=tilt;
    parent.add(pivot);
    const bones=bendJoints(part).map(name=>Object.assign(new THREE.Bone(),{name}));
    pivot.add(bones[0]);
    bones[0].add(bones[1]);
    bones[1].add(bones[2]);
    bones[1].position.y=.18*length;
    bones[2].position.y=.21*length;
    return {pivot,bones,length};
  }
  const flex={
    extension:bendable('extension','ExtensionPivot',spine,[0,0,0],0),
    nose:bendable('nose','NosePivot',head,[0,.23,.16],1.53,.56),
    tail:bendable('tail','TailPivot',pelvis,[0,.06,-.16],-1.04,.90),
  };
  const extension=flex.extension.pivot;
  let extensionPlace='top';
  function positionExtension(place=extensionPlace) {
    extensionPlace=place;
    const onHead=place==='top' || place==='front';
    (onHead?head:spine).add(extension);
    const positions={
      top:[0,.48,0],front:[0,.20,.22],
      side:[.33,-.08,0],back:[0,-.14,-.26],
    };
    extension.position.set(...positions[place]);
    const tilt={front:1.05,back:-1.15};
    extension.rotation.set(tilt[place]??0,0,place==='side'?-1.05:0);
  }
  positionExtension();
  ears[0].position.set(.205,.235,.05);
  ears[1].position.set(-.205,.235,.05);
  const ankles={};
  const wrists={};
  const extremities={hands:[],feet:[]};
  for (const [side,sign] of [['L',1],['R',-1]]) {
    const arm=joint(spine,'UpperArm'+side,sign*.32,example ? .315 : .34,0);
    arm.rotation.z=sign*(example ? .26 : 1.78);
    const forearm=joint(arm,'Forearm'+side,0,example ? -.34 : -.33,0);
    const leg=joint(pelvis,'Thigh'+side,sign*(example ? .173 : .22),example ? -.135 : -.08,0);
    leg.rotation.z=sign*(example ? .035 : .34);
    const shin=joint(leg,'Shin'+side,0,example ? -.355 : -.32,0);
    ankles[side]=leg.localToWorld(new THREE.Vector3(0,-.57,0));
    wrists[side]=arm.localToWorld(new THREE.Vector3(0,-.5874,0));
    for (const [kind,prefix,parent,position] of [
      ['hands','HandClay',forearm,[0,-.40,0]],
      ['feet','FootClay',shin,[0,-.305,.075]],
    ]) {
      const group=new THREE.Group();
      group.name=prefix+side;
      group.position.set(...position);
      parent.add(group);
      extremities[kind].push(group);
    }
  }
  model.updateMatrixWorld(true);

  // The brush edits the same vertices that the upper and lower joint animate.
  function limb(name,upper,lower,isLeg,color=stone,depth=0) {
    const geometry=volume(isLeg?.136:.132,isLeg?.425:.398,isLeg?.134:.124);
    if (depth) {
      const positions=geometry.getAttribute('position');
      const side=upper.name.endsWith('L')?1:-1;
      for(let i=0;i<positions.count;i++){
        const spread=THREE.MathUtils.smoothstep(-positions.getY(i),-.35,.35);
        positions.setX(i,positions.getX(i)+side*.29*spread);
        positions.setZ(i,positions.getZ(i)+depth*(.45+.55*spread));
      }
      geometry.computeVertexNormals();
    }
    geometry.translate(0,isLeg?-.291:-.294,0);
    fitLimbSkin(geometry,-lower.position.y);
    tint(geometry,color);
    const mesh=new THREE.SkinnedMesh(geometry,ceramic);
    mesh.name=name;
    mesh.frustumCulled=false;
    mesh.castShadow=true;
    model.updateMatrixWorld(true);
    const transform=model.matrixWorld.clone().invert().multiply(upper.matrixWorld);
    transform.decompose(mesh.position,mesh.quaternion,mesh.scale);
    model.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([upper,lower]));
    surfaces.push(mesh);
    return mesh;
  }

  function movingClay(kind) {
    const {pivot,bones,length}=flex[kind];
    const width=kind==='nose'?.105:.127;
    const geometry=volume(width,.345*length,width*.94).translate(0,.27*length,0);
    writeSkin(geometry,y=>{
      const middle=THREE.MathUtils.smoothstep(y/length,.06,.29);
      const tip=THREE.MathUtils.smoothstep(y/length,.27,.52);
      return [1-middle,middle*(1-tip),middle*tip];
    });
    tint(geometry,stone);
    const mesh=new THREE.SkinnedMesh(geometry,ceramic);
    mesh.name=kind==='extension'?'Moving clay':pivot.name+' clay';
    mesh.frustumCulled=false;
    mesh.castShadow=true;
    pivot.add(mesh);
    model.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    surfaces.push(mesh);
    return mesh;
  }

  function addPart(kind,{shape:choice='fan'}={}) {
    if (example || parts.has(kind)) return false;
    // A choice reads "shape@size", for example "long@2.4" for giant rabbit ears.
    const [shape,sizeText]=String(choice).split('@');
    const size=THREE.MathUtils.clamp(Number(sizeText)||1,.5,3);
    const created=[];
    if (kind==='headShape') {
      created.push(sculptable(headClay,'HeadClay clay',headShapeGeometry(shape),[0,0,0]));
      tuckHead(1);
    } else if (kind==='ears') {
      for (const [index,ear] of ears.entries()) {
        const side=index===0?1:-1;
        created.push(sculptable(ear,ear.name+' clay',earGeometry(shape,side),[0,0,0]));
      }
    } else if (bendableParts.includes(kind)) {
      created.push(movingClay(kind));
    } else if (kind==='extraLegs') {
      for (const side of ['L','R']) {
        created.push(limb('Extra leg '+side,joints['Thigh'+side],joints['Shin'+side],true,stone,-.29));
      }
    } else if (kind==='hands' || kind==='feet') {
      for (const group of extremities[kind]) {
        const handSizes={round:[.135,.17,.105],paddle:[.18,.19,.075],taper:[.108,.248,.095]};
        const footSizes={round:[.128,.13,.19],flat:[.19,.072,.3],duck:[.16,.06,.27]};
        const geometry=kind==='hands'?volume(...(handSizes[shape]??handSizes.round)):volume(...(footSizes[shape]??footSizes.round));
        if (kind==='feet' && shape!=='round' && footSizes[shape]) {
          const position=geometry.getAttribute('position');
          for(let i=0;i<position.count;i++){
            const front=position.getZ(i)/footSizes[shape][2];
            if (shape==='duck') position.setX(i,position.getX(i)*(1+.85*Math.max(0,front)));
            position.setY(i,position.getY(i)-.045);
            position.setZ(i,position.getZ(i)+.07);
          }
          geometry.computeVertexNormals();
        }
        if (kind==='hands' && shape==='taper') {
          const position=geometry.getAttribute('position');
          for(let i=0;i<position.count;i++){
            const t=position.getY(i)/.248;
            position.setX(i,position.getX(i)*(.9+.42*t)+.083*t*t);
          }
          geometry.computeVertexNormals();
        }
        created.push(sculptable(group,group.name+' clay',geometry,[0,0,0]));
      }
    }
    if (!created.length) return false;
    for (const mesh of created) if (mesh.parent!==model) mesh.parent.scale.setScalar(size);
    model.updateMatrixWorld(true);
    if (created.length===2) {
      symmetryPairs.set(created[0],created[1]);
      symmetryPairs.set(created[1],created[0]);
    }
    parts.set(kind,created);
    return true;
  }

  function removePart(kind) {
    const meshes=parts.get(kind);
    if (!meshes) return;
    if (kind==='headShape') tuckHead(-1);
    for (const decor of decorations.filter(item=>meshes.some(mesh=>mesh.name===item.userData.host))) removeDecor(decor);
    for (const mesh of meshes) {
      symmetryPairs.delete(mesh);
      if (mesh.parent!==model) mesh.parent?.scale.setScalar(1);
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.skeleton?.dispose();
      const index=surfaces.indexOf(mesh);
      if (index!==-1) surfaces.splice(index,1);
    }
    parts.delete(kind);
  }

  // A head shape replaces the round head, so the body's own head is tucked inside it.
  let headTuck=null;
  function tuckHead(direction) {
    if (!bodyMesh) return;
    const positions=bodyMesh.geometry.getAttribute('position');
    if (direction>0 && !headTuck) {
      const center=new THREE.Vector3(0,1.93,0);
      const point=new THREE.Vector3();
      headTuck=new Float32Array(positions.count*3);
      for (let i=0;i<positions.count;i++) {
        point.fromBufferAttribute(positions,i);
        const amount=.55*THREE.MathUtils.smoothstep(point.y,1.64,1.84);
        if (!amount) continue;
        point.sub(center).multiplyScalar(-amount).toArray(headTuck,i*3);
      }
    } else if (direction>0 || !headTuck) {
      return;
    }
    for (let i=0;i<positions.count;i++) {
      positions.setXYZ(i,positions.getX(i)+direction*headTuck[i*3],
        positions.getY(i)+direction*headTuck[i*3+1],positions.getZ(i)+direction*headTuck[i*3+2]);
    }
    if (direction<0) headTuck=null;
    refreshAttribute(bodyMesh,'position');
  }

  // A small clay piece pressed onto the surface. It follows the surface it was pressed on.
  function addDecor({object:host,point,face},{shape='star',size=1,color='#f3d54a'}={}) {
    if (example || !host?.parent) return null;
    model.updateMatrixWorld(true);
    const toHost=host.matrixWorld.clone().invert();
    const center=point.clone().applyMatrix4(toHost);
    const normal=face.normal.clone().normalize();
    const up=new THREE.Vector3(0,1,0).transformDirection(model.matrixWorld).transformDirection(toHost);
    const across=up.clone().cross(normal);
    if (across.lengthSq()<1e-6) across.set(1,0,0).cross(normal);
    across.normalize();
    const upright=normal.clone().cross(across);
    const geometry=decorGeometry(shape,size);
    const placement=new THREE.Matrix4().makeBasis(across,upright,normal)
      .setPosition(center.addScaledVector(normal,-.01*size));
    geometry.applyMatrix4(placement);
    tint(geometry,color);
    let mesh;
    if (host.isSkinnedMesh) {
      const {position,skinIndex,skinWeight}=host.geometry.attributes;
      const vertex=new THREE.Vector3();
      let nearest=0,best=Infinity;
      for (let i=0;i<position.count;i++) {
        const distance=vertex.fromBufferAttribute(position,i).distanceToSquared(point.clone().applyMatrix4(toHost));
        if (distance<best) {best=distance;nearest=i;}
      }
      const count=geometry.getAttribute('position').count;
      const indices=new Uint16Array(count*4);
      const weights=new Float32Array(count*4);
      for (let i=0;i<count;i++) for (let slot=0;slot<4;slot++) {
        indices[i*4+slot]=skinIndex.getComponent(nearest,slot);
        weights[i*4+slot]=skinWeight.getComponent(nearest,slot);
      }
      geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
      geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
      mesh=new THREE.SkinnedMesh(geometry,ceramic);
      mesh.frustumCulled=false;
    } else {
      mesh=new THREE.Mesh(geometry,ceramic);
    }
    mesh.name='Decor';
    mesh.userData.decor=true;
    mesh.userData.host=host.name;
    mesh.castShadow=true;
    mesh.position.copy(host.position);
    mesh.quaternion.copy(host.quaternion);
    mesh.scale.copy(host.scale);
    host.parent.add(mesh);
    model.updateMatrixWorld(true);
    if (mesh.isSkinnedMesh) mesh.bind(host.skeleton,host.bindMatrix);
    decorations.push(mesh);
    return mesh;
  }

  function removeDecor(mesh) {
    const index=decorations.indexOf(mesh);
    if (index===-1) return;
    decorations.splice(index,1);
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }

  let bodyMesh;
  if (!example) {
    const geometry=clayBodyGeometry();
    tint(geometry,stone);
    const end=name=>joints[name].getWorldPosition(new THREE.Vector3());
    const segments={Pelvis:end('Spine'),Spine:end('Head'),Head:new THREE.Vector3(0,2.16,0)};
    for (const [side,sign] of [['L',1],['R',-1]]) {
      segments['UpperArm'+side]=end('Forearm'+side);
      segments['Forearm'+side]=new THREE.Vector3(sign*1.03,1.55,0);
      segments['Thigh'+side]=end('Shin'+side);
      segments['Shin'+side]=ankles[side];
    }
    bodyMesh=bindClayBody(geometry,ceramic,model,joints,segments);
    surfaces.push(bodyMesh);
  } else {
    const body=volume(.385,.615,.302);
    const v=body.getAttribute('position');
    for(let i=0;i<v.count;i++){
      const height=(v.getY(i)+.615)/1.23;
      v.setX(i,v.getX(i)*(1.16-height*.40)+.13*(height-.5)**2);
      v.setZ(i,v.getZ(i)+.105*(height-.46));
    }
    body.computeVertexNormals();
    sculptable(spine,'Tapered porcelain body',body,[-.02,.014,0]);
    for (const side of ['L','R']) {
      limb('Porcelain arm '+side,joints['UpperArm'+side],joints['Forearm'+side],false);
      limb('Porcelain leg '+side,joints['Thigh'+side],joints['Shin'+side],true);
      sculptable(joints['Shin'+side],'Porcelain foot '+side,volume(.142,.083,.194),[0,-.306,.055],side==='L'?slate:stone);
    }

    sculptable(head,'Long head',volume(.259,.492,.292),[.008,.235,.037]).rotation.z=-.26;
    sculptable(head,'Projecting face',volume(.176,.102,.189),[-.072,.083,.252]).rotation.z=.18;
    const arc=new THREE.CatmullRomCurve3([
      new THREE.Vector3(.128,.43,-.039),new THREE.Vector3(.249,.56,-.04),
      new THREE.Vector3(.337,.725,-.053),new THREE.Vector3(.265,.857,-.042),
      new THREE.Vector3(.135,.825,-.02),new THREE.Vector3(.123,.729,.023),
    ]);
    ornament(head,new THREE.TubeGeometry(arc,42,.064,16,false),[0,0,0],slate);
    ornament(head,volume(.091,.091,.091),[.122,.725,.024],gold,brass);
    for (const [x,y,z,rotation] of [[-.116,.286,.296,.1],[.07,.31,.323,-.03]]) {
      const eye=ornament(head,volume(.029,.009,.013),[x,y,z],'#343733');
      eye.rotation.z=rotation;
    }
    const bodyInset=ornament(spine,volume(.050,.139,.027),[-.149,-.084,.282],gold,brass);
    bodyInset.rotation.z=-.19;
    for (let i=0;i<3;i++) {
      const offset=i*.033;
      const groove=new THREE.CatmullRomCurve3([
        new THREE.Vector3(.116+offset,-.278,.263-offset*.72),
        new THREE.Vector3(.132+offset,-.343,.241-offset*.68),
        new THREE.Vector3(.123+offset,-.405,.208-offset*.65),
      ]);
      ornament(spine,new THREE.TubeGeometry(groove,15,.006,7,false),[0,0,0],'#a39c89');
    }
  }

  const rest=Object.fromEntries(Object.entries(joints).map(([name,bone])=>[name,bone.quaternion.clone()]));
  function mirrorSurface(mesh) {
    if (mesh.parent===extension && extensionPlace==='side') return null;
    return symmetryPairs.get(mesh)??mesh;
  }

  return {model,joints,rest,surfaces,bodyMesh,ankles,wrists,parts,decorations,addPart,removePart,addDecor,removeDecor,positionExtension,mirrorSurface};
}

export function resetPose(avatar) {
  if (avatar.restHip) avatar.joints.Pelvis.position.copy(avatar.restHip);
  for (const [name,rotation] of Object.entries(avatar.rest)) {
    avatar.joints[name].quaternion.copy(rotation);
  }
  avatar.model.updateMatrixWorld(true);
}

function refreshAttribute(mesh,key) {
  const geometry=mesh.geometry;
  geometry.getAttribute(key).needsUpdate=true;
  if (key==='position') {
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    if (mesh.isSkinnedMesh) {
      mesh.boundingSphere=null;
      mesh.boundingBox=null;
    }
  }
}

export function restoreBrushAttribute(mesh,key,values) {
  mesh.geometry.getAttribute(key).array.set(values);
  refreshAttribute(mesh,key);
}

function surfaceNeighbors(geometry) {
  if (neighbors.has(geometry)) return neighbors.get(geometry);
  const positions=geometry.getAttribute('position');
  const groupIds=[];
  const groups=[];
  const groupByPosition=new Map();
  for (let i=0;i<positions.count;i++) {
    const key=[positions.getX(i),positions.getY(i),positions.getZ(i)]
      .map(value=>Math.round(value*100000)).join(',');
    let id=groupByPosition.get(key);
    if (id===undefined) {
      id=groups.length;
      groups.push({vertex:i,links:new Set()});
      groupByPosition.set(key,id);
    }
    groupIds.push(id);
  }
  const faces=geometry.index.array;
  for (let i=0;i<faces.length;i+=3) {
    const face=[groupIds[faces[i]],groupIds[faces[i+1]],groupIds[faces[i+2]]];
    for (let j=0;j<3;j++) {
      const a=face[j], b=face[(j+1)%3];
      if (a===b) continue;
      groups[a].links.add(b);
      groups[b].links.add(a);
    }
  }
  const links=groups.map(group=>[...group.links].map(id=>groups[id].vertex));
  const result=groupIds.map(id=>links[id]);
  neighbors.set(geometry,result);
  return result;
}

export function reflectedBrush(avatar,hit) {
  const object=avatar.mirrorSurface(hit.object);
  if (!object) return null;
  const {model}=avatar;
  model.updateWorldMatrix(true,true);
  const modelInverse=model.matrixWorld.clone().invert();
  const targetInverse=object.matrixWorld.clone().invert();
  const point=hit.point.clone().applyMatrix4(modelInverse);
  point.x=-point.x;
  point.applyMatrix4(model.matrixWorld);
  const normal=(hit.normal??hit.face.normal).clone()
    .transformDirection(hit.object.matrixWorld)
    .transformDirection(modelInverse);
  normal.x=-normal.x;
  normal.transformDirection(model.matrixWorld).transformDirection(targetInverse);
  return {object,point,face:{normal}};
}

export function applyBrush(hits,tool,radius,distance,color,pressure=1) {
  const samplesByMesh=new Map();
  for (const {object,point,normal,face} of hits) {
    if (!samplesByMesh.has(object)) samplesByMesh.set(object,[]);
    samplesByMesh.get(object).push({
      center:object.worldToLocal(point.clone()),
      normal:(normal??face.normal).clone().normalize(),
    });
  }
  for (const [mesh,samples] of samplesByMesh) {
    applyBrushSamples(mesh,samples,tool,radius,distance,color,pressure);
  }
}

function applyBrushSamples(mesh,samples,tool,radius,distance,color,pressure) {
  const geometry=mesh.geometry;
  const key=tool==='paint'||tool==='blend'?'color':'position';
  const attribute=geometry.getAttribute(key);
  const positions=geometry.getAttribute('position').array;
  const radiusSquared=radius*radius;
  const strength=Math.min(.027,Math.max(.008,distance*.0022))*pressure*(tool==='push'?-1:1);
  const adjacency=tool==='smooth'||tool==='blend'?surfaceNeighbors(geometry):null;
  if (tool==='blend') {
    blendColors(mesh,samples,radiusSquared,adjacency,pressure);
    return;
  }
  const sculpt=tool==='pull'||tool==='push';
  if (sculpt && samples.length===2) {
    const [left,right]=samples;
    const center=left.center.clone().lerp(right.center,.5);
    // Feather a mirrored pair into one brush as it approaches the symmetry plane.
    const separation=left.center.distanceTo(right.center)/(2*radius);
    const split=THREE.MathUtils.smoothstep(separation,.4,1);
    left.center.lerp(center,1-split);
    right.center.lerp(center,1-split);
  }
  const output=attribute.array.slice();
  const normal=new THREE.Vector3();
  for (let i=0;i<positions.length;i+=3) {
    let influence=0;
    let totalWeight=0;
    normal.set(0,0,0);
    for (const sample of samples) {
      const dx=positions[i]-sample.center.x;
      const dy=positions[i+1]-sample.center.y;
      const dz=positions[i+2]-sample.center.z;
      const d=dx*dx+dy*dy+dz*dz;
      if (d>=radiusSquared) continue;
      const weight=(1-d/radiusSquared)**2;
      influence=sculpt?influence+(1-influence)*weight:Math.max(influence,weight);
      totalWeight+=weight;
      normal.addScaledVector(sample.normal,weight);
    }
    if (!influence) continue;
    if (tool==='paint') {
      const coverage=Math.min(1,influence*2.15*pressure);
      output[i]+=(color.r-output[i])*coverage;
      output[i+1]+=(color.g-output[i+1])*coverage;
      output[i+2]+=(color.b-output[i+2])*coverage;
    } else if (adjacency) {
      const adjacent=adjacency[i/3];
      if (!adjacent.length) continue;
      for (let k=0;k<3;k++) {
        const mean=adjacent.reduce((sum,vertex)=>sum+positions[vertex*3+k],0)/adjacent.length;
        output[i+k]+=(mean-positions[i+k])*influence*.58*pressure;
      }
    } else {
      const displacement=strength*influence/totalWeight;
      output[i]+=normal.x*displacement;
      output[i+1]+=normal.y*displacement;
      output[i+2]+=normal.z*displacement;
    }
  }
  restoreBrushAttribute(mesh,key,output);
}

// Spreads neighbouring colours into each other so painted patches melt into gradients.
function blendColors(mesh,samples,radiusSquared,adjacency,pressure) {
  const positions=mesh.geometry.getAttribute('position').array;
  const influences=new Float32Array(positions.length/3);
  for (let i=0;i<influences.length;i++) {
    for (const {center} of samples) {
      const dx=positions[i*3]-center.x,dy=positions[i*3+1]-center.y,dz=positions[i*3+2]-center.z;
      const d=dx*dx+dy*dy+dz*dz;
      if (d<radiusSquared) influences[i]=Math.max(influences[i],(1-d/radiusSquared)**2);
    }
  }
  let colors=mesh.geometry.getAttribute('color').array.slice();
  for (let pass=0;pass<9;pass++) {
    const next=colors.slice();
    for (let i=0;i<influences.length;i++) {
      const influence=influences[i];
      const adjacent=adjacency[i];
      if (!influence || !adjacent.length) continue;
      for (let k=0;k<3;k++) {
        const mean=adjacent.reduce((sum,vertex)=>sum+colors[vertex*3+k],0)/adjacent.length;
        next[i*3+k]+=(mean-colors[i*3+k])*Math.min(1,influence*.9*pressure);
      }
    }
    colors=next;
  }
  restoreBrushAttribute(mesh,'color',colors);
}

export function snapshotModel(avatar) {
  const model=clone(avatar.model);
  model.name='GardenCreature';
  model.position.set(0,0,0);
  model.rotation.set(0,0,0);
  model.scale.setScalar(1);
  if (avatar.restHip) model.getObjectByName('Pelvis').position.copy(avatar.restHip);
  for (const [name,rotation] of Object.entries(avatar.rest)) {
    model.getObjectByName(name).quaternion.copy(rotation);
  }
  partReaction(model,'ears')(0);
  for (const part of bendableParts) partReaction(model,part)(0);
  return model;
}

export function rigPreview(avatar) {
  const times=[0,.48,.96,1.5];
  const euler=new THREE.Euler();
  const rotation=new THREE.Quaternion();
  const offset=new THREE.Quaternion();
  function track(name,angles) {
    const values=angles.flatMap(values=>rotation.copy(avatar.rest[name])
      .multiply(offset.setFromEuler(euler.set(...values))).toArray());
    return new THREE.QuaternionKeyframeTrack(name+'.quaternion',times,values);
  }
  return new THREE.AnimationClip('Rig preview',1.5,[
    track('Head',[[0,0,0],[0,-.12,.19],[0,.08,-.16],[0,0,0]]),
    track('Spine',[[0,0,0],[.05,0,.13],[0,0,-.08],[0,0,0]]),
    track('UpperArmL',[[0,0,0],[0,0,.52],[0,0,.42],[0,0,0]]),
    track('ForearmL',[[0,0,0],[-.22,0,.60],[-.20,0,.32],[0,0,0]]),
  ]);
}

