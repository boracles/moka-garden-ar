import * as THREE from 'three';
import {mergeGeometries as mergeRaw} from 'three/addons/utils/BufferGeometryUtils.js';

// Merge parts that may come from different primitives: keep only the
// attributes they all share, and make sure every part is indexed.
function mergeGeometries(parts) {
  const list=parts.filter(Boolean);
  if (!list.length) return new THREE.SphereGeometry(1e-4,3,2);
  const names=Object.keys(list[0].attributes).filter(name=>list.every(g=>g.attributes[name]));
  const cleaned=list.map(g=>{
    const copy=g.index?g:g.clone();
    if (!copy.index) {
      const count=copy.getAttribute('position').count;
      copy.setIndex([...Array(count).keys()]);
    }
    for (const name of Object.keys(copy.attributes)) if (!names.includes(name)) copy.deleteAttribute(name);
    copy.morphAttributes={};
    return copy;
  });
  return mergeRaw(cleaned)??new THREE.SphereGeometry(1e-4,3,2);
}

// Generative garden plants.
//
// A child's creature becomes a set of genes (colors, attached parts and
// proportions). The genes choose a growth form and tune an L-system with
// tropism, phyllotaxis rosettes and flower heads, parametric leaves, flowers,
// fruits and one of ten seed designs. The same creature always grows the same
// plant, so the editor and AR agree without storing anything extra.

const TAU=Math.PI*2;
const GOLDEN=Math.PI*(3-Math.sqrt(5));
const clamp=THREE.MathUtils.clamp;
const lerp=THREE.MathUtils.lerp;
const smooth=(a,b,t)=>THREE.MathUtils.smoothstep(t,a,b);
const Y=new THREE.Vector3(0,1,0);

function rng(seed) {
  let s=(seed>>>0)||1;
  return ()=>{
    s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0;
    return s/4294967296;
  };
}

function hashString(text) {
  let h=2166136261;
  for (let i=0;i<text.length;i++) { h^=text.charCodeAt(i); h=Math.imul(h,16777619); }
  return h>>>0;
}

// ---------------------------------------------------------------- genes

function sampleColors(model) {
  const buckets=new Map();
  let total=0, light=0;
  const color=new THREE.Color();
  const hsl={};
  model.traverse(node=>{
    const attribute=node.isMesh && node.visible!==false && node.geometry?.getAttribute('color');
    if (!attribute) return;
    const step=6;
    for (let i=0;i<attribute.count;i+=step) {
      color.fromBufferAttribute(attribute,i);
      color.getHSL(hsl);
      total++;
      if (hsl.l>.84 && hsl.s<.4) { light++; continue; }
      if (hsl.s<.1 || hsl.l<.12) continue;
      const key=Math.round(hsl.h*12)%12;
      const bucket=buckets.get(key)??{weight:0,r:0,g:0,b:0};
      const weight=.75+.25*hsl.s;
      bucket.weight+=weight;
      bucket.r+=color.r*weight; bucket.g+=color.g*weight; bucket.b+=color.b*weight;
      buckets.set(key,bucket);
    }
  });
  const ranked=[...buckets.entries()].sort((a,b)=>b[1].weight-a[1].weight)
    .map(([key,b])=>({key,color:new THREE.Color(b.r/b.weight,b.g/b.weight,b.b/b.weight)}));
  const fallback=['#8fd06a','#ff9fb2','#ffd25e'].map(c=>new THREE.Color(c));
  const palette=[];
  for (const entry of ranked) {
    if (palette.every(other=>Math.min(Math.abs(other.key-entry.key),12-Math.abs(other.key-entry.key))>=2)) palette.push(entry);
    if (palette.length===3) break;
  }
  while (palette.length<3) palette.push({key:-1,color:fallback[palette.length]});
  return {palette:palette.map(entry=>entry.color),spots:total?light/total>.02:false};
}

function partBox(model,pattern) {
  const box=new THREE.Box3();
  model.updateMatrixWorld(true);
  model.traverse(node=>{ if (node.isMesh && pattern.test(node.name)) box.expandByObject(node); });
  return box.isEmpty()?null:box;
}

export const growthForms={bush:'덤불',weeping:'늘어진 가지',upright:'곧은 줄기',fern:'고사리',vine:'덩굴',rosette:'로제트',grass:'풀 다발'};
export const flowerTypes={daisy:'데이지',cup:'튤립',bell:'종',star:'별',pompom:'방울',sunflower:'해바라기'};
export const fruitTypes={none:'없음',berries:'산딸기',pod:'꼬투리',spiky:'밤송이',drupe:'열매'};
export const leafShapes={ovate:'달걀형',lanceolate:'버들잎형',cordate:'하트형',round:'둥근형',needle:'바늘형',palmate:'손바닥형',fan:'부채형'};
export const seedNames=['줄무늬 씨앗','강낭콩','도토리','날개 씨앗','민들레 씨앗','호박씨','솔방울','도꼬마리','팔각','연밥'];

export function plantGenes(model) {
  const {palette,spots}=sampleColors(model);
  const body=new THREE.Box3().setFromObject(model);
  const size=body.getSize(new THREE.Vector3());
  const ears=partBox(model,/Ear[LR]/i);
  const nose=partBox(model,/Nose/i);
  const tail=partBox(model,/Tail/i);
  const sprout=partBox(model,/Moving.?clay|Extension/i);
  const hands=partBox(model,/HandClay/i);
  const feet=partBox(model,/FootClay/i);
  let ear='none';
  if (ears) {
    const earSize=ears.getSize(new THREE.Vector3());
    const tall=earSize.y/Math.max(earSize.x*.5,.01);
    const headLine=body.max.y-size.y*.24;
    if (ears.getCenter(new THREE.Vector3()).y<headLine-size.y*.05) ear='droopy';
    else if (tall>2.2) ear='long';
    else if (tall>1.3) ear='pointy';
    else if (earSize.x*.5>earSize.y*.9) ear='round';
    else ear='fan';
  }
  const signature=[...palette.map(c=>c.getHexString()),ear,!!nose,!!tail,!!sprout,!!hands,!!feet,spots,size.x.toFixed(2),size.y.toFixed(2)].join('|');
  return genesFromSeed(hashString(signature),{palette,spots,ear,nose:!!nose,tail:!!tail,sprout:!!sprout,hands:!!hands,feet:!!feet,bushy:clamp(size.x/Math.max(size.y,.01),.3,1.4)});
}

// Traits can come from a creature or be drawn at random (for galleries).
export function genesFromSeed(seed,traits={}) {
  const r=rng(seed);
  const pick=list=>list[Math.floor(r()*list.length)%list.length];
  const palette=traits.palette??[
    new THREE.Color().setHSL(r(),.55+.3*r(),.6),
    new THREE.Color().setHSL(r(),.65+.3*r(),.62),
    new THREE.Color().setHSL(r(),.7,.58),
  ];
  const ear=traits.ear??pick(['none','droopy','long','pointy','round','fan']);
  const formByEar={droopy:['weeping','vine'],long:['grass','upright'],pointy:['rosette','upright'],round:['bush','rosette'],fan:['fern','bush'],none:['upright','bush','vine']};
  const leafByEar={droopy:['lanceolate','ovate'],long:['lanceolate','needle'],pointy:['cordate','ovate'],round:['round','ovate'],fan:['fan','palmate'],none:['ovate','cordate','palmate']};
  const form=traits.form??pick(formByEar[ear]);
  const leaf=traits.leaf??pick(leafByEar[ear]);
  const flowerChoices=traits.sprout?['sunflower','daisy','cup']:traits.nose?['bell','cup','star']:['daisy','star','pompom','bell'];
  const flower=traits.flower??pick(flowerChoices);
  const fruit=traits.fruit??(traits.hands?pick(['berries','drupe']):traits.feet?pick(['pod','spiky']):pick(['none','berries','pod','none','spiky','drupe']));
  return {
    seed, seedType:seed%10, palette, spots:traits.spots??r()>.6,
    form, leaf, flower, fruit,
    tendrils:traits.tendrils??!!(traits.tail||traits.nose||r()>.75),
    bushy:traits.bushy??.6+.6*r(),
    angle:lerp(18,38,r()),
    leafSize:lerp(.7,1.25,r()),
    serration:r()>.6?lerp(.3,1,r()):0,
    teeth:6+Math.floor(r()*10),
    fold:lerp(.05,.45,r()),
    curl:lerp(-.3,.7,r()),
    petals:5+Math.floor(r()*9),
    petalWidth:lerp(.35,1,r()),
    flowerSize:lerp(.8,1.3,r()),
    blooms:1+Math.floor(r()*4),
    iterations:4,
    lengthDecay:lerp(.72,.88,r()),
    lean:(r()-.5)*.6,
  };
}

// ---------------------------------------------------------------- helpers

function vertexColors(geometry,fn) {
  const p=geometry.getAttribute('position');
  const colors=new Float32Array(p.count*3);
  const v=new THREE.Vector3();
  const c=new THREE.Color();
  for (let i=0;i<p.count;i++) {
    v.fromBufferAttribute(p,i);
    fn(v,c,i);
    c.toArray(colors,i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  return geometry;
}

function gridGeometry(nu,nv,fn) {
  const positions=[], index=[];
  for (let j=0;j<=nv;j++) for (let i=0;i<=nu;i++) positions.push(...fn(i/nu,j/nv));
  for (let j=0;j<nv;j++) for (let i=0;i<nu;i++) {
    const a=j*(nu+1)+i, b=a+1, c=a+nu+1, d=c+1;
    index.push(a,c,b,b,c,d);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function bend(y,z,amount) {
  // Curl along the midrib: rotate around X progressively.
  const a=amount*y;
  return [y*Math.cos(a)-z*Math.sin(a), y*Math.sin(a)+z*Math.cos(a)];
}

// ---------------------------------------------------------------- leaves

function leafWidth(shape,v) {
  switch (shape) {
    case 'lanceolate': return Math.pow(Math.sin(Math.PI*v),1.15)*.32;
    case 'cordate': return Math.pow(Math.sin(Math.PI*(.12+.88*v)),.75)*.62*(1-.25*v)+(v<.12?.18*(1-v/.12):0);
    case 'round': return Math.sqrt(Math.max(0,1-Math.pow(2*v-1,2)))*.5;
    case 'needle': return .045*(1-v*.8);
    case 'fan': return Math.pow(v,.85)*.62*(v>.9?Math.sqrt(Math.max(0,1-Math.pow((v-.9)/.1,2))):1);
    default: return Math.pow(Math.sin(Math.PI*v),.8)*(1-.35*v)*.48;
  }
}

function singleLeaf(genes,shape,length,low,high) {
  const g=gridGeometry(10,18,(u,v)=>{
    const s=u*2-1;
    let w=leafWidth(shape,v);
    if (genes.serration) w*=1-genes.serration*.14*Math.abs(Math.sin(genes.teeth*Math.PI*v));
    const x=s*w*length;
    const z0=genes.fold*Math.abs(s)*w*length*.6;
    const [y,z]=bend(v*length,z0,genes.curl/Math.max(length,.01));
    return [x,y,z];
  });
  return vertexColors(g,(p,c,i)=>{
    const u=(i%11)/10, v=Math.floor(i/11)/18;
    c.copy(low).lerp(high,v);
    if (Math.abs(u-.5)<.06) c.lerp(new THREE.Color('#f4ffe0'),.35);
    else if (Math.abs(u-.5)>.42) c.multiplyScalar(.88);
  });
}

function leafGeometry(genes,length,low,high) {
  if (genes.leaf==='palmate') {
    const lobes=[];
    for (let i=-2;i<=2;i++) {
      const lobe=singleLeaf(genes,'lanceolate',length*(1-Math.abs(i)*.18),low,high);
      lobe.rotateZ(i*.42);
      lobes.push(lobe);
    }
    return mergeGeometries(lobes);
  }
  return singleLeaf(genes,genes.leaf,length,low,high);
}

// ---------------------------------------------------------------- flowers

function petalGeometry(length,width,cup,low,high,pointed=false) {
  const g=gridGeometry(8,10,(u,v)=>{
    const s=u*2-1;
    const w=(pointed?Math.pow(Math.sin(Math.PI*v),1.3)*(1-v*.5):Math.pow(Math.sin(Math.PI*Math.min(v*1.05,1)),.6))*width*length*.5;
    const x=s*w;
    const z0=Math.abs(s)*w*.35;
    const [y,z]=bend(v*length,z0,cup/Math.max(length,.01));
    return [x,y,z];
  });
  return vertexColors(g,(p,c,i)=>{ const v=Math.floor(i/9)/10; c.copy(low).lerp(high,v); });
}

function phyllotaxisDisc(count,radius,dotSize,inner,outer) {
  const parts=[];
  for (let n=0;n<count;n++) {
    const r=radius*Math.sqrt(n/count);
    const a=n*GOLDEN;
    const dot=new THREE.SphereGeometry(dotSize*(.7+.5*n/count),6,4);
    dot.translate(Math.cos(a)*r,dotSize*.6+(1-r/radius)*radius*.25,Math.sin(a)*r);
    const c=inner.clone().lerp(outer,n/count);
    vertexColors(dot,(p,col)=>col.copy(c));
    parts.push(dot);
  }
  return mergeGeometries(parts);
}

function flowerGeometry(genes,size) {
  const [c1,c2,c3]=genes.palette;
  const hsl={}; c2.getHSL(hsl);
  const vivid=new THREE.Color().setHSL(hsl.h,Math.max(hsl.s,.72),clamp(hsl.l,.5,.66));
  const petalLow=vivid.clone().multiplyScalar(.9);
  const petalHigh=vivid.clone().lerp(new THREE.Color('#ffffff'),.42);
  const parts=[];
  const ring=(count,length,width,cup,tilt,offset=0,pointed=false,low=petalLow,high=petalHigh)=>{
    for (let i=0;i<count;i++) {
      const p=petalGeometry(length,width,cup,low,high,pointed);
      p.rotateX(-tilt);
      p.rotateY(i/count*TAU+offset);
      parts.push(p);
    }
  };
  switch (genes.flower) {
    case 'cup':
      ring(6,size*.85,genes.petalWidth*.9+.5,2.4,.2);
      parts.push(vertexColors(new THREE.SphereGeometry(size*.12,10,8).translate(0,size*.1,0),(p,c)=>c.copy(c3)));
      break;
    case 'bell': {
      const pts=[];
      for (let i=0;i<=16;i++) {
        const t=i/16;
        const r=size*(.08+.42*Math.pow(t,1.6))*(1+.08*Math.sin(t*20));
        pts.push(new THREE.Vector2(r,-t*size*.9));
      }
      const bell=new THREE.LatheGeometry(pts,24);
      const pos=bell.getAttribute('position');
      for (let i=0;i<pos.count;i++) {
        const a=Math.atan2(pos.getZ(i),pos.getX(i));
        const t=-pos.getY(i)/(size*.9);
        const k=1+.12*t*Math.cos(a*genes.petals);
        pos.setX(i,pos.getX(i)*k); pos.setZ(i,pos.getZ(i)*k);
      }
      bell.computeVertexNormals();
      vertexColors(bell,(p,c)=>c.copy(petalHigh).lerp(petalLow,-p.y/(size*.9)));
      bell.rotateX(Math.PI);
      parts.push(bell);
      parts.push(vertexColors(new THREE.CylinderGeometry(size*.02,size*.02,size*.5,6).translate(0,size*.55,0),(p,c)=>c.copy(c3)));
      break;
    }
    case 'star':
      ring(5,size,genes.petalWidth*.6+.25,.25,1.35,0,true);
      parts.push(phyllotaxisDisc(20,size*.12,size*.03,c3,c3.clone().multiplyScalar(.7)));
      break;
    case 'pompom': {
      const count=90;
      for (let n=0;n<count;n++) {
        const yv=1-2*(n+.5)/count;
        const rr=Math.sqrt(1-yv*yv);
        const a=n*GOLDEN;
        const dir=new THREE.Vector3(Math.cos(a)*rr,yv,Math.sin(a)*rr);
        const p=petalGeometry(size*.32,.7,.6,petalLow,petalHigh);
        p.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y,dir));
        p.translate(dir.x*size*.12,dir.y*size*.12+size*.3,dir.z*size*.12);
        parts.push(p);
      }
      break;
    }
    case 'sunflower':
      ring(Math.max(14,genes.petals*2),size*.9,genes.petalWidth*.45+.25,.35,1.25);
      ring(Math.max(14,genes.petals*2),size*.75,genes.petalWidth*.45+.25,.6,1.0,Math.PI/genes.petals/2);
      parts.push(phyllotaxisDisc(180,size*.38,size*.03,c3.clone().multiplyScalar(.45),c3));
      break;
    default:
      ring(Math.max(10,genes.petals+6),size*.95,genes.petalWidth*.45+.2,.3,1.3);
      parts.push(phyllotaxisDisc(70,size*.2,size*.03,c3,c3.clone().lerp(new THREE.Color('#ffffff'),.3)));
  }
  return mergeGeometries(parts.map(p=>p.index?p:p));
}

// ---------------------------------------------------------------- fruits

function fruitGeometry(genes,size) {
  const [c1,c2,c3]=genes.palette;
  const ripe=c3.clone().lerp(new THREE.Color('#e5383b'),.35);
  const parts=[];
  switch (genes.fruit) {
    case 'berries':
      for (let i=0;i<6;i++) {
        const a=i*GOLDEN, r=size*.18*Math.sqrt(i/6);
        parts.push(vertexColors(new THREE.SphereGeometry(size*(.22-.015*i),14,10).translate(Math.cos(a)*r,-i*size*.07,Math.sin(a)*r),(p,c)=>c.copy(ripe).lerp(new THREE.Color('#ffffff'),.08*Math.max(0,p.y))));
      }
      break;
    case 'pod': {
      const pod=new THREE.CapsuleGeometry(size*.16,size*.9,6,14);
      const pos=pod.getAttribute('position');
      for (let i=0;i<pos.count;i++) {
        const a=Math.atan2(pos.getZ(i),pos.getX(i));
        const k=1+.12*Math.cos(a*2)+.05*Math.sin(pos.getY(i)*40/size);
        pos.setX(i,pos.getX(i)*k); pos.setZ(i,pos.getZ(i)*k*.7);
      }
      pod.computeVertexNormals();
      pod.translate(0,-size*.55,0);
      parts.push(vertexColors(pod,(p,c)=>c.copy(c1.clone().lerp(new THREE.Color('#7fb84a'),.5)).lerp(ripe,clamp(-p.y/size,0,1)*.4)));
      break;
    }
    case 'spiky': {
      const ball=new THREE.SphereGeometry(size*.3,16,12);
      parts.push(vertexColors(ball,(p,c)=>c.copy(c1).lerp(new THREE.Color('#9acd4f'),.5)));
      for (let n=0;n<60;n++) {
        const yv=1-2*(n+.5)/60, rr=Math.sqrt(1-yv*yv), a=n*GOLDEN;
        const dir=new THREE.Vector3(Math.cos(a)*rr,yv,Math.sin(a)*rr);
        const spike=new THREE.ConeGeometry(size*.03,size*.22,5);
        spike.translate(0,size*.38,0);
        spike.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y,dir));
        parts.push(vertexColors(spike,(p,c)=>c.set('#c9dd7a')));
      }
      parts.forEach(p=>p.translate(0,-size*.35,0));
      break;
    }
    default: {
      const drupe=new THREE.SphereGeometry(size*.32,18,14);
      drupe.scale(1,1.1,1);
      drupe.translate(0,-size*.36,0);
      parts.push(vertexColors(drupe,(p,c)=>c.copy(ripe).lerp(c2,clamp((p.y+size*.36)/size,0,1)*.5)));
    }
  }
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------- seeds

function lathe(profile,segments=32) {
  return new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),segments);
}

export function createSeed(type,palette=[new THREE.Color('#c08a4a'),new THREE.Color('#5a3b22'),new THREE.Color('#e9d6a8')],size=1) {
  const [c1,c2,c3]=palette;
  const brown=new THREE.Color('#7a5232').lerp(c1,.18);
  const dark=new THREE.Color('#3b2716').lerp(c2,.12);
  const cream=new THREE.Color('#efe2c2').lerp(c3,.12);
  const group=new THREE.Group();
  group.name='Garden seed';
  const glossy=new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.32,clearcoat:.8,clearcoatRoughness:.25});
  const matte=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.75});
  const add=(geometry,material=matte)=>{ geometry.computeVertexNormals(); const m=new THREE.Mesh(geometry,material); group.add(m); return m; };
  switch (type) {
    case 0: { // striped sunflower seed
      const g=lathe(Array.from({length:22},(_,i)=>{ const t=i/21; return [Math.sin(Math.PI*t)*.32*(1-.45*t),t*1.2-.6]; }),40);
      g.scale(1,1,.55);
      add(vertexColors(g,(p,c)=>{ const a=Math.atan2(p.z/.55,p.x); c.copy(Math.cos(a*10)>.35?cream:dark); }),glossy);
      break;
    }
    case 1: { // kidney bean
      const g=new THREE.SphereGeometry(.45,40,28);
      const pos=g.getAttribute('position');
      for (let i=0;i<pos.count;i++) { const x=pos.getX(i), y=pos.getY(i); pos.setX(i,x*1.5-y*y*.55); pos.setZ(i,pos.getZ(i)*.75); }
      add(vertexColors(g,(p,c)=>{ c.copy(c1.clone().lerp(new THREE.Color('#8a1f2c'),.6)); if (p.x<-.45 && Math.abs(p.y)<.08) c.copy(cream); else if (Math.sin(p.x*9+p.y*13)>.92) c.lerp(cream,.4); }),glossy);
      break;
    }
    case 2: { // acorn
      const nut=lathe(Array.from({length:20},(_,i)=>{ const t=i/19; return [Math.pow(Math.sin(Math.PI*.5*t),.7)*.38,-.7+t*.95]; }),36);
      add(vertexColors(nut,(p,c)=>c.copy(brown).lerp(cream,.2*Math.max(0,-p.y))),glossy);
      const cap=new THREE.SphereGeometry(.42,36,16,0,TAU,0,Math.PI/2);
      const pos=cap.getAttribute('position');
      for (let i=0;i<pos.count;i++) { const a=Math.atan2(pos.getZ(i),pos.getX(i)), y=pos.getY(i); const bump=1+.06*Math.sin(a*18)*Math.sin(y*30); pos.setX(i,pos.getX(i)*bump); pos.setZ(i,pos.getZ(i)*bump); pos.setY(i,y*.55+.22); }
      add(vertexColors(cap,(p,c)=>c.copy(dark).lerp(brown,.3*Math.sin(p.y*40)**2)));
      add(vertexColors(new THREE.CylinderGeometry(.03,.05,.22,8).translate(0,.55,0),(p,c)=>c.copy(dark)));
      break;
    }
    case 3: { // winged samara
      const s=new THREE.Shape();
      s.moveTo(0,0); s.bezierCurveTo(.5,.1,.75,.9,.45,1.6); s.bezierCurveTo(.25,1.75,-.05,1.4,-.12,.9); s.bezierCurveTo(-.15,.5,-.1,.15,0,0);
      const wing=new THREE.ShapeGeometry(s,24);
      const pos=wing.getAttribute('position');
      for (let i=0;i<pos.count;i++) pos.setZ(i,Math.sin(pos.getY(i)*2)*.08);
      add(vertexColors(wing,(p,c)=>{ c.copy(cream).lerp(c1,.25).lerp(brown,.4*(1-p.y/1.6)); if (Math.sin((p.x*3+p.y)*9)>.9) c.multiplyScalar(.85); }),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.6,side:THREE.DoubleSide,transparent:true,opacity:.92}));
      add(vertexColors(new THREE.SphereGeometry(.2,24,16).scale(1,1.3,.8),(p,c)=>c.copy(brown)),glossy);
      group.children.forEach(m=>m.translate?.(0,0,0));
      group.position.y=-.5;
      break;
    }
    case 4: { // dandelion achene with pappus
      add(vertexColors(lathe(Array.from({length:14},(_,i)=>{ const t=i/13; return [Math.sin(Math.PI*t)*.09,t*.5-.9]; }),16),(p,c)=>c.copy(brown)));
      add(vertexColors(new THREE.CylinderGeometry(.008,.008,.9,5).translate(0,-.0,0),(p,c)=>c.set('#f4f1e6')));
      const hairs=[];
      for (let n=0;n<60;n++) {
        const yv=.2+.8*(n/60), rr=Math.sqrt(1-yv*yv), a=n*GOLDEN;
        const dir=new THREE.Vector3(Math.cos(a)*rr,yv,Math.sin(a)*rr);
        const h=new THREE.CylinderGeometry(.004,.004,.55,3).translate(0,.275,0);
        h.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y,dir)).translate(0,.45,0);
        hairs.push(vertexColors(h,(p,c)=>c.set('#ffffff')));
      }
      add(mergeGeometries(hairs),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.4,transparent:true,opacity:.85}));
      break;
    }
    case 5: { // pumpkin seed
      const g=new THREE.SphereGeometry(.5,40,24);
      const pos=g.getAttribute('position');
      for (let i=0;i<pos.count;i++) { const y=pos.getY(i); pos.setY(i,y*1.35); pos.setX(i,pos.getX(i)*(1-.25*Math.max(0,y))); pos.setZ(i,pos.getZ(i)*.22); }
      add(vertexColors(g,(p,c)=>{ const edge=Math.hypot(p.x/.5,p.y/.675); c.copy(cream).lerp(c3,.15); if (edge>.86) c.multiplyScalar(.9); }));
      break;
    }
    case 6: { // pine cone, phyllotaxis scales
      const scales=[];
      const count=110;
      for (let n=0;n<count;n++) {
        const t=n/count, a=n*GOLDEN;
        const r=.42*Math.sin(Math.PI*clamp(t*1.05,0,1))+.04;
        const sc=new THREE.SphereGeometry(.13*(.5+Math.sin(Math.PI*t)),10,6);
        sc.scale(1.1,.45,.8).rotateZ(-.5).translate(r,0,0).rotateY(-a).translate(0,-.75+t*1.5,0);
        scales.push(vertexColors(sc,(p,c)=>c.copy(brown).lerp(dark,.35+.3*Math.sin(n))));
      }
      add(mergeGeometries(scales));
      break;
    }
    case 7: { // burr
      add(vertexColors(new THREE.SphereGeometry(.34,24,16).scale(1,1.25,1),(p,c)=>c.copy(brown).lerp(c1,.2)));
      const hooks=[];
      for (let n=0;n<70;n++) {
        const yv=1-2*(n+.5)/70, rr=Math.sqrt(1-yv*yv), a=n*GOLDEN;
        const dir=new THREE.Vector3(Math.cos(a)*rr,yv*1.2,Math.sin(a)*rr).normalize();
        const h=new THREE.ConeGeometry(.025,.24,5).translate(0,.44,0);
        h.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y,dir));
        hooks.push(vertexColors(h,(p,c)=>c.copy(cream).lerp(brown,.4)));
      }
      add(mergeGeometries(hooks));
      break;
    }
    case 8: { // star anise
      const pods=[];
      for (let i=0;i<8;i++) {
        const pod=new THREE.SphereGeometry(.3,18,12,0,TAU,0,Math.PI*.62);
        pod.scale(.55,1,1.5).rotateX(Math.PI/2).translate(0,0,.38).rotateY(i/8*TAU);
        pods.push(vertexColors(pod,(p,c)=>c.copy(dark).lerp(brown,.5)));
        const s=new THREE.SphereGeometry(.09,12,8).scale(1,.8,1.4).translate(0,.12,.38).rotateY(i/8*TAU);
        pods.push(vertexColors(s,(p,c)=>c.set('#c79a5a')));
      }
      add(mergeGeometries(pods),glossy);
      break;
    }
    default: { // lotus seed head
      const head=lathe([[0,-.55],[.12,-.5],[.3,-.2],[.5,.25],[.55,.35],[0,.38]],40);
      add(vertexColors(head,(p,c)=>c.copy(new THREE.Color('#7f9a52')).lerp(c1,.15).lerp(new THREE.Color('#c8b16b'),clamp(p.y+.2,0,1)*.5)));
      const seeds=[];
      for (let n=0;n<17;n++) {
        const r=.42*Math.sqrt((n+.5)/17), a=n*GOLDEN;
        seeds.push(vertexColors(new THREE.SphereGeometry(.07,12,8).translate(Math.cos(a)*r,.38,Math.sin(a)*r),(p,c)=>c.set('#3b3020')));
      }
      add(mergeGeometries(seeds),glossy);
    }
  }
  group.scale.setScalar(size);
  return group;
}

// ---------------------------------------------------------------- L-system

const forms={
  bush:{axiom:'X',rules:{X:[[.5,'F[&+XL]/[&-XL]//[^XL]FXK'],[.5,'F[&XL]///[&XL]///[&XL]FK']],F:[[1,'F']]},tropism:[0,1,0],strength:.04},
  weeping:{axiom:'FX',rules:{X:[[.6,'F[&&+XL]/[&&-XLR]//F[&&XL]XK'],[.4,'F[&&XL]//[&&XLR]//[&&XL]XK']],F:[[1,'F']]},tropism:[0,-1,0],strength:.2},
  upright:{axiom:'X',rules:{X:[[.55,'FL[&+XL]//[&-XLK]FL/XK'],[.45,'FL[&XLR]///[&XL]FXK']],F:[[1,'F']]},tropism:[0,1,0],strength:.12},
  vine:{axiom:'FX',rules:{X:[[.6,'F[&+XL]/F[&-XLR]/FL[^XL]XK'],[.4,'F/[&LX]//F[&LXR]XK']],F:[[1,'F']]},tropism:[.4,.35,0],strength:.12},
  fern:{axiom:'X',rules:{X:[[1,'F[&+Y]//[&+Y]//[&+Y]//[&+Y]K']],Y:[[1,'F[+L][-L]Y']]},tropism:[0,-1,0],strength:.05,iterations:6},
};

function expand(form,iterations,random) {
  let text=form.axiom;
  for (let n=0;n<iterations;n++) {
    let next='';
    for (const ch of text) {
      const options=form.rules[ch];
      if (!options) { next+=ch; continue; }
      let roll=random(), chosen=options[0][1];
      for (const [p,body] of options) { if ((roll-=p)<=0) { chosen=body; break; } }
      next+=chosen;
      if (next.length>6000) break;
    }
    text=next;
  }
  return text;
}

function turtle(text,genes,height,random,form) {
  const segments=[], leaves=[], blooms=[], fruits=[];
  const angle=THREE.MathUtils.degToRad(genes.angle);
  const tropism=new THREE.Vector3(...form.tropism).normalize();
  let state={pos:new THREE.Vector3(),q:new THREE.Quaternion(),width:.05*height,length:.2*height,depth:0};
  const stack=[];
  const rot=(axis,a)=>state.q.multiply(new THREE.Quaternion().setFromAxisAngle(axis,a+(random()-.5)*.2));
  const X=new THREE.Vector3(1,0,0), Z=new THREE.Vector3(0,0,1);
  let order=0;
  state.q.setFromAxisAngle(Z,genes.lean*.3);
  for (const ch of text) {
    switch (ch) {
      case 'F': {
        const heading=Y.clone().applyQuaternion(state.q);
        const len=state.length*(.85+.3*random());
        const next=state.pos.clone().addScaledVector(heading,len);
        const r1=state.width*.82;
        segments.push({a:state.pos.clone(),b:next,r0:state.width,r1,order:order++});
        state.pos=next; state.width=r1;
        const axis=heading.clone().cross(tropism);
        const amount=axis.length();
        if (amount>1e-4) state.q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis.normalize(),form.strength*amount));
        break;
      }
      case '+': rot(Z,angle); break;
      case '-': rot(Z,-angle); break;
      case '&': rot(X,angle); break;
      case '^': rot(X,-angle); break;
      case '/': rot(Y,angle*1.4); break;
      case '\\': rot(Y,-angle*1.4); break;
      case '[': stack.push({...state,pos:state.pos.clone(),q:state.q.clone()}); state.depth++; state.length*=genes.lengthDecay; state.width*=.72; break;
      case ']': state=stack.pop()??state; break;
      case 'L': leaves.push({pos:state.pos.clone(),q:state.q.clone(),depth:state.depth,order:order}); break;
      case 'K': blooms.push({pos:state.pos.clone(),q:state.q.clone(),order:order}); break;
      case 'R': fruits.push({pos:state.pos.clone(),q:state.q.clone(),order:order}); break;
    }
  }
  return {segments,leaves,blooms,fruits,total:Math.max(order,1)};
}

function rosette(genes,height,random) {
  const leaves=[], segments=[], blooms=[], fruits=[];
  const count=genes.form==='grass'?22:34;
  for (let n=0;n<count;n++) {
    const t=n/count;
    const q=new THREE.Quaternion().setFromAxisAngle(Y,n*GOLDEN)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),genes.form==='grass'?lerp(.12,.7,t)+(random()-.5)*.2:lerp(.35,1.15,t)));
    leaves.push({pos:new THREE.Vector3(0,.01*height,0),q,depth:genes.form==='grass'?0:Math.floor((1-t)*3),order:Math.floor(t*count),scale:genes.form==='grass'?1.5:lerp(.7,1.35,t)});
  }
  const stalks=genes.form==='grass'?Math.max(2,genes.blooms):1;
  let order=count;
  for (let s=0;s<stalks;s++) {
    let pos=new THREE.Vector3(), q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(s*2.4),0,Math.sin(s*2.4)),(s?.25:0)+(random()-.5)*.1);
    const steps=6;
    for (let i=0;i<steps;i++) {
      const next=pos.clone().addScaledVector(Y.clone().applyQuaternion(q),height*.62/steps);
      segments.push({a:pos,b:next,r0:.012*height*(1-i/steps*.5),r1:.012*height*(1-(i+1)/steps*.5),order:order++});
      pos=next;
    }
    blooms.push({pos,q,order:order});
    if (genes.fruit!=='none' && s===0) fruits.push({pos:pos.clone().add(new THREE.Vector3(.05*height,-.18*height,0)),q,order:order+2});
  }
  return {segments,leaves,blooms,fruits,total:order+3};
}

// ---------------------------------------------------------------- assembly

function branchGeometry(segments,total,low,high) {
  const parts=[];
  const up=new THREE.Vector3(0,1,0);
  for (const s of segments) {
    const dir=s.b.clone().sub(s.a);
    const len=dir.length();
    if (len<1e-5) continue;
    const g=new THREE.CylinderGeometry(s.r1,s.r0,len,7,1,true);
    g.translate(0,len/2,0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up,dir.normalize()));
    g.translate(s.a.x,s.a.y,s.a.z);
    const count=g.getAttribute('position').count;
    const birth=new Float32Array(count).fill(s.order/total);
    const base=new Float32Array(count*3);
    for (let i=0;i<count;i++) base.set([s.a.x,s.a.y,s.a.z],i*3);
    g.setAttribute('birth',new THREE.BufferAttribute(birth,1));
    g.setAttribute('base',new THREE.BufferAttribute(base,3));
    vertexColors(g,(p,c)=>c.copy(low).lerp(high,s.order/total));
    parts.push(g.toNonIndexed?g:g);
  }
  return mergeGeometries(parts);
}

function growingMaterial(options) {
  const material=new THREE.MeshStandardMaterial(options);
  const uniforms={growth:{value:1}};
  material.onBeforeCompile=shader=>{
    shader.uniforms.growth=uniforms.growth;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nattribute float birth;\nattribute vec3 base;\nuniform float growth;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nfloat grown=clamp((growth*1.15-birth)/.12,0.,1.);\ntransformed=base+(transformed-base)*grown;');
  };
  material.userData.growth=uniforms.growth;
  return material;
}

function instanced(geometry,material,items,matrixFor) {
  const mesh=new THREE.InstancedMesh(geometry,material,Math.max(items.length,1));
  mesh.count=items.length;
  const matrices=items.map(matrixFor);
  matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));
  mesh.userData.matrices=matrices;
  mesh.frustumCulled=false;
  return mesh;
}

export function createPlant(genes,{height=1}={}) {
  const random=rng(genes.seed^0x9e3779b9);
  const [c1,c2]=genes.palette;
  const leafGreen=new THREE.Color('#4f9f45');
  const leafLow=leafGreen.clone().lerp(c1,.18).multiplyScalar(.85);
  const leafHigh=leafGreen.clone().lerp(new THREE.Color('#d9f7a8'),.45).lerp(c1,.12);
  const barkLow=new THREE.Color('#5e7a3a').lerp(c1,.1);
  const barkHigh=new THREE.Color('#8fbf5a').lerp(c1,.15);

  const group=new THREE.Group();
  group.name='Garden plant';
  const plant=new THREE.Group();
  group.add(plant);

  const soil=new THREE.Mesh(new THREE.SphereGeometry(1,40,12,0,TAU,0,Math.PI/2),
    new THREE.MeshStandardMaterial({color:'#5b4030',roughness:1}));
  soil.scale.set(.2*height,.05*height,.2*height);
  group.add(soil);
  for (let i=0;i<9;i++) {
    const pebble=new THREE.Mesh(new THREE.SphereGeometry(.025*height,8,6),new THREE.MeshStandardMaterial({color:i%2?'#b9ab97':'#8d7f6c',roughness:.9}));
    const a=i*2.3, r=(.08+.1*((i*37)%10)/10)*height;
    pebble.position.set(Math.cos(a)*r,.03*height*(1-r/(.2*height)),Math.sin(a)*r);
    pebble.scale.y=.6;
    group.add(pebble);
  }

  const seed=createSeed(genes.seedType,genes.palette,.06*height);
  seed.position.y=.09*height;
  group.add(seed);

  let structure;
  if (genes.form==='rosette' || genes.form==='grass') structure=rosette(genes,height,random);
  else {
    const form=forms[genes.form]??forms.bush;
    const text=expand(form,form.iterations??genes.iterations,random);
    structure=turtle(text,genes,height,random,form);
  }

  const branchMaterial=growingMaterial({vertexColors:true,roughness:.7});
  const branches=new THREE.Mesh(branchGeometry(structure.segments,structure.total,barkLow,barkHigh),branchMaterial);
  plant.add(branches);

  const leafMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.5,side:THREE.DoubleSide});
  const leafLength=.26*height*genes.leafSize*(genes.form==='fern'?.6:genes.form==='grass'?1.25:1);
  const leafMesh=instanced(leafGeometry(genes,leafLength,leafLow,leafHigh),leafMaterial,structure.leaves,item=>{
    const q=item.q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
      genes.form==='weeping'?.9:.55+(random()-.5)*.5,random()*TAU,(random()-.5)*.6)));
    const s=(item.scale??1)*(1-.1*item.depth)*(.75+.5*random());
    return new THREE.Matrix4().compose(item.pos,q,new THREE.Vector3(s,s,s));
  });
  plant.add(leafMesh);

  const bloomItems=[...structure.blooms].sort((a,b)=>b.pos.y-a.pos.y).filter((item,i,list)=>list.slice(0,i).every(o=>o.pos.distanceTo(item.pos)>.12*height)).slice(0,genes.blooms+4);
  const flowerMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.45,side:THREE.DoubleSide});
  const flowerSize=.24*height*genes.flowerSize*(genes.form==='rosette'||genes.form==='grass'?1.35:1);
  const flowerMesh=instanced(flowerGeometry(genes,flowerSize),flowerMaterial,bloomItems,item=>{
    const q=genes.flower==='bell'?new THREE.Quaternion():item.q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.55+random()*.3,random()*TAU,0)));
    return new THREE.Matrix4().compose(item.pos,q,new THREE.Vector3(1,1,1));
  });
  plant.add(flowerMesh);

  let fruitMesh=null;
  const fruitItems=[...structure.fruits].sort((a,b)=>b.pos.y-a.pos.y).filter((item,i,list)=>list.slice(0,i).every(o=>o.pos.distanceTo(item.pos)>.1*height)).slice(0,5);
  if (genes.fruit!=='none' && fruitItems.length) {
    const fruitMaterial=new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.3,clearcoat:.7,clearcoatRoughness:.2});
    fruitMesh=instanced(fruitGeometry(genes,.17*height),fruitMaterial,fruitItems,item=>new THREE.Matrix4().compose(item.pos,new THREE.Quaternion(),new THREE.Vector3(1,1,1)));
    plant.add(fruitMesh);
  }

  const tendrils=[];
  if (genes.tendrils && structure.segments.length>4) {
    for (let k=0;k<2;k++) {
      const s=structure.segments[Math.floor(structure.segments.length*(.3+.25*k))];
      const pts=[];
      for (let i=0;i<=50;i++) {
        const t=i/50, r=(.05*(1-t)+.012)*height;
        pts.push(new THREE.Vector3(s.b.x+(k?-1:1)*(.02+t*.16)*height+Math.cos(t*16)*r,s.b.y+t*.06*height+Math.sin(t*16)*r,s.b.z));
      }
      const g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),90,.005*height,5,false);
      const t=new THREE.Mesh(vertexColors(g,(p,c)=>c.copy(barkHigh)),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.6}));
      t.userData.birth=s.order/structure.total;
      plant.add(t);
      tendrils.push(t);
    }
  }

  // Keep plants a companion size next to the creature.
  plant.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(plant);
  const tallest=Math.max(box.max.y,1e-3);
  const fit=Math.min(1.4,.62*height/tallest);
  plant.scale.setScalar(fit);
  plant.position.y=.045*height;
  plant.rotation.y=random()*TAU;

  const tmp=new THREE.Matrix4(), pos=new THREE.Vector3(), quat=new THREE.Quaternion(), scl=new THREE.Vector3();
  function scaleInstances(mesh,items,from,span) {
    if (!mesh) return;
    items.forEach((item,i)=>{
      const born=item.order/structure.total;
      const k=Math.max(smooth(from+born*span,from+born*span+.14,growth),1e-3);
      mesh.userData.matrices[i].decompose(pos,quat,scl);
      tmp.compose(pos,quat,scl.multiplyScalar(k));
      mesh.setMatrixAt(i,tmp);
    });
    mesh.instanceMatrix.needsUpdate=true;
  }
  let growth=1;
  function setGrowth(value) {
    growth=clamp(value,0,1);
    const sprout=smooth(.08,.25,growth);
    seed.scale.setScalar(.06*height*(1-sprout*.85));
    seed.position.y=.09*height-.05*height*sprout;
    branchMaterial.userData.growth.value=smooth(.12,.8,growth);
    scaleInstances(leafMesh,structure.leaves,.15,.65);
    scaleInstances(flowerMesh,bloomItems,.62,.3);
    scaleInstances(fruitMesh,fruitItems,.82,.15);
    for (const t of tendrils) t.scale.setScalar(Math.max(smooth(.5+t.userData.birth*.3,.75+t.userData.birth*.3,growth),1e-3));
  }
  function update(seconds) {
    plant.rotation.z=Math.sin(seconds*1.1+genes.seed%7)*.025;
    plant.rotation.x=Math.cos(seconds*.9+genes.seed%5)*.015;
  }
  setGrowth(1);
  return {group,setGrowth,update,genes};
}
