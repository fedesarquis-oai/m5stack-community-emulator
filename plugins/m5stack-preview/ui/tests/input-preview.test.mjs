import test from 'node:test';
import assert from 'node:assert/strict';
import {INPUT_PREVIEW_CATALOG,createInputPreview,applyPreviewInput,drawInputPreview} from '../input-preview.mjs';

for(const profile of INPUT_PREVIEW_CATALOG.profiles){
  test(profile.id+' local Hello World: short +1 independent of motion; hold resets on release',()=>{
    const state=createInputPreview(profile);
    assert.equal(state.count,0);
    assert.equal(applyPreviewInput(state,profile,{type:'primary',durationMs:999}),true);assert.equal(state.count,1);
    assert.equal(applyPreviewInput(state,profile,{type:'tilt',degrees:30}),profile.motion);assert.equal(applyPreviewInput(state,profile,{type:'shake'}),profile.motion);
    assert.equal(state.count,1);assert.equal(state.rollDegrees,profile.motion?30:0);assert.equal(state.shakeMark,profile.motion);
    applyPreviewInput(state,profile,{type:'primary',durationMs:50});assert.equal(state.count,2);
    applyPreviewInput(state,profile,{type:'primary',durationMs:1000});assert.equal(state.count,0);assert.equal(state.rollDegrees,0);assert.equal(state.shakeMark,false);
    applyPreviewInput(state,profile,{type:'primary',durationMs:50});applyPreviewInput(state,profile,{type:'reset'});assert.equal(state.count,0);
  });
}
test('local inputs reject invalid durations, unsupported motion and mismatched profile',()=>{
  const profile=INPUT_PREVIEW_CATALOG.profiles[0],state=createInputPreview(profile);
  for(const durationMs of [-1,1000.1,60001,Infinity,NaN,'1000'])assert.equal(applyPreviewInput(state,profile,{type:'primary',durationMs}),false);
  for(const degrees of [61,-61,Infinity,NaN,'30'])assert.equal(applyPreviewInput(state,profile,{type:'tilt',degrees}),false);
  assert.equal(applyPreviewInput(state,{...profile,motion:false},{type:'shake'}),false);
  assert.equal(applyPreviewInput(state,{...profile,motion:false},{type:'tilt',degrees:0}),false);
  assert.equal(applyPreviewInput(state,INPUT_PREVIEW_CATALOG.profiles[1],{type:'primary',durationMs:50}),false);
  assert.equal(state.count,0);assert.equal(state.revision,0);
});
test('repeated local +1 crosses 999 without wrapping and fits a narrow display',()=>{
  const profile=INPUT_PREVIEW_CATALOG.profiles[1],state=createInputPreview(profile);state.count=999;
  applyPreviewInput(state,profile,{type:'primary',durationMs:0});assert.equal(state.count,1000);
  const texts=[],context={fillRect(){},fillText(text,x,y,maxWidth){texts.push({text,font:this.font,maxWidth});}},canvas={getContext:()=>context};
  drawInputPreview(canvas,state,profile);const count=texts.find(item=>item.text==='1000');
  assert.equal(canvas.width,135);assert.equal(canvas.height,240);assert.ok(parseInt(count.font)*4*.62<=119);assert.equal(count.maxWidth,119);
  state.count=Number.MAX_SAFE_INTEGER;assert.equal(applyPreviewInput(state,profile,{type:'primary',durationMs:0}),false);assert.equal(state.count,Number.MAX_SAFE_INTEGER);
});

test('CoreS3 SE preview exposes the real lower touch surface while preserving its LCD and absent motion',()=>{
  const profile=INPUT_PREVIEW_CATALOG.profiles.find(item=>item.id==='cores3se'),state=createInputPreview(profile);
  assert.equal(profile.motion,false);assert.equal(profile.microphone,true);assert.equal(profile.audioOutput,'speaker');
  for(const event of [{type:'shake'},{type:'tilt',degrees:0},{type:'tilt',degrees:30},{type:'primary',durationMs:50,x:320,y:0},{type:'primary',durationMs:50,x:0,y:280},{type:'primary',durationMs:1000,x:0,y:-1},{type:'primary',durationMs:50,x:0}])assert.equal(applyPreviewInput(state,profile,event),false);
  assert.equal(state.revision,0);assert.equal(state.count,0);
  assert.equal(applyPreviewInput(state,profile,{type:'primary',durationMs:50,x:319,y:239}),true);assert.equal(state.count,1);
  for(const [x,label] of [[0,'A'],[106,'A'],[107,'B'],[213,'B'],[214,'C'],[319,'C']]){
    assert.equal(applyPreviewInput(state,profile,{type:'primary',durationMs:50,x,y:260}),true);assert.equal(state.lastInput,'Touch '+label+' +1');
  }
  assert.equal(state.count,7);
  const standard=INPUT_PREVIEW_CATALOG.profiles.find(item=>item.id==='cores3');
  assert.equal(applyPreviewInput(createInputPreview(standard),standard,{type:'primary',durationMs:50,x:160,y:260}),false);
  const rectangles=[],context={fillRect(...args){rectangles.push(args);},fillText(){}},canvas={getContext:()=>context};
  drawInputPreview(canvas,state,profile);assert.deepEqual([canvas.width,canvas.height],[320,240]);
  assert.deepEqual(rectangles,[[0,0,320,240]],'SE does not draw the motion indicator');
});

test('Core POWER click and hold stay distinct from touch count and app reset',()=>{
  for(const profile of INPUT_PREVIEW_CATALOG.profiles){
    const state=createInputPreview(profile);state.count=4;
    const core=['cores3','cores3se'].includes(profile.id);
    for(const action of ['click','hold']){
      assert.equal(applyPreviewInput(state,profile,{type:'power',action}),core);
      assert.equal(state.count,4);assert.equal(state.rollDegrees,0);
      if(core)assert.equal(state.lastInput,'POWER '+action);
    }
    const before=structuredClone(state);
    for(const event of [{type:'power'},{type:'power',action:'off'},{type:'power',action:'hold',durationMs:6000}])assert.equal(applyPreviewInput(state,profile,event),false);
    assert.deepEqual(state,before);
    assert.equal(applyPreviewInput(state,profile,{type:'reset'}),true);assert.equal(state.count,0);
  }
});
