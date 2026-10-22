#pragma once
// Generic mono PCM output. App-owned samples; no files, codecs or providers.
#include "device_model.hpp"
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <string>
#include <ostream>
#include <utility>
#include <type_traits>
#include <vector>
#include <memory>

namespace preview {
inline bool supportsSpeakerPcm(const DeviceProfile& d) {
    const auto* profile=hardwareProfile(d.id);
    return d.capabilities.tone_output && profile && std::string_view(profile->audio_output)=="speaker";
}
struct SpeakerPacket {
    std::uint64_t generation = 0, sequence = 0;
    unsigned sample_rate = 16000, first_frame = 0, total_frames = 0;
    bool active = false;
    std::vector<std::int16_t> samples;
};
class SpeakerOutput {
public:
    // Copy one bounded clip (up to 30 seconds). A new play replaces the old clip.
    // Decode WAV/MP3/etc in app preparation or app code, never in the emulator UI.
    bool play(const DeviceProfile& d, const std::int16_t* samples, unsigned frames, unsigned rate) {
        if (!supportsSpeakerPcm(d) || !samples || !frames || rate < 8000 || rate > 48000 ||
            frames > rate * 30 || generation_ >= 9007199254740991ULL) return false;
        auto next = std::make_shared<const std::vector<std::int16_t>>(samples, samples + frames);
        samples_ = std::move(next); rate_ = rate;
        ++generation_; sequence_ = 0; cursor_ = 0; started_ = Clock::now(); return true;
    }
    void stop() {
        samples_.reset(); cursor_ = 0;
        if (generation_ < 9007199254740991ULL) ++generation_;
        sequence_ = 0;
    }
    struct Clip { std::uint64_t generation; unsigned rate; std::shared_ptr<const std::vector<std::int16_t>> samples; };
    Clip clip() const { return {generation_, rate_, samples_}; }
    bool playing() const { return samples_ && !samples_->empty() && elapsedFrames() < (samples_ ? samples_->size() : 0); }
    // Called by the runtime. Emit at most 250 ms, up to 250 ms ahead.
    // Wall-clock expiry prevents old sound replay after a hidden/muted host.
    SpeakerPacket read() {
        SpeakerPacket p{generation_, sequence_, rate_, cursor_, static_cast<unsigned>((samples_ ? samples_->size() : 0)), playing(), {}};
        if (!p.active) return p;
        unsigned now = elapsedFrames();
        if (cursor_ > now + rate_ / 4) return p;
        // Transport pauses drop expired frames, never queue seconds of stale audio.
        if (now > cursor_ + rate_ / 4) cursor_ = now;
        unsigned end = std::min(static_cast<unsigned>((samples_ ? samples_->size() : 0)), cursor_ + rate_ / 4);
        p.first_frame = cursor_; p.sequence = ++sequence_;
        p.samples.assign(samples_->begin() + cursor_, samples_->begin() + end);
        cursor_ = end; return p;
    }
private:
    using Clock = std::chrono::steady_clock;
    unsigned elapsedFrames() const {
        return static_cast<unsigned>(std::min<double>((samples_ ? samples_->size() : 0),
            std::chrono::duration<double>(Clock::now() - started_).count() * rate_));
    }
    Clock::time_point started_ = Clock::now();
    std::uint64_t generation_ = 0, sequence_ = 0;
    unsigned rate_ = 16000, cursor_ = 0;
    std::shared_ptr<const std::vector<std::int16_t>> samples_;
};
template<class App, class = void> struct HasSpeakerOutput : std::false_type {};
template<class App> struct HasSpeakerOutput<App, std::void_t<decltype(std::declval<App&>().speakerOutput())>>
    : std::is_same<decltype(std::declval<App&>().speakerOutput()), SpeakerOutput&> {};
inline std::string speakerBase64(const std::vector<std::int16_t>& samples) {
    static constexpr char abc[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string bytes; bytes.reserve(samples.size()*2);
    for(auto s:samples) { auto u=static_cast<std::uint16_t>(s); bytes+=static_cast<char>(u&255); bytes+=static_cast<char>(u>>8); }
    std::string out; out.reserve((bytes.size()+2)/3*4);
    for(std::size_t i=0;i<bytes.size();i+=3) {
        auto n=static_cast<unsigned char>(bytes[i])<<16;
        if(i+1<bytes.size()) n|=static_cast<unsigned char>(bytes[i+1])<<8;
        if(i+2<bytes.size()) n|=static_cast<unsigned char>(bytes[i+2]);
        out+=abc[(n>>18)&63]; out+=abc[(n>>12)&63];
        out+=i+1<bytes.size()?abc[(n>>6)&63]:'='; out+=i+2<bytes.size()?abc[n&63]:'=';
    }
    return out;
}
template<class App> void writeSpeakerState(std::ostream& out, App& app, const DeviceProfile& d) {
    if constexpr(HasSpeakerOutput<App>::value) {
        if(supportsSpeakerPcm(d)) {
            const auto p=app.speakerOutput().read();
            out<<",\"speaker_output_adapter\":1,\"speaker_output\":{\"generation\":"<<p.generation
               <<",\"sequence\":"<<p.sequence<<",\"sample_rate\":"<<p.sample_rate<<",\"channels\":1"
               <<",\"first_frame\":"<<p.first_frame<<",\"total_frames\":"<<p.total_frames
               <<",\"active\":"<<(p.active?"true":"false")<<",\"pcm_s16le\":\""<<speakerBase64(p.samples)<<"\"}";
            return;
        }
    }
    out<<",\"speaker_output\":null";
}
} // namespace preview
