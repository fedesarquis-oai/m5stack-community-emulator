#pragma once
// Editable rendering callback. Draw only into the supplied native framebuffer.
// Replace this starter screen without changing transport or browser controls.
#include "user_app.hpp"
#include "live_audio.hpp"
#include <algorithm>
#include <cmath>
#include <string>

namespace preview {

// Display curve only, matching the browser meter. Keep app RMS and PCM raw.
inline double microphoneMeterLevel(double rms) {
    if (!std::isfinite(rms) || rms <= 0.001) return 0;
    return std::clamp((20.0 * std::log10(rms) + 60.0) / 60.0, 0.0, 1.0);
}

// Dependent App type lets older authored apps omit the optional PCM contract.
template<class Display, class App>
void drawUserMicrophone(Display& display, const App& app, int y, std::uint16_t ink, std::uint16_t background) {
    if constexpr (HasAudioInputAdapter<App>::value) {
        if (!supportsAudioInput(app.device())) return;
        const auto stats = appAudioStats(app);
        if (!stats) return;
        const auto label = std::string(stats->active ? "MIC " : "MIC OFF ") +
            std::to_string(stats->received_frames) + " smp";
        display.setTextSize(1); display.setTextColor(ink, background);
        display.setCursor(8, y); display.print(label.c_str());
        const int max_width = static_cast<int>(app.device().width) - 16;
        const int width = static_cast<int>(microphoneMeterLevel(stats->level) * max_width);
        for (int row = 0; row < 3; ++row) display.drawFastHLine(8, y + 10 + row, width, ink);
    }
}

template<class Display>
void drawUserApp(Display& display, const UserApp& app) {
    const auto& state = app.snapshot();
    const int width = static_cast<int>(app.device().width);
    const int height = static_cast<int>(app.device().height);
    const bool compact = height < 180;
    const int title_scale = width >= 280 ? 2 : 1;
    const int preferred_count_scale = compact ? 4 : width >= 280 ? 7 : 5;
    const auto background = display.color565(17, 23, 29);
    const auto ink = display.color565(243, 245, 238);
    const auto muted = display.color565(154, 165, 172);
    const auto accent = state.alternate ? display.color565(247, 182, 112) : display.color565(145, 214, 202);

    auto text = [&](int y, std::string value, int scale, std::uint16_t color) {
        // Keep editable labels within the native panel. The starter uses ASCII
        // Font0; this clipping is display-only, not a mutation of app state.
        const auto columns = static_cast<std::size_t>((width - 8) / (6 * scale));
        if (value.size() > columns) value.resize(columns);
        display.setTextSize(scale);
        display.setTextColor(color, background);
        display.setCursor((width - static_cast<int>(value.size()) * 6 * scale) / 2, y);
        display.print(value.c_str());
    };

    display.startWrite();
    display.fillScreen(background);
    display.setTextWrap(false, false);
    text(compact ? 12 : 26, state.title, title_scale, ink);
    const auto digits = std::to_string(state.count);
    const int count_scale = std::max(1, std::min(preferred_count_scale,
        (width - 8) / (6 * static_cast<int>(digits.size()))));
    text(compact ? 41 : 87, digits, count_scale, accent);

    // Optional input feedback stays small. Neither motion input changes count.
    std::string motion;
    if (state.tilt_degrees != 0) {
        const int angle = static_cast<int>(std::lround(state.tilt_degrees));
        motion = "TILT " + (angle > 0 ? std::string("+") : std::string()) + std::to_string(angle);
    }
    if (state.alternate) motion += motion.empty() ? "COLOR 2" : " / COLOR 2";
    if (!motion.empty()) text(height - 43, motion, 1, muted);
    drawUserMicrophone(display, app, height - 65, accent, background);
    text(height - 25, app.device().capabilities.touch_input ? "TAP +1" : "BUTTON +1", 1, muted);
    text(height - 13, "HOLD 1S TO RESET", 1, muted);
    display.endWrite();
}

} // namespace preview
