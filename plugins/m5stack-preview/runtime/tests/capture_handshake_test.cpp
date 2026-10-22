#include "native_app_test_support.hpp"

struct LegacyCaptureApp {};
struct PartialCaptureApp { const std::optional<CaptureIntent>& captureIntent() const; };
static_assert(!HasCaptureAdapter<LegacyCaptureApp>::value,"legacy app opted into capture handshake");
static_assert(!HasCaptureAdapter<PartialCaptureApp>::value,"partial app opted into capture handshake");
static_assert(HasCaptureAdapter<UserApp>::value,"starter handshake not detected");

static DeviceProfile se() { return {"cores3se",320,240,{false,true,false,true,true}}; }
static RecordingInfo clip(const std::string& id,const std::string& source="fixture") {
    return {id,"audio/wav",1000,32044,std::string(64,'a'),source};
}
int main() {
    try {
        LegacyCaptureApp legacy;
        check(appCaptureIntent(legacy)==nullptr && !appRecordingStopped(legacy,"id","fixture") &&
            !appClearRecording(legacy,"id","fixture"),"legacy trait wrapper did not fail closed");
        UserApp app(se());
        check(!app.recordingStarted("clip_a","fixture"),"unsolicited Started accepted");
        InputEvent request{InputKind::RecordingStartRequested};request.asset_id="clip_a";request.text="fixture";
        check(app.apply(request),"explicit toolbar request rejected");
        const auto sequence=app.captureIntent()->sequence;
        for(unsigned i=0;i<10;++i) {
            check(app.captureIntent()->action=="start" && !app.recordingCapture() && !app.recording(),"reading passive intent began recording");
        }
        check(app.setCaptureIntent("start","clip_a","fixture") && app.captureIntent()->sequence==sequence,"pending Start retry changed identity");
        check(!app.recordingStarted("clip_a","browser") && !app.recordingStarted("other","fixture"),"mismatched Started accepted");
        // Exercise references into an optional that is consumed by the method.
        check(app.recordingStarted(app.captureIntent()->id,app.captureIntent()->source),"matching Started rejected");
        check(!app.captureIntent() && !app.recordingCapture()->stopped,"Started did not consume intent");
        const auto started_revision=app.snapshot().revision;
        check(app.recordingStarted("clip_a","fixture") && app.snapshot().revision==started_revision,"duplicate Started was not idempotent");
        check(!app.setRecording(clip("clip_a")),"Ready accepted before physical Stop acknowledgement");
        check(!app.setCaptureIntent("start","other","fixture"),"overlapping Start accepted");
        check(app.setCaptureIntent("stop","clip_a","fixture"),"device Stop intent failed");
        const auto stop_sequence=app.captureIntent()->sequence;
        check(stop_sequence>sequence && !app.recordingCapture()->stopped,"Stop intent claimed browser was already stopped");
        check(app.setCaptureIntent("stop","clip_a","fixture") && app.captureIntent()->sequence==stop_sequence,"Stop retry created a new intent");
        check(!app.recordingStopped("clip_a","browser"),"wrong-source Stopped accepted");
        check(app.recordingStopped("clip_a","fixture") && !app.captureIntent() && app.recordingCapture()->stopped,"Stopped did not acknowledge exact clip");
        const auto stopped_revision=app.snapshot().revision;
        check(app.recordingStopped("clip_a","fixture") && app.snapshot().revision==stopped_revision,"Stopped retry changed state");
        check(app.setRecording(clip("clip_a")) && !app.recordingCapture(),"Ready failed after Stopped");
        check(app.recordingStopped("clip_a","fixture"),"late repeated Stopped after Ready was not idempotent");
        check(!app.setRecording(clip("clip_a")) && !app.setCaptureIntent("start","clip_a","fixture"),"completed clip replayed");
        check(app.clearRecording(app.recording()->id,app.recording()->source),"scoped cleanup with owned-field references failed");
        const auto clear_sequence=app.captureIntent()->sequence;
        check(app.clearRecording("clip_a","fixture") && app.captureIntent()->sequence==clear_sequence,"scoped cleanup retry changed state");
        check(app.setCaptureIntent("start","clip_b","browser") && app.recordingStarted("clip_b","browser"),"second clip failed");
        check(!app.clearRecording("clip_a","fixture") && app.recordingCapture()->id=="clip_b","stale cleanup cancelled replacement");
        // Toolbar Stop has no native stop intent; its actual stopped receipt is
        // enough to notify the app, which can advance its own Stop transition.
        check(app.recordingStopped("clip_b","browser") && app.setRecording(clip("clip_b","browser")),"toolbar Stop handshake failed");
        check(app.setCaptureIntent("start","permission_wait","browser") && app.clearRecording("permission_wait","browser"),"pending permission cancellation failed");
        check(!app.recordingStarted("permission_wait","browser") && !app.setCaptureIntent("start","permission_wait","browser"),"late permission revived cancelled capture");
        check(app.setCaptureIntent("start","reset_wait","browser"),"reset setup failed");
        app.apply({InputKind::HoldReset});
        check(!app.captureIntent() && !app.recordingCapture() && !app.recordingStarted("reset_wait","browser") &&
            !app.setCaptureIntent("start","reset_wait","browser"),"reset lost identity replay guard");
        UserApp bounded(se());
        for(unsigned i=1;i<=64;++i) {
            const auto id="capture_"+std::to_string(i);
            check(bounded.setCaptureIntent("start",id,"fixture") && bounded.clearRecording(id,"fixture"),"capture history exhausted early");
        }
        bounded.apply({InputKind::HoldReset});
        check(!bounded.setCaptureIntent("start","capture_65","fixture") && !bounded.setCaptureIntent("start","capture_1","browser"),"bounded history evicted or reused an ID");
        UserApp atom({"atoms3r",128,128,{true,false,true,false,false}});
        check(!atom.apply(request) && !atom.setCaptureIntent("start","clip","fixture") && !atom.recordingStopped("clip","fixture"),"Atom invented a capture capability");
        std::cout<<"PASS capture handshake: passive state inert, exact clip/source, device/browser Stop ordering, idempotent receipts, scoped cancellation, reset/replay guards,64-ID bound, legacy/partial traits and Atom capability\n";
    } catch(const std::exception& error) { std::cerr<<"FAIL: "<<error.what()<<'\n';return 1; }
    return 0;
}
