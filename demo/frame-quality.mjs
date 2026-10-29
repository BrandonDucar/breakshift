import assert from 'node:assert/strict';

export function inspectFramePixels(bytes, width=64, height=36) {
  assert.equal(bytes.length,width*height*3);
  const bins=new Set();const counts=new Map();let sum=0,sum2=0,min=255,max=0;
  for(let i=0;i<bytes.length;i+=3){
    const [r,g,b]=bytes.subarray(i,i+3);const bin=`${r>>4}:${g>>4}:${b>>4}`;
    bins.add(bin);counts.set(bin,(counts.get(bin)||0)+1);
    const l=.2126*r+.7152*g+.0722*b;sum+=l;sum2+=l*l;min=Math.min(min,l);max=Math.max(max,l);
  }
  const pixels=width*height,mean=sum/pixels,deviation=Math.sqrt(Math.max(0,sum2/pixels-mean*mean));
  const dominantFraction=Math.max(...counts.values())/pixels;
  assert.ok(bins.size>=8&&max-min>30&&deviation>8&&dominantFraction<.985,'BLANK_OR_NEAR_UNIFORM_FRAME');
  return {sampleWidth:width,sampleHeight:height,colorBins:bins.size,meanLuminance:mean,luminanceDeviation:deviation,dominantFraction};
}
