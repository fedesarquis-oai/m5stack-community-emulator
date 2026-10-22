#include "native_app_test_support.hpp"

static const std::string metadata="recording clip_a 1000 32044 wav "+std::string(64,'a')+" fixture";
static void rejected(const std::string& binary,const std::vector<std::string>& setup,const std::string& invalid) {
    NativeWorker worker(binary,"cores3se",320,240);worker.receive();
    for(const auto& line:setup)worker.command(line);
    worker.send(invalid);check(worker.finish()==2,"malformed/stale native capture command did not exit 2");
}
int main(int argc,char** argv) {
    try {
        if(argc!=3)throw std::runtime_error("usage: capture_protocol_test new-worker legacy-worker");
        const std::string binary=argv[1],legacy=argv[2];
        {
            NativeWorker worker(binary,"cores3se",320,240);
            contains(worker.receive().header,"\"capture_adapter\":1");
            auto request=worker.command("recording_request clip_a fixture");
            contains(request.header,"\"capture_intent\":{\"id\":\"clip_a\",\"source\":\"fixture\",\"action\":\"start\",\"sequence\":1}");
            auto started=worker.command("recording_start clip_a fixture");
            contains(started.header,"\"capture_intent\":null");contains(started.header,"\"stopped\":false");
            check(worker.command("recording_start clip_a fixture").header==started.header,"Started receipt was not idempotent");
            auto stopped=worker.command("recording_stopped clip_a fixture");contains(stopped.header,"\"stopped\":true");
            check(worker.command("recording_stopped clip_a fixture").header==stopped.header,"Stopped receipt was not idempotent");
            auto ready=worker.command(metadata);contains(ready.header,"\"recording_capture\":null");
            contains(ready.header,"\"recording\":{\"id\":\"clip_a\"");
            check(worker.command("recording_stopped clip_a fixture").header==ready.header,"Completed Stopped retry was not idempotent");
            auto cleared=worker.command("recording_clear clip_a fixture");contains(cleared.header,"\"action\":\"cancel\"");
            check(worker.command("recording_clear clip_a fixture").header==cleared.header,"Scoped clear retry was not idempotent");
            worker.command("recording_request clip_b fixture");worker.command("recording_start clip_b fixture");
            contains(worker.command("reset").header,"\"capture_intent\":null");
            check(worker.finish()==0,"valid native capture worker did not close cleanly");
        }
        const std::vector<std::string> requested{"recording_request clip_a fixture"};
        const std::vector<std::string> started{"recording_request clip_a fixture","recording_start clip_a fixture"};
        auto stopped=started;stopped.push_back("recording_stopped clip_a fixture");
        for(const auto& command:std::vector<std::string>{
            "recording_request clip_a", "recording_request clip_a fixture extra", "recording_request clip_a physical",
            "recording_request ../clip fixture", "recording_start clip_a fixture", "recording_stopped clip_a fixture",
            "recording_clear clip_a", "recording_clear clip_a fixture extra", "recording_clear clip_a fixture"})rejected(binary,{},command);
        rejected(binary,requested,"recording_start clip_a browser");
        rejected(binary,requested,"recording_request clip_b fixture");
        rejected(binary,started,metadata);
        rejected(binary,started,"recording_stopped clip_b fixture");
        rejected(binary,started,"recording_stopped clip_a fixture extra");
        rejected(binary,started,"recording_clear clip_a browser");
        auto cancelled=started;cancelled.push_back("recording_clear clip_a fixture");
        rejected(binary,cancelled,"recording_start clip_a fixture");
        rejected(binary,cancelled,"recording_request clip_a fixture");
        auto reset=started;reset.push_back("reset");
        rejected(binary,reset,"recording_request clip_a fixture");
        auto replacement=cancelled;replacement.push_back("recording_request clip_b fixture");
        rejected(binary,replacement,"recording_clear clip_a fixture");
        auto complete=stopped;complete.push_back(metadata);rejected(binary,complete,metadata);
        {
            NativeWorker worker(legacy,"cores3se",320,240);
            check(worker.receive().header.find("\"capture_adapter\"")==std::string::npos,"legacy header claimed handshake adapter");
            const auto header=worker.command("recording_start clip_a fixture").header;
            contains(header,"\"recording_capture\":{\"id\":\"clip_a\",\"source\":\"fixture\"}");
            contains(worker.command(metadata).header,"\"recording\":{\"id\":\"clip_a\"");
            worker.command("recording_clear");check(worker.finish()==0,"legacy flow failed");
        }
        for(const auto& command:std::vector<std::string>{"recording_request clip_a fixture","recording_stopped clip_a fixture","recording_clear clip_a fixture"})rejected(legacy,{},command);
        std::cout<<"PASS direct native capture protocol: current and legacy lifecycle, idempotent acknowledgements, 20 current invalid/stale commands and 3 unsupported legacy commands rejected\n";
    } catch(const std::exception& error) { std::cerr<<"FAIL: "<<error.what()<<'\n';return 1; }
    return 0;
}
