#include "../src/ShakeDetector.h"

#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

using hello_counter::ShakeDetector;

namespace {
void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

struct Fixture {
  ShakeDetector detector;
  uint32_t now = 0;
  unsigned events = 0;

  void sample(float x = 0, float y = 0, float z = 1) {
    if (detector.update(x, y, z, now)) ++events;
    now += 20;
  }

  void hold(unsigned durationMs, float x = 0, float y = 0, float z = 1) {
    for (unsigned elapsed = 0; elapsed < durationMs; elapsed += 20) sample(x, y, z);
  }

  void ready() { hold(800); }

  // Three moderate acceleration lobes, representing a back-and-forth gesture.
  void gesture(float amplitude = 0.55f) {
    hold(120, amplitude);
    hold(120, -amplitude);
    hold(120, amplitude);
  }
};

void idleAndNoise() {
  Fixture f;
  f.ready();
  for (unsigned i = 0; i < 1000; ++i) {
    const float noise = (i % 2 == 0) ? 0.015f : -0.015f;
    f.sample(noise, -noise, 1.0f + noise);
  }
  require(f.events == 0, "resting sensor noise counted as a shake");
  require(!f.detector.latched(), "idle detector is latched");
  require(std::isfinite(f.detector.motionG()), "idle motion is not finite");
}

void slowTilt() {
  Fixture f;
  f.ready();
  constexpr float halfPi = 1.5707963267948966f;
  for (unsigned i = 0; i <= 500; ++i) {
    const float angle = halfPi * static_cast<float>(i) / 500.0f;
    f.sample(std::sin(angle), 0, std::cos(angle));
  }
  f.hold(1000, 1, 0, 0);
  require(f.events == 0, "slow orientation change counted as a shake");
}

void IsolatedMotion() {
  Fixture f;
  f.ready();
  f.sample(0.8f);
  f.hold(1000);
  require(f.events == 0, "one brief bump counted as a shake");
  f.hold(120, 0.55f);
  f.hold(120, -0.55f);
  f.hold(1000);
  require(f.events == 0, "only two motion lobes counted as a complete shake");
}

void moderateGesture() {
  Fixture f;
  f.ready();
  f.gesture();
  require(f.events == 1, "moderate back-and-forth gesture did not count once");
  require(f.detector.latched(), "gesture did not latch detector");
  require(f.detector.motionG() > 0.1f, "active motion was not observable");
}

void otherAxes() {
  for (unsigned axis = 1; axis <= 2; ++axis) {
    Fixture f;
    f.ready();
    for (const float direction : {1.0f, -1.0f, 1.0f}) {
      if (axis == 1) f.hold(120, 0, direction * 0.55f, 1);
      else f.hold(120, 0, 0, 1 + direction * 0.55f);
    }
    require(f.events == 1, "gesture depends on a single device orientation");
  }
}

void continuousMotion() {
  Fixture f;
  f.ready();
  for (unsigned i = 0; i < 100; ++i) f.hold(120, i % 2 ? -0.55f : 0.55f);
  require(f.events == 1, "continuous motion produced repeated shake counts");
  require(f.detector.latched(), "continuous motion unexpectedly rearmed");
}

void cooldownAndRearm() {
  Fixture f;
  f.ready();
  f.gesture();
  f.hold(500);
  f.gesture();
  require(f.events == 1, "gesture during cooldown was counted");
  f.hold(1800);
  require(!f.detector.latched(), "settled detector failed to rearm");
  f.gesture();
  require(f.events == 2, "new gesture after rest did not count");
  f.hold(1800);
  f.gesture();
  require(f.events == 3, "third separate gesture did not count");
}

void invalidData() {
  const float bad[] = {std::numeric_limits<float>::quiet_NaN(),
                       std::numeric_limits<float>::infinity(),
                       -std::numeric_limits<float>::infinity(), 33.0f, -33.0f};
  for (const float value : bad) {
    for (unsigned axis = 0; axis < 3; ++axis) {
      Fixture f;
      f.ready();
      f.hold(120, 0.55f);
      f.hold(120, -0.55f);
      f.sample(axis == 0 ? value : 0, axis == 1 ? value : 0,
               axis == 2 ? value : 1);
      f.hold(120, 0.55f);
      require(f.events == 0, "invalid sample bridged a partial gesture");
      require(std::isfinite(f.detector.motionG()), "invalid data poisoned motion value");
      f.ready();
      f.gesture();
      require(f.events == 1, "detector did not recover from invalid data");
    }
  }
}

void staleGap() {
  Fixture f;
  f.ready();
  f.hold(120, 0.55f);
  f.hold(120, -0.55f);
  f.now += 1000;
  f.hold(120, 0.55f);
  require(f.events == 0, "stale data gap completed an old gesture");
  f.ready();
  f.gesture();
  require(f.events == 1, "detector failed to recover after a sample gap");
}

void interruptionKeepsLatch() {
  Fixture f;
  f.ready();
  f.gesture();
  f.detector.invalidate();
  require(f.detector.latched(), "explicit invalidation removed the gesture latch");
  f.now += 3000;
  f.sample();
  require(f.detector.latched(), "sample gap rearmed without observed quiet");
  // Recovery must observe rest before it accepts another gesture.
  f.ready();
  require(!f.detector.latched(), "observed quiet did not release recovery latch");
  f.gesture();
  require(f.events == 2, "gesture after interruption recovery did not count");
}

void unsignedClockWrap() {
  Fixture f;
  f.now = std::numeric_limits<uint32_t>::max() - 1200;
  f.ready();
  f.gesture();
  require(f.events == 1, "gesture immediately before clock wrap failed");
  f.hold(500);
  f.gesture();
  require(f.events == 1, "clock wrap bypassed cooldown");
  f.hold(1800);
  f.gesture();
  require(f.events == 2, "clock wrap prevented later rearm");
}

void startupMotion() {
  Fixture f;
  f.gesture();
  require(f.events == 0, "startup motion was interpreted as a complete gesture");
  f.ready();
  f.gesture();
  require(f.events == 1, "detector did not become ready after startup");
}
}  // namespace

int main() {
  struct Case { const char* name; void (*run)(); };
  const Case cases[] = {
      {"idle and sensor noise", idleAndNoise},
      {"slow tilt", slowTilt},
      {"isolated bump and incomplete gesture", IsolatedMotion},
      {"moderate gesture", moderateGesture},
      {"orientation-independent gesture", otherAxes},
      {"continuous motion latches", continuousMotion},
      {"cooldown and repeated gestures", cooldownAndRearm},
      {"invalid data and recovery", invalidData},
      {"stale sample gap", staleGap},
      {"interruption retains latch", interruptionKeepsLatch},
      {"millis wrap", unsignedClockWrap},
      {"startup motion", startupMotion},
  };
  unsigned failures = 0;
  for (const auto& test : cases) {
    try {
      test.run();
      std::cout << "PASS: " << test.name << '\n';
    } catch (const std::exception& error) {
      ++failures;
      std::cerr << "FAIL: " << test.name << ": " << error.what() << '\n';
    }
  }
  std::cout << (sizeof(cases) / sizeof(cases[0]) - failures) << '/'
            << sizeof(cases) / sizeof(cases[0]) << " checks passed\n";
  return failures == 0 ? 0 : 1;
}
