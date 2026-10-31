function canvasPaint(signal){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(Error('Clip capture cancelled.'));return;}
    let frame,timer,settled=false;
    const abort=()=>finish(Error('Clip capture cancelled.'));
    const finish=error=>{
      if(settled)return;settled=true;cancelAnimationFrame(frame);clearTimeout(timer);
      signal?.removeEventListener('abort',abort);error?reject(error):resolve();
    };
    signal?.addEventListener('abort',abort,{once:true});
    frame=requestAnimationFrame(()=>finish());
    timer=setTimeout(()=>finish(Error('Camera preview stopped updating. Keep this tab visible or take a still photo.')),1500);
  });
}

function prepareRecorder(recorder,draw,signal){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(Error('Clip capture cancelled.'));return;}
    let frame,timer,settled=false;
    const abort=()=>finish(Error('Clip capture cancelled.'));
    const failed=event=>finish(event.error||Error('MP4 recording failed.'));
    const ready=()=>finish();
    const finish=error=>{
      if(settled)return;settled=true;cancelAnimationFrame(frame);clearTimeout(timer);
      recorder.removeEventListener('start',ready);recorder.removeEventListener('error',failed);
      signal?.removeEventListener('abort',abort);error?reject(error):resolve();
    };
    const paint=()=>{try{draw();if(!settled)frame=requestAnimationFrame(paint);}catch(error){finish(error);}};
    recorder.addEventListener('start',ready,{once:true});recorder.addEventListener('error',failed,{once:true});
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(Error('The video encoder could not start. Take a still photo instead.')),4000);
    try{recorder.start(200);frame=requestAnimationFrame(paint);}catch(error){finish(error);}
  });
}

function finishRecorder(recorder){
  return new Promise((resolve,reject)=>{
    let timer;
    const finish=error=>{clearTimeout(timer);recorder.removeEventListener('stop',stopped);error?reject(error):resolve();};
    const stopped=()=>finish();
    recorder.addEventListener('stop',stopped,{once:true});
    timer=setTimeout(()=>finish(Error('The video encoder did not finish. Take a still photo instead.')),4000);
    try{recorder.stop();}catch(error){finish(error);}
  });
}

export async function captureInspectionClip(draw,{width,height,onProgress=()=>{},signal}={}){
  const mime=['video/mp4;codecs=avc1.42001E','video/mp4;codecs=avc3.42001E','video/mp4'].find(x=>globalThis.MediaRecorder?.isTypeSupported(x));
  if(!mime)throw Error('This browser cannot record the required MP4 format. Take a still photo for SAM outlines and Wonder diagnosis.');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');draw(context,0,width,height);
  const poster=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));
  const stream=canvas.captureStream(10),chunks=[];let recorder,primer;
  try{
    // A cold AVC encoder can start after the entire short capture window. Discard
    // startup media, then record a separate bounded clip with the warmed encoder.
    primer=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:600000});
    await prepareRecorder(primer,()=>draw(context,0,width,height),signal);await finishRecorder(primer);
    if(signal?.aborted)throw Error('Clip capture cancelled.');
    recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:600000});
    let failure=null;recorder.onerror=event=>{failure=event.error||Error('MP4 recording failed.');};
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    const recordingAt=performance.now();
    await prepareRecorder(recorder,()=>draw(context,0,width,height),signal);
    // Canvas capture samples painted frames; timers alone can leave a phone clip empty.
    for(let i=0;i<18&&performance.now()-recordingAt<1800;i++){if(signal?.aborted)throw Error('Clip capture cancelled.');draw(context,i,width,height);onProgress(i/18);await canvasPaint(signal);await new Promise(resolve=>setTimeout(resolve,100));}
    if(performance.now()-recordingAt>2200)throw Error('The camera clip exceeded its local recording window. Take a still photo instead.');
    await finishRecorder(recorder);if(failure)throw failure;if(signal?.aborted)throw Error('Clip capture cancelled.');
    const blob=new Blob(chunks,{type:'video/mp4'});if(blob.size<80||blob.size>1500000)throw Error('The camera clip could not be encoded within the size limit. Use a still photo.');
    const videoDataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
    if(signal?.aborted)throw Error('Clip capture cancelled.');return {blob,videoDataUrl,poster};
  }finally{
    try{for(const value of [recorder,primer]){try{if(value&&value.state!=='inactive')value.stop();}catch{}}}
    finally{stream.getTracks().forEach(track=>track.stop());}
  }
}
