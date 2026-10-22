# Source provenance and licenses

Original project code is MIT licensed by Federico Sarquis; see [LICENSE](LICENSE). Upstream code retains its original terms. The browser casing illustrations are CSS; official product photographs and private evidence are excluded.

## Native dependencies

Setup fetches two pinned official source repositories into the app workspace. Their license files and per-file notices remain in those checkouts. Dependency trees, native executables and firmware are not bundled.

| Dependency | Revision | License |
|---|---|---|
| [M5GFX](https://github.com/m5stack/M5GFX) | `f3e51bd12b8986b6a7f7a7e14c6d687403e820e0` | MIT, plus original per-file notices |
| [LVGL](https://github.com/lvgl/lvgl) | `4495f428630cc1741bd8bfd977f080e8460e8e8d` | MIT, plus retained component notices |

`src/native_display.hpp` reads Font0 from M5GFX's `src/lgfx/Fonts/glcdfont.h`. That file has **Copyright (c) 2012 Adafruit Industries** and its own BSD notice. The fetched header stays unmodified. Preserve that notice in any native binary distribution; the repository-wide M5GFX MIT license does not replace it.

## Original reusable input code

`src/ShakeDetector.h` and its test originated in Federico Sarquis's HelloCounter project. The algorithm is shared by the simulator and physical motion adapter. It is included under this project's MIT license with the author's authorization. [Provenance hashes](docs/shake-provenance.json) document the original snapshot; no separate HelloCounter app or private project is bundled.

The 8 Ball, mascot and trail experiments, their content and alternate viewers were removed from the community runtime. `counter` and `custom` are compatibility names for the same editable Hello World headers.

## JavaScript and implementation credits

The complete plugin includes JavaScript bundles and dependency notices in its root `THIRD_PARTY_NOTICES.md` and `licenses/`. Workspace source exports do not contain those bundles. Firmware setup dependencies have their own pinned inventory in `firmware.json`.

The native renderer originated from the display/input approach in [m5stack/lv_m5_emulator](https://github.com/m5stack/lv_m5_emulator/tree/32898dbb5497644e753305947e7f3c2a0a2caa20). The applicable original MIT notice follows:

```
MIT License

Copyright (c) 2024 M5Stack

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
