#include "../src/speaker_output.hpp"
#include <cassert>
#include <sstream>
#include <thread>
int main(){
 preview::DeviceProfile d{"cores3se",320,240,{false,true,false,true,true}};
 preview::SpeakerOutput out;std::vector<std::int16_t> samples(16000);for(int i=0;i<16000;i++)samples[i]=i-8000;
 assert(!out.play(d,nullptr,16000,16000));assert(!out.play(d,samples.data(),16000,7999));
 auto bad=d;bad.id="stickcplus2";assert(!out.play(bad,samples.data(),16000,16000));
 assert(out.play(d,samples.data(),16000,16000));samples[0]=123;auto a=out.read();assert(a.samples.size()==4000&&a.samples[0]==-8000&&a.first_frame==0);
 auto b=out.read();assert(b.sequence==2&&b.first_frame==4000);assert(out.read().samples.empty());
 auto retained=out.clip();assert(retained.samples && (*retained.samples)[0]==-8000);
 out.stop();assert((*retained.samples)[0]==-8000);auto stop=out.read();assert(!stop.active&&stop.samples.empty()&&stop.generation>a.generation);
 assert(out.play(d,samples.data(),100,16000));std::this_thread::sleep_for(std::chrono::milliseconds(20));assert(!out.read().active);
 assert(preview::speakerBase64({0,-32768,32767})=="AAAAgP9/");
}
