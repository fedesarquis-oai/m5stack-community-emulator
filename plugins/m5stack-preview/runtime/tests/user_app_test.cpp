#include "../src/user_app.hpp"
#include "../src/user_draw.hpp"
#include <algorithm>
#include <cassert>
#include <cerrno>
#include <chrono>
#include <csignal>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

// Optional native-pipe checks run on the supported desktop POSIX environment.
// No shell, Python, browser, audio device, or serial port is involved.
#include <poll.h>
#include <sys/wait.h>
#include <unistd.h>

using namespace preview;

struct Raster {
    int width, height, x = 0, y = 0, size = 1;
    std::uint16_t foreground = 0, background = 0;
    bool out_of_bounds = false;
    std::vector<std::uint16_t> pixels;
    Raster(int w,int h) : width(w), height(h), pixels(w*h) {}
    std::uint16_t color565(int r,int g,int b) { return ((r & 248)<<8) | ((g & 252)<<3) | (b>>3); }
    void startWrite() {} void endWrite() {} void setTextWrap(bool,bool) {}
    void setTextSize(int s) { size=s; }
    void setTextColor(std::uint16_t fg,std::uint16_t bg) { foreground=fg; background=bg; }
    void setCursor(int px,int py) { x=px; y=py; }
    void pixel(int px,int py,std::uint16_t color) {
        if (px<0 || py<0 || px>=width || py>=height) { out_of_bounds=true; return; }
        pixels[py*width+px]=color;
    }
    void fillScreen(std::uint16_t color) { std::fill(pixels.begin(),pixels.end(),color); }
    void drawFastHLine(int px,int py,int length,std::uint16_t color) {
        for (int i=0;i<length;++i) pixel(px+i,py,color);
    }
    void fillCircle(int px,int py,int radius,std::uint16_t color) {
        for (int yy=-radius;yy<=radius;++yy) for (int xx=-radius;xx<=radius;++xx)
            if (xx*xx+yy*yy<=radius*radius) pixel(px+xx,py+yy,color);
    }
    void print(const char* text) {
        for (const char* p=text;*p;++p) {
            for (int yy=0;yy<8*size;++yy) for (int xx=0;xx<6*size;++xx)
                pixel(x+xx,y+yy,(*p!=' ' && yy/size<7 &&
                    (static_cast<unsigned char>(*p) & (1u<<(xx/size))))?foreground:background);
            x+=6*size;
        }
    }
};

static DeviceProfile profile(unsigned width=128,unsigned height=128) {
    return {"test",width,height,{true,false,true,false,false}};
}

static void microphoneDisplayTests() {
    for (const std::string id : {"stickcplus2", "cores3", "cores3se"}) {
        auto device = profile(id == "stickcplus2" ? 135 : 320, 240);
        device.id = id; device.capabilities.microphone_input = true;
        UserApp app(device);
        std::vector<std::int16_t> samples(1600, 1966); // Approximately 6% RMS.
        const auto original = samples;
        const std::string source = "fixture";
        app.onMicrophoneState(true);
        assert(app.onMicrophoneBlock({samples.data(),1600,16000,1,0,0,source}));
        Raster raster(device.width,device.height);
        drawUserApp(raster,app);
        const auto ink = raster.color565(145,214,202);
        const int row = device.height-55, maximum = device.width-16;
        int filled = 0;
        for (unsigned x=8;x<device.width-8;++x) if(raster.pixels[row*device.width+x]==ink)++filled;
        assert(filled > maximum*.58 && filled < maximum*.61);
        // Drawing never changes gain, source samples, app state or count.
        assert(samples==original && app.snapshot().microphone_frames==1600);
        assert(std::abs(app.snapshot().microphone_amplitude-1966.0/32768.0)<1e-10);
        assert(app.snapshot().count==0 && !raster.out_of_bounds);
        app.onMicrophoneState(false);drawUserApp(raster,app);
        for (unsigned x=8;x<device.width-8;++x) assert(raster.pixels[row*device.width+x]!=ink);
    }
    assert(microphoneMeterLevel(0)==0 && microphoneMeterLevel(.001)==0);
    assert(microphoneMeterLevel(1)==1);
}

static void modelTests() {
    UserApp app(profile());
    assert(app.snapshot().title==USER_APP_TITLE && app.snapshot().count==0 && !app.snapshot().alternate);
    for (unsigned i=1;i<=1000;++i) {
        assert(app.apply({InputKind::PrimaryClick}));
        assert(app.snapshot().count==i);
    }
    assert(app.apply({InputKind::HoldReset}));
    assert(app.apply({InputKind::Shake}) && app.snapshot().alternate);
    assert(app.apply({InputKind::PrimaryClick}) && app.snapshot().count==1);
    assert(app.apply({InputKind::Shake}) && !app.snapshot().alternate && app.snapshot().count==1);
    for (double angle : {-60.0,-30.0,0.0,30.0,60.0}) {
        assert(app.apply({InputKind::Tilt,angle}));
        assert(app.snapshot().tilt_degrees==angle && app.snapshot().count==1);
        assert(app.apply({InputKind::PrimaryClick}) && app.snapshot().count==2);
        assert(app.apply({InputKind::HoldReset}));
        assert(app.apply({InputKind::PrimaryClick}) && app.snapshot().count==1);
    }
    assert(app.apply({InputKind::Tilt,60}));
    const auto revision=app.snapshot().revision;
    for (double angle : {-60.1,60.1,std::numeric_limits<double>::quiet_NaN(),std::numeric_limits<double>::infinity()})
        assert(!app.apply({InputKind::Tilt,angle}));
    for (const auto kind : {InputKind::MicrophoneAmplitude,InputKind::RequestTone,InputKind::NextPage,InputKind::PreviousPage})
        assert(!app.apply({kind,0.5}));
    assert(app.snapshot().revision==revision && app.snapshot().tilt_degrees==60);
    assert(app.apply({InputKind::HoldReset}));
    assert(app.snapshot().count==0 && !app.snapshot().alternate && app.snapshot().tilt_degrees==0);
    assert(app.snapshot().revision==revision+1);

    auto no_sensors=profile(); no_sensors.capabilities={};
    UserApp synthetic(no_sensors);
    for (const auto kind : {InputKind::PrimaryClick,InputKind::HoldReset,InputKind::Shake,InputKind::Tilt})
        assert(!synthetic.apply({kind,0,InputSource::Physical}));
    assert(synthetic.snapshot().revision==0);
    assert(synthetic.apply({InputKind::PrimaryClick}));
    auto touch=profile(); touch.capabilities={false,true,true,true,true};
    UserApp touchscreen(touch);
    assert(touchscreen.apply({InputKind::PrimaryClick,0,InputSource::Physical}));
    assert(touchscreen.apply({InputKind::HoldReset,0,InputSource::Physical}));
    assert(touchscreen.apply({InputKind::Tilt,30,InputSource::Physical}));
    assert(touchscreen.snapshot().tilt_source==InputSource::Physical);
    // A mic level reaches the editable model, but never changes the counter.
    assert(!touchscreen.apply({InputKind::RequestTone}));
    for (const double level : {0.0,0.125,0.5,1.0}) {
        assert(touchscreen.apply({InputKind::MicrophoneAmplitude,level}));
        assert(touchscreen.snapshot().microphone_amplitude==level && touchscreen.snapshot().count==0);
    }
    const auto media_revision=touchscreen.snapshot().revision;
    for (const double invalid : {-0.01,1.01,std::numeric_limits<double>::quiet_NaN(),std::numeric_limits<double>::infinity()})
        assert(!touchscreen.apply({InputKind::MicrophoneAmplitude,invalid}));
    assert(touchscreen.snapshot().revision==media_revision);
    assert(!app.requestSound("click",440,50)); // Atom/no speaker cannot declare output.
    UserApp sound_app(touch);
    const auto previous_sound_id = 0;
    assert(sound_app.requestSound("click",440,50));
    assert(sound_app.appSound()->id==previous_sound_id+1 && sound_app.appSound()->frequency_hz==440 && sound_app.appSound()->duration_ms==50);
    assert(!sound_app.requestSound("bad cue",440,50));
    assert(!sound_app.requestSound(std::string(65,'x'),440,50));
    for (const unsigned hz : {0u,39u,4001u}) assert(!sound_app.requestSound("click",hz,50));
    for (const unsigned duration : {0u,1001u}) assert(!sound_app.requestSound("click",440,duration));
    assert(sound_app.appSound()->id==previous_sound_id+1);
    assert(sound_app.apply({InputKind::HoldReset}));
    assert(!sound_app.appSound() && sound_app.snapshot().microphone_amplitude==0);
    assert(sound_app.requestSound("again",4000,1000) && sound_app.appSound()->id==previous_sound_id+2);

    UserApp one(profile()),two(profile());
    for (unsigned i=0;i<120;++i) {
        const InputEvent event=i%9==0?InputEvent{InputKind::HoldReset}:i%4==0?InputEvent{InputKind::Shake}:
            i%2==0?InputEvent{InputKind::Tilt,static_cast<double>(static_cast<int>(i%121)-60)}:InputEvent{InputKind::PrimaryClick};
        assert(one.apply(event)==two.apply(event));
        assert(one.snapshot().count==two.snapshot().count && one.snapshot().alternate==two.snapshot().alternate);
        assert(one.snapshot().tilt_degrees==two.snapshot().tilt_degrees && one.snapshot().revision==two.snapshot().revision);
    }
    for (const auto geometry : {std::pair<unsigned,unsigned>{128,128},{135,240},{320,240}}) {
        UserApp drawn(profile(geometry.first,geometry.second));
        Raster raster(geometry.first,geometry.second);
        drawUserApp(raster,drawn); const auto original=raster.pixels;
        assert(!raster.out_of_bounds);
        for (const auto event : {InputEvent{InputKind::PrimaryClick},InputEvent{InputKind::Shake},InputEvent{InputKind::Tilt,-60},InputEvent{InputKind::Tilt,60}}) {
            const auto previous=raster.pixels;
            assert(drawn.apply(event)); drawUserApp(raster,drawn);
            assert(!raster.out_of_bounds && raster.pixels!=previous);
        }
        for (unsigned i=0;i<98;++i) drawn.apply({InputKind::PrimaryClick});
        assert(drawn.snapshot().count==99); drawUserApp(raster,drawn); assert(!raster.out_of_bounds);
        drawn.apply({InputKind::HoldReset}); drawUserApp(raster,drawn);
        assert(!raster.out_of_bounds && raster.pixels==original);
    }
    for (const auto& invalid : {DeviceProfile{"",128,128,{}},{"bad",127,128,{}},{"bad",128,1025,{}}}) {
        bool rejected=false;
        try { UserApp bad(invalid); } catch (const std::invalid_argument&) { rejected=true; }
        assert(rejected);
    }
    std::cout<<"PASS Hello World model/drawing: +1 through 1000 presses, no tilt multiplier, shake indicator, reset, finite tilt, physical capabilities, unsupported inputs, deterministic replay, all three geometries\n";
}

struct NativeFrame { std::string header; std::vector<unsigned char> pixels; };

class NativeWorker {
public:
    NativeWorker(const std::string& binary,const char* device_profile,unsigned width,unsigned height,const char* app="custom")
        : byte_count_(width*height*3) {
        int input[2],output[2];
        if (pipe(input)!=0) throw std::runtime_error("input pipe failed");
        if (pipe(output)!=0) { close(input[0]);close(input[1]);throw std::runtime_error("output pipe failed"); }
        pid_=fork();
        if (pid_==0) {
            dup2(input[0],STDIN_FILENO);dup2(output[1],STDOUT_FILENO);
            close(input[0]);close(input[1]);close(output[0]);close(output[1]);
            if (app) execl(binary.c_str(),binary.c_str(),device_profile,app,static_cast<char*>(nullptr));
            else execl(binary.c_str(),binary.c_str(),device_profile,static_cast<char*>(nullptr));
            _exit(127);
        }
        close(input[0]);close(output[1]);
        if (pid_<0) { close(input[1]);close(output[0]);throw std::runtime_error("fork failed"); }
        input_=input[1];output_=output[0];
    }
    ~NativeWorker() {
        if (input_>=0) close(input_);
        if (output_>=0) close(output_);
        if (pid_>0) { kill(pid_,SIGKILL);waitpid(pid_,nullptr,0); }
    }
    NativeWorker(const NativeWorker&)=delete;
    NativeWorker& operator=(const NativeWorker&)=delete;

    void send(const std::string& command) {
        const auto text=command+"\n";
        std::size_t sent=0;
        while (sent<text.size()) {
            const auto count=write(input_,text.data()+sent,text.size()-sent);
            if (count<0 && errno==EINTR) continue;
            if (count<=0) throw std::runtime_error("worker input failed");
            sent+=static_cast<std::size_t>(count);
        }
    }
    NativeFrame receive() {
        const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(3);
        NativeFrame frame;
        char c=0;
        while (true) {
            readBytes(&c,1,deadline);
            if (c=='\n') break;
            frame.header+=c;
            if (frame.header.size()>8192) throw std::runtime_error("oversized header");
        }
        frame.pixels.resize(byte_count_);
        readBytes(frame.pixels.data(),byte_count_,deadline);
        return frame;
    }
    NativeFrame command(const std::string& line) { send(line);return receive(); }
    int finish() {
        if (input_>=0) { close(input_);input_=-1; }
        int status=0;
        for (unsigned attempt=0;attempt<200;++attempt) {
            const auto result=waitpid(pid_,&status,WNOHANG);
            if (result==pid_) { pid_=-1;return WIFEXITED(status)?WEXITSTATUS(status):-1; }
            if (result<0 && errno!=EINTR) throw std::runtime_error("waitpid failed");
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        throw std::runtime_error("owned worker failed to exit within two seconds");
    }
private:
    void readBytes(void* destination,std::size_t length,std::chrono::steady_clock::time_point deadline) {
        auto* bytes=static_cast<unsigned char*>(destination);
        std::size_t received=0;
        while (received<length) {
            const auto remaining=std::chrono::duration_cast<std::chrono::milliseconds>(deadline-std::chrono::steady_clock::now()).count();
            if (remaining<=0) throw std::runtime_error("worker output timed out");
            pollfd descriptor{output_,POLLIN,0};
            const auto ready=poll(&descriptor,1,static_cast<int>(remaining));
            if (ready<0 && errno==EINTR) continue;
            if (ready<=0) throw std::runtime_error("worker output timed out");
            const auto count=read(output_,bytes+received,length-received);
            if (count<0 && errno==EINTR) continue;
            if (count<=0) throw std::runtime_error("worker output closed");
            received+=static_cast<std::size_t>(count);
        }
    }
    pid_t pid_=-1;
    int input_=-1,output_=-1;
    std::size_t byte_count_;
};

static void contains(const std::string& text,const std::string& expected) {
    if (text.find(expected)==std::string::npos) throw std::runtime_error("missing native field: "+expected+" in "+text);
}

static void check(bool condition,const char* message) {
    if (!condition) throw std::runtime_error(message);
}

static void nativeTests(const std::string& binary) {
    struct Profile { const char* id;unsigned width,height;bool touch; };
    for (const auto profile : {Profile{"atoms3r",128,128,false},{"stickcplus2",135,240,false},{"cores3",320,240,true}}) {
      for (const auto* starter : {"counter","custom"}) {
        NativeWorker worker(binary,profile.id,profile.width,profile.height,starter);
        const auto initial=worker.receive();
        contains(initial.header,std::string("\"app\":\"")+starter+"\"");
        contains(initial.header,"\"width\":"+std::to_string(profile.width));
        contains(initial.header,"\"height\":"+std::to_string(profile.height));
        contains(initial.header,std::string("\"user_app\":{\"title\":\"")+USER_APP_TITLE+"\",\"count\":0,\"alternate\":false,\"tilt_degrees\":0,\"microphone_amplitude\":0,\"revision\":0}");
        contains(initial.header,"\"media_adapter\":1");
        contains(initial.header,"\"step\":1");
        contains(initial.header,"\"app_sound\":null");contains(initial.header,"\"output_tone\":null");
        check(std::any_of(initial.pixels.begin(),initial.pixels.end(),[&](unsigned char byte){return byte!=initial.pixels[0];}),"blank native frame");
        const std::string primary=profile.touch?"touch 160 120 ":"button ";
        const auto clicked=worker.command(primary+"999");
        contains(clicked.header,std::string("\"user_app\":{\"title\":\"")+USER_APP_TITLE+"\",\"count\":1");
        check(clicked.pixels!=initial.pixels,"click did not change frame");
        const auto tilt=worker.command("motion 0 0.5 0.866025404");
        contains(tilt.header,"\"tilt_degrees\":30");check(tilt.pixels!=clicked.pixels,"tilt did not change frame");
        const auto tilted_click=worker.command(primary+"50");
        contains(tilted_click.header,"\"count\":2");contains(tilted_click.header,"\"step\":1");
        const auto shake=worker.command("shake");
        contains(shake.header,"\"count\":2");contains(shake.header,"\"alternate\":true");
        check(shake.pixels!=tilted_click.pixels,"shake did not change frame");
        const auto reset=worker.command(primary+"1000");
        contains(reset.header,"\"count\":0,\"alternate\":false,\"tilt_degrees\":0");
        check(reset.pixels==initial.pixels,"hold did not restore initial frame"); // No extra click on release.
        worker.command(primary+"50");
        check(worker.command("hold").pixels==initial.pixels,"explicit hold did not reset");
        worker.command("shake");
        check(worker.command("reset").pixels==initial.pixels,"reset did not restore frame");
        check(worker.command("state").pixels==initial.pixels,"poll changed frame");
        if (std::string(profile.id)!="atoms3r") {
            const auto mic=worker.command("mic 50 browser");
            contains(mic.header,"\"mic_level\":50,\"mic_source\":\"browser\"");
            contains(mic.header,"\"microphone_amplitude\":0.5");
            contains(mic.header,"\"count\":0");
            check(mic.pixels!=initial.pixels,"microphone meter did not change native drawing");
            contains(worker.command("reset").header,"\"microphone_amplitude\":0");
        }
        worker.send("quit");check(worker.finish()==0,"quit failed");
        NativeWorker reloaded(binary,profile.id,profile.width,profile.height,starter);
        check(reloaded.receive().pixels==initial.pixels,"reloaded app did not start clean");
        reloaded.send("quit");check(reloaded.finish()==0,"reloaded worker did not close");
        std::vector<std::string> invalid_commands={"mic 101","mic -1","mic NaN","mic 50junk","mic 50 unknown","mic 50 browser extra","pcm 16000 1","tone","page 1","motion 0 2 0.4"};
        if(std::string(profile.id)=="atoms3r")invalid_commands.push_back("mic 50");
        for (const std::string invalid : invalid_commands) {
            NativeWorker rejected(binary,profile.id,profile.width,profile.height,starter);
            rejected.receive();rejected.send(invalid);
            check(rejected.finish()==2,"unsupported command was not rejected");
        }
      }
        NativeWorker legacy(binary,profile.id,profile.width,profile.height,nullptr);
        const auto default_state=legacy.receive();
        contains(default_state.header,"\"app\":\"counter\"");
        contains(default_state.header,std::string("\"title\":\"")+USER_APP_TITLE+"\"");
        legacy.send("quit");check(legacy.finish()==0,"legacy counter quit failed");
        for (const auto* example : {"trail","mascot","eightball"}) {
            NativeWorker example_worker(binary,profile.id,profile.width,profile.height,example);
            check(example_worker.finish()==2,"retired example was accepted");
        }
        std::cout<<"PASS native Hello World counter/custom: "<<profile.id<<" "<<profile.width<<"x"<<profile.height
                 <<" real frames, +1 with tilt, short/hold/reset/reload, shake indicator, input rejection, retired example rejection, clean exits\n";
    }
}

int main(int argc,char** argv) {
    if (argc!=1 && (argc!=3 || std::string(argv[1])!="--worker")) {
        std::cerr<<"Usage: user_app_test [--worker /absolute/native-worker]\n";return 2;
    }
    std::signal(SIGPIPE,SIG_IGN);
    try {
        modelTests();
        microphoneDisplayTests();
        if (argc==3) nativeTests(argv[2]);
    } catch (const std::exception& error) {
        std::cerr<<"FAIL: "<<error.what()<<'\n';return 1;
    }
}
