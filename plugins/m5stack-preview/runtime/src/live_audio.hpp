#pragma once
// Portable, borrowed microphone input. No device access, file I/O or provider.
#include "device_model.hpp"
#include "app_assets.hpp"
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <optional>
#include <type_traits>
#include <utility>
#include <vector>

namespace preview {
constexpr std::uint32_t AUDIO_INPUT_RATE = 16000;
constexpr std::uint32_t AUDIO_INPUT_CHUNK_FRAMES = 1600;
constexpr std::uint32_t AUDIO_INPUT_MAX_FRAMES = AUDIO_INPUT_RATE * 300;

inline bool supportsAudioInput(const DeviceProfile& device) {
    const auto* profile=hardwareProfile(device.id);
    return device.capabilities.microphone_input && profile && profile->microphone;
}

struct AudioBlockView {
    // Valid only for this callback; copy into bounded app storage if needed.
    const std::int16_t* samples = nullptr;
    std::uint32_t frames = 0;
    std::uint32_t sample_rate = AUDIO_INPUT_RATE;
    unsigned channels = 1;
    std::uint32_t sequence = 0, first_frame = 0;
    const std::string& source; // browser | fixture | device; device is supplied only by the firmware adapter
};

// Optional app-owned evidence. This counter describes samples processed by the
// app, rather than the transport offset. It is never inferred from browser RMS.
struct AudioInputStats {
    std::uint64_t received_frames = 0;
    double level = 0;
    bool active = false;
};

template<class App, class = void> struct HasAudioInputStats : std::false_type {};
template<class App> struct HasAudioInputStats<App, std::void_t<
    decltype(std::declval<const App&>().audioInputStats())>>
    : std::is_same<decltype(std::declval<const App&>().audioInputStats()), AudioInputStats> {};
template<class App> std::optional<AudioInputStats> appAudioStats(const App& app) {
    if constexpr (HasAudioInputStats<App>::value) {
        const auto stats = app.audioInputStats();
        if (stats.received_frames <= AUDIO_INPUT_MAX_FRAMES && std::isfinite(stats.level) &&
            stats.level >= 0 && stats.level <= 1) return stats;
    }
    return std::nullopt;
}

template<class App, class = void> struct HasAudioInputAdapter : std::false_type {};
template<class App> struct HasAudioInputAdapter<App, std::void_t<
    decltype(App::audio_input_adapter),
    decltype(std::declval<const App&>().audioInputRequested()),
    decltype(std::declval<App&>().onMicrophoneBlock(std::declval<const AudioBlockView&>())),
    decltype(std::declval<App&>().onMicrophoneState(bool{}))>>
    : std::bool_constant<App::audio_input_adapter == 1 &&
        std::is_same_v<decltype(std::declval<const App&>().audioInputRequested()), bool> &&
        std::is_same_v<decltype(std::declval<App&>().onMicrophoneBlock(std::declval<const AudioBlockView&>())), bool> &&
        std::is_same_v<decltype(std::declval<App&>().onMicrophoneState(bool{})), void>> {};

template<class App> bool appAudioRequested(const App& app, const DeviceProfile& device) {
    if constexpr (HasAudioInputAdapter<App>::value) return supportsAudioInput(device) && app.audioInputRequested();
    return false;
}
template<class App> void appAudioState(App& app, bool active) {
    if constexpr (HasAudioInputAdapter<App>::value) app.onMicrophoneState(active);
}
template<class App> bool appAudioBlock(App& app, const AudioBlockView& block) {
    if constexpr (HasAudioInputAdapter<App>::value) return app.onMicrophoneBlock(block);
    return false;
}

// Runtime stream admission/order state, separate from application intent.
// The supervisor binds this worker lifetime to its opaque session identity.
class AudioInputSession {
public:
    bool active() const { return active_; }
    const std::string& id() const { return id_; }
    const std::string& source() const { return source_; }
    std::int64_t sequence() const { return sequence_; }
    std::uint32_t nextFrame() const { return next_frame_; }

    template<class App> void cancel(App& app) {
        if (!active_) return;
        active_ = false;
        appAudioState(app, false);
    }
    template<class App> void reconcile(App& app, const DeviceProfile& device) {
        if (active_ && !appAudioRequested(app, device)) cancel(app);
    }
    template<class App> bool start(App& app, const DeviceProfile& device,
                                  const std::string& id, const std::string& source) {
        reconcile(app, device);
        if (active_ || !appAudioRequested(app, device) || !validAssetId(id) ||
            (source != "browser" && source != "fixture") || history_.size() >= 64 ||
            std::find(history_.begin(), history_.end(), id) != history_.end()) return false;
        history_.push_back(id);
        id_ = id; source_ = source; sequence_ = -1; next_frame_ = 0; final_partial_ = false;
        active_ = true; appAudioState(app, true);
        reconcile(app, device);
        return active_;
    }
    template<class App> bool chunk(App& app, const DeviceProfile& device,
                                  const std::string& id, std::uint32_t sequence,
                                  std::uint32_t first_frame, const std::int16_t* samples,
                                  std::uint32_t frames) {
        reconcile(app, device);
        if (!active_ || id != id_ || final_partial_ || !samples || !frames ||
            frames > AUDIO_INPUT_CHUNK_FRAMES || sequence != static_cast<std::uint64_t>(sequence_ + 1) ||
            first_frame != next_frame_ || frames > AUDIO_INPUT_MAX_FRAMES - next_frame_) return false;
        const AudioBlockView block{samples, frames, AUDIO_INPUT_RATE, 1, sequence, first_frame, source_};
        if (!appAudioBlock(app, block)) { cancel(app); return false; }
        sequence_ = sequence; next_frame_ += frames; final_partial_ = frames < AUDIO_INPUT_CHUNK_FRAMES;
        reconcile(app, device);
        if (next_frame_ == AUDIO_INPUT_MAX_FRAMES) cancel(app);
        return true;
    }
    template<class App> bool stop(App& app, const std::string& id) {
        if (id_.empty() || id != id_) return false;
        cancel(app); return true; // Exact repeated stop is idempotent.
    }
private:
    bool active_ = false, final_partial_ = false;
    std::string id_, source_;
    std::int64_t sequence_ = -1;
    std::uint32_t next_frame_ = 0;
    std::vector<std::string> history_; // Bounded, never reuse an ID in this worker.
};
} // namespace preview
