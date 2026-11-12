import * as THREE from 'three';

const engineURL='https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js';
let enginePromise;

export function warmUpAR() {
  window.THREE=THREE;
  if (window.XR8?.Threejs && !enginePromise) return Promise.resolve(window.XR8);
  if (!enginePromise) {
    enginePromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const timer=setTimeout(()=>fail('AR 기능을 불러오는 데 시간이 걸려요. 다시 눌러 주세요.'),18000);
      function cleanup() {
        clearTimeout(timer);
        window.removeEventListener('xrloaded',loaded);
      }
      function fail(message) {
        cleanup();
        script.remove();
        enginePromise=null;
        reject(new Error(message));
      }
      function loaded() {
        cleanup();
        resolve(window.XR8);
      }
      window.addEventListener('xrloaded',loaded,{once:true});
      script.src=engineURL;
      script.crossOrigin='anonymous';
      script.dataset.preloadChunks='slam';
      script.async=true;
      script.addEventListener('error',()=>fail('AR 기능을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'),{once:true});
      document.head.append(script);
    });
  }
  return enginePromise;
}

const ground=new THREE.Plane(new THREE.Vector3(0,1,0),0);

export function positionOnFloor(camera,x,y) {
  const raycaster=new THREE.Raycaster();
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  raycaster.setFromCamera(new THREE.Vector2(x,y),camera);
  if (raycaster.ray.direction.y>-.055) return null;
  const hit=raycaster.ray.intersectPlane(ground,new THREE.Vector3());
  if (!hit || hit.distanceTo(camera.position)>9) return null;
  return hit;
}

export class GardenAR {
  constructor(canvas,status) {
    this.canvas=canvas;
    this.status=status;
    this.generation=0;
    this.place=this.place.bind(this);
  }

  async open(model,clip) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('카메라를 사용할 수 있는 HTTPS 주소에서 열어 주세요.');
    this.stop();
    const generation=this.generation;
    window.THREE=THREE;
    const orientation=window.DeviceOrientationEvent?.requestPermission?.() ?? Promise.resolve('granted');
    const [motionPermission,xr]=await Promise.all([orientation,warmUpAR()]);
    if (generation!==this.generation) return false;
    if (motionPermission!=='granted') throw new Error('정원에 놓으려면 기기 움직임 권한을 허용해 주세요.');

    this.xr=xr;
    this.avatar=model;
    this.avatar.visible=false;
    this.avatar.scale.setScalar(.37);
    this.avatar.rotation.y=0;
    this.placed=false;
    this.tracked=false;
    this.lastFrame=null;
    this.mixer=new THREE.AnimationMixer(model);
    this.mixer.clipAction(clip).play();
    const cameraFeed=xr.GlTextureRenderer.pipelineModule();
    const three=xr.Threejs.pipelineModule();
    const tracking=xr.XrController.pipelineModule();
    this.modules=[cameraFeed.name,three.name,tracking.name,'moka-floor-placement'];
    xr.XrController.configure({scale:'absolute'});
    this.canvas.addEventListener('pointerup',this.place);
    const session=this;
    xr.addCameraPipelineModules([cameraFeed,three,tracking,{
      name:'moka-floor-placement',
      onStart() {
        const {scene,camera}=xr.Threejs.xrScene();
        session.scene=scene;
        session.camera=camera;
        camera.position.set(0,1.3,0);
        scene.add(new THREE.HemisphereLight(0xffffed,0x789a87,2.25));
        const light=new THREE.DirectionalLight(0xfff6df,2.4);
        light.position.set(-3,5,4);
        scene.add(light,model);
        xr.XrController.updateCameraProjectionMatrix({origin:camera.position,facing:camera.quaternion});
        session.status('바닥을 천천히 비춰요. 위치를 찾으면 안내가 바뀌어요.');
      },
      onCanvasSizeChange() {
        if (session.canvas.isConnected) {
          const style=session.canvas.style;
          style.width='100%';
          style.height='100%';
        }
      },
      onCameraStatusChange({status}) {
        if (status==='failed') session.fail('뒤 카메라를 열 수 없어요. Safari에서 카메라 권한을 확인해 주세요.');
      },
      onUpdate({processCpuResult}) {
        const tracked=processCpuResult?.reality?.trackingStatus==='NORMAL';
        if (tracked!==session.tracked) {
          session.tracked=tracked;
          session.status(tracked?'정원 바닥에서 동물이 살 자리를 터치해요.':'바닥을 천천히 비춰 위치를 다시 찾고 있어요.');
        }
        const now=performance.now();
        if (session.placed && session.lastFrame!==null) {
          session.mixer.update(Math.min((now-session.lastFrame)/1000,.065));
        }
        session.lastFrame=now;
      },
      onException(error) {
        console.error(error);
        session.fail('이 기기에서 AR을 시작하지 못했어요. 수업용 태블릿 브라우저와 카메라 권한을 확인해 주세요.');
      },
    }]);
    try {
      xr.run({canvas:this.canvas, allowedDevices:xr.XrConfig.device().MOBILE,
        cameraConfig:{direction:xr.XrConfig.camera().BACK}});
    } catch(error) {
      this.stop();
      throw error;
    }
    return true;
  }

  fail(message) {
    this.status(message);
    setTimeout(()=>this.stop(),0);
  }

  place(event) {
    if (!this.camera || !this.tracked || !this.avatar) {
      this.status('바닥을 천천히 비추고, 자리 표시 안내가 나오면 터치해요.');
      return;
    }
    const rect=this.canvas.getBoundingClientRect();
    this.camera.updateMatrixWorld(true);
    const x=(event.clientX-rect.left)/rect.width*2-1;
    const y=1-(event.clientY-rect.top)/rect.height*2;
    const position=positionOnFloor(this.camera,x,y);
    if (!position) {
      this.status('태블릿을 바닥 쪽으로 기울이고 놓을 자리를 다시 터치해요.');
      return;
    }
    this.avatar.position.copy(position);
    this.avatar.rotation.y=Math.atan2(this.camera.position.x-position.x,this.camera.position.z-position.z);
    this.avatar.visible=true;
    this.placed=true;
    this.mixer.setTime(0);
    this.status('동물을 놓았어요. 자리를 다시 터치하거나 크기와 방향을 바꿔 볼 수 있어요.');
  }

  resize(factor) {
    if (this.placed) this.avatar.scale.setScalar(THREE.MathUtils.clamp(this.avatar.scale.x*factor,.13,1.2));
  }

  rotate() {
    if (this.placed) this.avatar.rotation.y+=Math.PI/6;
  }

  reset() {
    if (!this.avatar) return;
    this.avatar.visible=false;
    this.placed=false;
    this.status('새로 놓을 자리를 터치해요.');
  }

  stop() {
    this.generation++;
    this.canvas.removeEventListener('pointerup',this.place);
    this.mixer?.stopAllAction();
    this.scene?.remove(this.avatar);
    this.scene=null;
    this.avatar=null;
    this.camera=null;
    if (this.xr) {
      const xr=this.xr;
      this.xr=null;
      try { xr.stop(); } finally { xr.removeCameraPipelineModules(this.modules); }
    }
  }
}

