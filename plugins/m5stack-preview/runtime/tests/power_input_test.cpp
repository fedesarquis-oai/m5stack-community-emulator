#include "native_app_test_support.hpp"

static void reject(const std::string& binary,const char* profile,unsigned width,unsigned height,const char* app,const std::string& command){
    NativeWorker worker(binary,profile,width,height,app);worker.receive();worker.send(command);
    check(worker.finish()==2,"invalid or unsupported POWER command was accepted");
}
int main(int argc,char** argv){
    try{
        for(const auto* id:{"cores3","cores3se"}){
            UserApp app({id,320,240,{false,true,true,true,true}});
            app.apply({InputKind::PrimaryClick});app.setImage({"kept_image",1,1,{0x1234}});app.expectResult({"draft","request",1});
            const auto count=app.snapshot().count;
            for(const auto kind:{InputKind::PowerClick,InputKind::PowerHold}){
                const auto revision=app.snapshot().revision;
                check(app.apply({kind}),"Core POWER semantic input rejected");
                check(app.snapshot().count==count&&app.snapshot().revision==revision+1&&app.image()&&app.expectedResult(),"default POWER caused an app reset");
            }
        }
        for(const auto* id:{"atoms3r","stickcplus2","sticks3","cores3-se"}){
            UserApp app({id,128,128,{true,true,true,true,true}});const auto revision=app.snapshot().revision;
            for(const auto kind:{InputKind::PowerClick,InputKind::PowerHold})for(const auto source:{InputSource::Synthetic,InputSource::Physical})
                check(!app.apply({kind,0,source})&&app.snapshot().revision==revision,"unsupported board invented a POWER input");
        }
        std::cout<<"PASS model POWER: exact Core identities; appended semantic inputs; starter preserves count, assets and pending context\n";
        if(argc==1)return 0;
        if(argc!=3)throw std::runtime_error("usage: power_input_test [base-worker authored-fixture-worker]");
        const std::string binary=argv[1],fixture=argv[2];
        for(const auto* profile:{"cores3","cores3se"})for(const auto* app:{"counter","custom"}){
            NativeWorker worker(binary,profile,320,240,app);
            contains(worker.receive().header,"\"power_button_adapter\":1");worker.command("touch 20 20 50");
            for(const auto* command:{"power click","power hold"}){
                const auto response=worker.command(command);contains(response.header,"\"app_input_accepted\":true");contains(response.header,"\"count\":1");
            }
            contains(worker.command("state").header,"\"app_input_accepted\":null");check(worker.finish()==0,"POWER worker did not close normally");
        }
        for(const auto* command:{"power","power click extra","power hold 1000","power reset","power CLICK","power 1"})reject(binary,"cores3se",320,240,"custom",command);
        for(const auto* action:{"power click","power hold"}){
            reject(binary,"atoms3r",128,128,"custom",action);reject(binary,"stickcplus2",135,240,"custom",action);
            reject(binary,"sticks3",135,240,"custom",action);
        }
        for(const auto* profile:{"cores3","cores3se"}){
            NativeWorker worker(fixture,profile,320,240);worker.receive();
            const auto denied=worker.command("power hold");contains(denied.header,"\"app_input_accepted\":false");contains(denied.header,"\"count\":0");
            contains(worker.command("power click").header,"\"count\":10");
            const auto accepted=worker.command("power hold");contains(accepted.header,"\"app_input_accepted\":true");contains(accepted.header,"\"count\":110");
            check(worker.finish()==0,"authored POWER rejection terminated worker");
        }
        std::cout<<"PASS native POWER: Core counter/custom only; invalid/unsupported commands rejected; authored click/hold and nonfatal rejection verified\n";
    }catch(const std::exception& error){std::cerr<<"FAIL: "<<error.what()<<'\n';return 1;}return 0;
}
