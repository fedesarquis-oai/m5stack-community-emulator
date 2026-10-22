#pragma once
#include "network_io.hpp"
#include <algorithm>

namespace preview {
// Optional app-owned connection policy. Never replays an HTTP request.
// Call start() on app startup or a retry gesture, tick() from the app timer,
// and stop() when the app/user no longer wants a network connection.
class NetworkConnection {
    bool wanted_=false,waiting_=false;
    uint32_t observed_=0,next_=0,delay_=1000;
public:
    bool wanted()const{return wanted_;}
    void start(const NetworkPort& port){wanted_=true;waiting_=false;delay_=1000;observed_=port.last().id;}
    void stop(NetworkPort& port){wanted_=false;waiting_=false;port.disconnect();}
    bool tick(NetworkPort& port,uint32_t now){
        if(!wanted_)return false;
        if(port.link()=="online"){waiting_=false;delay_=1000;return true;}
        if(port.pending())return false;
        const auto& last=port.last();
        if(last.id!=observed_){
            observed_=last.id;
            // Configuration/authentication needs a deliberate correction/retry.
            if(last.error=="WIFI_CONFIG_REQUIRED"||last.error=="WIFI_AUTH_FAILED"||
               last.error=="CONFIG_REQUIRED"||last.error=="CONFIG_INVALID"){
                wanted_=false;return false;
            }
            next_=now+delay_;delay_=std::min<uint32_t>(delay_*2,30000);waiting_=true;
        }
        // Unsigned subtraction remains valid across the millisecond rollover.
        if(waiting_&&uint32_t(now-next_)>=0x80000000u)return false;
        waiting_=false;port.connect();return false;
    }
};
} // namespace preview
