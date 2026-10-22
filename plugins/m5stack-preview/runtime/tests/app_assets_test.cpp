// Focused app-asset and native protocol regression tests.
#include "native_app_test_support.hpp"
#include "../src/app_protocol.hpp"
#include <climits>
#include <sstream>

static DeviceProfile seProfile() { return {"cores3se",320,240,{false,true,false,true,true}}; }
static RecordingInfo recordingInfo() { return {"voice_1","audio/webm",1200,2048,std::string(64,'a'),"fixture"}; }
static ImageFrame imageFrame() { return {"image_1",2,2,{0xf800,0x07e0,0x001f,0xffff}}; }
static bool beginCapture(UserApp& app,const std::string& id,const std::string& source) {
    return app.setCaptureIntent("start",id,source)&&app.recordingStarted(id,source);
}
static bool readyCapture(UserApp& app,const RecordingInfo& info) {
    return beginCapture(app,info.id,info.source)&&app.recordingStopped(info.id,info.source)&&app.setRecording(info);
}

static void assetModelTests() {
    UserApp app(seProfile());
    check(!app.recording() && !app.image(),"initial assets not empty");
    check(!app.apply({InputKind::Shake}) && !app.apply({InputKind::Tilt,30}),"SE accepted invented motion");
    InputEvent touch{InputKind::TouchTap};touch.x=319;touch.y=239;touch.duration_ms=999;
    check(app.apply(touch) && app.snapshot().count==1,"logical edge touch did not increment exactly once");
    for (const auto point : {std::pair<int,int>{320,0},{0,280},{-1,0},{0,-1},{INT_MAX,INT_MAX}}) {
        auto invalid=touch;invalid.x=point.first;invalid.y=point.second;
        check(!app.apply(invalid),"out of touch-surface input accepted");
    }
    auto long_touch=touch;long_touch.duration_ms=60001;
    check(!app.apply(long_touch),"oversized touch duration accepted");
    check(app.snapshot().count==1,"invalid touches mutated count");
    InputEvent swipe{InputKind::TouchSwipe};swipe.x=319;swipe.y=239;swipe.end_x=0;swipe.end_y=0;swipe.duration_ms=200;
    check(app.apply(swipe) && app.snapshot().count==1,"swipe synthesized a counter click");
    swipe.end_y=280;check(!app.apply(swipe),"swipe outside full touch surface accepted");
    swipe.end_y=0;swipe.end_x=-1;check(!app.apply(swipe),"negative swipe endpoint accepted");
    check(readyCapture(app,recordingInfo()) && app.recording()->source=="fixture","fixture provenance lost");
    const auto first_revision=app.snapshot().revision;
    auto browser=recordingInfo();browser.id="voice_browser";browser.source="browser";
    check(readyCapture(app,browser) && app.recording()->source=="browser" && app.snapshot().revision==first_revision+3,"replacement did not notify app");
    for (unsigned field=0;field<10;++field) {
        auto invalid=recordingInfo();
        switch(field) {
            case 0:invalid.id="../../private";break;
            case 1:invalid.id=std::string(65,'a');break;
            case 2:invalid.duration_ms=0;break;
            case 3:invalid.duration_ms=30001;break;
            case 4:invalid.bytes=0;break;
            case 5:invalid.bytes=2097153;break;
            case 6:invalid.mime_type="text/html";break;
            case 7:invalid.sha256=std::string(64,'A');break;
            case 8:invalid.sha256=std::string(63,'a');break;
            case 9:invalid.source="physical";break;
        }
        check(!app.setRecording(invalid) && app.recording()->id=="voice_browser","invalid recording mutated prior asset");
    }
    check(app.setImage(imageFrame()),"valid image rejected");
    for (unsigned field=0;field<6;++field) {
        auto invalid=imageFrame();
        switch(field) {
            case 0:invalid.id="https://private";break;
            case 1:invalid.width=0;break;
            case 2:invalid.width=321;break;
            case 3:invalid.height=241;break;
            case 4:invalid.rgb565.pop_back();break;
            case 5:invalid.rgb565.push_back(0);break;
        }
        check(!app.setImage(invalid) && app.image()->rgb565==imageFrame().rgb565,"invalid image mutated prior asset");
    }
    InputEvent text{InputKind::TextInput};text.text="A dream \xf0\x9f\x8c\x99";
    check(app.apply(text),"valid UTF-8 rejected");
    text.text=std::string(2048,'x');check(app.apply(text),"2048 byte text rejected");
    text.text+='x';check(!app.apply(text),"2049 byte text accepted");
    for(const std::string invalid:{"\xc0\xaf","\xed\xa0\x80","\xf4\x90\x80\x80","\xe2\x82","\x80"}) {
        text.text=invalid;check(!app.apply(text),"invalid Unicode accepted");
    }
    long_touch.duration_ms=1000;
    check(app.apply(long_touch) && app.snapshot().count==0 && !app.recording() && !app.image(),"hold did not clear volatile assets");
    browser.id="voice_after_reset";
    check(readyCapture(app,browser) && app.setImage(imageFrame()),"reload assets failed");
    check(app.clearRecording() && app.clearImage() && !app.recording() && !app.image(),"explicit clear failed");
    check(app.clearRecording() && app.clearImage(),"idempotent clear failed");
    check(beginCapture(app,"pending_voice","fixture") && !app.recording(),"capture-start acknowledgement created fake recording");
    check(!app.recordingStarted("pending_voice","physical"),"unproven capture source accepted");
    check(app.clearRecording() && !app.recording(),"cancel before ready failed");
    UserApp atom({"atoms3r",128,128,{true,false,true,false,false}});
    check(!atom.setRecording(browser) && !atom.clearRecording() && !atom.apply(touch),"Atom accepted invented mic/touch");
    check(atom.setImage(imageFrame()),"display-only Atom image rejected");
    check(!atom.recordingStarted("voice","fixture"),"Atom capture-start accepted");
    ImageFrame oversized{"large",129,1,std::vector<std::uint16_t>(129)};
    check(!atom.setImage(oversized),"image larger than selected display accepted");
    std::cout<<"PASS app assets: exact SE capability gates, spatial touch bounds/hold, replacement notifications, recording provenance/limits, text Unicode/size, reset/clear, Atom rejection\n";
}

static void recordingCaptureTests() {
    UserApp app(seProfile());
    const auto info=recordingInfo();
    check(!app.setRecording(info) && !app.recording() && !app.recordingCapture() && app.snapshot().revision==0,"unsolicited recording changed state");
    check(beginCapture(app,info.id,info.source) && app.recordingCapture()->id==info.id && app.recordingCapture()->source==info.source,"capture acknowledgement lost id/source");
    check(!app.setRecording(info),"Ready accepted before Stopped acknowledgement");
    check(app.recordingStopped(info.id,info.source),"Stopped acknowledgement failed");
    const auto revision=app.snapshot().revision;
    auto wrong_clip=info;wrong_clip.id="other_clip";
    auto wrong_source=info;wrong_source.source="browser";
    auto bad_metadata=info;bad_metadata.bytes=0;
    for (const auto& invalid:{wrong_clip,wrong_source,bad_metadata})
        check(!app.setRecording(invalid) && !app.recording() && app.recordingCapture()->id==info.id &&
              app.recordingCapture()->source==info.source && app.snapshot().revision==revision,"invalid completion mutated active capture");
    auto replacement=info;replacement.id="replacement";replacement.source="browser";
    check(app.clearRecording() && beginCapture(app,replacement.id,replacement.source),"replacement capture failed");
    check(!app.setRecording(info) && app.recordingCapture()->id==replacement.id,"replaced capture accepted old completion");
    check(app.recordingStopped(replacement.id,replacement.source) && app.setRecording(replacement) && !app.recordingCapture() && app.recording()->id==replacement.id,"matching completion failed to consume capture");
    const auto ready_revision=app.snapshot().revision;
    check(!app.setRecording(replacement) && !app.recordingCapture() && app.recording()->id==replacement.id && app.snapshot().revision==ready_revision,"duplicate completion changed accepted recording");
    auto cancelled=info;cancelled.id="cancelled";
    check(beginCapture(app,cancelled.id,cancelled.source) && app.clearRecording(),"capture cancellation failed");
    check(!app.setRecording(cancelled) && !app.recording() && !app.recordingCapture(),"late completion survived cancellation");
    auto reset=info;reset.id="reset_clip";
    check(beginCapture(app,reset.id,reset.source) && app.apply({InputKind::HoldReset}),"capture reset failed");
    check(!app.setRecording(reset) && !app.recording() && !app.recordingCapture(),"late completion survived reset");
    check(beginCapture(app,"after_reset","fixture") && !app.setRecording(reset) && app.recordingCapture()->id=="after_reset","old completion displaced new capture after reset");
    std::cout<<"PASS recording lifecycle: active capture ID/source required, wrong/invalid completion preserves state, replacement/cancel/reset/duplicate completion rejection\n";
}

static void resultContextTests() {
    UserApp app(seProfile());
    const ResultContext first{"draft1","request1",1},second{"draft1","request2",2};
    check(!app.setText("stale",first) && !app.setImage(imageFrame(),first),"unsolicited result accepted");
    check(app.expectResult(first) && app.expectResult(first),"active expectation not idempotent");
    check(!app.setText("fixture") && !app.setImage(imageFrame()),"unscoped fixture overwrote expected result");
    check(!app.setText("wrong",second) && app.expectedResult()->request_id=="request1","wrong result consumed expected context");
    check(!app.setText("",first) && app.expectedResult(),"invalid result consumed expected context");
    check(app.setText("accepted",first) && !app.expectedResult(),"matching text failed to consume expectation");
    check(!app.setText("duplicate",first) && !app.expectResult(first),"consumed text context replayed");
    check(app.expectResult(second) && app.setImage(imageFrame(),second) && !app.expectedResult(),"matching image failed to consume");
    check(!app.setImage(imageFrame(),second) && !app.expectResult(second),"consumed image context replayed");
    const ResultContext cancelled{"draft1","cancelled",3};
    check(app.expectResult(cancelled),"cancel expectation failed");app.clearExpectedResult();
    check(!app.setText("late",cancelled) && !app.expectResult(cancelled),"cancelled context rearmed");
    const ResultContext reset{"draft2","reset_request",4};
    check(app.expectResult(reset) && app.apply({InputKind::HoldReset}) && !app.expectedResult(),"reset did not cancel expectation");
    check(!app.setImage(imageFrame(),reset) && !app.expectResult(reset),"reset context rearmed");
    const ResultContext replaced{"draft3","old_request",5},latest{"draft3","latest_request",6};
    check(app.expectResult(replaced) && app.expectResult(latest),"expectation replacement failed");
    check(!app.setText("old",replaced) && !app.expectResult(replaced) && app.expectedResult()->request_id==latest.request_id,"old result displaced latest");
    check(readyCapture(app,recordingInfo()) && app.expectedResult(),"independent recording consumed async expectation");
    check(app.setText("latest",latest),"latest result rejected");
    check(app.setText("direct fixture") && app.setImage(imageFrame()),"direct fixture rejected with no expectation");
    for (const auto& invalid : {ResultContext{"","r",1},{"d","bad id",1},{"d","r",0},{"d","r",9007199254740992ULL}})
        check(!app.expectResult(invalid),"invalid context accepted");
    UserApp bounded(seProfile());
    for (unsigned i=1;i<=64;++i) {
        check(bounded.expectResult({"d","r"+std::to_string(i),i}),"history exhausted before64");
        bounded.clearExpectedResult();
    }
    check(!bounded.expectResult({"d","r65",65}),"history exceeded64 requests");
    bounded.apply({InputKind::HoldReset});
    check(!bounded.expectResult({"d","r1",1}) && !bounded.expectResult({"d","r65",65}),"reset evicted replay history");
    UserApp reloaded(seProfile());
    check(reloaded.expectResult({"d","r65",65}),"fresh worker lifetime did not renew budget");
    std::cout<<"PASS async results: unsolicited/wrong/duplicate rejection, consume before notification, fixtures gated by expectation, cancel/reset/replacement replay rejection,64-context lifetime bound\n";
}

static void imageRasterTests() {
    Raster raster(4,4);
    const auto frame=imageFrame();
    check(drawImage(raster,frame,0,0,4,4),"raster draw rejected");
    check(raster.pixels==std::vector<std::uint16_t>{0xf800,0xf800,0x07e0,0x07e0,0xf800,0xf800,0x07e0,0x07e0,
        0x001f,0x001f,0xffff,0xffff,0x001f,0x001f,0xffff,0xffff},"nearest-neighbor RGB565 fidelity failed");
    std::fill(raster.pixels.begin(),raster.pixels.end(),0);
    check(drawImage(raster,frame,-2,-2,4,4) && !raster.out_of_bounds,"negative destination clipping failed");
    check(raster.pixels==std::vector<std::uint16_t>{0xffff,0xffff,0,0,0xffff,0xffff,0,0,0,0,0,0,0,0,0,0},"clipped source mapping wrong");
    check(drawImage(raster,frame,INT_MAX,INT_MAX,INT_MAX,INT_MAX),"positive overflow-safe offscreen draw failed");
    check(drawImage(raster,frame,INT_MIN,INT_MIN,INT_MAX,INT_MAX),"negative overflow-safe offscreen draw failed");
    check(!drawImage(raster,frame,0,0,0,4) && !drawImage(raster,frame,0,0,4,-1),"invalid destination accepted");
    auto bad=frame;bad.rgb565.clear();check(!drawImage(raster,bad,0,0,4,4),"invalid source accepted");
    check(!raster.out_of_bounds,"raster adapter saw out of bounds pixels");
    std::cout<<"PASS image raster: exact RGB565 colors, nearest-neighbor geometry, clipping and integer extremes\n";
}

static void parserTests() {
    std::string line;
    std::istringstream stream(std::string(MAX_APP_COMMAND_BYTES,'a')+"\nnext");
    check(readAppCommand(stream,line)==LineRead::Line && line.size()==MAX_APP_COMMAND_BYTES,"maximum command failed");
    check(readAppCommand(stream,line)==LineRead::Line && line=="next","EOF-terminated command lost");
    check(readAppCommand(stream,line)==LineRead::End,"clean EOF failed");
    std::istringstream oversized(std::string(MAX_APP_COMMAND_BYTES+1,'a')+"\n");
    check(readAppCommand(oversized,line)==LineRead::TooLong && line.size()==MAX_APP_COMMAND_BYTES,"oversized command not bounded");
    std::uint32_t number=0;
    check(appUnsigned("4294967295",UINT32_MAX,number) && number==UINT32_MAX,"maximum integer rejected");
    for (const auto* invalid:{"4294967296","99999999999999999999","-1","+1","1e2",""})
        check(!appUnsigned(invalid,UINT32_MAX,number),"invalid integer accepted");
    std::string decoded="unchanged";
    check(decodeAppText("41F09F8C99",decoded) && decoded=="A\xf0\x9f\x8c\x99","text hex decode failed");
    for (const auto* invalid:{"a","gg","c0af","eda080","f4908080"}) {
        decoded="unchanged";check(!decodeAppText(invalid,decoded) && decoded=="unchanged","invalid text decode mutated output");
    }
    ImageFrame image;
    check(decodeAppImage("colors","2","2","f80007e0001fffff",image) && image.rgb565==imageFrame().rgb565,"numeric R5G6B5 order wrong");
    check(!decodeAppImage("bad","2","2","f800",image) && image.id=="colors","truncated image mutated output");
    check(!decodeAppImage("bad","320","240",std::string(307201,'0'),image),"oversized pixels accepted");
    check(decodeAppImage("max","320","240",std::string(307200,'f'),image) && image.rgb565.size()==76800,"maximum image rejected");
    ResultContext context;
    check(decodeResultContext("draft","request","9007199254740991",context) && context.revision==9007199254740991ULL,"safe maximum revision rejected");
    for (const auto* invalid:{"0","-1","1.0","9007199254740992","18446744073709551616",""})
        check(!decodeResultContext("draft","request",invalid,context),"invalid revision accepted");
    std::cout<<"PASS protocol helpers: bounded command read, overflow-safe integers, UTF-8/hex rejection, exact/max RGB565 payload\n";
}

static void seNativeTests(const std::string& binary) {
    const std::string record="recording voice_1 1200 2048 webm "+std::string(64,'a')+" fixture";
    for (const auto* app_name:{"counter","custom"}) {
        NativeWorker worker(binary,"cores3se",320,240,app_name);
        const auto initial=worker.receive();
        contains(initial.header,"\"profile\":\"cores3se\",\"width\":320,\"height\":240");
        contains(initial.header,"\"media_adapter\":1,\"app_adapter\":1");
        contains(initial.header,"\"recording\":null,\"image\":null");
        contains(initial.header,"\"expected_result\":null");
        contains(initial.header,"\"recording_capture\":null");
        contains(initial.header,"\"capture_adapter\":1");
        contains(worker.command("touch 319 239 999").header,"\"count\":1");
        contains(worker.command("swipe 319 239 0 0 200").header,"\"count\":1");
        worker.command("recording_request cancelled_first fixture");
        contains(worker.command("recording_start cancelled_first fixture").header,"\"recording_capture\":{\"id\":\"cancelled_first\",\"source\":\"fixture\",\"stopped\":false}");
        contains(worker.command("recording_clear").header,"\"recording\":null");
        worker.command("recording_request voice_1 fixture");
        worker.command("recording_start voice_1 fixture");
        worker.command("recording_stopped voice_1 fixture");
        contains(worker.command(record).header,"\"mime_type\":\"audio/webm\",\"duration_ms\":1200,\"bytes\":2048");
        contains(worker.command("state").header,"\"source\":\"fixture\"");
        contains(worker.command("state").header,"\"recording_capture\":null");
        contains(worker.command("image colors 2 2 f80007e0001fffff").header,"\"image\":{\"id\":\"colors\",\"width\":2,\"height\":2}");
        contains(worker.command("text 647265616d20f09f8c99").header,"\"count\":1");
        auto reset=worker.command("touch 160 120 1000");
        contains(reset.header,"\"recording\":null,\"image\":null");
        check(reset.pixels==initial.pixels,"SE hold failed to restore original framebuffer");
        worker.command("recording_request after_reset fixture");worker.command("recording_start after_reset fixture");
        worker.command("recording_stopped after_reset fixture");worker.command("recording after_reset 1200 2048 webm "+std::string(64,'a')+" fixture");worker.command("recording_clear");
        worker.command("image max 320 240 "+std::string(307200,'f'));
        contains(worker.command("image_clear").header,"\"recording\":null,\"image\":null");
        contains(worker.command("mic 50 browser").header,"\"microphone_amplitude\":0.5");
        worker.send("quit");check(worker.finish()==0,"SE worker did not exit");
    }
    const std::vector<std::string> invalid={"shake","motion 0 0.5 0.866025404","button","touch 0 280","touch 320 0","touch 0 0 60001","touch 0 0 50 extra",
        "swipe 0 0 0 280 200","swipe 0 0 320 0 200","swipe 0 0 0 0 60001","swipe 0 0 0 0 200 extra",
        "recording_start voice physical","recording_start voice fixture extra","recording_start voice",record,
        "text_result draft request 1 61","image_result draft request 1 img 1 1 f800",
        "text_result draft request 9007199254740992 61","image_result draft request 0 img 1 1 f800",
        "text","text ff","text 0","text 00 extra","text "+std::string(4098,'0'),"recording v 0 1 webm "+std::string(64,'a')+" browser",
        "recording v 1 2097153 webm "+std::string(64,'a')+" fixture",record+" extra","recording v 1 1 webm "+std::string(64,'a')+" physical",
        "recording_clear extra","image_clear extra","image bad 2 2 f800","image bad 321 1 f800","image bad 1 1 zzzz","image ../../private 1 1 f800",
        "image bad 1 1 f800 extra",std::string(MAX_APP_COMMAND_BYTES+1,'x')};
    for (const auto& command:invalid) {
        NativeWorker rejected(binary,"cores3se",320,240);
        rejected.receive();rejected.send(command);check(rejected.finish()==2,"SE malformed/unsupported command accepted");
    }
    const std::vector<std::vector<std::string>> invalid_capture_sequences={
        {"recording_request voice_1 fixture","recording_start voice_1 fixture","recording_clear",record},
        {"recording_request voice_1 fixture","recording_start voice_1 fixture","reset",record},
        {"recording_request voice_1 fixture","recording_start voice_1 fixture","touch 0 0 1000",record},
        {"recording_request voice_1 fixture","recording_start voice_1 fixture","recording_stopped voice_1 fixture",record,record},
        {"recording_request wrong_clip fixture","recording_start wrong_clip fixture",record},
        {"recording_request voice_1 browser","recording_start voice_1 browser",record},
        {"recording_request voice_1 fixture","recording_start voice_1 fixture",record},
        {"recording_request voice_1 fixture","recording_start voice_1 fixture","reset","recording_request new_clip fixture","recording_start new_clip fixture",record},
    };
    for(const auto& sequence:invalid_capture_sequences) {
        NativeWorker rejected(binary,"cores3se",320,240);
        rejected.receive();
        for(std::size_t i=0;i+1<sequence.size();++i)rejected.command(sequence[i]);
        rejected.send(sequence.back());check(rejected.finish()==2,"native stale/wrong recording completion accepted");
    }
    for (const auto* example:{"trail","mascot","eightball"}) {
        NativeWorker rejected(binary,"cores3se",320,240,example);
        check(rejected.finish()==2,"retired example was accepted");
    }
    NativeWorker atom(binary,"atoms3r",128,128);
    atom.receive();atom.send(record);check(atom.finish()==2,"Atom native accepted recording metadata");
    std::cout<<"PASS native SE: 2 starter apps, spatial logical bounds/hold, root asset metadata/provenance, max image, reset/clear, mic level, "
        <<invalid.size()<<" malformed/unsupported commands, "<<invalid_capture_sequences.size()<<" stale/wrong capture sequences, retired-app/Atom gates and worker exits\n";
}

int main(int argc,char** argv) {
    if (argc!=1 && (argc!=3 || std::string(argv[1])!="--worker")) return 2;
    std::signal(SIGPIPE,SIG_IGN);
    try {
        assetModelTests();recordingCaptureTests();resultContextTests();imageRasterTests();parserTests();
        if(argc==3)seNativeTests(argv[2]);
    } catch(const std::exception& error) { std::cerr<<"FAIL: "<<error.what()<<'\n';return 1; }
    return 0;
}
