#pragma once

#include "ShakeDetector.h"
#include <cstdint>

namespace preview {

// A bounded sample fixture for the copied physical project's pure detector.
// This supplies acceleration samples; it does not emulate an IMU or wait for
// wall-clock time. Keep one adapter per preview session so latch, gravity, and
// unsigned virtual time persist between requested gestures.
class SyntheticMotionAdapter {
public:
    explicit SyntheticMotionAdapter(std::uint32_t initial_time_ms = 0)
        : now_ms_(initial_time_ms) {}

    bool shake() {
        unsigned events = 0;
        // 50 Hz: 90 quiet samples, then three alternating six-sample lobes.
        // The quiet lead-in allows the existing detector to warm up/rearm.
        hold(1800, 0.0f, events);
        hold(120, 0.55f, events);
        hold(120, -0.55f, events);
        hold(120, 0.55f, events);
        return events == 1;
    }

private:
    void hold(std::uint32_t duration_ms, float ax, unsigned& events) {
        for (std::uint32_t elapsed = 0; elapsed < duration_ms; elapsed += 20) {
            if (detector_.update(ax, 0.0f, 1.0f, now_ms_)) ++events;
            now_ms_ += 20;
        }
    }

    hello_counter::ShakeDetector detector_;
    std::uint32_t now_ms_;
};

} // namespace preview
