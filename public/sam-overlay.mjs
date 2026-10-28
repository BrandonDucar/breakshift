export function createSamOverlay(canvas,video){
  let data=null,selected=null,callback=null;const masks=new Map();
  const context=canvas.getContext('2d');
  function stop(){if(callback!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(callback);callback=null;}
  function frameAt(ms){let index=-1;for(let i=0;i<data.frameTimesMs.length;i++){if(data.frameTimesMs[i]>ms+1)break;index=i;}return index;}
  function maskCanvas(object){
    const key=JSON.stringify(object.mask);if(masks.has(key))return masks.get(key);
    const {width,height,bitsBase64}=object.mask,bytes=Uint8Array.from(atob(bitsBase64),c=>c.charCodeAt(0));
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>128||height>128||bytes.length!==Math.ceil(width*height/8))throw Error('Invalid SAM display mask.');
    const mask=document.createElement('canvas');mask.width=width;mask.height=height;const ctx=mask.getContext('2d'),pixels=ctx.createImageData(width,height);
    const on=(x,y)=>x>=0&&x<width&&y>=0&&y<height&&Boolean(bytes[(y*width+x)>>3]&(128>>((y*width+x)&7)));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(on(x,y)){
      const edge=!on(x-1,y)||!on(x+1,y)||!on(x,y-1)||!on(x,y+1),at=(y*width+x)*4;
      pixels.data[at]=111;pixels.data[at+1]=218;pixels.data[at+2]=255;pixels.data[at+3]=edge?245:35;
    }
    ctx.putImageData(pixels,0,0);masks.set(key,mask);return mask;
  }
  function render(mediaTime=video.currentTime){
    context.clearRect(0,0,canvas.width,canvas.height);if(!data)return;
    const index=data.kind==='VIDEO_TRACKING'?frameAt(mediaTime*1000):0;
    const frame=data.frames.find(f=>f.frameIndex===index);canvas.dataset.frameIndex=String(index);canvas.dataset.visibleObjects=String(frame?.objects.length||0);
    if(!frame)return;
    for(const object of frame.objects){
      const {left,top,right,bottom}=object.bounds;
      context.globalAlpha=selected===null||selected===object.id?1:.3;context.imageSmoothingEnabled=false;
      context.drawImage(maskCanvas(object),left,top,right-left,bottom-top);
      context.globalAlpha=1;context.font='11px monospace';context.fillStyle='#10212a';context.fillRect(left,Math.max(0,top-19),92,18);context.fillStyle='#a5eaff';context.fillText(`SAM object ${object.id}`,left+4,Math.max(12,top-6));
    }
  }
  function tick(){render();if(data?.kind==='VIDEO_TRACKING'&&!video.paused&&!video.ended&&video.requestVideoFrameCallback)callback=video.requestVideoFrameCallback((_,metadata)=>{callback=null;render(metadata.mediaTime);tick();});}
  video.addEventListener('play',tick);video.addEventListener('pause',stop);video.addEventListener('seeked',()=>render());video.addEventListener('timeupdate',()=>render());
  return {setResult(value){stop();data=value;selected=null;masks.clear();canvas.width=value.dimensions.width;canvas.height=value.dimensions.height;canvas.hidden=false;render();},select(id){selected=id;render();},clear(){stop();data=null;masks.clear();context.clearRect(0,0,canvas.width,canvas.height);canvas.hidden=true;}};
}
