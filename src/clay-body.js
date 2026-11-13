import * as THREE from 'three';

export const clayBodyName='Clay body';

export function clayBodyGeometry() {
  // The silhouette is sampled once. The front and back share the same rim.
  const side=[
    [0,2.18],[.19,2.12],[.30,1.96],[.29,1.77],[.23,1.62],
    [.33,1.55],[.53,1.59],[.77,1.63],[.97,1.64],[1.055,1.56],
    [1.02,1.45],[.85,1.36],[.64,1.29],[.42,1.22],
    [.36,1.08],[.38,.89],[.45,.65],[.52,.38],[.53,.17],
    [.44,.095],[.32,.14],[.24,.30],[.16,.53],[.085,.68],[0,.73],
  ];
  const outline=[...side,...side.slice(1,-1).reverse().map(([x,y])=>[-x,y])];
  const curve=new THREE.CatmullRomCurve3(outline.map(([x,y])=>new THREE.Vector3(x,y,0)),true);
  const slices=outline.length*5;
  const rings=96;
  curve.arcLengthDivisions=slices*4;
  // This point lies inside the visibility kernel of the rounded silhouette.
  const centerY=1.35;
  const perimeter=Array.from({length:slices},(_,i)=>curve.getPointAt(i/slices));
  const rimSegments=perimeter.map((point,i)=>new THREE.Line3(point,perimeter[(i+1)%slices]));
  const sample=new THREE.Vector3();
  const nearest=new THREE.Vector3();
  const bevel=.23;
  function depthAt(x,y) {
    sample.set(x,y,0);
    let distanceSquared=bevel**2;
    for (const edge of rimSegments) {
      edge.closestPointToPoint(sample,true,nearest);
      distanceSquared=Math.min(distanceSquared,sample.distanceToSquared(nearest));
    }
    const distance=Math.sqrt(distanceSquared);
    const rounded=Math.sqrt(distance*(2*bevel-distance));
    return rounded*(1-.10*Math.min(Math.abs(x),1));
  }
  const centerDepth=depthAt(0,centerY);
  const positions=[0,centerY,centerDepth];
  const indices=[];

  for (let ring=1;ring<rings;ring++) {
    const angle=Math.PI*ring/rings;
    const radius=Math.sin(angle);
    for (const border of perimeter) {
      const x=border.x*radius;
      const y=centerY+(border.y-centerY)*radius;
      const depth=ring===rings/2?0:depthAt(x,y);
      positions.push(x,y,ring>rings/2?-depth:depth);
    }
  }
  const back=positions.length/3;
  positions.push(0,centerY,-centerDepth);

  for (let slice=0;slice<slices;slice++) {
    const next=(slice+1)%slices;
    indices.push(0,1+next,1+slice);
    for (let ring=0;ring<rings-2;ring++) {
      const a=1+ring*slices+slice;
      const b=1+ring*slices+next;
      const c=a+slices;
      const d=b+slices;
      indices.push(a,b,c,b,d,c);
    }
    indices.push(back,back-slices+slice,back-slices+next);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function bindClayBody(geometry,material,model,joints,segments) {
  model.updateMatrixWorld(true);
  const bones=Object.values(joints);
  const skeleton=new THREE.Skeleton(bones);
  const positions=geometry.getAttribute('position');
  const indices=new Uint16Array(positions.count*4);
  const weights=new Float32Array(positions.count*4);
  const vertex=new THREE.Vector3();
  const closest=new THREE.Vector3();
  const lines=Object.entries(segments).map(([name,end])=>({
    index:bones.indexOf(joints[name]),
    line:new THREE.Line3(joints[name].getWorldPosition(new THREE.Vector3()),end),
  }));
  for (let i=0;i<positions.count;i++) {
    vertex.fromBufferAttribute(positions,i);
    const influences=lines.map(({index,line})=>{
      line.closestPointToPoint(vertex,true,closest);
      const distance=vertex.distanceToSquared(closest);
      return {index,weight:1/(.006+distance)**3};
    }).sort((a,b)=>b.weight-a.weight).slice(0,4);
    const total=influences.reduce((sum,item)=>sum+item.weight,0);
    influences.forEach(({index,weight},offset)=>{
      indices[i*4+offset]=index;
      weights[i*4+offset]=weight/total;
    });
  }
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const mesh=new THREE.SkinnedMesh(geometry,material);
  mesh.name=clayBodyName;
  mesh.frustumCulled=false;
  mesh.castShadow=true;
  model.add(mesh);
  mesh.bind(skeleton);
  return mesh;
}
