import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceLayout,motionEnvelope,rotatedBounds,DEVICE_MARGIN_X,DEVICE_MARGIN_Y} from '../device-layout.mjs';

const profiles=[['atoms3r',128,128,1],['stickcplus2',135,240,.5],['cores3',320,240,1],['cores3se',320,240,1]];
// Stage budgets conservatively allow for the selector, state, keycaps and inputs.
const viewports=[[320,480],[600,700],[1000,800],[390,844],[800,400]];
for(const [profile,pixelWidth,pixelHeight,caseRatio] of profiles){
  test(profile+' stays within compact, medium, wide, portrait and short landscape stages without stretching',()=>{
    for(const [width,height] of viewports){
      const stageWidth=width-(width<=420?24:48),stageHeight=height-160;
      const layout=deviceLayout(profile,stageWidth,stageHeight);
      assert.ok(layout.width>0 && layout.height>0);
      assert.ok(layout.width<=stageWidth-12,`${width}×${height} horizontal bounds`);
      assert.ok(layout.height+18<=stageHeight,`${width}×${height} depth/shadow room`);
      assert.ok(Math.abs(layout.width/layout.height-caseRatio)<1e-12,'physical front ratio');
      assert.ok(Math.abs(layout.screen.width/layout.screen.height-pixelWidth/pixelHeight)<1e-12,'native screen ratio');
      assert.ok(layout.screen.x>0 && layout.screen.y>0);
      assert.ok(layout.screen.x+layout.screen.width<layout.width);
      assert.ok(layout.screen.y+layout.screen.height<layout.height);
      assert.ok(layout.height>=stageHeight*.5 || layout.width>=stageWidth*.6,'device stays prominent');
    }
  });
}
test('continuous resizing does not jump at the compact/wide transition',()=>{
  for(const [profile] of profiles){
    for(let width=280;width<1000;width++){
      const before=deviceLayout(profile,width,650),after=deviceLayout(profile,width+1,650);
      assert.ok(Math.abs(after.width-before.width)<=1+1e-9,'no breakpoint size jump; fixed margins allow one pixel growth');
    }
  }
});
test('hidden or invalid stage sizes defer layout and unsupported profiles fail closed',()=>{
  for(const size of [[0,480],[320,0],[NaN,480],[320,Infinity],[-1,480],[320,10]])assert.equal(deviceLayout('atoms3r',...size),null);
  assert.throws(()=>deviceLayout('stick-s3',320,480),/Unsupported/);
});

for(const [profile,pixelWidth,pixelHeight,caseRatio] of profiles.filter(([id])=>id!=='cores3se')){
  test(profile+' reserves rotation, shake and shadow bounds across compact and landscape stages',()=>{
    for(const [width,height] of [[296,320],[296,200],[366,400],[752,240],[952,640]]){
      for(const roll of [-60,-30,0,30,60]){
        const layout=deviceLayout(profile,width,height,{rollDegrees:roll});assert.ok(layout);
        assert.ok(Math.abs(layout.width/layout.height-caseRatio)<1e-12);
        assert.ok(Math.abs(layout.screen.width/layout.screen.height-pixelWidth/pixelHeight)<1e-12);
        for(let angle=-Math.abs(roll);angle<=Math.abs(roll);angle+=1){
          const bounds=rotatedBounds(layout.width,layout.height,angle);
          assert.ok(bounds.width+2*DEVICE_MARGIN_X<=width+1e-9,`${width}x${height} roll ${roll}, intermediate ${angle} horizontal`);
          assert.ok(bounds.height+2*DEVICE_MARGIN_Y<=height+1e-9,`${width}x${height} roll ${roll}, intermediate ${angle} vertical`);
        }
        const envelope=motionEnvelope(layout.width,layout.height,roll);
        assert.ok(envelope.width>=width*.55 || envelope.height>=height*.55,'rotated device remains prominent');
      }
    }
  });
}

test('StickC Plus2 envelope includes the intermediate vertical maximum and resets to neutral sizing',()=>{
  const envelope=motionEnvelope(200,400,60),endpoint=rotatedBounds(200,400,60);
  assert.ok(envelope.height>endpoint.height+70,'a 60 degree endpoint alone underestimates required height');
  assert.ok(Math.abs(envelope.height-Math.hypot(200,400))<1e-9);
  const neutral=deviceLayout('stickcplus2',296,320),tilted=deviceLayout('stickcplus2',296,320,{rollDegrees:60});
  assert.ok(tilted.width<neutral.width);
  assert.deepEqual(deviceLayout('stickcplus2',296,320,{rollDegrees:0}),neutral);
});

test('CoreS3 SE preserves its square 54mm front and 4:3 display without simulated motion',()=>{
  for(const [width,height] of viewports){
    const neutral=deviceLayout('cores3se',width,height);
    assert.equal(neutral.width,neutral.height);assert.ok(Math.abs(neutral.screen.width/neutral.screen.height-4/3)<1e-12);
    assert.equal(neutral.touchStrip.x,neutral.screen.x);assert.equal(neutral.touchStrip.width,neutral.screen.width);
    assert.ok(Math.abs(neutral.touchStrip.y-(neutral.screen.y+neutral.screen.height))<1e-10);
    assert.ok(Math.abs(neutral.touchStrip.height/neutral.screen.height-40/240)<1e-12);
    assert.ok(neutral.touchStrip.y+neutral.touchStrip.height<neutral.height);
    for(const rollDegrees of [-60,-30,30,60])assert.deepEqual(deviceLayout('cores3se',width,height,{rollDegrees}),neutral);
  }
  for(const id of ['atoms3r','stickcplus2','cores3'])assert.equal(deviceLayout(id,400,600).touchStrip,undefined);
});
