#pragma once
// Small, bounded parser helpers shared with native protocol tests.
#include "app_assets.hpp"
#include <istream>
#include <utility>

namespace preview {

constexpr std::size_t MAX_APP_COMMAND_BYTES = 307600; // 320*240*4 hex + bounded result context/metadata.
enum class LineRead { Line, End, TooLong };

inline LineRead readAppCommand(std::istream& input, std::string& line) {
    line.clear();
    char byte = 0;
    while (input.get(byte)) {
        if (byte == '\n') return LineRead::Line;
        if (line.size() == MAX_APP_COMMAND_BYTES) return LineRead::TooLong;
        line += byte;
    }
    return line.empty() ? LineRead::End : LineRead::Line;
}

inline bool appUnsigned(const std::string& text, std::uint32_t maximum, std::uint32_t& value) {
    if (text.empty()) return false;
    value = 0;
    for (const unsigned char c : text) {
        if (c < '0' || c > '9') return false;
        const auto digit = static_cast<std::uint32_t>(c - '0');
        if (digit > maximum || value > (maximum - digit) / 10) return false;
        value = value * 10 + digit;
    }
    return true;
}

inline int appHexDigit(unsigned char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

inline bool decodeAppText(const std::string& hex, std::string& text) {
    if (hex.size() > 4096 || hex.size() % 2) return false;
    std::string decoded;
    decoded.reserve(hex.size() / 2);
    for (std::size_t i = 0; i < hex.size(); i += 2) {
        const int hi = appHexDigit(hex[i]), lo = appHexDigit(hex[i + 1]);
        if (hi < 0 || lo < 0) return false;
        decoded += static_cast<char>((hi << 4) | lo);
    }
    if (!validAppText(decoded)) return false;
    text = std::move(decoded);
    return true;
}

inline bool decodeAppImage(const std::string& id, const std::string& width,
                           const std::string& height, const std::string& hex, ImageFrame& image) {
    std::uint32_t w = 0, h = 0;
    if (!validAssetId(id) || !appUnsigned(width, 320, w) || !w ||
        !appUnsigned(height, 240, h) || !h || hex.size() != static_cast<std::size_t>(w) * h * 4) return false;
    ImageFrame decoded{id, w, h, {}};
    decoded.rgb565.reserve(static_cast<std::size_t>(w) * h);
    for (std::size_t i = 0; i < hex.size(); i += 4) {
        unsigned value = 0;
        for (unsigned j = 0; j < 4; ++j) {
            const int nibble = appHexDigit(hex[i + j]);
            if (nibble < 0) return false;
            value = (value << 4) | static_cast<unsigned>(nibble);
        }
        decoded.rgb565.push_back(static_cast<std::uint16_t>(value));
    }
    image = std::move(decoded);
    return true;
}

inline std::string recordingMime(const std::string& token) {
    if (token == "webm" || token == "ogg" || token == "mp4" || token == "wav") return "audio/" + token;
    return {};
}

inline bool decodeResultContext(const std::string& draft, const std::string& request,
                                const std::string& revision, ResultContext& context) {
    if (revision.empty()) return false;
    std::uint64_t value = 0;
    constexpr std::uint64_t maximum = 9007199254740991ULL;
    for (unsigned char c : revision) {
        if (c < '0' || c > '9') return false;
        const auto digit = static_cast<std::uint64_t>(c - '0');
        if (value > (maximum - digit) / 10) return false;
        value = value * 10 + digit;
    }
    ResultContext decoded{draft, request, value};
    if (!validResultContext(decoded)) return false;
    context = std::move(decoded);
    return true;
}

} // namespace preview
