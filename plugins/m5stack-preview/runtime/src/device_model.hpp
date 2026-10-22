#pragma once
// Portable application/device contract. No device drivers or runtime services.
#include "device_profiles.generated.hpp"
#include <cstdint>
#include <string>
#include <type_traits>

namespace preview {

// Physical capabilities are supplied by the host after choosing an exact board.
// Synthetic input is labeled separately and does not claim this hardware exists.
struct DeviceCapabilities {
    bool primary_button = false;
    bool touch_input = false;
    bool motion_input = false;
    bool microphone_input = false;
    bool tone_output = false;
};

struct DeviceProfile {
    std::string id;
    unsigned width = 128;
    unsigned height = 128;
    DeviceCapabilities capabilities;
};

// The SE controller extends 40 pixels below its unchanged 320x240 LCD.
// App code opts in separately so rebuilding an older authored app cannot
// silently advertise a coordinate range that its touch handler rejects.
inline unsigned touchSurfaceHeight(const DeviceProfile& device) {
    const auto* profile=hardwareProfile(device.id);
    return profile && profile->width==device.width && profile->height==device.height ? profile->touch_height : device.height;
}
template<class T,class=void> struct HasTouchStripAdapter : std::false_type {};
template<class T> struct HasTouchStripAdapter<T,std::void_t<decltype(T::touch_strip_adapter)>>
    : std::bool_constant<T::touch_strip_adapter==1> {};

template<class T,class=void> struct HasSecondaryButtonAdapter : std::false_type {};
template<class T> struct HasSecondaryButtonAdapter<T,std::void_t<decltype(T::secondary_button_adapter)>>
    : std::bool_constant<T::secondary_button_adapter==1> {};

enum class InputSource { Synthetic, Physical };
enum class InputKind {
    PrimaryClick,
    Shake,
    HoldReset,
    Tilt,
    MicrophoneAmplitude,
    NextPage,
    PreviousPage,
    RequestTone,
    TouchTap,
    TextInput,
    RecordingReady,
    RecordingCleared,
    ImageReady,
    ImageCleared,
    TouchSwipe,
    RecordingStarted,
    RecordingStartRequested,
    RecordingStopped,
    PowerClick,
    PowerHold,
    SecondaryClick,
    SecondaryHold
};

struct InputEvent {
    InputKind kind = InputKind::PrimaryClick;
    // Tilt: degrees [-60,60]. MicrophoneAmplitude: normalized envelope [0,1].
    // Other events do not consume value. Gesture recognition belongs to adapters.
    double value = 0;
    InputSource source = InputSource::Synthetic;
    // Completed logical touch: LCD coordinates, plus y240..279 on opted-in SE apps.
    int x = -1, y = -1;
    unsigned duration_ms = 0;
    std::string text;
    std::string asset_id;
    int end_x = -1, end_y = -1;
    std::string draft_id, request_id;
    std::uint64_t revision = 0;
};

enum class OutputKind { ToneRequested };
struct OutputEvent {
    OutputKind kind = OutputKind::ToneRequested;
    std::uint64_t id = 0;
    unsigned frequency_hz = 660;
    unsigned duration_ms = 90;
    InputSource cause = InputSource::Synthetic;
};

// Application-declared output intent, distinct from RequestTone diagnostics.
// Adapters choose a buzzer/speaker renderer and remain muted until opted in.
struct AppSound {
    std::uint64_t id = 0;
    std::string cue;
    unsigned frequency_hz = 0;
    unsigned duration_ms = 0;
};

inline bool supportsInput(const DeviceProfile& device, const InputEvent& event) {
    if (event.kind == InputKind::SecondaryClick || event.kind == InputKind::SecondaryHold) {
        const auto* profile=hardwareProfile(device.id);
        return profile && profile->secondary_button && event.duration_ms<=60000;
    }
    // Semantic app inputs only, not power management or a timing simulation.
    if (event.kind == InputKind::PowerClick || event.kind == InputKind::PowerHold)
        return device.id == "cores3" || device.id == "cores3se";
    // Output capability is always enforced, even for synthetic requests.
    if (event.kind == InputKind::RequestTone) return device.capabilities.tone_output;
    if (event.kind == InputKind::TouchTap || event.kind == InputKind::TouchSwipe) return device.capabilities.touch_input;
    if (event.kind == InputKind::RecordingReady || event.kind == InputKind::RecordingCleared || event.kind == InputKind::RecordingStarted ||
        event.kind == InputKind::RecordingStartRequested || event.kind == InputKind::RecordingStopped)
        return device.capabilities.microphone_input;
    // An exact SE profile never invents an IMU, including synthetic events.
    if (device.id == "cores3se" && (event.kind == InputKind::Shake || event.kind == InputKind::Tilt)) return false;
    if (event.source == InputSource::Synthetic) return true;
    switch (event.kind) {
        case InputKind::PrimaryClick:
        case InputKind::HoldReset:
            return device.capabilities.primary_button || device.capabilities.touch_input;
        case InputKind::Shake:
        case InputKind::Tilt:
            return device.capabilities.motion_input;
        case InputKind::MicrophoneAmplitude:
            return device.capabilities.microphone_input;
        case InputKind::NextPage:
        case InputKind::PreviousPage:
            return true;
        case InputKind::RequestTone:
            return device.capabilities.tone_output;
        case InputKind::TouchTap:
        case InputKind::TouchSwipe:
            return device.capabilities.touch_input;
        case InputKind::RecordingReady:
        case InputKind::RecordingCleared:
        case InputKind::RecordingStarted:
        case InputKind::RecordingStartRequested:
        case InputKind::RecordingStopped:
            return device.capabilities.microphone_input;
        case InputKind::TextInput:
        case InputKind::ImageReady:
        case InputKind::ImageCleared:
            return true;
        case InputKind::SecondaryClick:
        case InputKind::SecondaryHold:
            return false; // Handled above with the exact registry.
        case InputKind::PowerClick:
        case InputKind::PowerHold:
            return device.id == "cores3" || device.id == "cores3se";
    }
    return false;
}

} // namespace preview
