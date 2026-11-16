#pragma once
#include <cstdio>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace preview {
// The bridge carries JSON headers followed by binary pixels. Windows text mode
// rewrites LF and treats Ctrl-Z as end-of-input; preserve the protocol bytes.
inline bool prepareHostStdio() {
#ifdef _WIN32
    return _setmode(_fileno(stdin), _O_BINARY) != -1
        && _setmode(_fileno(stdout), _O_BINARY) != -1;
#else
    return true;
#endif
}
}
