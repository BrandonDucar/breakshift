export async function captureInspectionClip(draw,{width,height,onProgress=()=>{},signal}={}){
  const mime=['video/mp4;codecs=avc1.42001E','video/mp4;codecs=avc3.42001E','video/mp4'].find(x=>globalThis.MediaRecorder?.isTypeSupported(x));
  if(!mime)throw Error('This browser cannot record the required MP4 format. Take a still photo for SAM outlines and Wonder diagnosis.');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');draw(context,0,width,height);
  const poster=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));
  const stream=canvas.captureStream(10),chunks=[];const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:600000});
  let failure=null;recorder.onerror=event=>{failure=event.error||Error('MP4 recording failed.');};
  const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
  try{
    recorder.start(200);
    for(let i=0;i<18;i++){if(signal?.aborted)throw Error('Clip capture cancelled.');draw(context,i,width,height);onProgress(i/18);await new Promise(resolve=>setTimeout(resolve,100));}
    recorder.stop();await stopped;if(failure)throw failure;
    const blob=new Blob(chunks,{type:'video/mp4'});if(blob.size<80||blob.size>1500000)throw Error('The camera clip could not be encoded within the size limit. Use a still photo.');
    const videoDataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
    return {blob,videoDataUrl,poster};
  }finally{if(recorder.state!=='inactive')recorder.stop();stream.getTracks().forEach(track=>track.stop());}
}
