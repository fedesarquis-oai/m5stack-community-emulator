// Headless LVGL renderer for the local browser bridge. Actual application pixels.
// The default counter and custom starter share one editable portable app.
#include <lvgl.h>
#include "native_display.hpp"
#include <cmath>
#include "user_draw.hpp"
#include "app_protocol.hpp"
#include "synthetic_motion.hpp"
#include "live_audio.hpp"
#include "speaker_output.hpp"
#include "network_io.hpp"
#include "app_tick.hpp"
#include <memory>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

static int WIDTH=135, HEIGHT=240;
static const char *profile="stickcplus2";
static double ax=0, ay=0, az=1;
static int roll_degrees=0;
static constexpr unsigned LONG_PRESS_MS=1000;
static std::vector<lv_color_t> framebuffer;
static struct {NativeDisplay Display{WIDTH,HEIGHT,0,0,1,0xffff,0,framebuffer};} M5;
static std::string app_name="counter";
static preview::DeviceProfile device;
static std::unique_ptr<preview::UserApp> user_app;
static bool touchStripSupported() { return device.id=="cores3se" && preview::HasTouchStripAdapter<preview::UserApp>::value; }
static unsigned touchHeight() { return touchStripSupported()?preview::touchSurfaceHeight(device):static_cast<unsigned>(HEIGHT); }
static double microphone_level=0;
static std::string microphone_source="fixture";
static preview::SyntheticMotionAdapter motion_adapter;
static preview::AudioInputSession audio_input;
static std::chrono::steady_clock::time_point audio_started;
static bool audioInputSupported() {
    return preview::HasAudioInputAdapter<preview::UserApp>::value && preview::supportsAudioInput(device);
}
static void syncAudioInput() {
    audio_input.reconcile(*user_app, device);
    if (audio_input.active() && std::chrono::steady_clock::now() - audio_started >= std::chrono::minutes(5)) audio_input.cancel(*user_app);
}
static std::string tone_kind="none";
static std::string device_event;
// Per-command receipt; a later state refresh must not replay text acceptance.
static std::optional<bool> app_input_accepted;
static const auto started=std::chrono::steady_clock::now();
static uint32_t now_ms() {
    return static_cast<uint32_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now()-started).count()+2000);
}
static std::string escaped(const std::string& value) {
    std::string result;
    for(unsigned char c:value) {
        if(c=='"' || c=='\\') {result+='\\';result+=c;}
        else if(c<32) {char bytes[7];std::snprintf(bytes,7,"\\u%04x",c);result+=bytes;}
        else result+=c;
    }
    return result;
}
static bool boundedUnsigned(const std::string& text,uint32_t maximum,uint32_t& value) {
    return preview::appUnsigned(text,maximum,value);
}
static void flush(lv_disp_drv_t *disp,const lv_area_t *area,lv_color_t *colors) {
    for(int y=area->y1;y<=area->y2;y++)
        for(int x=area->x1;x<=area->x2;x++) framebuffer[y*WIDTH+x]=*colors++;
    lv_disp_flush_ready(disp);
}
static void refresh() {
    M5.Display.offset_x=M5.Display.offset_y=0;
    preview::drawUserApp(M5.Display,*user_app);
}
static void reply() {
    preview::appTick(*user_app,now_ms());
    syncAudioInput();
    refresh();
    std::ostringstream out;
    const auto quoted=[](const std::string& text){return "\""+escaped(text)+"\"";};
    out<<"{\"profile\":"<<quoted(profile)<<",\"width\":"<<WIDTH<<",\"height\":"<<HEIGHT
       <<",\"app\":"<<quoted(app_name)<<",\"count\":"<<user_app->snapshot().count
       <<",\"roll_degrees\":"<<roll_degrees<<",\"step\":"<<1
       <<",\"ax\":"<<ax<<",\"ay\":"<<ay<<",\"az\":"<<az
       <<",\"title\":"<<quoted(user_app->snapshot().title)
       <<",\"heading\":"<<quoted(user_app->snapshot().title)
       <<",\"device_event\":"<<quoted(device_event)<<",\"media_adapter\":1,\"app_adapter\":1"
       <<",\"mic_level\":"<<microphone_level<<",\"mic_source\":"<<quoted(microphone_source);
    out<<",\"app_input_accepted\":"<<(app_input_accepted?(*app_input_accepted?"true":"false"):"null");
    if (audioInputSupported()) {
        out<<",\"audio_input_adapter\":1,\"audio_input\":{\"requested\":"<<(preview::appAudioRequested(*user_app,device)?"true":"false")
           <<",\"active\":"<<(audio_input.active()?"true":"false")
           <<",\"stream_id\":"<<(audio_input.id().empty()?"null":quoted(audio_input.id()))
           <<",\"source\":"<<(audio_input.source().empty()?"null":quoted(audio_input.source()))
           <<",\"sequence\":"<<audio_input.sequence()<<",\"next_frame\":"<<audio_input.nextFrame();
        const auto stats=preview::appAudioStats(*user_app);
        out<<",\"received_frames\":";
        if(stats)out<<stats->received_frames;else out<<"null";
        out<<",\"level\":";
        if(stats)out<<stats->level;else out<<"null";
        out<<"}";
    } else out<<",\"audio_input\":null";
    if((device.id=="cores3" || device.id=="cores3se"))out<<",\"power_button_adapter\":1";
    if(preview::HasSecondaryButtonAdapter<preview::UserApp>::value &&
       preview::hardwareProfile(device.id)->secondary_button)out<<",\"secondary_button_adapter\":1";
    if(touchStripSupported())out<<",\"touch_strip_adapter\":1";
    const bool capture_adapter=preview::HasCaptureAdapter<preview::UserApp>::value;
    if(capture_adapter)out<<",\"capture_adapter\":1";
    const auto* intent=preview::appCaptureIntent(*user_app);
    out<<",\"capture_intent\":";
    if(capture_adapter && intent && *intent) {
        const auto& value=**intent;
        out<<"{\"id\":"<<quoted(value.id)<<",\"source\":"<<quoted(value.source)
           <<",\"action\":"<<quoted(value.action)<<",\"sequence\":"<<value.sequence<<"}";
    } else out<<"null";
    out<<",\"recording\":";
    if(user_app->recording()) {
        const auto& recording=*user_app->recording();
        out<<"{\"id\":"<<quoted(recording.id)<<",\"mime_type\":"<<quoted(recording.mime_type)
           <<",\"duration_ms\":"<<recording.duration_ms<<",\"bytes\":"<<recording.bytes
           <<",\"sha256\":"<<quoted(recording.sha256)<<",\"source\":"<<quoted(recording.source)<<"}";
    } else out<<"null";
    out<<",\"image\":";
    if(user_app->image()) {
        const auto& image=*user_app->image();
        out<<"{\"id\":"<<quoted(image.id)<<",\"width\":"<<image.width<<",\"height\":"<<image.height<<"}";
    } else out<<"null";
    out<<",\"recording_capture\":";
    if(user_app->recordingCapture()) {
        const auto& capture=*user_app->recordingCapture();
        out<<"{\"id\":"<<quoted(capture.id)<<",\"source\":"<<quoted(capture.source);
        if(capture_adapter)out<<",\"stopped\":"<<(preview::appCaptureStopped(*user_app)?"true":"false");
        out<<"}";
    } else out<<"null";
    out<<",\"expected_result\":";
    if(user_app->expectedResult()) {
        const auto& context=*user_app->expectedResult();
        out<<"{\"draft_id\":"<<quoted(context.draft_id)<<",\"request_id\":"<<quoted(context.request_id)
           <<",\"revision\":"<<context.revision<<"}";
    } else out<<"null";
    preview::writeNetworkState(out,*user_app);
    preview::writeSpeakerState(out,*user_app,device);
    const auto& sound=user_app->appSound();
    out<<",\"app_sound\":";
    if(device.capabilities.tone_output && sound)out<<"{\"id\":"<<sound->id<<",\"origin\":\"app\",\"cue\":"<<quoted(sound->cue)
        <<",\"frequency_hz\":"<<sound->frequency_hz<<",\"duration_ms\":"<<sound->duration_ms
        <<",\"kind\":"<<quoted(tone_kind)<<"}";
    else out<<"null";
    out<<",\"output_tone\":null";
    {
        const auto& state=user_app->snapshot();
        out<<",\"user_app\":{\"title\":"<<quoted(state.title)<<",\"count\":"<<state.count
           <<",\"alternate\":"<<(state.alternate?"true":"false")
           <<",\"tilt_degrees\":"<<state.tilt_degrees
           <<",\"microphone_amplitude\":"<<state.microphone_amplitude<<",\"revision\":"<<state.revision<<"}";
    }
    out<<"}\n";
    std::fputs(out.str().c_str(),stdout);
    for(auto color:framebuffer) {
        lv_color32_t c; c.full=lv_color_to32(color);
        unsigned char rgb[]={c.ch.red,c.ch.green,c.ch.blue};
        std::fwrite(rgb,1,3,stdout);
    }
    std::fflush(stdout);
}
static void audioReply(const std::string& id,const char* action,bool accepted) {
    const auto quoted=[](const std::string& text){return "\""+escaped(text)+"\"";};
    std::cout<<"{\"type\":\"audio_ack\",\"profile\":"<<quoted(profile)<<",\"app\":"<<quoted(app_name)
        <<",\"stream_id\":"<<quoted(id)<<",\"action\":"<<quoted(action)<<",\"accepted\":"<<(accepted?"true":"false")
        <<",\"sequence\":"<<audio_input.sequence()<<",\"next_frame\":"<<audio_input.nextFrame()
        <<",\"requested\":"<<(preview::appAudioRequested(*user_app,device)?"true":"false")
        <<",\"active\":"<<(audio_input.active()?"true":"false")<<"}\n"<<std::flush;
}
int main(int argc,char **argv) {
    if(argc<2 || argc>3) return 2;
    const auto* selected=preview::hardwareProfile(argv[1]);
    if(!selected)return 2;
    profile=selected->id; WIDTH=selected->width; HEIGHT=selected->height;
    device={profile,static_cast<unsigned>(WIDTH),static_cast<unsigned>(HEIGHT),
           {!selected->touch,selected->touch,selected->motion,selected->microphone,
             std::string_view(selected->audio_output)!="none"}};
    tone_kind=selected->audio_output;
    if(argc==3)app_name=argv[2];
    if(app_name!="counter" && app_name!="custom")return 2;
    user_app=std::make_unique<preview::UserApp>(device);
    M5.Display.width=WIDTH;M5.Display.height=HEIGHT;
    framebuffer.resize(WIDTH*HEIGHT);
    lv_init();
    std::vector<lv_color_t> draw(WIDTH*24);
    lv_disp_draw_buf_t buf; lv_disp_draw_buf_init(&buf,draw.data(),nullptr,draw.size());
    lv_disp_drv_t driver; lv_disp_drv_init(&driver);
    driver.hor_res=WIDTH; driver.ver_res=HEIGHT; driver.draw_buf=&buf; driver.flush_cb=flush;
    lv_disp_drv_register(&driver); reply();
    std::string line;
    while(true) {
        const auto read=preview::readAppCommand(std::cin,line);
        if(read==preview::LineRead::End)break;
        if(read==preview::LineRead::TooLong)return 2;
        device_event.clear();
        app_input_accepted.reset();
        std::string command=line;
        std::istringstream tokens(line);std::vector<std::string> words;std::string word;
        while(tokens>>word)words.push_back(word);
        if(words.empty())return 2;
        if(words[0]=="network_result") {
            uint32_t id=0,status=0;std::string body;
            if(words.size()!=7 || !boundedUnsigned(words[1],1000000000,id) || !boundedUnsigned(words[4],599,status) ||
               !preview::networkUnhex(words[6],body,preview::NETWORK_RESPONSE_BYTES))return 2;
            preview::NetworkResult result{id,words[2],"host",words[5]=="-"?"":words[5],status,body};
            if(words[3]!="host")return 2;
            app_input_accepted=preview::appNetworkResult(*user_app,result);reply();continue;
        }
        if (words[0]=="audio_start" || words[0]=="audio_chunk" || words[0]=="audio_stop") {
            // Bounded binary is consumed before semantic rejection, preserving
            // framing after wrong IDs/order. Invalid lengths close this worker.
            syncAudioInput();
            if (words[0]=="audio_start") {
                if (words.size()!=3 || !preview::validAssetId(words[1]) || (words[2]!="browser" && words[2]!="fixture")) return 2;
                const bool accepted=audioInputSupported() && audio_input.start(*user_app,device,words[1],words[2]);
                if (accepted) audio_started=std::chrono::steady_clock::now();
                audioReply(words[1],"start",accepted);
            } else if (words[0]=="audio_stop") {
                if (words.size()!=2 || !preview::validAssetId(words[1])) return 2;
                audioReply(words[1],"stop",audioInputSupported() && audio_input.stop(*user_app,words[1]));
            } else {
                std::uint32_t sequence=0,first=0,count=0;
                if (words.size()!=5 || !preview::validAssetId(words[1]) ||
                    !boundedUnsigned(words[2],preview::AUDIO_INPUT_MAX_FRAMES,sequence) ||
                    !boundedUnsigned(words[3],preview::AUDIO_INPUT_MAX_FRAMES,first) ||
                    !boundedUnsigned(words[4],preview::AUDIO_INPUT_CHUNK_FRAMES,count) || !count) return 2;
                std::vector<unsigned char> bytes(count*2);
                std::cin.read(reinterpret_cast<char*>(bytes.data()),static_cast<std::streamsize>(bytes.size()));
                if (std::cin.gcount()!=static_cast<std::streamsize>(bytes.size())) return 2;
                std::vector<std::int16_t> samples(count);
                for (std::size_t i=0;i<count;++i) {
                    const unsigned raw=bytes[i*2] | (static_cast<unsigned>(bytes[i*2+1])<<8);
                    samples[i]=static_cast<std::int16_t>(raw<=32767?static_cast<int>(raw):static_cast<int>(raw)-65536);
                }
                const bool accepted=audioInputSupported() && audio_input.chunk(*user_app,device,words[1],sequence,first,samples.data(),count);
                std::fill(bytes.begin(),bytes.end(),0);std::fill(samples.begin(),samples.end(),0);
                audioReply(words[1],"chunk",accepted);
            }
            continue; // Audio acknowledges consumption; frame polling is separate.
        }
        uint32_t press_duration=50;
        bool touch_input=false;
        uint32_t touch_x=0,touch_y=0;
        if(words[0]=="touch") {
            if(!device.capabilities.touch_input || (words.size()!=3 && words.size()!=4) ||
               !boundedUnsigned(words[1],static_cast<uint32_t>(WIDTH-1),touch_x) ||
               !boundedUnsigned(words[2],touchHeight()-1,touch_y) ||
               (words.size()==4 && !boundedUnsigned(words[3],60000,press_duration)))return 2;
            touch_input=true;
            command="button";
        } else if(words[0]=="button") {
            if(!device.capabilities.primary_button || (words.size()!=1 && words.size()!=2) ||
               (words.size()==2 && !boundedUnsigned(words[1],60000,press_duration)))return 2;
            command="button";
        }
        const bool reset_input=command=="hold" || command=="reset" ||
            (command=="button" && !touch_input && press_duration>=LONG_PRESS_MS);
        if(command=="button" || command=="shake" || command=="hold" || command=="reset") {
            // Each explicit Shake control plays a bounded synthetic sample fixture
            // through the shared bounded shake detector.
            if(command=="shake" && (!device.capabilities.motion_input || !motion_adapter.shake())) return 2;
           {
                if (reset_input || (touch_input && press_duration>=1000)) audio_input.cancel(*user_app);
                preview::InputEvent event{touch_input?preview::InputKind::TouchTap:reset_input?preview::InputKind::HoldReset:command=="shake"?preview::InputKind::Shake:preview::InputKind::PrimaryClick};
                if(touch_input) {event.x=static_cast<int>(touch_x);event.y=static_cast<int>(touch_y);event.duration_ms=press_duration;}
                if(!user_app->apply(event))return 2;
            }
            if(reset_input) {
                microphone_level=0; microphone_source="fixture"; motion_adapter=preview::SyntheticMotionAdapter{};
                ax=ay=roll_degrees=0;az=1;
            }
        }
        else if(words[0]=="secondary") {
            uint32_t duration=0;
            if(!preview::HasSecondaryButtonAdapter<preview::UserApp>::value ||
               !preview::hardwareProfile(device.id)->secondary_button || words.size()!=2 ||
               !boundedUnsigned(words[1],60000,duration))return 2;
            preview::InputEvent event{duration>=1000?preview::InputKind::SecondaryHold:preview::InputKind::SecondaryClick};
            event.duration_ms=duration;
            app_input_accepted=user_app->apply(event);
        }
        else if(words[0]=="power") {
            if((device.id!="cores3" && device.id!="cores3se") || words.size()!=2 ||
               (words[1]!="click" && words[1]!="hold"))return 2;
            const auto kind=words[1]=="click"?preview::InputKind::PowerClick:preview::InputKind::PowerHold;
            app_input_accepted=user_app->apply({kind});
        }
        else if(words[0]=="swipe") {
            uint32_t x=0,y=0,end_x=0,end_y=0,duration=0;
            if(!device.capabilities.touch_input || words.size()!=6 ||
               !boundedUnsigned(words[1],static_cast<uint32_t>(WIDTH-1),x) ||
               !boundedUnsigned(words[2],touchHeight()-1,y) ||
               !boundedUnsigned(words[3],static_cast<uint32_t>(WIDTH-1),end_x) ||
               !boundedUnsigned(words[4],touchHeight()-1,end_y) ||
               !boundedUnsigned(words[5],60000,duration))return 2;
            preview::InputEvent event{preview::InputKind::TouchSwipe};
            event.x=static_cast<int>(x);event.y=static_cast<int>(y);event.end_x=static_cast<int>(end_x);
            event.end_y=static_cast<int>(end_y);event.duration_ms=duration;
            if(!user_app->apply(event))return 2;
        }
        else if(words[0]=="text" || words[0]=="text_result") {
            const bool result=words[0]=="text_result";
            std::string text;
            std::optional<preview::ResultContext> context;
            if(words.size()!=(result?5:2))return 2;
            if(result) {
                preview::ResultContext decoded;
                if(!preview::decodeResultContext(words[1],words[2],words[3],decoded))return 2;
                context=std::move(decoded);
            }
            if(!preview::decodeAppText(words[result?4:1],text) || !user_app->setText(text,context))return 2;
            app_input_accepted=true;
        }
        else if(words[0]=="recording_request") {
            if(!preview::HasCaptureAdapter<preview::UserApp>::value || words.size()!=3 ||
               !preview::validAssetId(words[1]) || (words[2]!="browser" && words[2]!="fixture"))return 2;
            preview::InputEvent event{preview::InputKind::RecordingStartRequested};
            event.asset_id=words[1];event.text=words[2];
            if(!user_app->apply(event))return 2;
        }
        else if(words[0]=="recording_start") {
            if(words.size()!=3 || !user_app->recordingStarted(words[1],words[2]))return 2;
        }
        else if(words[0]=="recording_stopped") {
            if(words.size()!=3 || !preview::appRecordingStopped(*user_app,words[1],words[2]))return 2;
        }
        else if(words[0]=="recording") {
            uint32_t duration=0,bytes=0;
            if(!device.capabilities.microphone_input || words.size()!=7 ||
               !boundedUnsigned(words[2],30000,duration) || !boundedUnsigned(words[3],2097152,bytes))return 2;
            if(!user_app->setRecording({words[1],preview::recordingMime(words[4]),duration,bytes,words[5],words[6]}))return 2;
        }
        else if(words[0]=="recording_clear") {
                        if(words.size()==1) {if(!user_app->clearRecording())return 2;}
            else if(words.size()==3) {if(!preview::appClearRecording(*user_app,words[1],words[2]))return 2;}
            else return 2;
        }
        else if(words[0]=="image" || words[0]=="image_result") {
            const bool result=words[0]=="image_result";
            const std::size_t first=result?4:1;
            preview::ImageFrame image;
            std::optional<preview::ResultContext> context;
            if(words.size()!=(result?8:5))return 2;
            if(result) {
                preview::ResultContext decoded;
                if(!preview::decodeResultContext(words[1],words[2],words[3],decoded))return 2;
                context=std::move(decoded);
            }
            if(!preview::decodeAppImage(words[first],words[first+1],words[first+2],words[first+3],image) || !user_app->setImage(std::move(image),context))return 2;
        }
        else if(words[0]=="image_clear") {
            if(words.size()!=1 || !user_app->clearImage())return 2;
        }
        else if(line=="state") {}
        else if(line=="quit") {audio_input.cancel(*user_app);return 0;}
        else {
            std::istringstream input(line); std::string name,extra; double x,y,z;
            if(!(input>>name>>x) || !std::isfinite(x)) return 2;
            if(name=="motion") {
                if(!device.capabilities.motion_input || !(input>>y>>z) || (input>>extra) || !std::isfinite(y+z) ||
                   std::abs(x)>2 || std::abs(y)>2 || std::abs(z)>2 || z<0.4) return 2;
                ax=x;ay=y;az=z;
                roll_degrees=static_cast<int>(std::lround(std::atan2(y,z)*180.0/3.141592653589793));
                if(!user_app->apply({preview::InputKind::Tilt,static_cast<double>(roll_degrees)}))return 2;
            } else if(name=="mic") {
                std::string source="fixture";
                if(words.size()==3 && !(input>>source))return 2;
                if((input>>extra) || (words.size()!=2 && words.size()!=3) || (source!="fixture" && source!="browser") ||
                   !device.capabilities.microphone_input || x<0 || x>100) return 2;
                microphone_level=x; microphone_source=source;
                if(!user_app->apply({preview::InputKind::MicrophoneAmplitude,x/100}))return 2;
            } else return 2;
        }
        reply();
    }
    audio_input.cancel(*user_app);
    return 0;
}
