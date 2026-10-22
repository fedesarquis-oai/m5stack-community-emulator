// A UI-only first-open example, never a native process or firmware emulator.
// The small fallback catalog makes the first render useful before host connect.
import {DEVICE_PROFILES} from './device-profiles.mjs';
export const INPUT_PREVIEW_CATALOG={profiles:DEVICE_PROFILES,apps:[{id:'counter',label:'Hello World',example:true}]};

export function createInputPreview(profile){
  return {profile:profile.id,width:profile.width,height:profile.height,count:0,rollDegrees:0,micLevel:0,micSource:'fixture',shakeMark:false,lastInput:'Ready',revision:0};
}
export function applyPreviewInput(state,profile,event){
  if(!state || state.profile!==profile.id)return false;
  if(event.type==='primary' && (!Number.isInteger(event.durationMs) || event.durationMs<0 || event.durationMs>60000))return false;
  if(event.type==='primary'){
    const hasX=Object.hasOwn(event,'x'),hasY=Object.hasOwn(event,'y');
    const touchHeight=profile.id==='cores3se'&&profile.touchStrip===true?280:profile.height;
    if(hasX!==hasY || (hasX && (profile.primaryInput!=='touch' || !Number.isInteger(event.x) || !Number.isInteger(event.y) || event.x<0 || event.y<0 || event.x>=profile.width || event.y>=touchHeight)))return false;
  }
  if(event.type==='secondary'){
    if(!profile.secondaryButton || Object.keys(event).length!==2 || !Number.isInteger(event.durationMs) || event.durationMs<0 || event.durationMs>60000)return false;
    state.lastInput=event.durationMs>=1000?'B hold':'B click';state.revision++;return true;
  }
  if(event.type==='reset' || (event.type==='primary' && event.durationMs>=1000)){
    Object.assign(state,createInputPreview(profile),{revision:state.revision+1,lastInput:'Reset'});return true;
  }
  if(event.type==='primary' && Number.isInteger(event.durationMs) && event.durationMs>=0 && event.durationMs<=60000){
    if(!Number.isSafeInteger(state.count) || state.count>=Number.MAX_SAFE_INTEGER)return false;
    state.count++;state.lastInput=profile.id==='cores3se'&&event.y>=240?'Touch '+['A','B','C'][Math.floor(event.x*614/65536)]+' +1':profile.primaryInput==='touch'?'Tap +1':'Button +1';
  }else if(event.type==='power' && profile.powerButton===true && ['cores3','cores3se'].includes(profile.id) && ['click','hold'].includes(event.action) && Object.keys(event).length===2){
    // Explicit logical BtnPWR events; no PMIC timing, power-off or boot emulation.
    state.lastInput=event.action==='click'?'POWER click':'POWER hold';
  }else if(event.type==='shake' && profile.motion){state.shakeMark=!state.shakeMark;state.lastInput='Shake';}
  else if(event.type==='tilt' && profile.motion && Number.isFinite(event.degrees) && Math.abs(event.degrees)<=60){state.rollDegrees=event.degrees;state.lastInput='Tilt';}
  else if(event.type==='mic' && profile.microphone && Number.isFinite(event.level) && event.level>=0 && event.level<=1 && ['fixture','browser'].includes(event.source)){state.micLevel=event.level;state.micSource=event.source;}
  else return false;
  state.revision++;return true;
}
export function drawInputPreview(canvas,state,profile){
  canvas.width=profile.width;canvas.height=profile.height;
  const context=canvas.getContext('2d');if(!context)throw new Error('The host could not create an input preview canvas.');
  const width=profile.width,height=profile.height,compact=height<180;
  const accent=state.shakeMark?'#ffbd79':'#98dfc5';
  context.imageSmoothingEnabled=false;context.fillStyle='#17252e';context.fillRect(0,0,width,height);
  context.textAlign='center';context.textBaseline='middle';context.fillStyle='#f2f6f5';
  context.font=(width>=280?'22':'12')+'px ui-monospace,monospace';context.fillText('Hello, world!',width/2,compact?20:36);
  const countText=String(state.count),countSize=Math.min(compact?40:64,Math.floor((width-16)/(countText.length*.62)));
  context.fillStyle=accent;context.font=countSize+'px ui-monospace,monospace';context.fillText(countText,width/2,compact?61:106,width-16);
  context.font=(width>=280?'13':'9')+'px ui-monospace,monospace';context.fillStyle='#c1d2d8';
  context.fillText(profile.primaryInput==='touch'?'TAP +1':'BUTTON +1',width/2,compact?91:165);
  context.fillStyle='#819aa4';context.font=(width>=280?'11':'8')+'px ui-monospace,monospace';
  context.fillText(state.lastInput.startsWith('POWER ')||state.lastInput.startsWith('Touch ')?state.lastInput:state.lastInput==='Shake'?'SHAKE':state.rollDegrees?'TILT '+state.rollDegrees+'°':'HOLD 1s TO RESET',width/2,compact?110:205);
  if(profile.motion){const y=height-7;context.fillStyle='#40535d';context.fillRect(width/4,y,width/2,2);context.fillStyle=accent;context.fillRect(width/2+(state.rollDegrees/60)*(width/4)-2,y-2,4,6);}
}
