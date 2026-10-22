#pragma once
// Generated from runtime/data/device-profiles.json. Run scripts/generate-device-profiles.mjs.
#include <string_view>
namespace preview {
struct HardwareProfile {
    const char* id; unsigned width, height; bool touch, motion, microphone;
    const char* audio_output; unsigned touch_height; bool secondary_button;
};
inline constexpr HardwareProfile HARDWARE_PROFILES[]={
    {"atoms3r", 128, 128, false, true, false, "none", 128, false},
    {"stickcplus2", 135, 240, false, true, true, "buzzer", 240, true},
    {"sticks3", 135, 240, false, true, true, "speaker", 240, true},
    {"cores3", 320, 240, true, true, true, "speaker", 240, false},
    {"cores3se", 320, 240, true, false, true, "speaker", 280, false},
};
inline const HardwareProfile* hardwareProfile(std::string_view id) {
    for(const auto& profile:HARDWARE_PROFILES)if(id==profile.id)return &profile;
    return nullptr;
}
} // namespace preview
