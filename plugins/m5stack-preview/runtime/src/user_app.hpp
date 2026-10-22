#pragma once
// Editable app model. Keep this interface and replace the starter behavior.
// The host supplies semantic inputs; this file needs no LVGL, browser, or I/O.
#include "device_model.hpp"
#include "app_assets.hpp"
#include "live_audio.hpp"
#include "speaker_output.hpp"
#include <cmath>
#include <limits>
#include <optional>
#include <stdexcept>
#include <utility>

namespace preview {

constexpr const char* USER_APP_TITLE = "Hello, world!";

struct UserSnapshot {
    std::string title = USER_APP_TITLE;
    std::uint64_t count = 0;
    bool alternate = false;
    double tilt_degrees = 0;
    InputSource tilt_source = InputSource::Synthetic;
    double microphone_amplitude = 0; // Normalized level only, never PCM or speech.
    std::uint64_t microphone_frames = 0;
    bool microphone_active = false;
    std::uint64_t revision = 0;
};

class UserApp {
public:
    static constexpr unsigned touch_strip_adapter = 1;
    static constexpr unsigned secondary_button_adapter = 1;
    static constexpr unsigned audio_input_adapter = 1;
    explicit UserApp(DeviceProfile device) : device_(std::move(device)) {
        if (device_.id.empty() || device_.width < 128 || device_.height < 128 ||
            device_.width > 1024 || device_.height > 1024)
            throw std::invalid_argument("A supported display profile is required");
        microphone_requested_ = supportsAudioInput(device_);
    }

    const DeviceProfile& device() const { return device_; }
    const UserSnapshot& snapshot() const { return state_; }
    SpeakerOutput& speakerOutput() { return speaker_output_; }
    bool playPcm(const std::int16_t* samples, unsigned frames, unsigned rate) {
        const bool ok = speaker_output_.play(device_, samples, frames, rate);
        if (ok) app_sound_.reset();
        return ok;
    }
    void stopSpeaker() { speaker_output_.stop(); }
    const std::optional<AppSound>& appSound() const { return app_sound_; }
    const std::optional<RecordingInfo>& recording() const { return recording_; }
    const std::optional<RecordingCapture>& recordingCapture() const { return recording_capture_; }
    const std::optional<CaptureIntent>& captureIntent() const { return capture_intent_; }
    const std::optional<ImageFrame>& image() const { return image_; }
    const std::optional<ResultContext>& expectedResult() const { return expected_result_; }
    bool audioInputRequested() const { return microphone_requested_; }
    AudioInputStats audioInputStats() const {
        return {state_.microphone_frames, state_.microphone_amplitude, state_.microphone_active};
    }
    bool requestMicrophone(bool requested) {
        if (requested && !supportsAudioInput(device_)) return false;
        microphone_requested_ = requested; return true;
    }
    void onMicrophoneState(bool active) {
        state_.microphone_active = active;
        state_.microphone_amplitude = 0;
        if (active) state_.microphone_frames = 0;
        ++state_.revision;
    }
    bool onMicrophoneBlock(const AudioBlockView& block) {
        if (!microphone_requested_ || !supportsAudioInput(device_) || !state_.microphone_active ||
            !block.samples || !block.frames || block.frames > AUDIO_INPUT_CHUNK_FRAMES ||
            block.sample_rate != AUDIO_INPUT_RATE || block.channels != 1 ||
            (block.source != "browser" && block.source != "fixture" && block.source != "device")) return false;
        double squares = 0;
        for (std::uint32_t i = 0; i < block.frames; ++i) {
            const double value = static_cast<double>(block.samples[i]) / 32768.0;
            squares += value * value;
        }
        state_.microphone_amplitude = std::sqrt(squares / block.frames);
        state_.microphone_frames += block.frames;
        ++state_.revision;
        return true;
    }

    // At most64 distinct expectations per worker lifetime. Cancel/reset retain
    // history; reload starts a new lifetime. History never silently evicts old
    // contexts, so a consumed/cancelled request cannot be re-armed accidentally.
    bool expectResult(ResultContext context) {
        if (!validResultContext(context)) return false;
        if (expected_result_ && sameResultContext(*expected_result_, context)) return true;
        for (const auto& prior : result_history_) if (sameResultContext(prior, context)) return false;
        if (result_history_.size() >= 64) return false;
        result_history_.push_back(context);
        expected_result_ = std::move(context);
        return true;
    }
    void clearExpectedResult() { expected_result_.reset(); }

    bool setText(const std::string& text, std::optional<ResultContext> context = std::nullopt) {
        if (!validAppText(text) || !acceptsResult(context)) return false;
        InputEvent event{InputKind::TextInput};
        event.text = text;
        consumeResult(context, event);
        apply(event);
        return true;
    }

    // Author intent only while handling an explicit action. A host must never
    // start recording from a poll, render, reconnect, or replay of this state.
    // Capture IDs cannot be reused within this worker lifetime, including after
    // reset/cancellation. The 64-ID bound requires a reload when exhausted.
    bool setCaptureIntent(std::string action,std::string id,std::string source) {
        if (!device_.capabilities.microphone_input || !validAssetId(id) || !validCaptureSource(source) ||
            (action != "start" && action != "stop" && action != "cancel")) return false;
        if (capture_intent_ && capture_intent_->id == id && capture_intent_->source == source && capture_intent_->action == action) return true;
        if (capture_sequence_ >= 9007199254740991ULL) return false;
        if (action == "start") {
            if (recording_capture_ || (capture_intent_ && capture_intent_->action == "start") || capture_history_.size() >= 64) return false;
            for (const auto& prior : capture_history_) if (prior == id) return false;
            capture_history_.push_back(id);
            recording_.reset();
        } else if (action == "stop") {
            if (!matchingCapture(id,source)) return false;
            if (recording_capture_->stopped) return true;
        } else {
            if (!matchesRecording(id,source)) return false;
            recording_.reset();
            recording_capture_.reset();
        }
        capture_intent_ = CaptureIntent{id,source,action,++capture_sequence_};
        return true;
    }

    // An acknowledgement of host capture state, never a request to open a mic.
    // The source is carried as event.text; capture bytes remain outside C++.
    bool recordingStarted(std::string id, std::string source = "browser") {
        if (!device_.capabilities.microphone_input || !validAssetId(id) || !validCaptureSource(source)) return false;
        if (matchingCapture(id,source)) return !recording_capture_->stopped;
        if (!capture_intent_ || capture_intent_->action != "start" || capture_intent_->id != id || capture_intent_->source != source) return false;
        recording_.reset();
        recording_capture_ = RecordingCapture{id, source, false};
        capture_intent_.reset();
        InputEvent event{InputKind::RecordingStarted};
        event.asset_id = id;
        event.text = source;
        apply(event);
        return true;
    }

    bool recordingStopped(std::string id,std::string source) {
        if (!device_.capabilities.microphone_input) return false;
        if (recording_ && recording_->id == id && recording_->source == source) return true;
        if (!matchingCapture(id,source)) return false;
        if (recording_capture_->stopped) return true;
        recording_capture_->stopped = true;
        if (capture_intent_ && capture_intent_->id == id && capture_intent_->source == source && capture_intent_->action == "stop") capture_intent_.reset();
        InputEvent event{InputKind::RecordingStopped};
        event.asset_id = id;
        event.text = source;
        apply(event);
        return true;
    }

    // The host owns ephemeral audio bytes. The app receives metadata only.
    // A valid setter stores first, then notifies apply(); the return value means
    // asset acceptance, regardless of whether an edited app handles the event.
    bool setRecording(RecordingInfo info) {
        if (!device_.capabilities.microphone_input || !validRecording(info) || !recording_capture_ ||
            info.id != recording_capture_->id || info.source != recording_capture_->source || !recording_capture_->stopped) return false;
        recording_ = std::move(info);
        recording_capture_.reset(); // Consume before notifying application code.
        InputEvent event{InputKind::RecordingReady};
        event.asset_id = recording_->id;
        event.duration_ms = recording_->duration_ms;
        apply(event);
        return true;
    }
    bool clearRecording() {
        if (!device_.capabilities.microphone_input) return false;
        if (recording_capture_) return clearRecording(recording_capture_->id,recording_capture_->source);
        if (recording_) return clearRecording(recording_->id,recording_->source);
        if (capture_intent_) return clearRecording(capture_intent_->id,capture_intent_->source);
        InputEvent event{InputKind::RecordingCleared};
        apply(event);
        return true;
    }
    bool clearRecording(std::string id,std::string source) {
        if (!device_.capabilities.microphone_input || !validAssetId(id) || !validCaptureSource(source)) return false;
        if (capture_intent_ && capture_intent_->action == "cancel" && capture_intent_->id == id && capture_intent_->source == source) return true;
        if (!setCaptureIntent("cancel",id,source)) return false;
        InputEvent event{InputKind::RecordingCleared};
        event.asset_id = id;
        event.text = source;
        recording_.reset();
        recording_capture_.reset();
        apply(event);
        return true;
    }
    bool setImage(ImageFrame frame, std::optional<ResultContext> context = std::nullopt) {
        if (!validImage(frame) || frame.width > device_.width || frame.height > device_.height || !acceptsResult(context)) return false;
        image_ = std::move(frame);
        InputEvent event{InputKind::ImageReady};
        event.asset_id = image_->id;
        consumeResult(context, event);
        apply(event);
        return true;
    }
    bool clearImage() {
        InputEvent event{InputKind::ImageCleared};
        if (image_) event.asset_id = image_->id;
        image_.reset();
        apply(event);
        return true;
    }

    // Author an optional tone from apply(). Playback requires a separate user
    // gesture in the host, remains muted by default, and is not device audio.
    bool requestSound(const std::string& cue, unsigned frequency_hz, unsigned duration_ms) {
        if (!device_.capabilities.tone_output || cue.empty() || cue.size()>64 ||
            frequency_hz<40 || frequency_hz>4000 || duration_ms<1 || duration_ms>1000 ||
            sound_sequence_>=9007199254740991ULL) return false;
        for (const unsigned char c : cue)
            if (!((c>='A' && c<='Z') || (c>='a' && c<='z') ||
                  (c>='0' && c<='9') || c=='_' || c=='-')) return false;
        speaker_output_.stop();
        app_sound_=AppSound{++sound_sequence_,cue,frequency_hz,duration_ms};
        return true;
    }

    // Return false for an unsupported/invalid event without changing state.
    // Short click/tap, hold and shake recognition belong to the runtime.
    bool apply(const InputEvent& event) {
        if (!supportsInput(device_, event)) return false;
        switch (event.kind) {
            case InputKind::SecondaryClick:
                state_.alternate = !state_.alternate;
                break;
            case InputKind::SecondaryHold:
                return apply({InputKind::HoldReset});
            case InputKind::PowerClick:
            case InputKind::PowerHold:
                break; // App-defined POWER semantics; no automatic reset or shutdown.
            case InputKind::RecordingStartRequested:
                if (!setCaptureIntent("start",event.asset_id,event.text)) return false;
                break; // Apps may choose their own ID instead of the proposed ID.
            case InputKind::TouchSwipe:
                if (event.x < 0 || event.y < 0 || event.end_x < 0 || event.end_y < 0 ||
                    static_cast<unsigned>(event.x) >= device_.width || static_cast<unsigned>(event.end_x) >= device_.width ||
                    static_cast<unsigned>(event.y) >= touchSurfaceHeight(device_) || static_cast<unsigned>(event.end_y) >= touchSurfaceHeight(device_) ||
                    event.duration_ms > 60000) return false;
                break; // Editable apps choose swipe navigation; the counter does not increment.
            case InputKind::TouchTap:
                if (event.x < 0 || event.y < 0 || static_cast<unsigned>(event.x) >= device_.width ||
                    static_cast<unsigned>(event.y) >= touchSurfaceHeight(device_) || event.duration_ms > 60000) return false;
                // Replace this branch to use spatial confirmation controls.
                // One completed touch is one event, including a held touch.
                if (event.duration_ms >= 1000) return apply({InputKind::HoldReset});
                [[fallthrough]];
            case InputKind::PrimaryClick:
                // Tilt and shake never change the increment. Refuse only at
                // the integer limit, so the counter cannot wrap on overflow.
                if (state_.count == std::numeric_limits<std::uint64_t>::max()) return false;
                ++state_.count;
                if (device_.capabilities.tone_output) requestSound("hello_click",740,70);
                break;
            case InputKind::Shake:
                state_.alternate = !state_.alternate;
                break;
            case InputKind::HoldReset: {
                const auto revision = state_.revision;
                state_ = UserSnapshot{};
                state_.revision = revision;
                speaker_output_.stop();
                app_sound_.reset(); // IDs stay monotonic across resets.
                recording_.reset();
                image_.reset();
                recording_capture_.reset();
                capture_intent_.reset(); // History and sequence survive reset.
                clearExpectedResult();
                break;
            }
            case InputKind::Tilt:
                if (!std::isfinite(event.value) || event.value < -60 || event.value > 60) return false;
                state_.tilt_degrees = event.value;
                state_.tilt_source = event.source;
                break;
            case InputKind::MicrophoneAmplitude:
                // Synthetic input must not invent a microphone on AtomS3R.
                if (!device_.capabilities.microphone_input || !std::isfinite(event.value) ||
                    event.value<0 || event.value>1) return false;
                state_.microphone_amplitude=event.value;
                break;
            case InputKind::TextInput:
                if (!validAppText(event.text)) return false;
                break; // Editable apps consume the text; the counter does not retain it.
            case InputKind::RecordingReady:
            case InputKind::RecordingStarted:
            case InputKind::RecordingStopped:
            case InputKind::RecordingCleared:
            case InputKind::ImageReady:
            case InputKind::ImageCleared:
                break; // Assets are available through the accessors above.
            default:
                return false; // No automatic tones or content paging in this app.
        }
        ++state_.revision;
        return true;
    }

private:
    static bool validCaptureSource(const std::string& source) { return source == "browser" || source == "fixture"; }
    bool matchingCapture(const std::string& id,const std::string& source) const {
        return recording_capture_ && recording_capture_->id == id && recording_capture_->source == source;
    }
    bool matchesRecording(const std::string& id,const std::string& source) const {
        return matchingCapture(id,source) || (recording_ && recording_->id == id && recording_->source == source) ||
            (capture_intent_ && capture_intent_->id == id && capture_intent_->source == source && capture_intent_->action == "start");
    }
    bool acceptsResult(const std::optional<ResultContext>& context) const {
        if (!expected_result_) return !context;
        return context && validResultContext(*context) && sameResultContext(*expected_result_, *context);
    }
    void consumeResult(const std::optional<ResultContext>& context, InputEvent& event) {
        if (!context) return;
        event.draft_id = context->draft_id;
        event.request_id = context->request_id;
        event.revision = context->revision;
        expected_result_.reset(); // Consume before application code can issue the next request.
    }
    DeviceProfile device_;
    bool microphone_requested_ = false;
    SpeakerOutput speaker_output_;
    UserSnapshot state_;
    std::optional<AppSound> app_sound_;
    std::optional<RecordingInfo> recording_;
    std::optional<ImageFrame> image_;
    std::optional<RecordingCapture> recording_capture_;
    std::optional<CaptureIntent> capture_intent_;
    std::vector<std::string> capture_history_;
    std::uint64_t capture_sequence_ = 0;
    std::optional<ResultContext> expected_result_;
    std::vector<ResultContext> result_history_;
    std::uint64_t sound_sequence_=0;
};

} // namespace preview
