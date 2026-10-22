#include "native_app_test_support.hpp"

struct LegacyApp {};
struct DisabledApp { static constexpr unsigned touch_strip_adapter=0; };
static_assert(!HasTouchStripAdapter<LegacyApp>::value);
static_assert(!HasTouchStripAdapter<DisabledApp>::value);
static_assert(HasTouchStripAdapter<UserApp>::value);

int main(int argc,char** argv) {
    try {
        DeviceProfile se{"cores3se",320,240,{false,true,false,true,true}};
        UserApp app(se);
        for(int x : {0,106,107,213,214,319}) {
            InputEvent tap{InputKind::TouchTap};tap.x=x;tap.y=260;tap.duration_ms=50;
            check(app.apply(tap),"SE lower strip touch was rejected");
        }
        check(app.snapshot().count==6,"one strip touch must produce one starter action");
        InputEvent swipe{InputKind::TouchSwipe};swipe.x=0;swipe.y=239;swipe.end_x=319;swipe.end_y=279;swipe.duration_ms=100;
        check(app.apply(swipe),"SE display-to-strip swipe was rejected");
        swipe.end_y=280;check(!app.apply(swipe),"SE accepted touch beyond full surface");
        UserApp standard({"cores3",320,240,{false,true,true,true,true}});
        InputEvent tap{InputKind::TouchTap};tap.x=160;tap.y=260;tap.duration_ms=50;
        check(!standard.apply(tap),"standard Core inherited SE strip extension");
        for(int y : {-1,280}) {tap.y=y;check(!app.apply(tap),"SE accepted invalid Y");}
        Raster raster(320,240);drawUserApp(raster,app);
        check(!raster.out_of_bounds && raster.pixels.size()==320*240,"touch extension changed framebuffer bounds");
        if(argc==2) {
            NativeWorker worker(argv[1],"cores3se",320,240);
            contains(worker.receive().header,"\"touch_strip_adapter\":1");
            auto frame=worker.command("touch 319 279 50");contains(frame.header,"\"count\":1");
            check(frame.pixels.size()==320*240*3,"native LCD payload changed");
            contains(worker.command("swipe 0 239 319 279 200").header,"\"count\":1");
            worker.send("touch 319 280 50");check(worker.finish()==2,"native parser accepted Y280");
            NativeWorker core(argv[1],"cores3",320,240);auto header=core.receive().header;
            check(header.find("touch_strip_adapter")==std::string::npos,"standard Core advertised SE strip");
            core.send("touch 160 260 50");check(core.finish()==2,"standard Core accepted strip input");
            NativeWorker retired(argv[1],"cores3se",320,240,"trail");
            check(retired.finish()==2,"retired app was accepted");
        }
        std::cout<<"PASS SE touch strip: model bounds, isolated profile, fixed LCD"<<(argc==2?", native adapter and protocol":"; native protocol not run")<<'\n';
    } catch(const std::exception& error) {std::cerr<<"FAIL: "<<error.what()<<'\n';return 1;}
}
