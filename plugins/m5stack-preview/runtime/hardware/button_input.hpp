#pragma once
#include <algorithm>
#include <cstdint>
#include <optional>
#include "src/device_model.hpp"

namespace preview {
// One instance per physical button: simultaneous presses keep separate clocks.
class HardwareButtonGesture {
    bool pressed_ = false;
    std::uint32_t started_ = 0;
public:
    std::optional<InputEvent> update(bool down, bool up, std::uint32_t now, bool secondary = false) {
        if (down) { pressed_ = true; started_ = now; }
        if (!up || !pressed_) return std::nullopt;
        pressed_ = false;
        const auto duration = std::min<std::uint32_t>(60000, now - started_);
        InputEvent event{secondary
            ? (duration >= 1000 ? InputKind::SecondaryHold : InputKind::SecondaryClick)
            : (duration >= 1000 ? InputKind::HoldReset : InputKind::PrimaryClick)};
        event.duration_ms = duration;
        return event;
    }
};
}
