#pragma once
#include "src/ShakeDetector.h"
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace preview {
struct MotionUpdate {
    bool valid=false, shake=false, tilt_changed=false;
    int tilt=0;
};

// M5Unified supplies board-oriented acceleration in g. The existing app
// contract consumes shake and sideways tilt, not raw nine-axis sensor data.
class HardwareMotion {
public:
    MotionUpdate update(float x,float y,float z,uint32_t now) {
        MotionUpdate result;
        if(!hello_counter::ShakeDetector::validSample(x,y,z)) {
            detector_.invalidate();seeded_=false;return result;
        }
        result.valid=true;result.shake=detector_.update(x,y,z,now);
        if(!seeded_ || uint32_t(now-last_)>200) {gx_=x;gy_=y;gz_=z;seeded_=true;}
        else {
            const float dt=uint32_t(now-last_),alpha=dt/(180.0f+dt);
            gx_+=alpha*(x-gx_);gy_+=alpha*(y-gy_);gz_+=alpha*(z-gz_);
        }
        last_=now;
        const float norm=std::sqrt(gx_*gx_+gy_*gy_+gz_*gz_);
        if(norm<0.5f || norm>1.5f)return result;
        const int angle=std::clamp(int(std::lround(std::atan2(gx_,std::sqrt(gy_*gy_+gz_*gz_))*180.0/3.141592653589793)),-60,60);
        if(!sent_ || (uint32_t(now-last_sent_)>=100 && std::abs(angle-tilt_)>=2)) {
            sent_=true;last_sent_=now;tilt_=angle;result.tilt_changed=true;
        }
        result.tilt=tilt_;return result;
    }
private:
    hello_counter::ShakeDetector detector_;
    bool seeded_=false,sent_=false;
    float gx_=0,gy_=0,gz_=1;
    int tilt_=0;
    uint32_t last_=0,last_sent_=0;
};
}
