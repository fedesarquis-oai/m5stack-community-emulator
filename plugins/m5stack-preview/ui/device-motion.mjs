// Presentation-only motion. This module never changes a framebuffer or sends an input.
export const MAX_ROLL_DEGREES=60;
export const SHAKE_DURATION_MS=420;
export const SHAKE_OFFSET_PX=6;
export const TILT_DURATION_MS=160;

export function normalizedRoll(degrees){
  return Number.isFinite(degrees)?Math.max(-MAX_ROLL_DEGREES,Math.min(MAX_ROLL_DEGREES,degrees)):0;
}

export function shakeKeyframes(degrees){
  const roll=normalizedRoll(degrees);
  return [0,-1,1,-.75,.75,-.4,.4,0].map((amount,index)=>({
    transform:`translateX(${amount*SHAKE_OFFSET_PX}px) rotate(${roll}deg)`,
    offset:index/7,
  }));
}

// p1/p2/p4 describe the transformed top-left/top-right/bottom-left corners.
// An affine inverse handles rotation, translation, and scale, including DOMQuad.
export function nativePointFromQuad(quad,width,height,x,y){
  if(!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 ||
     !Number.isFinite(x) || !Number.isFinite(y))return null;
  const {p1,p2,p4}=quad || {};
  if(![p1,p2,p4].every(point=>point && Number.isFinite(point.x) && Number.isFinite(point.y)))return null;
  const ax=p2.x-p1.x,ay=p2.y-p1.y,bx=p4.x-p1.x,by=p4.y-p1.y;
  const determinant=ax*by-ay*bx;
  if(!Number.isFinite(determinant) || Math.abs(determinant)<1e-9)return null;
  const dx=x-p1.x,dy=y-p1.y;
  let u=(dx*by-dy*bx)/determinant,v=(ax*dy-ay*dx)/determinant;
  // Allow rounding at the inclusive top/left edges; right/bottom stay exclusive.
  const epsilon=1e-12;
  if(u< -epsilon || v< -epsilon || u>=1-epsilon || v>=1-epsilon)return null;
  u=Math.max(0,u);v=Math.max(0,v);
  return {x:Math.min(width-1,Math.floor(u*width+epsilon)),y:Math.min(height-1,Math.floor(v*height+epsilon))};
}

// Fallback for browsers without getBoxQuads. The center of a rotated rectangle's
// axis-aligned bounds is also its transformed center. Sizes are unrotated CSS px.
export function nativePointFromPose(rect,cssWidth,cssHeight,degrees,width,height,x,y){
  if(!rect || ![rect.left,rect.top,rect.width,rect.height,cssWidth,cssHeight,degrees].every(Number.isFinite) ||
     rect.width<=0 || rect.height<=0 || cssWidth<=0 || cssHeight<=0)return null;
  const radians=degrees*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  const centerX=rect.left+rect.width/2,centerY=rect.top+rect.height/2;
  const corner=(localX,localY)=>({x:centerX+localX*c-localY*s,y:centerY+localX*s+localY*c});
  return nativePointFromQuad({p1:corner(-cssWidth/2,-cssHeight/2),p2:corner(cssWidth/2,-cssHeight/2),
    p4:corner(-cssWidth/2,cssHeight/2)},width,height,x,y);
}

function rotationFromTransform(transform,fallback){
  const matrix=/^matrix\(([^)]+)\)$/.exec(transform || '');
  if(matrix){const values=matrix[1].split(',').map(Number);if(values.length===6 && values.every(Number.isFinite))return Math.atan2(values[1],values[0])*180/Math.PI;}
  const matrix3d=/^matrix3d\(([^)]+)\)$/.exec(transform || '');
  if(matrix3d){const values=matrix3d[1].split(',').map(Number);if(values.length===16 && values.every(Number.isFinite))return Math.atan2(values[1],values[0])*180/Math.PI;}
  return fallback;
}

export class DeviceMotion {
  constructor(shell,{onLayout=()=>{},getStyle=element=>globalThis.getComputedStyle?.(element),
    mediaQuery=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')}={}){
    this.shell=shell;this.onLayout=onLayout;this.getStyle=getStyle;this.mediaQuery=mediaQuery;
    this.rollDegrees=0;this.layoutRollDegrees=0;this.tiltAnimation=null;this.shakeAnimation=null;this.disposed=false;
    this.onMotionPreference=()=>{if(this.mediaQuery?.matches)this.cancel();};
    mediaQuery?.addEventListener?.('change',this.onMotionPreference);
    shell.style.transform='rotate(0deg)';
  }
  get reducedMotion(){return Boolean(this.mediaQuery?.matches);}
  currentRoll(){return rotationFromTransform(this.getStyle(this.shell)?.transform,this.rollDegrees);}
  cancelAnimations(){
    // Detach first: cancellation must not run an obsolete completion handler.
    for(const key of ['tiltAnimation','shakeAnimation']){const animation=this[key];this[key]=null;if(animation){animation.onfinish=null;animation.cancel();}}
  }
  cancel(){
    this.cancelAnimations();this.shell.style.transform=`rotate(${this.rollDegrees}deg)`;
    this.layoutRollDegrees=Math.abs(this.rollDegrees);this.onLayout();
  }
  setRoll(degrees){
    if(this.disposed)return false;
    const next=normalizedRoll(degrees);if(next===this.rollDegrees)return false;
    const previous=this.currentRoll();this.cancelAnimations();
    this.rollDegrees=next;this.layoutRollDegrees=Math.max(Math.abs(previous),Math.abs(next));
    this.shell.style.transform=`rotate(${next}deg)`;this.onLayout();
    if(!this.reducedMotion && typeof this.shell.animate==='function'){
      try{
        const animation=this.shell.animate([{transform:`rotate(${previous}deg)`},{transform:`rotate(${next}deg)`}],{duration:TILT_DURATION_MS,easing:'ease-out'});
        this.tiltAnimation=animation;
        animation.onfinish=()=>{if(this.tiltAnimation!==animation || this.disposed)return;this.tiltAnimation=null;this.layoutRollDegrees=Math.abs(this.rollDegrees);this.onLayout();};
        return true;
      }catch{/* Static pose remains usable when animation is unavailable. */}
    }
    this.layoutRollDegrees=Math.abs(next);this.onLayout();return true;
  }
  shake(){
    if(this.disposed || this.reducedMotion || typeof this.shell.animate!=='function')return false;
    this.cancel();
    try{
      const animation=this.shell.animate(shakeKeyframes(this.rollDegrees),{duration:SHAKE_DURATION_MS,easing:'linear'});
      this.shakeAnimation=animation;
      animation.onfinish=()=>{if(this.shakeAnimation===animation)this.shakeAnimation=null;};
      return true;
    }catch{return false;}
  }
  reset(){
    if(this.disposed)return;
    this.rollDegrees=0;this.cancel();
  }
  nativePoint(canvas,width,height,x,y){
    if(this.disposed)return null;
    try{const quad=canvas.getBoxQuads?.()[0];if(quad)return nativePointFromQuad(quad,width,height,x,y);}catch{/* Use the supported flat-pose fallback. */}
    const style=this.getStyle(canvas);
    const cssWidth=Number.parseFloat(style?.width) || canvas.clientWidth;
    const cssHeight=Number.parseFloat(style?.height) || canvas.clientHeight;
    return nativePointFromPose(canvas.getBoundingClientRect(),cssWidth,cssHeight,this.currentRoll(),width,height,x,y);
  }
  dispose(){
    if(this.disposed)return;
    this.disposed=true;this.cancelAnimations();
    this.mediaQuery?.removeEventListener?.('change',this.onMotionPreference);
    this.shell.style.transform=`rotate(${this.rollDegrees}deg)`;
  }
}
