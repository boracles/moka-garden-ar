import {fuseClay} from './clay-fusion.js';

self.onmessage=({data:{id,inputs,boneCount}})=>{
  try {
    const result=fuseClay(inputs,boneCount);
    self.postMessage({id,result},Object.values(result).map(array=>array.buffer));
  } catch (error) {
    self.postMessage({id,error:error.message});
  }
};
