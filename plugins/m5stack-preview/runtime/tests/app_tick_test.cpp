#include "../src/app_tick.hpp"
#include <cassert>
struct Legacy { unsigned calls=0; void onTick(uint32_t){++calls;} };
struct Disabled { static constexpr unsigned timer_adapter=0; unsigned calls=0; void onTick(uint32_t){++calls;} };
struct Enabled { static constexpr unsigned timer_adapter=1; uint32_t now=0; void onTick(uint32_t value){now=value;} };
int main(){Legacy a;Disabled b;Enabled c;preview::appTick(a,7);preview::appTick(b,7);preview::appTick(c,0xffffffffu);assert(a.calls==0&&b.calls==0&&c.now==0xffffffffu);}
