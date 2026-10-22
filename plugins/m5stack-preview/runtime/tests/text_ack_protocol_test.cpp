#include "native_app_test_support.hpp"

int main(int argc,char** argv) {
    try {
        if(argc!=3)throw std::runtime_error("usage: text_ack_protocol_test current-worker fixture-worker");
        {
            NativeWorker worker(argv[1],"cores3se",320,240);
            contains(worker.receive().header,"\"app_input_accepted\":null");
            contains(worker.command("text 66697874757265").header,"\"app_input_accepted\":true");
            contains(worker.command("state").header,"\"app_input_accepted\":null");
            contains(worker.command("touch 20 20 50").header,"\"app_input_accepted\":null");
            contains(worker.command("text 66697874757265").header,"\"app_input_accepted\":true");
            contains(worker.command("reset").header,"\"app_input_accepted\":null");
            check(worker.finish()==0,"valid acknowledgement worker did not close cleanly");
        }
        {
            NativeWorker worker(argv[2],"cores3se",320,240);worker.receive();
            worker.command("touch 20 20 50");
            const auto accepted=worker.command("text_result draft_fixture request_text 1 66697874757265");
            contains(accepted.header,"\"app_input_accepted\":true");
            contains(accepted.header,"\"expected_result\":{\"draft_id\":\"draft_fixture\",\"request_id\":\"request_image\",\"revision\":2}");
            contains(worker.command("state").header,"\"app_input_accepted\":null");
            worker.send("text_result draft_fixture request_text 1 66697874757265");
            check(worker.finish()==2,"rejected tagged result did not keep exit-2 behavior");
        }
        std::cout<<"PASS per-command native text acknowledgment: initial/nontext/state null, accepted text true, successor context retained, stale text rejected\n";
    } catch(const std::exception& error) {std::cerr<<"FAIL: "<<error.what()<<'\n';return 1;}
    return 0;
}
