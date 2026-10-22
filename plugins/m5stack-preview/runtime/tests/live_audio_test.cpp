#include "../src/user_app.hpp"
#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>

using namespace preview;
struct OldApp {};
struct PartialApp { static constexpr unsigned audio_input_adapter=1; bool audioInputRequested() const {return true;} };
static_assert(!HasAudioInputAdapter<OldApp>::value);
static_assert(!HasAudioInputAdapter<PartialApp>::value);
static_assert(HasAudioInputAdapter<UserApp>::value);
static_assert(HasAudioInputStats<UserApp>::value);
static_assert(!HasAudioInputStats<OldApp>::value);
struct InvalidStats {
    AudioInputStats audioInputStats() const { return {0, std::numeric_limits<double>::quiet_NaN(), false}; }
};

struct Observer {
    static constexpr unsigned audio_input_adapter=1;
    bool requested=true,active=false,reject=false,stop_after=false;
    std::vector<std::int16_t> received;
    bool audioInputRequested() const {return requested;}
    void onMicrophoneState(bool value) {active=value;}
    bool onMicrophoneBlock(const AudioBlockView& block) {
        if(reject)return false;
        received.insert(received.end(),block.samples,block.samples+block.frames);
        if(stop_after)requested=false;
        return true;
    }
};
static DeviceProfile device(const std::string& id) {
    return {id,id=="stickcplus2"?135u:320u,240,{false,true,false,id!="atoms3r",true}};
}
int main() {
    for(const std::string id:{"stickcplus2","cores3","cores3se"}) {
        auto profile=device(id);UserApp app(profile);AudioInputSession stream;
        assert(app.audioInputRequested());assert(stream.start(app,profile,"a","browser"));
        std::vector<std::int16_t> pcm(1600);
        for(std::size_t i=0;i<pcm.size();++i)pcm[i]=i%2?16384:-16384;
        assert(stream.chunk(app,profile,"a",0,0,pcm.data(),pcm.size()));
        assert(app.snapshot().microphone_frames==1600 && std::abs(app.snapshot().microphone_amplitude-.5)<1e-12);
        const auto stats=appAudioStats(app);
        assert(stats && stats->received_frames==1600 && stats->level==.5 && stats->active);
        assert(app.snapshot().count==0 && app.snapshot().microphone_active);
        const auto revision=app.snapshot().revision;
        assert(!stream.chunk(app,profile,"wrong",1,1600,pcm.data(),1600));
        assert(!stream.chunk(app,profile,"a",0,1600,pcm.data(),1600));
        assert(!stream.chunk(app,profile,"a",1,1599,pcm.data(),1600));
        assert(!stream.chunk(app,profile,"a",1,1600,pcm.data(),1601));
        assert(!stream.chunk(app,profile,"a",1,1600,nullptr,1600));
        assert(app.snapshot().revision==revision && stream.nextFrame()==1600);
        assert(app.apply({InputKind::PrimaryClick}) && app.snapshot().count==1);
        assert(stream.chunk(app,profile,"a",1,1600,pcm.data(),3));
        assert(!stream.chunk(app,profile,"a",2,1603,pcm.data(),1));
        assert(stream.stop(app,"a") && stream.stop(app,"a"));
        assert(!app.snapshot().microphone_active && app.snapshot().microphone_amplitude==0);
        assert(app.snapshot().microphone_frames==1603 && !stream.active());
        assert(!stream.start(app,profile,"a","browser"));
        assert(!stream.start(app,profile,"b","physical"));
        assert(stream.start(app,profile,"b","fixture"));
        assert(app.snapshot().microphone_frames==0);
        assert(app.requestMicrophone(false));stream.reconcile(app,profile);
        assert(!stream.active() && !stream.chunk(app,profile,"b",0,0,pcm.data(),1600));
        assert(!stream.start(app,profile,"c","browser"));
        assert(app.requestMicrophone(true) && stream.start(app,profile,"c","browser"));
        stream.cancel(app);assert(app.apply({InputKind::HoldReset}));
        assert(app.snapshot().count==0 && app.snapshot().microphone_frames==0 && !app.snapshot().microphone_active);
    }
    auto atom=device("atoms3r");UserApp absent(atom);AudioInputSession denied;
    assert(!absent.audioInputRequested() && !absent.requestMicrophone(true));
    assert(!denied.start(absent,atom,"a","browser"));
    auto fake=device("not-a-supported-profile");UserApp unknown(fake);
    assert(!unknown.audioInputRequested());
    OldApp old;assert(!denied.start(old,device("cores3se"),"a","browser"));
    assert(!appAudioStats(old) && !appAudioStats(InvalidStats{}));
    auto profile=device("cores3se");Observer observer;AudioInputSession ordered;
    std::vector<std::int16_t> first(1600),last{-32768,0,32767};
    for(std::size_t i=0;i<first.size();++i)first[i]=static_cast<std::int16_t>(i-800);
    assert(ordered.start(observer,profile,"ordered","fixture"));
    assert(ordered.chunk(observer,profile,"ordered",0,0,first.data(),1600));
    observer.stop_after=true;
    assert(ordered.chunk(observer,profile,"ordered",1,1600,last.data(),3));
    assert(observer.received.size()==1603 && std::equal(first.begin(),first.end(),observer.received.begin()));
    assert(std::equal(last.begin(),last.end(),observer.received.begin()+1600));
    assert(!ordered.active() && !observer.active && ordered.sequence()==1 && ordered.nextFrame()==1603);
    Observer rejection;rejection.reject=true;AudioInputSession rejected;
    assert(rejected.start(rejection,profile,"r","fixture"));
    assert(!rejected.chunk(rejection,profile,"r",0,0,first.data(),1600));
    assert(rejection.received.empty() && rejected.sequence()==-1 && rejected.nextFrame()==0 && !rejected.active());
    Observer maximum;AudioInputSession bounded;assert(bounded.start(maximum,profile,"m","fixture"));
    for(std::uint32_t i=0;i<3000;++i) {
        assert(bounded.chunk(maximum,profile,"m",i,i*1600,first.data(),1600));
        maximum.received.clear(); // App chooses not to retain sample history.
    }
    assert(!bounded.active() && bounded.nextFrame()==AUDIO_INPUT_MAX_FRAMES);
    assert(!bounded.chunk(maximum,profile,"m",3000,AUDIO_INPUT_MAX_FRAMES,first.data(),1));
    Observer identities;AudioInputSession history;
    for(unsigned i=0;i<64;++i) {
        const auto id="s"+std::to_string(i);assert(history.start(identities,profile,id,"fixture"));assert(history.stop(identities,id));
    }
    assert(!history.start(identities,profile,"overflow","fixture"));
    std::cout<<"PASS live PCM: exact samples, RMS, three microphone profiles, Atom excluded, sequence/identity/partial/stop/reject/reset/5-minute bounds, old app opt-in\n";
}
