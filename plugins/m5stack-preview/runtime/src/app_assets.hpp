#pragma once
// Bounded, memory-only app assets. No capture, file, URL, or network access.
#include <algorithm>
#include <cstdint>
#include <optional>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

namespace preview {

struct RecordingInfo {
    std::string id;
    std::string mime_type;
    unsigned duration_ms = 0;
    unsigned bytes = 0;
    std::string sha256;
    std::string source = "fixture";
};

struct RecordingCapture {
    std::string id;
    std::string source;
    bool stopped = false;
};

struct CaptureIntent {
    std::string id;
    std::string source;
    std::string action; // start | stop | cancel; never an automatic capture trigger.
    std::uint64_t sequence = 0;
};

// Optional adapter detection keeps earlier authored UserApp implementations
// compilable. A partial implementation must not advertise a complete handshake.
template<class App, class = void> struct HasCaptureAdapter : std::false_type {};
template<class App> struct HasCaptureAdapter<App, std::void_t<
    decltype(std::declval<const App&>().captureIntent()),
    decltype(std::declval<const App&>().recordingCapture()->stopped),
    decltype(std::declval<App&>().recordingStopped(std::declval<const std::string&>(),std::declval<const std::string&>())),
    decltype(std::declval<App&>().clearRecording(std::declval<const std::string&>(),std::declval<const std::string&>()))>>
    : std::bool_constant<std::is_same_v<decltype(std::declval<const App&>().captureIntent()),const std::optional<CaptureIntent>&> &&
        std::is_convertible_v<decltype(std::declval<App&>().recordingStopped(std::declval<const std::string&>(),std::declval<const std::string&>())),bool> &&
        std::is_convertible_v<decltype(std::declval<App&>().clearRecording(std::declval<const std::string&>(),std::declval<const std::string&>())),bool>> {};

template<class App> const std::optional<CaptureIntent>* appCaptureIntent(const App& app) {
    if constexpr (HasCaptureAdapter<App>::value) return &app.captureIntent();
    else return nullptr;
}
template<class App> bool appRecordingStopped(App& app,const std::string& id,const std::string& source) {
    if constexpr (HasCaptureAdapter<App>::value) return app.recordingStopped(id,source);
    else return false;
}
template<class App> bool appCaptureStopped(const App& app) {
    if constexpr (HasCaptureAdapter<App>::value) return app.recordingCapture() && app.recordingCapture()->stopped;
    else return false;
}
template<class App> bool appClearRecording(App& app,const std::string& id,const std::string& source) {
    if constexpr (HasCaptureAdapter<App>::value) return app.clearRecording(id,source);
    else return false;
}

struct ImageFrame {
    std::string id;
    unsigned width = 0, height = 0;
    std::vector<std::uint16_t> rgb565;
};

struct ResultContext {
    std::string draft_id;
    std::string request_id;
    std::uint64_t revision = 0;
};

inline bool validAssetId(const std::string& id) {
    if (id.empty() || id.size() > 64) return false;
    for (unsigned char c : id)
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
              (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
    return true;
}

inline bool validRecording(const RecordingInfo& info) {
    if (!validAssetId(info.id) || info.duration_ms < 1 || info.duration_ms > 30000 ||
        info.bytes < 1 || info.bytes > 2097152 || info.sha256.size() != 64 ||
        (info.source != "fixture" && info.source != "browser") ||
        (info.mime_type != "audio/webm" && info.mime_type != "audio/ogg" &&
         info.mime_type != "audio/mp4" && info.mime_type != "audio/wav")) return false;
    for (unsigned char c : info.sha256)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}

inline bool validResultContext(const ResultContext& context) {
    return validAssetId(context.draft_id) && validAssetId(context.request_id) &&
        context.revision >= 1 && context.revision <= 9007199254740991ULL;
}

inline bool sameResultContext(const ResultContext& first, const ResultContext& second) {
    return first.draft_id == second.draft_id && first.request_id == second.request_id && first.revision == second.revision;
}

inline bool validImage(const ImageFrame& frame) {
    return validAssetId(frame.id) && frame.width >= 1 && frame.width <= 320 &&
        frame.height >= 1 && frame.height <= 240 &&
        frame.rgb565.size() == static_cast<std::size_t>(frame.width) * frame.height;
}

// Unicode scalar values only: no overlong encodings, surrogate code points, or
// truncation. The 1..2048 limit is encoded bytes, not characters.
inline bool validAppText(const std::string& text) {
    if (text.empty() || text.size() > 2048) return false;
    for (std::size_t i = 0; i < text.size();) {
        const auto c = static_cast<unsigned char>(text[i++]);
        if (c < 0x80) continue;
        unsigned remaining = 0;
        std::uint32_t value = 0, minimum = 0;
        if (c >= 0xc2 && c <= 0xdf) { remaining = 1; value = c & 0x1f; minimum = 0x80; }
        else if (c >= 0xe0 && c <= 0xef) { remaining = 2; value = c & 0x0f; minimum = 0x800; }
        else if (c >= 0xf0 && c <= 0xf4) { remaining = 3; value = c & 0x07; minimum = 0x10000; }
        else return false;
        if (text.size() - i < remaining) return false;
        while (remaining--) {
            const auto continuation = static_cast<unsigned char>(text[i++]);
            if ((continuation & 0xc0) != 0x80) return false;
            value = (value << 6) | (continuation & 0x3f);
        }
        if (value < minimum || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return false;
    }
    return true;
}

// Exact destination rectangle; nearest-neighbor scaling, clipped to the native
// display. Callers choose contain/cover before this operation. Display supplies
// integer width/height members and pixel(x,y,rgb565); no decoder is involved.
template<class Display>
bool drawImage(Display& display, const ImageFrame& image, int x, int y, int width, int height) {
    if (!validImage(image) || width <= 0 || height <= 0 || display.width <= 0 || display.height <= 0) return false;
    using Wide = std::int64_t;
    const Wide left = std::max<Wide>(0, x), top = std::max<Wide>(0, y);
    const Wide right = std::min<Wide>(display.width, static_cast<Wide>(x) + width);
    const Wide bottom = std::min<Wide>(display.height, static_cast<Wide>(y) + height);
    for (Wide dy = top; dy < bottom; ++dy) {
        const auto sy = static_cast<unsigned>((dy - y) * image.height / height);
        for (Wide dx = left; dx < right; ++dx) {
            const auto sx = static_cast<unsigned>((dx - x) * image.width / width);
            display.pixel(static_cast<int>(dx), static_cast<int>(dy), image.rgb565[static_cast<std::size_t>(sy) * image.width + sx]);
        }
    }
    return true;
}

} // namespace preview
