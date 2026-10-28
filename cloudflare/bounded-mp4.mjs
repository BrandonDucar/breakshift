// Accept one bounded AVC camera track. Read the encoded sample table rather
// than trusting browser-supplied duration/fps or file extensions.
export function inspectMp4(bytes){
  const fail=()=>{throw Error('MUSE_CLIP_FORMAT_REJECTED');};
  if(bytes.length<80||bytes.length>1500000)fail();
  let boxesSeen=0;
  const boxes=(start,end)=>{
    const found=[];let at=start;
    while(at<end){
      if(++boxesSeen>1500||at+8>end)fail();
      let size=bytes.readUInt32BE(at),head=8;const type=bytes.toString('ascii',at+4,at+8);
      if(size===1){if(at+16>end)fail();size=Number(bytes.readBigUInt64BE(at+8));head=16;}
      if(size===0)size=end-at;
      if(!Number.isSafeInteger(size)||size<head||at+size>end)fail();
      found.push({type,start:at+head,end:at+size});at+=size;
    }
    return found;
  };
  const child=(box,type)=>boxes(box.start,box.end).find(x=>x.type===type)||fail();
  const top=boxes(0,bytes.length),moov=top.find(x=>x.type==='moov');
  if(top[0]?.type!=='ftyp'||!moov||!top.some(x=>x.type==='mdat'))fail();
  const tracks=boxes(moov.start,moov.end).filter(x=>x.type==='trak');if(tracks.length!==1)fail();
  const trak=tracks[0],tkhd=child(trak,'tkhd'),mdia=child(trak,'mdia'),mdhd=child(mdia,'mdhd'),hdlr=child(mdia,'hdlr');
  if(bytes.toString('ascii',hdlr.start+8,hdlr.start+12)!=='vide')fail();
  const width=bytes.readUInt32BE(tkhd.end-8)/65536,height=bytes.readUInt32BE(tkhd.end-4)/65536;
  if(!Number.isInteger(width)||!Number.isInteger(height)||Math.min(width,height)<32||Math.max(width,height)>768)fail();
  const version=bytes[mdhd.start],timescale=bytes.readUInt32BE(mdhd.start+(version===1?20:12));if(!timescale||![0,1].includes(version))fail();
  const stbl=child(child(mdia,'minf'),'stbl'),stsd=child(stbl,'stsd');
  const entries=boxes(stsd.start+8,stsd.end);if(entries.length!==1||!['avc1','avc3'].includes(entries[0].type))fail();
  const entry=entries[0];if(entry.start+78>entry.end||!boxes(entry.start+78,entry.end).some(x=>x.type==='avcC'))fail();
  const stsz=child(stbl,'stsz'),stts=child(stbl,'stts');const durations=[];
  const n=bytes.readUInt32BE(stts.start+4);if(n>50||stts.start+8+n*8>stts.end)fail();
  for(let i=0;i<n;i++){
    const count=bytes.readUInt32BE(stts.start+8+i*8),delta=bytes.readUInt32BE(stts.start+12+i*8);
    if(count>48||!delta||durations.length+count>48)fail();for(let j=0;j<count;j++)durations.push(delta);
  }
  // MediaRecorder may emit fragmented MP4 with empty stbl tables.
  if(!durations.length){
    const mvex=boxes(moov.start,moov.end).find(x=>x.type==='mvex');
    const trex=mvex&&boxes(mvex.start,mvex.end).find(x=>x.type==='trex');
    const trexDuration=trex?bytes.readUInt32BE(trex.start+12):0;
    for(const moof of top.filter(x=>x.type==='moof'))for(const traf of boxes(moof.start,moof.end).filter(x=>x.type==='traf')){
      const children=boxes(traf.start,traf.end),tfhd=children.find(x=>x.type==='tfhd');if(!tfhd)fail();
      const flags=bytes.readUIntBE(tfhd.start+1,3);let offset=tfhd.start+8;
      if(flags&1)offset+=8;if(flags&2)offset+=4;
      const defaultDuration=flags&8?bytes.readUInt32BE(offset):trexDuration;
      for(const trun of children.filter(x=>x.type==='trun')){
        const f=bytes.readUIntBE(trun.start+1,3),count=bytes.readUInt32BE(trun.start+4);
        if(!count||count>48||durations.length+count>48)fail();let at=trun.start+8;
        if(f&1)at+=4;if(f&4)at+=4;
        for(let i=0;i<count;i++){
          const delta=f&256?bytes.readUInt32BE(at):defaultDuration;if(f&256)at+=4;
          if(f&512)at+=4;if(f&1024)at+=4;if(f&2048)at+=4;if(at>trun.end||!delta)fail();durations.push(delta);
        }
      }
    }
  }else if(bytes.readUInt32BE(stsz.start+8)!==durations.length)fail();
  if(!durations.length)fail();let elapsed=0;
  const frameTimesMs=durations.map(d=>{const t=elapsed*1000/timescale;elapsed+=d;return t;});
  const durationMs=elapsed*1000/timescale;if(durationMs>2500||durationMs<100)fail();
  return {width,height,frames:durations.length,durationMs,frameTimesMs};
}
