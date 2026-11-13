import * as THREE from 'three';
import {MeshBVH} from 'three-mesh-bvh';

const blend=.13;
const band=.14;
const transferBand=.16;
const minimumStep=.032;

function makeSurface({positions,index,colors,skinIndex,skinWeight}) {
  const geometry=new THREE.BufferGeometry();
  const position=new THREE.BufferAttribute(positions,3);
  geometry.setAttribute('position',position);
  geometry.setIndex(new THREE.BufferAttribute(index,1));
  const tree=new MeshBVH(geometry,{indirect:true,maxLeafSize:8});
  const {min,max}=geometry.boundingBox;
  const ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(0,0,1));
  const target={point:new THREE.Vector3()};
  const box=geometry.boundingBox.clone().expandByScalar(band);
  const transferBox=geometry.boundingBox.clone().expandByScalar(transferBand);
  let depths=[];

  return {
    min,max,
    beginColumn(x,y,z) {
      depths=[];
      if (x<min.x || x>max.x || y<min.y || y>max.y) return;
      ray.origin.set(x,y,z);
      const hits=tree.raycast(ray,THREE.DoubleSide).sort((a,b)=>a.distance-b.distance);
      for (const hit of hits) {
        if (Math.abs(hit.point.z-(depths.at(-1)??Infinity))>1e-6) depths.push(hit.point.z);
      }
    },
    distance(point) {
      if (!box.containsPoint(point)) return band;
      let crossings=0;
      for (const z of depths) {
        if (z>=point.z) break;
        crossings++;
      }
      const distance=tree.closestPointToPoint(point,target,0,band)?.distance??band;
      return crossings%2?-distance:distance;
    },
    sample(point,color,weights,factor) {
      const hit=tree.closestPointToPoint(point,target);
      const offset=hit.faceIndex*3;
      const a=index[offset],b=index[offset+1],c=index[offset+2];
      va.fromBufferAttribute(position,a);
      vb.fromBufferAttribute(position,b);
      vc.fromBufferAttribute(position,c);
      THREE.Triangle.getBarycoord(hit.point,va,vb,vc,barycentric);
      for (const [vertex,weight] of [[a,barycentric.x],[b,barycentric.y],[c,barycentric.z]]) {
        const amount=factor*Math.max(0,weight);
        for (let i=0;i<3;i++) color[i]+=colors[vertex*3+i]*amount;
        for (let i=0;i<4;i++) {
          weights[skinIndex[vertex*4+i]]+=skinWeight[vertex*4+i]*amount;
        }
      }
    },
    unsigned(point) {
      if (!transferBox.containsPoint(point)) return transferBand;
      return tree.closestPointToPoint(point,target,0,transferBand)?.distance??transferBand;
    },
  };
}

const va=new THREE.Vector3(),vb=new THREE.Vector3(),vc=new THREE.Vector3();
const barycentric=new THREE.Vector3();
const corners=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];

function smoothMin(a,b) {
  const h=Math.max(blend-Math.abs(a-b),0)/blend;
  return Math.min(a,b)-h*h*blend*.25;
}

export function fuseClay(inputs,boneCount) {
  const surfaces=inputs.map(makeSurface);
  const bounds=new THREE.Box3();
  for (const surface of surfaces) bounds.expandByPoint(surface.min).expandByPoint(surface.max);
  const size=bounds.getSize(new THREE.Vector3());
  const step=Math.max(minimumStep,size.x/84,size.y/84,size.z/84);
  bounds.expandByScalar(step*2+blend*.5);
  bounds.min.addScaledVector(new THREE.Vector3(-.17,-.31,-.23),step);
  const {x:x0,y:y0,z:z0}=bounds.min;
  const [nx,ny,nz]=bounds.getSize(size).toArray().map(length=>Math.ceil(length/step)+1);
  const xy=nx*ny;
  const grid=new Float32Array(xy*nz);
  const point=new THREE.Vector3();

  for (let y=0;y<ny;y++) {
    for (let x=0;x<nx;x++) {
      point.set(x0+x*step,y0+y*step,z0);
      for (const surface of surfaces) surface.beginColumn(point.x,point.y,z0-step);
      for (let z=0;z<nz;z++) {
        point.z=z0+z*step;
        let distance=band;
        for (const surface of surfaces) {
          const sample=surface.distance(point);
          if (sample<band) distance=distance===band?sample:smoothMin(distance,sample);
        }
        grid[x+y*nx+z*xy]=distance;
      }
    }
  }

  const offsets=[0,1,nx,nx+1,xy,xy+1,xy+nx,xy+nx+1];
  const vertices=[];
  const faces=[];
  const edgeVertices=new Map();
  const tetrahedra=[[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]];
  const values=new Float32Array(8);
  const addVertex=(base,x,y,z,a,b)=>{
    const ia=base+offsets[a];
    const ib=base+offsets[b];
    const key=Math.min(ia,ib)*grid.length+Math.max(ia,ib);
    const existing=edgeVertices.get(key);
    if (existing!==undefined) return existing;
    const t=THREE.MathUtils.clamp(values[a]/(values[a]-values[b]),.00001,.99999);
    const [ax,ay,az]=corners[a], [bx,by,bz]=corners[b];
    const vertex=vertices.length/3;
    vertices.push(x0+(x+THREE.MathUtils.lerp(ax,bx,t))*step,
      y0+(y+THREE.MathUtils.lerp(ay,by,t))*step,
      z0+(z+THREE.MathUtils.lerp(az,bz,t))*step);
    edgeVertices.set(key,vertex);
    return vertex;
  };

  for (let z=0;z<nz-1;z++) {
    for (let y=0;y<ny-1;y++) {
      for (let x=0;x<nx-1;x++) {
        const base=x+y*nx+z*xy;
        let negative=0;
        for (let c=0;c<8;c++) {
          values[c]=grid[base+offsets[c]];
          if (values[c]<0) negative++;
        }
        if (negative===0 || negative===8) continue;
        for (const tetra of tetrahedra) {
          const inside=tetra.filter(c=>values[c]<0);
          const outside=tetra.filter(c=>values[c]>=0);
          if (!inside.length || !outside.length) continue;
          const v=(a,b)=>addVertex(base,x,y,z,a,b);
          const outward=new THREE.Vector3(...corners[outside[0]]).sub(new THREE.Vector3(...corners[inside[0]]));
          function triangle(a,b,c) {
            va.fromArray(vertices,a*3);
            vb.fromArray(vertices,b*3).sub(va);
            vc.fromArray(vertices,c*3).sub(va);
            if (vb.cross(vc).dot(outward)>0) faces.push(a,b,c);
            else faces.push(a,c,b);
          }
          if (inside.length===1) {
            triangle(...outside.map(c=>v(inside[0],c)));
          } else if (outside.length===1) {
            triangle(...inside.map(c=>v(c,outside[0])));
          } else {
            const [a,b]=inside,[c,d]=outside;
            const ac=v(a,c),ad=v(a,d),bc=v(b,c),bd=v(b,d);
            triangle(ac,ad,bd);
            triangle(ac,bd,bc);
          }
        }
      }
    }
  }
  if (!faces.length) throw new Error('The clay surface could not be reconstructed.');

  const count=vertices.length/3;
  const neighbors=Array.from({length:count},()=>new Set());
  for (let i=0;i<faces.length;i+=3) {
    const a=faces[i],b=faces[i+1],c=faces[i+2];
    neighbors[a].add(b).add(c);
    neighbors[b].add(a).add(c);
    neighbors[c].add(a).add(b);
  }
  const mean=new THREE.Vector3(),neighbor=new THREE.Vector3();
  const smoothed=new Float32Array(vertices.length);
  for (const amount of [.55,-.48,.40,-.35]) {
    for (let i=0;i<count;i++) {
      mean.set(0,0,0);
      for (const index of neighbors[i]) mean.add(neighbor.fromArray(vertices,index*3));
      mean.multiplyScalar(1/neighbors[i].size);
      point.fromArray(vertices,i*3).lerp(mean,amount).toArray(smoothed,i*3);
    }
    for (let i=0;i<vertices.length;i++) vertices[i]=smoothed[i];
  }
  const colors=new Float32Array(count*3);
  const indices=new Uint16Array(count*4);
  const weights=new Float32Array(count*4);
  const scores=new Float32Array(boneCount);
  const distances=new Float32Array(surfaces.length);
  const color=new Float32Array(3);
  const normals=new Float32Array(vertices.length);
  for (let i=0;i<count;i++) {
    point.fromArray(vertices,i*3);
    let nearest=transferBand;
    for (let j=0;j<surfaces.length;j++) {
      distances[j]=surfaces[j].unsigned(point);
      nearest=Math.min(nearest,distances[j]);
    }
    color.fill(0);
    scores.fill(0);
    let total=0;
    for (let j=0;j<surfaces.length;j++) {
      const t=1-(distances[j]-nearest)/blend;
      if (t<=0) continue;
      const weight=t*t;
      surfaces[j].sample(point,color,scores,weight);
      total+=weight;
    }
    for (let j=0;j<3;j++) colors[i*3+j]=color[j]/total;
    const best=Array.from(scores,(weight,index)=>({index,weight}))
      .sort((a,b)=>b.weight-a.weight).slice(0,4);
    const sum=best.reduce((total,bone)=>total+bone.weight,0);
    for (const [j,bone] of best.entries()) {
      indices[i*4+j]=bone.index;
      weights[i*4+j]=bone.weight/sum;
    }
  }

  function field(x,y,z) {
    const gx=(x-x0)/step,gy=(y-y0)/step,gz=(z-z0)/step;
    const i=Math.floor(gx),j=Math.floor(gy),k=Math.floor(gz);
    const a=gx-i,b=gy-j,c=gz-k;
    const f=i+j*nx+k*xy;
    const lower=THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(grid[f],grid[f+1],a),
      THREE.MathUtils.lerp(grid[f+nx],grid[f+nx+1],a),b);
    const upper=THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(grid[f+xy],grid[f+xy+1],a),
      THREE.MathUtils.lerp(grid[f+xy+nx],grid[f+xy+nx+1],a),b);
    return THREE.MathUtils.lerp(lower,upper,c);
  }
  const delta=step*.75;
  for (let i=0;i<vertices.length;i+=3) {
    const x=vertices[i],y=vertices[i+1],z=vertices[i+2];
    mean.set(field(x+delta,y,z)-field(x-delta,y,z),
      field(x,y+delta,z)-field(x,y-delta,z),
      field(x,y,z+delta)-field(x,y,z-delta)).normalize().toArray(normals,i);
  }

  return {positions:new Float32Array(vertices),index:new Uint32Array(faces),normals,colors,indices,weights};
}
