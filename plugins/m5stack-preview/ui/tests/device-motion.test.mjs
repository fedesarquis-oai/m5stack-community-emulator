import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceMotion,normalizedRoll,shakeKeyframes,nativePointFromQuad,nativePointFromPose,
  SHAKE_OFFSET_PX,SHAKE_DURATION_MS,TILT_DURATION_MS} from '../device-motion.mjs';

function scene(degrees,cssWidth=352,cssHeight=264){
  const radians=degrees*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  const point=(u,v)=>({x:203+(u-.5)*cssWidth*c-(v-.5)*cssHeight*s,y:187+(u-.5)*cssWidth*s+(v-.5)*cssHeight*c});
  const quad={p1:point(0,0),p2:point(1,0),p3:point(1,1),p4:point(0,1)};
  const corners=Object.values(quad);
  const left=Math.min(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y));
  const rect={left,top,width:Math.max(...corners.map(p=>p.x))-left,height:Math.max(...corners.map(p=>p.y))-top};
  return {point,quad,rect,cssWidth,cssHeight};
}

for(const roll of [-60,-30,0,30,60])test(`CoreS3 touch maps rotated corners, center and native pixel centers at ${roll} degrees`,()=>{
  const {point,quad,rect,cssWidth,cssHeight}=scene(roll);
  for(const [x,y] of [[0,0],[319,0],[0,239],[319,239],[160,120],[74,188]]){
    const p=point((x+.5)/320,(y+.5)/240);
    assert.deepEqual(nativePointFromQuad(quad,320,240,p.x,p.y),{x,y});
    assert.deepEqual(nativePointFromPose(rect,cssWidth,cssHeight,roll,320,240,p.x,p.y),{x,y});
  }
  for(const [u,v] of [[-.001,.5],[1,.5],[.5,-.001],[.5,1],[-.01,-.01],[1.01,1.01]]){
    const p=point(u,v);
    assert.equal(nativePointFromQuad(quad,320,240,p.x,p.y),null);
    assert.equal(nativePointFromPose(rect,cssWidth,cssHeight,roll,320,240,p.x,p.y),null);
  }
  const p=point(0,0);assert.deepEqual(nativePointFromQuad(quad,320,240,p.x,p.y),{x:0,y:0});
  if(roll){
    // BCR corners are empty space outside a rotated display, not valid touch pixels.
    assert.equal(nativePointFromPose(rect,cssWidth,cssHeight,roll,320,240,rect.left+.01,rect.top+.01),null);
  }
});

test('invalid coordinate geometry fails closed and affine scale/translation remain accurate',()=>{
  const {quad,point,rect}=scene(30);
  assert.equal(nativePointFromQuad(null,320,240,0,0),null);
  assert.equal(nativePointFromQuad({p1:{x:0,y:0},p2:{x:1,y:1},p4:{x:2,y:2}},320,240,0,0),null);
  assert.equal(nativePointFromQuad(quad,0,240,0,0),null);
  assert.equal(nativePointFromQuad(quad,320,240,NaN,0),null);
  assert.equal(nativePointFromPose(rect,0,264,30,320,240,0,0),null);
  assert.equal(nativePointFromPose(rect,352,264,NaN,320,240,0,0),null);
  const transform=p=>({x:p.x*1.5+50,y:p.y*.75-20});
  const scaled=Object.fromEntries(Object.entries(quad).map(([key,value])=>[key,transform(value)]));
  const p=transform(point((80+.5)/320,(70+.5)/240));
  assert.deepEqual(nativePointFromQuad(scaled,320,240,p.x,p.y),{x:80,y:70});
});

function harness({reduced=false,animated=true}={}){
  const animations=[],listeners=new Map();let layouts=0,liveRoll=null;
  const shell={style:{}};
  if(animated)shell.animate=(frames,options)=>{const animation={frames,options,cancelled:false,onfinish:null,cancel(){this.cancelled=true;}};animations.push(animation);return animation;};
  const mediaQuery={matches:reduced,addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:(name,callback)=>{if(listeners.get(name)===callback)listeners.delete(name);}};
  const getStyle=element=>{
    if(element!==shell)return {width:'352px',height:'264px'};
    if(liveRoll===null)return {transform:shell.style.transform};
    const r=liveRoll*Math.PI/180;return {transform:`matrix(${Math.cos(r)}, ${Math.sin(r)}, ${-Math.sin(r)}, ${Math.cos(r)}, 0, 0)`};
  };
  const motion=new DeviceMotion(shell,{mediaQuery,getStyle,onLayout:()=>layouts++});
  return {motion,shell,animations,listeners,mediaQuery,get layouts(){return layouts;},setLiveRoll:value=>{liveRoll=value;}};
}

test('shake is bounded, preserves tilt and ends at the static pose without accumulating animations',()=>{
  const h=harness();h.motion.setRoll(-60);h.animations.at(-1).onfinish();
  assert.equal(h.motion.shake(),true);
  const first=h.animations.at(-1);assert.equal(first.options.duration,SHAKE_DURATION_MS);
  assert.equal(first.frames[0].transform,'translateX(0px) rotate(-60deg)');
  assert.equal(first.frames.at(-1).transform,'translateX(0px) rotate(-60deg)');
  for(const frame of first.frames){assert.ok(Math.abs(Number(/translateX\(([^p]+)px/.exec(frame.transform)[1]))<=SHAKE_OFFSET_PX);assert.match(frame.transform,/rotate\(-60deg\)/);}
  h.motion.shake();assert.equal(first.cancelled,true);assert.notEqual(h.motion.shakeAnimation,first);
  h.animations.at(-1).onfinish();assert.equal(h.motion.shakeAnimation,null);assert.equal(h.shell.style.transform,'rotate(-60deg)');
});

test('tilt reserves the complete transition envelope and uses the current rendered angle when interrupted',()=>{
  const h=harness();h.motion.setRoll(60);const first=h.animations.at(-1);
  assert.equal(first.options.duration,TILT_DURATION_MS);assert.equal(h.motion.layoutRollDegrees,60);
  const staleFinish=first.onfinish;
  h.setLiveRoll(37);h.motion.setRoll(-30);const second=h.animations.at(-1);
  assert.equal(first.cancelled,true);assert.equal(second.frames[0].transform,'rotate(37deg)');
  assert.equal(h.motion.layoutRollDegrees,37);
  staleFinish();assert.equal(h.motion.tiltAnimation,second,'cancelled animation cannot complete a newer one');
  second.onfinish();assert.equal(h.motion.layoutRollDegrees,30);assert.equal(h.motion.tiltAnimation,null);
  const count=h.animations.length;h.motion.setRoll(-30);assert.equal(h.animations.length,count,'paint refresh does not restart the same pose');
});

test('reduced motion preserves tilt and disables transient shake; toggling preference cancels active motion',()=>{
  const h=harness({reduced:true});h.motion.setRoll(60);
  assert.equal(h.shell.style.transform,'rotate(60deg)');assert.equal(h.motion.layoutRollDegrees,60);
  assert.equal(h.motion.shake(),false);assert.equal(h.animations.length,0);
  h.mediaQuery.matches=false;h.motion.setRoll(-30);const animation=h.animations.at(-1);
  h.mediaQuery.matches=true;h.listeners.get('change')();
  assert.equal(animation.cancelled,true);assert.equal(h.shell.style.transform,'rotate(-30deg)');
  assert.equal(h.motion.layoutRollDegrees,30);assert.equal(h.motion.tiltAnimation,null);
});

test('reset, cancellation and disposal leave no motion running or preference listener',()=>{
  const h=harness();h.motion.setRoll(30);h.motion.shake();const shake=h.animations.at(-1);
  h.motion.reset();assert.equal(shake.cancelled,true);assert.equal(h.motion.rollDegrees,0);
  assert.equal(h.motion.layoutRollDegrees,0);assert.equal(h.shell.style.transform,'rotate(0deg)');
  h.motion.setRoll(60);h.motion.cancel();assert.equal(h.motion.tiltAnimation,null);assert.equal(h.shell.style.transform,'rotate(60deg)');
  h.motion.shake();const last=h.animations.at(-1);h.motion.dispose();
  assert.equal(last.cancelled,true);assert.equal(h.listeners.size,0);assert.equal(h.motion.setRoll(0),false);assert.equal(h.motion.shake(),false);
});

test('non-animating hosts still render supported static tilt without changing DOM or canvas pixels',()=>{
  const h=harness({animated:false});h.motion.setRoll(30);assert.equal(h.shell.style.transform,'rotate(30deg)');
  assert.equal(h.motion.shake(),false);assert.equal(normalizedRoll(100),60);assert.equal(normalizedRoll(-100),-60);assert.equal(normalizedRoll(NaN),0);
  assert.equal(shakeKeyframes(Infinity)[0].transform,'translateX(0px) rotate(0deg)');
});

test('DOM touch fallback reads the in-flight transform, and uses DOMQuad when supplied',()=>{
  const h=harness();h.motion.setRoll(60);h.setLiveRoll(25);
  const sample=scene(25),p=sample.point((57+.5)/320,(201+.5)/240);
  const canvas={getBoundingClientRect:()=>sample.rect};
  assert.deepEqual(h.motion.nativePoint(canvas,320,240,p.x,p.y),{x:57,y:201});
  const quadSample=scene(-30),q=quadSample.point((100+.5)/320,(37+.5)/240);
  canvas.getBoxQuads=()=>[quadSample.quad];
  assert.deepEqual(h.motion.nativePoint(canvas,320,240,q.x,q.y),{x:100,y:37});
});
