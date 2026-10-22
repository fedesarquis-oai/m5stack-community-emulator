#pragma once
#include "src/network_io.hpp"
#if FIRMWARE_NETWORK_ENABLED
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <atomic>
#include <sstream>
#include <sys/time.h>
#include "network_config.hpp"

namespace preview {
// Only the UI task calls app methods. HTTP runs in its own bounded worker task.
class HardwareNetwork {
    String ssid_,password_;
    std::string tokens_[4];
    std::atomic<bool> busy_{false},result_ready_{false};
    std::atomic<uint32_t> active_{0};
    std::atomic<unsigned> wifi_reason_{0},request_ms_{0};
    std::atomic<int> http_transport_code_{0},tls_code_{0};
    NetworkResult result_;
    uint32_t connecting_=0,connect_started_=0,requests_=0,completed_=0;
    std::string last_error_;
    unsigned last_status_=0,last_bytes_=0;
    bool checking_=false,forget_requested_=false;uint32_t scan_started_=0;
    struct Job {HardwareNetwork* owner;NetworkRequest request;unsigned service;std::string token;};
    static void task(void* raw){
        auto* owner=static_cast<Job*>(raw)->owner;
        { // Destroy C++ request/client state before vTaskDelete (which does not unwind).
        std::unique_ptr<Job> job(static_cast<Job*>(raw));auto& self=*job->owner;auto& r=job->request;
        NetworkResult result{r.id,"online","wifi","",0,""};
        self.http_transport_code_.store(0);self.tls_code_.store(0);self.request_ms_.store(0);
        const auto started=millis();
        const auto cancelled=[&](){return self.active_.load()!=r.id;};
        const auto expired=[&](){return uint32_t(millis()-started)>=12000;};
        const auto& service=NETWORK_SERVICES[job->service];
        WiFiClient plain;WiFiClientSecure tls;HTTPClient http; // HTTP client must be destroyed first.
        const bool secure=std::string(service.origin).rfind("https://",0)==0;
        bool begun=false;
        if(secure){
            // Certificate dates must be checked; never use setInsecure().
            while(time(nullptr)<1704067200 && !cancelled() && !expired())delay(20);
            if(time(nullptr)<1704067200)result.error="TIME_NOT_SYNCED";
            else {tls.setCACert(service.ca);tls.setHandshakeTimeout(10);begun=http.begin(tls,(std::string(service.origin)+r.path).c_str());}
        }else begun=http.begin(plain,(std::string(service.origin)+r.path).c_str());
        if(result.error.empty() && !begun)result.error="CONNECTION_FAILED";
        if(result.error.empty() && !cancelled()){
            http.setConnectTimeout(8000);http.setTimeout(12000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);http.useHTTP10(true);
            http.addHeader("Accept","application/json, text/plain");http.addHeader("Accept-Encoding","identity");
            if(service.bearer)http.addHeader("Authorization",("Bearer "+job->token).c_str());
            int code;
            if(r.method=="POST"){http.addHeader("Content-Type","application/json");code=http.POST(reinterpret_cast<uint8_t*>(r.body.data()),r.body.size());}
            else code=http.GET();
            self.http_transport_code_.store(code);
            if(code<=0 && secure){char detail[128]{};self.tls_code_.store(tls.lastError(detail,sizeof(detail)));}
            if(code<=0)result.error=secure?"TLS_OR_CONNECTION_FAILED":"CONNECTION_FAILED";
            else {
                result.status=unsigned(code);
                int remaining=http.getSize();
                if(code>=300&&code<400)result.error="REDIRECT_BLOCKED";
                else if(remaining>int(NETWORK_RESPONSE_BYTES))result.error="RESPONSE_TOO_LARGE";
                else {
                    struct Sink:Stream {
                        std::string body,error;std::atomic<uint32_t>& active;uint32_t id,started;
                        Sink(std::atomic<uint32_t>& a,uint32_t i,uint32_t t):active(a),id(i),started(t){}
                        int available()override{return 0;}int read()override{return -1;}int peek()override{return -1;}void flush()override{}
                        size_t write(uint8_t c)override{return write(&c,1);}
                        size_t write(const uint8_t* bytes,size_t count)override{
                            if(active.load()!=id)error="CANCELLED";
                            else if(uint32_t(millis()-started)>=12000)error="TIMEOUT";
                            else if(body.size()+count>NETWORK_RESPONSE_BYTES)error="RESPONSE_TOO_LARGE";
                            if(!error.empty())return 0;body.append(reinterpret_cast<const char*>(bytes),count);return count;
                        }
                    } sink(self.active_,r.id,started);
                    const int copied=http.writeToStream(&sink); // HTTPClient decodes chunked framing.
                    if(!sink.error.empty())result.error=sink.error;
                    else if(copied<0)result.error="INCOMPLETE_RESPONSE";
                    else if(!networkUtf8(sink.body))result.error="INVALID_UTF8";
                    else result.body=std::move(sink.body);
                }
            }
        }
        if(cancelled())result.error="CANCELLED";else if(expired())result.error="TIMEOUT";
        if(WiFi.status()!=WL_CONNECTED){result.link="offline";if(result.error.empty())result.error="OFFLINE";}
        if(!result.error.empty())result.body.clear();
        http.end();plain.stop();tls.stop();
        self.request_ms_.store(uint32_t(millis()-started));
        self.result_=std::move(result);self.result_ready_.store(true,std::memory_order_release);
        }
        owner->busy_.store(false,std::memory_order_release);vTaskDelete(nullptr);
    }
public:
    void begin(){
        Preferences p;p.begin("codex-network",true);ssid_=p.getString("ssid","");password_=p.getString("password","");
        for(unsigned i=0;i<NETWORK_SERVICE_COUNT;++i)tokens_[i]=p.getString(NETWORK_SERVICES[i].storageKey,"").c_str();p.end();
        WiFi.persistent(false);WiFi.setAutoReconnect(false);
        WiFi.onEvent([this](WiFiEvent_t,WiFiEventInfo_t info){wifi_reason_.store(info.wifi_sta_disconnected.reason);},ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
    }
    // Provisioning is USB-only, explicit, bounded, and never echoes credentials.
    bool configure(const char* line){
        std::istringstream input(line);std::string cmd,a,b,extra;unsigned persist=0;
        input>>cmd;
        if(cmd=="NETFORGET"){
            bool ok=!(input>>extra)&&!busy_.load();
            if(ok){
                active_.store(0);connecting_=0;checking_=false;WiFi.scanDelete();WiFi.disconnect(false);
                Preferences p;ok=p.begin("codex-network",false);
                if(ok){ok=p.clear();p.end();}
                if(ok){ssid_="";password_="";for(auto& token:tokens_)token.clear();forget_requested_=true;}
            }
            Serial.printf("{\"event\":\"network_config\",\"key\":\"forget\",\"ok\":%s}\n",ok?"true":"false");return true;
        }
        if(cmd=="NETCHECK"){
            if(checking_||connecting_||busy_.load()||WiFi.status()==WL_CONNECTED){Serial.println("{\"event\":\"network_scan\",\"error\":\"SCAN_BUSY\"}");return true;}
            WiFi.mode(WIFI_STA);WiFi.scanDelete();WiFi.setScanTimeout(15000);
            checking_=true;scan_started_=millis();WiFi.scanNetworks(true,true,false,300);return true;
        }
        if(cmd=="NETTIME"){
            unsigned long epoch=0;if(!(input>>epoch)||epoch<1704067200UL||epoch>4102444800UL||(input>>extra))return true;
            timeval tv{static_cast<time_t>(epoch),0};settimeofday(&tv,nullptr);Serial.println("{\"event\":\"network_config\",\"key\":\"time\",\"ok\":true}");return true;
        }
        if(cmd!="NETWIFI"&&cmd!="NETTOKEN")return false;
        bool ok=bool(input>>a>>b>>persist)&&persist<=1&&!(input>>extra)&&!busy_.load()&&!connecting_&&!checking_;std::string first,second;
        if(cmd=="NETWIFI"){
            ok=ok&&networkUnhex(a,first,32)&&!first.empty()&&networkUnhex(b,second,64)&&first.find('\0')==std::string::npos&&second.find('\0')==std::string::npos;
            if(ok){
                WiFi.disconnect(false);ssid_=first.c_str();password_=second.c_str();
                Preferences p;ok=p.begin("codex-network",false);
                if(ok){if(persist){ok=p.putString("ssid",ssid_)==ssid_.length();ok=(p.putString("password",password_)==password_.length())&&ok;}else{p.remove("ssid");p.remove("password");}p.end();}
            }
        }else{
            unsigned index=NETWORK_SERVICE_COUNT;for(unsigned i=0;i<NETWORK_SERVICE_COUNT;++i)if(a==NETWORK_SERVICES[i].id)index=i;
            ok=ok&&index<NETWORK_SERVICE_COUNT&&networkUnhex(b,second,1024);
            for(unsigned char c:second)if(c<33||c>126)ok=false;
            if(ok){tokens_[index]=second;Preferences p;ok=p.begin("codex-network",false);if(ok){if(persist)ok=p.putString(NETWORK_SERVICES[index].storageKey,second.c_str())==second.size();else p.remove(NETWORK_SERVICES[index].storageKey);p.end();}}
        }
        Serial.printf("{\"event\":\"network_config\",\"key\":\"%s\",\"ok\":%s}\n",cmd=="NETWIFI"?"wifi":"token",ok?"true":"false");return true;
    }
    template<class App> void tick(App& app){
        if(checking_){
            const int found=WiFi.scanComplete();
            if(found!=WIFI_SCAN_RUNNING||uint32_t(millis()-scan_started_)>15000){
                bool match=false,case_mismatch=false;int channel=0,signal=-127,auth=-1;
                for(int i=0;i<found&&i<255;++i){const auto name=WiFi.SSID(i);if(name==ssid_){match=true;channel=WiFi.channel(i);signal=WiFi.RSSI(i);auth=int(WiFi.encryptionType(i));}else if(name.equalsIgnoreCase(ssid_))case_mismatch=true;}
                Serial.printf("{\"event\":\"network_scan\",\"networks_seen\":%d,\"configured_network_found\":%s,\"name_case_mismatch\":%s,\"channel\":%d,\"rssi\":%d,\"auth_mode\":%d,\"error\":\"%s\"}\n",found<0?0:found,match?"true":"false",case_mismatch?"true":"false",channel,signal,auth,found<0?"SCAN_FAILED":"");
                checking_=false;WiFi.scanDelete();
            }
            return;
        }
        auto* n=appNetwork(app);if(!n)return;
        if(forget_requested_){forget_requested_=false;n->disconnect();}
        const auto send=[&](NetworkResult r){last_status_=r.status;last_bytes_=r.body.size();last_error_=r.error;++completed_;appNetworkResult(app,r);};
        if(result_ready_.load(std::memory_order_acquire)&&!busy_.load(std::memory_order_acquire)){
            NetworkResult result=std::move(result_);result_ready_.store(false);if(n->pending()&&n->pending()->id==result.id)send(std::move(result));
        }
        if(!n->pending()){active_.store(0);if(connecting_){WiFi.disconnect(false);connecting_=0;}return;}
        const auto r=*n->pending();
        if(active_.load()!=r.id)active_.store(0);
        if(r.kind=="disconnect"){
            active_.store(0);connecting_=0;WiFi.disconnect(false);send({r.id,"offline","wifi","",0,""});return;
        }
        if(r.kind=="connect"){
            if(connecting_!=r.id){
                if(ssid_.isEmpty()){send({r.id,"offline","wifi","WIFI_CONFIG_REQUIRED",0,""});return;}
                wifi_reason_.store(0);connecting_=r.id;connect_started_=millis();WiFi.mode(WIFI_STA);WiFi.begin(ssid_.c_str(),password_.c_str());
            }
            if(WiFi.status()==WL_CONNECTED){connecting_=0;configTime(0,0,"pool.ntp.org","time.cloudflare.com");send({r.id,"online","wifi","",0,""});}
            else if(uint32_t(millis()-connect_started_)>=15000){connecting_=0;WiFi.disconnect(false);send({r.id,"offline","wifi",wifi_reason_.load()==WIFI_REASON_NO_AP_FOUND?"WIFI_NETWORK_NOT_FOUND":wifi_reason_.load()==WIFI_REASON_AUTH_FAIL||wifi_reason_.load()==WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT?"WIFI_AUTH_FAILED":"WIFI_CONNECT_FAILED",0,""});}
            return;
        }
        if(busy_.load()){if(active_.load()!=r.id)active_.store(0);return;}
        if(WiFi.status()!=WL_CONNECTED){send({r.id,"offline","wifi","OFFLINE",0,""});return;}
        unsigned index=NETWORK_SERVICE_COUNT;for(unsigned i=0;i<NETWORK_SERVICE_COUNT;++i)if(r.service==NETWORK_SERVICES[i].id)index=i;
        if(index==NETWORK_SERVICE_COUNT){send({r.id,"online","wifi","SERVICE_NOT_ALLOWED",0,""});return;}
        if(NETWORK_SERVICES[index].bearer&&tokens_[index].empty()){send({r.id,"online","wifi","TOKEN_REQUIRED",0,""});return;}
        auto* job=new(std::nothrow) Job{this,r,index,tokens_[index]};
        if(!job){send({r.id,"online","wifi","ALLOCATION_FAILED",0,""});return;}
        active_.store(r.id);busy_.store(true);++requests_;
        if(xTaskCreate(task,"app-http",8192,job,1,nullptr)!=pdPASS){delete job;busy_.store(false);send({r.id,"online","wifi","TASK_FAILED",0,""});}
    }
    void status(){Serial.printf("{\"event\":\"network_status\",\"wifi_reason\":%u,\"request_ms\":%u,\"http_transport_code\":%d,\"tls_code\":%d,\"time_epoch\":%lld,\"connected\":%s,\"configured\":%s,\"busy\":%s,\"requests\":%u,\"completed\":%u,\"http_status\":%u,\"response_bytes\":%u,\"error\":\"%s\"}\n",wifi_reason_.load(),request_ms_.load(),http_transport_code_.load(),tls_code_.load(),static_cast<long long>(time(nullptr)),WiFi.status()==WL_CONNECTED?"true":"false",ssid_.isEmpty()?"false":"true",busy_.load()?"true":"false",requests_,completed_,last_status_,last_bytes_,last_error_.c_str());}
};
} // namespace preview
#endif
