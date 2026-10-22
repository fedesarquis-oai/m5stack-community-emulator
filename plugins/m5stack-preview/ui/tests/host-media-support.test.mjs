import test from 'node:test';
import assert from 'node:assert/strict';
import {readHostMediaSupport} from '../host-media-support.mjs';

const unavailable={document:null,navigator:null,AudioContext:null,AudioWorkletNode:null,isSecureContext:undefined};
test('missing host advertisement and browser APIs remain distinct from observed denial',()=>{
  const state=readHostMediaSupport(unavailable);
  assert.deepEqual(state,{hostMicrophone:'not-reported',microphonePolicy:'unknown',secureContext:null,audioContextAvailable:false,audioWorkletAvailable:false,getUserMediaAvailable:false});
  assert.equal(Object.isFrozen(state),true);
});
test('only bounded fixed observations escape and no media, permission, or constructor is called',()=>{
  const fail=()=>{throw new Error('must not activate');};
  const privateValue={secret:'never emit'};
  const state=readHostMediaSupport({
    hostCapabilities:{sandbox:{permissions:{microphone:privateValue},privateValue},privateValue},
    document:{permissionsPolicy:{allowsFeature(feature){assert.equal(feature,'microphone');return true;}}},
    navigator:{mediaDevices:{getUserMedia:fail,enumerateDevices:fail},permissions:{query:fail}},
    AudioContext:fail,AudioWorkletNode:fail,isSecureContext:true,
  });
  assert.deepEqual(state,{hostMicrophone:'advertised',microphonePolicy:'allowed',secureContext:true,audioContextAvailable:true,audioWorkletAvailable:true,getUserMediaAvailable:true});
  assert.ok(!JSON.stringify(state).includes('secret'));
});
test('advertised microphone plus observed blocked policy is not reported as a grant',()=>{
  const state=readHostMediaSupport({...unavailable,hostCapabilities:{sandbox:{permissions:{microphone:{}}}},document:{permissionsPolicy:{allowsFeature:()=>false}},isSecureContext:false});
  assert.equal(state.hostMicrophone,'advertised');assert.equal(state.microphonePolicy,'blocked');assert.equal(state.secureContext,false);
});
test('read-only legacy featurePolicy is supported without querying browser permission',()=>{
  const state=readHostMediaSupport({...unavailable,document:{featurePolicy:{allowsFeature:()=>true}}});
  assert.equal(state.microphonePolicy,'allowed');assert.equal(state.hostMicrophone,'not-reported');
});
for(const value of [undefined,null,true,false,[],0,'microphone']){
  test('malformed microphone advertisement '+JSON.stringify(value)+' does not assert permission',()=>{
    const state=readHostMediaSupport({...unavailable,hostCapabilities:{sandbox:{permissions:{microphone:value}}}});
    assert.equal(state.hostMicrophone,'not-reported');
  });
}
test('throwing policy and host capability getters remain unknown with no exception details',()=>{
  const fail=()=>{throw new Error('private diagnostic detail');};
  const state=readHostMediaSupport({...unavailable,hostCapabilities:{get sandbox(){return fail();}},document:{permissionsPolicy:{allowsFeature:fail}},navigator:{get mediaDevices(){return fail();}}});
  assert.equal(state.hostMicrophone,'not-reported');assert.equal(state.microphonePolicy,'unknown');assert.equal(state.getUserMediaAvailable,false);
  assert.ok(!JSON.stringify(state).includes('private'));
});
test('nonboolean policy values remain unknown',()=>{
  for(const value of [undefined,null,1,'true',{}])assert.equal(readHostMediaSupport({...unavailable,document:{permissionsPolicy:{allowsFeature:()=>value}}}).microphonePolicy,'unknown');
});
