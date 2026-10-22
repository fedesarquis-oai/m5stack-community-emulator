#include "../hardware/button_input.hpp"
#include <cassert>
#include <iostream>
using namespace preview;
int main() {
    HardwareButtonGesture a,b;
    assert(!a.update(false,true,5)); // Release without a press is not a gesture.
    assert(!a.update(true,false,100));
    assert(!b.update(true,false,250,true));
    auto short_a=a.update(false,true,1099);
    assert(short_a && short_a->kind==InputKind::PrimaryClick && short_a->duration_ms==999);
    auto held_b=b.update(false,true,1250,true);
    assert(held_b && held_b->kind==InputKind::SecondaryHold && held_b->duration_ms==1000);
    assert(!b.update(false,true,1300,true)); // No duplicate release.
    a.update(true,false,0xfffffff0u);
    auto wrapped=a.update(false,true,16);
    assert(wrapped && wrapped->duration_ms==32);
    b.update(true,false,0,true);
    auto capped=b.update(false,true,70000,true);
    assert(capped && capped->duration_ms==60000);
    a.update(true,false,0);assert(a.update(false,true,1000)->kind==InputKind::HoldReset);
    b.update(true,false,0,true);assert(b.update(false,true,50,true)->kind==InputKind::SecondaryClick);
    std::cout<<"PASS: independent buttons, click/hold boundary, duplicate release, timer wrap and duration bound\n";
}
