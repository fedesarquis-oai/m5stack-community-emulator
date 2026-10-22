// Shared runner for explicitly configured physical targets. App files stay unchanged.
#include <M5Unified.h>
#include <M5GFX.h>
#include <atomic>
#include <memory>
#include "build_identity.hpp"
#include "user_draw.hpp"
#include "motion_input.hpp"
#include "button_input.hpp"
#include "network_driver.hpp"
#include "src/app_tick.hpp"

using namespace preview;
static_assert(!HasNetworkAdapter<UserApp>::value || FIRMWARE_NETWORK_ENABLED,"Declare network in firmware.json and select a supported target");
#if FIRMWARE_NETWORK_ENABLED
static HardwareNetwork hardware_network;
#endif
static const auto* hw=hardwareProfile(FIRMWARE_PROFILE);
static DeviceProfile profile{FIRMWARE_PROFILE,hw->width,hw->height,{!hw->touch,hw->touch,hw->motion,hw->microphone,std::string(hw->audio_output)!="none"}};
static std::unique_ptr<UserApp> app;
static M5Canvas screen(&M5.Display);
static bool ready=false, mic_active=false, mic_blocked=false;
static unsigned mic_next=0;
static uint64_t speaker_generation=0,tone_id=0,render_revision=~0ULL;
static std::shared_ptr<const std::vector<int16_t>> playing_samples;
static int16_t microphone[2][AUDIO_INPUT_CHUNK_FRAMES];
static std::atomic<bool> mic_ready[2];
static uint32_t mic_sequence=0,mic_frames=0,mic_started=0;
static uint32_t physical_inputs=0,automated_inputs=0,speaker_frames=0,mic_errors=0;
static const std::string mic_source="device";
static const char* error_code="none";
static bool sound_active=false;
static uint32_t last_app_input_us=0,last_audio_start_us=0;
static uint32_t physical_button_clicks=0,physical_button_holds=0,physical_shakes=0,physical_tilts=0,imu_samples=0,imu_invalid=0;
static uint32_t physical_secondary_clicks=0,physical_secondary_holds=0;
static float accel_x=0,accel_y=0,accel_z=0;
static int motion_tilt=0;
static uint32_t physical_taps=0,physical_holds=0,physical_swipes=0,physical_strip=0,physical_power_clicks=0,physical_power_holds=0;

static void mic_complete(void*,void* data,size_t) {
    for(unsigned i=0;i<2;++i)if(data==microphone[i])mic_ready[i].store(true,std::memory_order_release);
}
static void stop_mic() {
    if(!mic_active)return;
    M5.Mic.end();
    mic_active=false;
    for(auto& flag:mic_ready)flag.store(false);
    appAudioState(*app,false);
}
static bool start_mic() {
    M5.Speaker.end(); playing_samples.reset();
    auto config=M5.Mic.config();config.sample_rate=AUDIO_INPUT_RATE;config.over_sampling=1;
    M5.Mic.config(config);
    M5.Mic.setBufferReleaseCallback(nullptr,mic_complete);
    if(!M5.Mic.begin()){error_code="MIC_BEGIN_FAILED";mic_blocked=true;++mic_errors;return false;}
    mic_sequence=mic_frames=0;mic_next=0;mic_started=millis();mic_active=true;
    appAudioState(*app,true);
    for(unsigned i=0;i<2;++i){mic_ready[i].store(false);if(!M5.Mic.record(microphone[i],AUDIO_INPUT_CHUNK_FRAMES,AUDIO_INPUT_RATE,false)){stop_mic();error_code="MIC_QUEUE_FAILED";mic_blocked=true;++mic_errors;return false;}}
    return true;
}
static void audio_update() {
    if(!profile.capabilities.microphone_input && !profile.capabilities.tone_output)return;
    const auto clip=app->speakerOutput().clip();
    const auto tone=app->appSound();
    const bool new_tone=tone && tone->id!=tone_id;
    if(clip.generation!=speaker_generation || new_tone){
        const auto audio_start=micros();
        speaker_generation=clip.generation;
        M5.Speaker.end(); // joins driver task before releasing its borrowed buffer
        playing_samples.reset();
        if(clip.samples && !clip.samples->empty()){
            stop_mic();
            if(M5.Speaker.begin()){
                M5.Speaker.setVolume(FIRMWARE_SPEAKER_VOLUME);playing_samples=clip.samples;
                if(M5.Speaker.playRaw(playing_samples->data(),playing_samples->size(),clip.rate,false,1,0,true))speaker_frames+=playing_samples->size();
                else error_code="SPEAKER_QUEUE_FAILED";
            }else error_code="SPEAKER_BEGIN_FAILED";
        }else if(new_tone){
            tone_id=tone->id;stop_mic();
            if(M5.Speaker.begin()){M5.Speaker.setVolume(FIRMWARE_SPEAKER_VOLUME);M5.Speaker.tone(tone->frequency_hz,tone->duration_ms);}
            else error_code="SPEAKER_BEGIN_FAILED";
        }
        last_audio_start_us=micros()-audio_start;
    }
    const bool playing=M5.Speaker.isPlaying();
    if(sound_active!=playing){sound_active=playing;render_revision=~0ULL;}
    const bool requested=appAudioRequested(*app,profile);
    if(!requested){stop_mic();mic_blocked=false;}
    if(requested && !playing && !mic_active && !mic_blocked)start_mic();
    if(!mic_active)return;
    if(millis()-mic_started>=300000){stop_mic();mic_blocked=true;error_code="MIC_TIME_LIMIT";return;}
    for(unsigned consumed=0;consumed<2 && mic_ready[mic_next].load(std::memory_order_acquire);++consumed){
        const unsigned i=mic_next;mic_next=(mic_next+1)%2;mic_ready[i].store(false,std::memory_order_release);
        const AudioBlockView block{microphone[i],AUDIO_INPUT_CHUNK_FRAMES,AUDIO_INPUT_RATE,1,mic_sequence,mic_frames,mic_source};
        if(!appAudioBlock(*app,block)){stop_mic();mic_blocked=true;error_code="APP_REJECTED_MIC";++mic_errors;break;}
        ++mic_sequence;mic_frames+=AUDIO_INPUT_CHUNK_FRAMES;
        // An app can finish recording from this callback. Do not deliver a
        // second queued block or requeue capture after it withdraws its request.
        if(!appAudioRequested(*app,profile)){stop_mic();break;}
        if(!M5.Mic.record(microphone[i],AUDIO_INPUT_CHUNK_FRAMES,AUDIO_INPUT_RATE,false)){stop_mic();mic_blocked=true;error_code="MIC_QUEUE_FAILED";++mic_errors;break;}
    }
}
static void deliver(InputEvent event,bool physical){
    event.source=physical?InputSource::Physical:InputSource::Synthetic;
    const auto started=micros();
    const bool accepted=app->apply(event);
    last_app_input_us=micros()-started;
    if(physical){
        ++physical_inputs;
        if(event.kind==InputKind::PrimaryClick)++physical_button_clicks;
        if(event.kind==InputKind::HoldReset)++physical_button_holds;
        if(event.kind==InputKind::SecondaryClick)++physical_secondary_clicks;
        if(event.kind==InputKind::SecondaryHold)++physical_secondary_holds;
        if(event.kind==InputKind::Shake)++physical_shakes;
        if(event.kind==InputKind::Tilt)++physical_tilts;
        if(event.kind==InputKind::TouchSwipe)++physical_swipes;
        if(event.kind==InputKind::TouchTap){++physical_taps;if(event.duration_ms>=1000)++physical_holds;}
        if((event.kind==InputKind::TouchTap||event.kind==InputKind::TouchSwipe)&&event.y>=240)++physical_strip;
        if(event.kind==InputKind::PowerClick)++physical_power_clicks;
        if(event.kind==InputKind::PowerHold)++physical_power_holds;
    }else ++automated_inputs;
    Serial.printf("{\"event\":\"input\",\"physical\":%s,\"accepted\":%s,\"x\":%d,\"y\":%d,\"duration\":%u,\"kind\":%u,\"end_x\":%d,\"end_y\":%d}\n",physical?"true":"false",accepted?"true":"false",event.x,event.y,event.duration_ms,unsigned(event.kind),event.end_x,event.end_y);
}
static void inputs_update(){
    if(profile.capabilities.primary_button){
        static HardwareButtonGesture primary;
        if(auto event=primary.update(M5.BtnA.wasPressed(),M5.BtnA.wasReleased(),millis()))deliver(*event,true);
    }
    if constexpr(HasSecondaryButtonAdapter<UserApp>::value){
        if(hw->secondary_button){
            static HardwareButtonGesture secondary;
            if(auto event=secondary.update(M5.BtnB.wasPressed(),M5.BtnB.wasReleased(),millis(),true))deliver(*event,true);
        }
    }
    if(!profile.capabilities.touch_input)return;
    static uint32_t touch_started[16]={};static bool touch_active[16]={};
    uint32_t seen=0;
    for(unsigned i=0;i<M5.Touch.getCount();++i){
        auto detail=M5.Touch.getDetail(i);
        const unsigned id=detail.id;
        if(id>=16 || (seen & (1u<<id)))continue;
        seen|=1u<<id;
        // The driver's base_msec is rewritten on short release. Keep our own
        // press time so apps receive an actual duration for every completed tap.
        if(detail.wasPressed() || (detail.isPressed() && !touch_active[id])){touch_started[id]=millis();touch_active[id]=true;}
        if(detail.wasReleased()){
            InputEvent event{InputKind::TouchTap};event.x=detail.base_x;event.y=detail.base_y;
            event.end_x=detail.x;event.end_y=detail.y;event.duration_ms=std::min<uint32_t>(60000,millis()-(touch_active[id]?touch_started[id]:detail.base_msec));
            touch_active[id]=false;
            if(abs(detail.distanceX())>12 || abs(detail.distanceY())>12)event.kind=InputKind::TouchSwipe;
            deliver(event,true);
        }
    }
    if(M5.BtnPWR.wasClicked())deliver({InputKind::PowerClick},true);
    if(M5.BtnPWR.wasHold())deliver({InputKind::PowerHold},true);
}
static void motion_update(){
    if(!profile.capabilities.motion_input)return;
    static uint32_t last=0;static HardwareMotion adapter;
    const auto now=millis();if(uint32_t(now-last)<20)return;last=now;
    if(!(M5.Imu.update() & m5::IMU_Class::sensor_mask_accel))return;
    const auto data=M5.Imu.getImuData();
    const auto result=adapter.update(data.accel.x,data.accel.y,data.accel.z,now);
    if(!result.valid){++imu_invalid;return;}
    ++imu_samples;accel_x=data.accel.x;accel_y=data.accel.y;accel_z=data.accel.z;
    if(result.shake)deliver({InputKind::Shake},true);
    if(result.tilt_changed){InputEvent event{InputKind::Tilt};event.value=result.tilt;motion_tilt=result.tilt;deliver(event,true);}
}
static void status(){
#if FIRMWARE_NETWORK_ENABLED
    hardware_network.status();
#endif
    auto stats=appAudioStats(*app);const auto clip=app->speakerOutput().clip();
    Serial.printf("{\"event\":\"status\",\"profile\":\"%s\",\"build\":\"%s\",\"ready\":%s,\"board\":%u,\"width\":%d,\"height\":%d,\"uptime_ms\":%u,\"reset_reason\":%u,\"heap\":%u,\"psram\":%u,\"physical_inputs\":%u,\"automated_inputs\":%u,\"speaker_frames\":%u,\"speaker_playing\":%s,\"mic_requested\":%s,\"mic_active\":%s,\"mic_frames\":%llu,\"mic_rms\":%.6f,\"mic_errors\":%u,\"app_input_us\":%u,\"audio_start_us\":%u,\"speaker_volume\":%u,\"physical_taps\":%u,\"physical_holds\":%u,\"physical_swipes\":%u,\"physical_strip\":%u,\"physical_power_clicks\":%u,\"physical_power_holds\":%u,\"audio_duplex\":\"%s\",\"physical_button_clicks\":%u,\"physical_button_holds\":%u,\"physical_secondary_clicks\":%u,\"physical_secondary_holds\":%u,\"physical_shakes\":%u,\"physical_tilts\":%u,\"imu_samples\":%u,\"imu_invalid\":%u,\"accel_x\":%.4f,\"accel_y\":%.4f,\"accel_z\":%.4f,\"tilt_degrees\":%d,\"error\":\"%s\"}\n",FIRMWARE_PROFILE,FIRMWARE_BUILD_ID,ready?"true":"false",unsigned(M5.getBoard()),M5.Display.width(),M5.Display.height(),millis(),unsigned(esp_reset_reason()),ESP.getFreeHeap(),ESP.getFreePsram(),physical_inputs,automated_inputs,speaker_frames,M5.Speaker.isPlaying()?"true":"false",appAudioRequested(*app,profile)?"true":"false",mic_active?"true":"false",stats?(unsigned long long)stats->received_frames:0,stats?stats->level:0,mic_errors,last_app_input_us,last_audio_start_us,unsigned(FIRMWARE_SPEAKER_VOLUME),physical_taps,physical_holds,physical_swipes,physical_strip,physical_power_clicks,physical_power_holds,FIRMWARE_AUDIO_DUPLEX,physical_button_clicks,physical_button_holds,physical_secondary_clicks,physical_secondary_holds,physical_shakes,physical_tilts,imu_samples,imu_invalid,accel_x,accel_y,accel_z,motion_tilt,error_code);
}
static void commands(){
    static char line[4096];static unsigned used=0;static bool overflow=false;
    while(Serial.available()>0){
        char c=Serial.read();if(c=='\r')continue;
        if(c!='\n'){if(used+1<sizeof(line))line[used++]=c;else overflow=true;continue;}
        line[used]=0;used=0;
        if(overflow){overflow=false;continue;}
#if FIRMWARE_NETWORK_ENABLED
        if(hardware_network.configure(line)){memset(line,0,sizeof(line));continue;}
#endif
        if(!strcmp(line,"STATUS")){status();continue;}
        if(!strcmp(line,"RESET_APP")){deliver({InputKind::HoldReset},false);continue;}
        int x,y,d;char extra;
        if(profile.capabilities.primary_button && sscanf(line,"BUTTON %d %c",&d,&extra)==1 && d>=0&&d<=60000){InputEvent event{d>=1000?InputKind::HoldReset:InputKind::PrimaryClick};event.duration_ms=d;deliver(event,false);}
        if constexpr(HasSecondaryButtonAdapter<UserApp>::value){
            if(hw->secondary_button && sscanf(line,"BUTTON2 %d %c",&d,&extra)==1 && d>=0&&d<=60000){InputEvent event{d>=1000?InputKind::SecondaryHold:InputKind::SecondaryClick};event.duration_ms=d;deliver(event,false);}
        }
        if(profile.capabilities.touch_input && sscanf(line,"TAP %d %d %d %c",&x,&y,&d,&extra)==3 && x>=0&&x<int(profile.width)&&y>=0&&y<int(HasTouchStripAdapter<UserApp>::value?touchSurfaceHeight(profile):profile.height)&&d>=0&&d<=60000){InputEvent event{InputKind::TouchTap};event.x=x;event.y=y;event.duration_ms=d;deliver(event,false);}
    }
}
void setup(){
    auto cfg=M5.config();cfg.internal_imu=profile.capabilities.motion_input;cfg.internal_rtc=false;cfg.internal_mic=profile.capabilities.microphone_input;cfg.internal_spk=profile.capabilities.tone_output;cfg.external_imu=false;cfg.external_rtc=false;
    M5.begin(cfg);Serial.begin(115200);Serial.setTxTimeoutMs(5);M5.Speaker.end();M5.Mic.end();M5.Display.setRotation(FIRMWARE_ROTATION);M5.Display.setBrightness(100);
    app=std::make_unique<UserApp>(profile);
    if(M5.getBoard()!=FIRMWARE_BOARD){error_code="BOARD_MISMATCH";status();return;}
    if(ESP.getPsramSize()<FIRMWARE_PSRAM_BYTES){error_code="PSRAM_CONFIGURATION_FAILED";status();return;}
    if(profile.capabilities.motion_input && !M5.Imu.isEnabled()){error_code="IMU_BEGIN_FAILED";status();return;}
    screen.setColorDepth(16);screen.setPsram(true);
    if(!screen.createSprite(profile.width,profile.height)){error_code="FRAMEBUFFER_ALLOCATION_FAILED";status();return;}
#if FIRMWARE_NETWORK_ENABLED
    hardware_network.begin();
#endif
    screen.setFont(&fonts::Font0);ready=true;status();
}
void loop(){
    if(!ready){if(Serial.available()>0){while(Serial.available()>0)Serial.read();status();}delay(20);return;}
    M5.update();inputs_update();motion_update();commands();
    appTick(*app,millis());
#if FIRMWARE_NETWORK_ENABLED
    hardware_network.tick(*app);
#endif
    audio_update();
    static uint32_t last_draw=0;
    if(millis()-last_draw>=33 && render_revision!=app->snapshot().revision){last_draw=millis();render_revision=app->snapshot().revision;drawUserApp(screen,*app);screen.pushSprite(0,0);}
    delay(1);
}
