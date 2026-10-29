import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFramePixels} from './frame-quality.mjs';
test('uniform gray and tiny contrast marks cannot masquerade as nonblank content',()=>{
  const gray=Buffer.alloc(64*36*3,30);
  assert.throws(()=>inspectFramePixels(gray),/BLANK_OR_NEAR_UNIFORM/);
  for(let i=0;i<24;i++)gray[i]=i*10;
  assert.throws(()=>inspectFramePixels(gray),/BLANK_OR_NEAR_UNIFORM/);
});
test('spatially varied content passes and wrong dimensions fail',()=>{
  const pixels=Buffer.from(Array.from({length:64*36*3},(_,i)=>(i*13)%256));
  assert.ok(inspectFramePixels(pixels).luminanceDeviation>8);
  assert.throws(()=>inspectFramePixels(pixels.subarray(3)));
});
