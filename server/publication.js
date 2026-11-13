const maxBytes=6_000_000;
const workPath=/^\/works\/(\d{4}-\d{2}-\d{2})\/(moka-garden-(?:0[1-9]|10))\.glb$/;
const encoder=new TextEncoder();

export async function classCode(secret,date) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,encoder.encode(date));
  return hex(signature);
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function validCode(request,secret,date) {
  const supplied=request.headers.get('Authorization')??'';
  if (!secret || !/^Bearer [a-f0-9]{64}$/.test(supplied)) return false;
  const expected=await classCode(secret,date);
  let diff=0;
  for (let index=0;index<expected.length;index++) {
    diff|=supplied.charCodeAt(index+7)^expected.charCodeAt(index);
  }
  return diff===0;
}

export default {
  async fetch(request,env) {
    const match=new URL(request.url).pathname.match(workPath);
    if (!match) return new Response(null,{status:404});
    const [,date,id]=match;
    const timestamp=Date.parse(date+'T00:00:00Z');
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10)!==date) {
      return new Response(null,{status:404});
    }
    const origin=request.headers.get('Origin');
    const allowed=origin===env.FRONTEND_ORIGIN;
    const headers={
      'Cache-Control':'no-store',
      'Vary':'Origin',
      'X-Content-Type-Options':'nosniff',
    };
    if (request.method==='GET') headers['Access-Control-Allow-Origin']='*';
    if (allowed) {
      headers['Access-Control-Allow-Origin']=origin;
      headers['Access-Control-Allow-Methods']='GET, PUT, OPTIONS';
      headers['Access-Control-Allow-Headers']='Authorization, Content-Type';
    }
    if (request.method==='OPTIONS') return new Response(null,{status:allowed?204:403,headers});
    if (request.method==='PUT' && (!allowed || !await validCode(request,env.CLASS_SECRET,date))) {
      return new Response(null,{status:403,headers});
    }
    if (!['GET','PUT'].includes(request.method)) return new Response(null,{status:405,headers});
    const store=env.WORKS.get(env.WORKS.idFromName(date+'/'+id));
    const stored=await store.fetch(request);
    for (const [name,value] of stored.headers) headers[name]=value;
    return new Response(stored.body,{status:stored.status,headers});
  },
};

function validWork(bytes,date,id) {
  if (bytes.byteLength<20) return false;
  const header=new DataView(bytes);
  if (header.getUint32(0,true)!==0x46546c67 || header.getUint32(4,true)!==2 ||
      header.getUint32(8,true)!==bytes.byteLength || header.getUint32(16,true)!==0x4e4f534a) return false;
  const jsonSize=header.getUint32(12,true);
  if (jsonSize%4!==0 || jsonSize>bytes.byteLength-20) return false;
  try {
    const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonSize)));
    const extras=gltf.nodes?.find(node=>node.extras?.gardenMarker===id)?.extras;
    const settings=extras?.gardenWork;
    const rule=settings?.rule;
    const clips=new Set(gltf.animations?.map(clip=>clip.name));
    const resources=[...(gltf.buffers??[]),...(gltf.images??[])];
    return gltf.asset?.version==='2.0' && extras?.gardenDate===date && !extras.gardenDemo &&
      Boolean(settings?.motion && clips.has(settings.motion) && rule?.part && rule.action) &&
      ['tap','place'].includes(rule.trigger) && (rule.action!=='recorded' || clips.has(rule.animation)) &&
      resources.every(resource=>!resource.uri);
  } catch {
    return false;
  }
}

export class PublishedWork {
  constructor(state) {
    this.storage=state.storage;
    this.storage.sql.exec('CREATE TABLE IF NOT EXISTS work (id INTEGER PRIMARY KEY, sha256 TEXT NOT NULL, file BLOB NOT NULL)');
  }

  async fetch(request) {
    if (request.method==='GET') {
      const row=this.storage.sql.exec('SELECT file FROM work WHERE id=1').toArray()[0];
      return row ? new Response(row.file,{headers:{'Content-Type':'model/gltf-binary'}})
        : new Response(null,{status:404});
    }
    if (request.headers.get('Content-Type')!=='model/gltf-binary') return new Response(null,{status:415});
    if (Number(request.headers.get('Content-Length'))>maxBytes) return new Response(null,{status:413});
    if (!request.body) return new Response(null,{status:400});
    const [,date,id]=new URL(request.url).pathname.match(workPath);
    const chunks=[];
    let size=0;
    const reader=request.body.getReader();
    try {
      for (;;) {
        const {value,done}=await reader.read();
        if (done) break;
        size+=value.byteLength;
        if (size>maxBytes) {
          await reader.cancel();
          return new Response(null,{status:413});
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const file=await new Blob(chunks).arrayBuffer();
    if (!validWork(file,date,id)) return new Response(null,{status:422});
    const digest=hex(await crypto.subtle.digest('SHA-256',file));
    const status=this.storage.transactionSync(()=>{
      const row=this.storage.sql.exec('SELECT sha256 FROM work WHERE id=1').toArray()[0];
      if (row) return row.sha256===digest ? 204 : 409;
      this.storage.sql.exec('INSERT INTO work (id,sha256,file) VALUES (1,?,?)',digest,file);
      return 204;
    });
    return new Response(null,{status});
  }
}
