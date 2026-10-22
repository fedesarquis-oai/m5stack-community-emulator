#ifndef HELLO_COUNTER_SHAKE_DETECTOR_H
#define HELLO_COUNTER_SHAKE_DETECTOR_H

#include <cmath>
#include <cstdint>

namespace hello_counter {

// Portable detector: accelerometer samples are in g, time is uint32_t millis.
// A gesture is three alternating motion lobes, not an isolated bump or tilt.
class ShakeDetector {
 public:
  static constexpr float kMotionThresholdG = 0.28f;
  static constexpr float kQuietThresholdG = 0.12f;
  static constexpr uint32_t kGravityTimeConstantMs = 300;
  static constexpr uint32_t kWarmupMs = 250;
  static constexpr uint32_t kMaxSampleGapMs = 200;
  static constexpr uint32_t kMinLobeGapMs = 70;
  static constexpr uint32_t kGestureWindowMs = 700;
  static constexpr uint32_t kCooldownMs = 1000;
  static constexpr uint32_t kQuietRearmMs = 350;

  static bool validSample(float ax, float ay, float az) {
    return std::isfinite(ax) && std::isfinite(ay) && std::isfinite(az) &&
           std::fabs(ax) <= 32.0f && std::fabs(ay) <= 32.0f &&
           std::fabs(az) <= 32.0f;
  }

  // Bad data cannot complete a gesture or count as quiet time. Preserve an
  // existing latch: a broken stream must not silently arm another event.
  void invalidate() {
    initialized_ = false;
    lobes_ = 0;
    quiet_ = false;
    motionG_ = 0.0f;
  }

  float motionG() const { return motionG_; }
  bool latched() const { return latched_; }

  bool update(float ax, float ay, float az, uint32_t nowMs) {
    if (!validSample(ax, ay, az)) {
      invalidate();
      return false;
    }
    if (!initialized_ ||
        static_cast<uint32_t>(nowMs - lastSampleMs_) > kMaxSampleGapMs) {
      initialized_ = true;
      gx_ = ax;
      gy_ = ay;
      gz_ = az;
      seededMs_ = lastSampleMs_ = nowMs;
      motionG_ = 0.0f;
      lobes_ = 0;
      quiet_ = false;
      return false;
    }

    const uint32_t dt = static_cast<uint32_t>(nowMs - lastSampleMs_);
    if (dt == 0) return false;
    lastSampleMs_ = nowMs;
    const float alpha = static_cast<float>(dt) /
                        static_cast<float>(kGravityTimeConstantMs + dt);
    gx_ += alpha * (ax - gx_);
    gy_ += alpha * (ay - gy_);
    gz_ += alpha * (az - gz_);
    const float dx = ax - gx_;
    const float dy = ay - gy_;
    const float dz = az - gz_;
    motionG_ = std::sqrt(dx * dx + dy * dy + dz * dz);

    // Seed gravity without interpreting power-on/recovery orientation as input.
    if (static_cast<uint32_t>(nowMs - seededMs_) < kWarmupMs) return false;

    if (latched_) {
      if (motionG_ <= kQuietThresholdG) {
        if (!quiet_) {
          quiet_ = true;
          quietSinceMs_ = nowMs;
        }
        if (static_cast<uint32_t>(nowMs - lastEventMs_) >= kCooldownMs &&
            static_cast<uint32_t>(nowMs - quietSinceMs_) >= kQuietRearmMs) {
          latched_ = false;
          quiet_ = false;
          lobes_ = 0;
        }
      } else {
        quiet_ = false;
      }
      return false;
    }

    if (lobes_ != 0 &&
        static_cast<uint32_t>(nowMs - firstLobeMs_) > kGestureWindowMs) {
      lobes_ = 0;
    }
    if (motionG_ < kMotionThresholdG) return false;
    if (lobes_ == 0) {
      firstLobeMs_ = lastLobeMs_ = nowMs;
      directionX_ = dx / motionG_;
      directionY_ = dy / motionG_;
      directionZ_ = dz / motionG_;
      lobes_ = 1;
      return false;
    }

    const float alongPrevious = dx * directionX_ + dy * directionY_ +
                                dz * directionZ_;
    // More than 120 degrees from the preceding lobe, with separate timing.
    if (alongPrevious < -0.5f * motionG_ &&
        static_cast<uint32_t>(nowMs - lastLobeMs_) >= kMinLobeGapMs) {
      lastLobeMs_ = nowMs;
      directionX_ = dx / motionG_;
      directionY_ = dy / motionG_;
      directionZ_ = dz / motionG_;
      if (++lobes_ >= 3) {
        latched_ = true;
        quiet_ = false;
        lastEventMs_ = nowMs;
        lobes_ = 0;
        return true;
      }
    }
    return false;
  }

 private:
  bool initialized_ = false;
  bool latched_ = false;
  bool quiet_ = false;
  uint8_t lobes_ = 0;
  uint32_t seededMs_ = 0;
  uint32_t lastSampleMs_ = 0;
  uint32_t firstLobeMs_ = 0;
  uint32_t lastLobeMs_ = 0;
  uint32_t lastEventMs_ = 0;
  uint32_t quietSinceMs_ = 0;
  float gx_ = 0.0f, gy_ = 0.0f, gz_ = 0.0f;
  float directionX_ = 0.0f, directionY_ = 0.0f, directionZ_ = 0.0f;
  float motionG_ = 0.0f;
};

}  // namespace hello_counter

#endif
