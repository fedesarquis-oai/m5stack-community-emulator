import {normalizedRoll,SHAKE_OFFSET_PX} from './device-motion.mjs';
// Layout geometry only. Native pixel dimensions are never modified by sizing.
export const DEVICE_GEOMETRY=Object.freeze({
  atoms3r:{width:240,height:240,screen:{x:18,y:22,width:204,height:204}},
  stickcplus2:{width:200,height:400,screen:{x:21,y:36,width:158,height:158*240/135}},
  sticks3:{width:200,height:400,screen:{x:21,y:36,width:158,height:158*240/135}},
  cores3:{width:400,height:400,screen:{x:24,y:52,width:352,height:264}},
  cores3se:{width:400,height:400,motion:false,screen:{x:24,y:52,width:352,height:264},touchStrip:{x:24,y:316,width:352,height:44}},
});

// Symmetric room for the horizontal shake and case shadow at any supported roll.
export const DEVICE_MARGIN_X=SHAKE_OFFSET_PX+18;
export const DEVICE_MARGIN_Y=24;

export function rotatedBounds(width,height,degrees){
  const radians=degrees*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));
  return {width:width*c+height*s,height:width*s+height*c};
}

// Maximum bounds anywhere between neutral and +/-roll, also covering animated
// left-to-right changes. Stick's maximum vertical extent occurs around 27deg.
export function motionEnvelope(width,height,degrees){
  const extent=Math.abs(normalizedRoll(degrees));
  const angles=[0,extent,Math.min(extent,Math.atan2(height,width)*180/Math.PI),
    Math.min(extent,Math.atan2(width,height)*180/Math.PI)];
  const bounds=angles.map(angle=>rotatedBounds(width,height,angle));
  return {width:Math.max(...bounds.map(bound=>bound.width)),height:Math.max(...bounds.map(bound=>bound.height))};
}

export function deviceLayout(profile,availableWidth,availableHeight,{rollDegrees=0}={}){
  const geometry=DEVICE_GEOMETRY[profile];
  if(!geometry)throw new Error('Unsupported device layout.');
  if(!Number.isFinite(availableWidth) || !Number.isFinite(availableHeight) || availableWidth<=0 || availableHeight<=0)return null;
  const widthFraction=.86-.24*Math.min(1,Math.max(0,(availableWidth-320)/280));
  const preferredWidth=availableWidth*widthFraction;
  const envelope=motionEnvelope(geometry.width,geometry.height,geometry.motion===false?0:rollDegrees);
  const scale=Math.max(0,Math.min(preferredWidth/geometry.width,(availableHeight-18)*.9/geometry.height,
    (availableWidth-DEVICE_MARGIN_X*2)/envelope.width,(availableHeight-DEVICE_MARGIN_Y*2)/envelope.height));
  if(scale===0)return null;
  const screen=Object.fromEntries(Object.entries(geometry.screen).map(([key,value])=>[key,value*scale]));
  const touchStrip=geometry.touchStrip?Object.fromEntries(Object.entries(geometry.touchStrip).map(([key,value])=>[key,value*scale])):undefined;
  return {width:geometry.width*scale,height:geometry.height*scale,screen,...(touchStrip?{touchStrip}:{})};
}
