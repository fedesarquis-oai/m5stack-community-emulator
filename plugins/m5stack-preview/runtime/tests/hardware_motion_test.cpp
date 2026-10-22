#include "../hardware/motion_input.hpp"
#include <cassert>
#include <cmath>
#include <limits>
#include <iostream>
int main(){
    preview::HardwareMotion motion;
    unsigned shakes=0;int tilt=0;
    auto feed=[&](float x,float y,float z,unsigned now){auto r=motion.update(x,y,z,now);assert(r.valid);shakes+=r.shake;if(r.tilt_changed)tilt=r.tilt;};
    for(unsigned t=0;t<1000;t+=20)feed(0,0,1,t);
    assert(shakes==0 && tilt==0);
    for(unsigned t=1000;t<2500;t+=20)feed(.5f,0,.8660254f,t);
    assert(std::abs(tilt-30)<=1 && shakes==0);
    for(unsigned t=2500;t<4000;t+=20)feed(-.5f,0,.8660254f,t);
    assert(std::abs(tilt+30)<=1 && shakes==0);
    for(unsigned t=4000;t<5500;t+=20)feed(1,0,0,t);
    assert(tilt==60 && shakes==0);
    assert(!motion.update(std::numeric_limits<float>::quiet_NaN(),0,1,5500).valid);
    preview::HardwareMotion shaking;unsigned count=0,now=0;
    for(;now<1800;now+=20)count+=shaking.update(0,0,1,now).shake;
    for(float x:{.55f,-.55f,.55f})for(unsigned n=0;n<6;++n,now+=20)count+=shaking.update(x,0,1,now).shake;
    assert(count==1);
    std::cout<<"PASS: quiet/left/right/bounded tilt, invalid-sample rejection, and one shake gesture\n";
}
