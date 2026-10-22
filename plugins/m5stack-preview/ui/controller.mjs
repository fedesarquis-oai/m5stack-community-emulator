// Host-independent queue: one MCP request at a time, with latest selection wins.
export const MAX_PRESS_MS = 60000;
export function nativePoint(rect, width, height, x, y) {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  return {x:Math.max(0,Math.min(width-1,Math.floor((x-rect.left)*width/rect.width))),
          y:Math.max(0,Math.min(height-1,Math.floor((y-rect.top)*height/rect.height)))};
}
export function pressDuration(start, end) {
  return Math.max(0, Math.min(MAX_PRESS_MS, Math.floor(end-start)));
}
export function readResult(result) {
  if (result?.isError) {
    const text = result.content?.filter(item=>item.type==='text').map(item=>item.text).join(' ');
    throw new Error(text?.slice(0,300) || 'The simulator could not complete this action. Reload to recover.');
  }
  let state = result?.structuredContent;
  if (!state || typeof state!=='object' || Array.isArray(state)) throw new Error('The simulator returned no state. Reload to recover.');
  if(state.sessionId==null && (state.status!=='welcome' || result._meta?.frame))throw new Error('The simulator returned no valid session. Reload to recover.');
  if (state.sessionId != null) {
    if(state.status==='stopped' && typeof state.sessionId==='string' && state.sessionId)return {state,frame:null};
    if (typeof state.sessionId!=='string' || !state.sessionId || !Number.isInteger(state.revision) || state.revision<0 ||
        !Number.isInteger(state.width) || !Number.isInteger(state.height) || state.width<1 || state.height<1 || state.width>1024 || state.height>1024 ||
        !['running','exited','unavailable','stopped'].includes(state.status) || typeof state.profile!=='string' || typeof state.app!=='string') {
      throw new Error('The simulator state is invalid. Reload to recover.');
    }
  }
  if(result._meta?.speakerPcm && state.nativeState)state={...state,nativeState:{...state.nativeState,speaker_output:result._meta.speakerPcm}};
  const frame = result._meta?.frame;
  if(state.sessionId && state.status==='running' && !frame)throw new Error('The running app returned no display frame. Reload to recover.');
  if (frame && (frame.mimeType!=='image/png' || typeof frame.data!=='string' || frame.data.length>6_000_000 ||
      !/^[a-f0-9]{64}$/i.test(frame.sha256 || '') || frame.width!==state.width || frame.height!==state.height)) {
    throw new Error('The display frame does not match the selected device. Reload to recover.');
  }
  return {state,frame:frame || null};
}

export class WorkbenchController {
  constructor({call,onChange=()=>{},makeId=()=>crypto.randomUUID(),
    // Native Window timers need their global receiver when stored on an instance.
    schedule=(...args)=>globalThis.setTimeout(...args),cancel=(...args)=>globalThis.clearTimeout(...args),pollMs=750}) {
    this.call=call;this.onChange=onChange;this.makeId=makeId;this.schedule=schedule;this.cancel=cancel;this.pollMs=pollMs;
    this.state=null;this.catalog=null;this.frame=null;this.error='';this.busy=false;this.requestName=null;this.requestEventType=null;this.active=true;this.visible=true;
    this.epoch=0;this.inputEpoch=0;this.desired={};this.queue=[];this.stopRequested=false;this.faulted=false;this.timer=null;this.pollPaused=false;this.pollHolds=new Set();
  }
  get ready(){return this.active && this.visible && !this.faulted && !this.stopRequested && this.state?.status==='running';}
  // Frame refreshes and microphone-level samples must not disable focused
  // controls. One explicit action can wait behind them without concurrency.
  get refreshing(){return this.busy && this.requestName==='m5stack_frame';}
  get backgroundRequest(){return this.refreshing || (this.busy && this.requestName==='m5stack_input' && this.requestEventType==='mic');}
  get canInput(){return this.ready && (!this.busy || this.backgroundRequest) && !Object.keys(this.desired).length && !this.queue.length;}
  get canRecover(){return this.active && this.visible && Boolean(this.state?.sessionId) && this.state.status!=='stopped' && !this.stopRequested;}
  notify(){this.onChange(this);}
  clearTimer(){if(this.timer!=null)this.cancel(this.timer);this.timer=null;}
  clearInputQueue(){
    const discarded=this.queue;this.queue=[];
    for(const item of discarded)if(typeof item.local?.onSettled==='function')try{item.local.onSettled({accepted:false});}catch{/* Discarded actions only perform local cleanup. */}
  }
  clearQueued(){this.inputEpoch++;this.desired={};this.clearInputQueue();}
  commit(result,{allowSessionChange=false}={}) {
    const {state,frame}=readResult(result);
    if (state.catalog) this.catalog=state.catalog;
    if (!state.sessionId) {if(!this.state)this.state=state;return true;}
    if (this.state?.sessionId && state.sessionId!==this.state.sessionId && !allowSessionChange) return false;
    if(state.status==='stopped'){this.state={...this.state,...state};this.frame=null;return true;}
    if (state.sessionId===this.state?.sessionId && state.revision<this.state.revision) return false;
    const changed=state.sessionId!==this.state?.sessionId;
    this.state=state;
    this.frame=state.status==='running' && frame?{...frame,sessionId:state.sessionId,revision:state.revision}:null;
    if(changed)this.clearInputQueue();
    return true;
  }
  receive(result) {
    if(!this.active)return;
    // An opener or a tool used in chat establishes a new authoritative view.
    this.epoch++;this.clearTimer();this.clearQueued();this.stopRequested=false;this.faulted=false;this.error='';
    try{
      const parsed=readResult(result);
      if(parsed.state.status==='welcome' && !parsed.state.sessionId){this.state=null;this.frame=null;}
      this.commit(result,{allowSessionChange:true});
    }catch(error){this.error=error.message;this.faulted=true;}
    this.notify();this.armPoll();
  }
  select(choice) {
    if(!this.active || !this.visible || !this.state?.sessionId || this.state.status==='stopped' || this.stopRequested)return;
    this.inputEpoch++;
    if(choice.profile)this.desired.profile=choice.profile;
    if(choice.app)this.desired.app=choice.app;
    this.clearInputQueue();this.clearTimer();this.pump();
  }
  input(event,{onResult,onSettled}={}) {
    // The caller retains only its newest level while busy; samples must never
    // occupy the single slot reserved for an explicit user action.
    if(!this.canInput || (event.type==='mic' && this.busy))return false;
    this.queue.push({name:'m5stack_input',event,requestId:this.makeId(),sessionId:this.state.sessionId,
      local:{onResult,onSettled,inputEpoch:this.inputEpoch,revision:this.state.revision}});
    this.clearTimer();if(this.backgroundRequest)this.notify();this.pump();return true;
  }
  reload() {
    if(!this.canRecover)return;
    this.clearQueued();this.queue.push({name:'m5stack_reload'});this.clearTimer();
    if(this.backgroundRequest)this.notify();
    this.pump();
  }
  stop() {
    if(!this.active || !this.state?.sessionId || this.state.status==='stopped')return;
    this.stopRequested=true;this.clearQueued();this.clearTimer();this.notify();this.pump();
  }
  setVisible(visible) {
    this.visible=visible;this.clearQueued();this.clearTimer();this.notify();
    if(visible){if(this.stopRequested)this.pump();else this.armPoll();}
  }
  holdPolling(paused,reason='gesture'){if(paused)this.pollHolds.add(reason);else this.pollHolds.delete(reason);this.pollPaused=this.pollHolds.size>0;this.clearTimer();this.armPoll();}
  dispose() {
    this.active=false;this.epoch++;this.stopRequested=false;this.clearQueued();this.clearTimer();this.notify();
  }
  armPoll() {
    this.clearTimer();
    const speakerActive=this.state?.capabilities?.speakerPcm && this.state?.nativeState?.speaker_output?.active;
    // Keep app audio flowing during a held device gesture. Decode still owns its pause.
    const paused=this.pollPaused && !(speakerActive && this.pollHolds.size===1 && this.pollHolds.has('gesture'));
    if(this.ready && !this.busy && !paused)this.timer=this.schedule(()=>{this.timer=null;this.pump(true);},speakerActive?80:this.pollMs);
  }
  async pump(poll=false) {
    if(this.busy || !this.active || !this.visible || !this.state?.sessionId)return;
    let next;
    if(this.stopRequested)next={name:'m5stack_stop'};
    else if(Object.keys(this.desired).length){
      const choice=this.desired;this.desired={};
      const args={};
      if(choice.profile && choice.profile!==this.state.profile)args.profile=choice.profile;
      if(choice.app && choice.app!==this.state.app)args.app=choice.app;
      if(Object.keys(args).length)next={name:'m5stack_select',...args};
    }
    if(!next)next=this.queue.shift();
    if(next?.local && (!this.ready || next.local.inputEpoch!==this.inputEpoch || next.sessionId!==this.state.sessionId)){
      if(typeof next.local.onSettled==='function')try{next.local.onSettled({accepted:false});}catch{/* Invalidated actions only perform local cleanup. */}
      next=null;
    }
    if(!next && poll && this.ready)next={name:'m5stack_frame'};
    if(!next){this.notify();this.armPoll();return;}
    const epoch=this.epoch;
    // Local completion hooks are never included in the MCP arguments. An input
    // result can authorize an explicit UI action only while its view and input
    // generation are still current, and only after a newer state was committed.
    const {name,local,...fields}=next;
    // A queued action must advance the revision that exists when it is sent,
    // not merely the older frame that was visible when the user clicked.
    if(local)local.revision=this.state.revision;
    const args={...fields,sessionId:this.state.sessionId};
    let response,accepted=false;
    this.requestName=name;this.requestEventType=fields.event?.type ?? null;this.busy=true;this.error='';this.notify();
    try {
      const result=response=await this.call({name,arguments:args});
      if(!this.active || epoch!==this.epoch)return;
      const committed=this.commit(result,{allowSessionChange:['m5stack_select','m5stack_reload','m5stack_stop'].includes(name)});
      this.faulted=false;
      if(name==='m5stack_stop'){this.stopRequested=false;this.clearQueued();}
      accepted=Boolean(local && committed && this.ready && local.inputEpoch===this.inputEpoch &&
        this.state.sessionId===args.sessionId && this.state.revision>local.revision);
      if(accepted && typeof local.onResult==='function')try{local.onResult(result);}catch{/* UI hooks do not change native transport success. */}
    } catch(error) {
      if(this.active && epoch===this.epoch){this.error=error.message || 'The simulator did not respond. Reload to recover.';this.faulted=true;this.stopRequested=false;this.clearQueued();}
    } finally {
      if(typeof local?.onSettled==='function')try{local.onSettled({accepted,result:response});}catch{/* Cleanup remains local. */}
      this.busy=false;this.requestName=null;this.requestEventType=null;
      if(this.active){this.notify();
        if(this.stopRequested || Object.keys(this.desired).length || this.queue.length)this.pump();
        else this.armPoll();
      }
    }
  }
}
