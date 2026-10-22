#pragma once
// Portable, single-flight network contract. Drivers and credentials live outside the app.
#include <cstdint>
#include <optional>
#include <string>
#include <type_traits>
#include <utility>
#include <ostream>

namespace preview {
constexpr std::size_t NETWORK_REQUEST_BYTES=1024, NETWORK_RESPONSE_BYTES=8192;
struct NetworkRequest {
    std::uint32_t id=0;
    std::string kind, service, method, path, body;
};
struct NetworkResult {
    std::uint32_t id=0;
    std::string link="offline", source, error;
    unsigned status=0;
    std::string body;
};
inline bool networkName(const std::string& s) {
    if(s.empty() || s.size()>32)return false;
    for(unsigned char c:s)if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'||c=='-'))return false;
    return true;
}
inline bool networkPath(const std::string& s) {
    if(s.empty() || s.size()>256 || s[0]!='/' || (s.size()>1&&s[1]=='/'))return false;
    for(unsigned char c:s)if(c<33 || c>126 || c=='\\' || c=='#')return false;
    return true;
}
inline bool networkUtf8(const std::string& s) {
    for(std::size_t i=0;i<s.size();) {
        unsigned char a=s[i++];if(a<0x80)continue;
        unsigned count=0;uint32_t cp=0,min=0;
        if(a>=0xc2&&a<=0xdf){count=1;cp=a&31;min=0x80;}
        else if(a>=0xe0&&a<=0xef){count=2;cp=a&15;min=0x800;}
        else if(a>=0xf0&&a<=0xf4){count=3;cp=a&7;min=0x10000;}
        else return false;
        if(i+count>s.size())return false;
        while(count--){unsigned char b=s[i++];if((b&0xc0)!=0x80)return false;cp=(cp<<6)|(b&63);}
        if(cp<min||cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff))return false;
    }return true;
}
inline std::string networkHex(const std::string& data) {
    if(data.empty())return "-";
    const char* digits="0123456789abcdef";std::string out;out.reserve(data.size()*2);
    for(unsigned char c:data){out+=digits[c>>4];out+=digits[c&15];}return out;
}
inline bool networkUnhex(const std::string& hex,std::string& out,std::size_t limit) {
    out.clear();if(hex=="-")return true;
    if(hex.empty() || hex.size()%2 || hex.size()>limit*2)return false;
    const auto digit=[](char c)->int{return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1;};
    for(std::size_t i=0;i<hex.size();i+=2){int a=digit(hex[i]),b=digit(hex[i+1]);if(a<0||b<0)return false;out+=char((a<<4)|b);}return true;
}
class NetworkPort {
    std::uint32_t next_=0;
    std::optional<NetworkRequest> pending_;
    NetworkResult last_;
    std::string link_="offline";
    bool issue(NetworkRequest req){if(next_>=1000000000)return false;req.id=++next_;pending_=std::move(req);return true;}
public:
    const auto& pending()const{return pending_;}
    const auto& last()const{return last_;}
    const auto& link()const{return link_;}
    bool connect(){if(pending_)return false;return issue({0,"connect",{},{},{},{}});}
    // Disconnect replaces outstanding work. A late reply cannot affect the new request.
    bool disconnect(){return issue({0,"disconnect",{},{},{},{}});}
    void cancel(){pending_.reset();}
    bool request(std::string service,std::string method,std::string path,std::string body={}){
        if(pending_ || link_!="online" || !networkName(service) || !networkPath(path) ||
           (method!="GET"&&method!="POST") || body.size()>NETWORK_REQUEST_BYTES || (method=="GET"&&!body.empty()))return false;
        return issue({0,"request",std::move(service),std::move(method),std::move(path),std::move(body)});
    }
    bool accept(const NetworkResult& result){
        if(!pending_ || pending_->id!=result.id || result.body.size()>NETWORK_RESPONSE_BYTES ||
           (result.link!="online"&&result.link!="offline") || (result.source!="host"&&result.source!="wifi") ||
           (!result.error.empty()&&!networkName(result.error)) || (result.status && (result.status<100||result.status>599)))return false;
        last_=result;link_=result.link;pending_.reset();return true;
    }
};
template<class T,class=void> struct HasNetworkAdapter:std::false_type{};
template<class T> struct HasNetworkAdapter<T,std::void_t<decltype(T::network_adapter)>>:std::bool_constant<T::network_adapter==1>{};
template<class T> NetworkPort* appNetwork(T& app){if constexpr(HasNetworkAdapter<T>::value)return &app.network();else return nullptr;}
template<class T> const NetworkPort* appNetwork(const T& app){if constexpr(HasNetworkAdapter<T>::value)return &app.network();else return nullptr;}
template<class T> bool appNetworkResult(T& app,const NetworkResult& result){
    if constexpr(HasNetworkAdapter<T>::value){if(!app.network().accept(result))return false;app.onNetworkResult(result);return true;}else return false;
}
inline std::string networkQuoted(const std::string& s){std::string out="\"";for(char c:s){if(c=='"'||c=='\\')out+='\\';out+=c;}return out+'"';}
template<class T> void writeNetworkState(std::ostream& out,const T& app){
    const auto* n=appNetwork(app);out<<",\"network_adapter\":"<<(n?1:0)<<",\"network\":";
    if(!n){out<<"null";return;}
    out<<"{\"link\":"<<networkQuoted(n->link())<<",\"source\":"<<networkQuoted(n->last().source)
       <<",\"last_id\":"<<n->last().id<<",\"http_status\":"<<n->last().status<<",\"error\":"<<networkQuoted(n->last().error)
       <<",\"response_bytes\":"<<n->last().body.size()<<",\"pending\":";
    if(!n->pending())out<<"null";
    else {const auto& r=*n->pending();out<<"{\"id\":"<<r.id<<",\"kind\":"<<networkQuoted(r.kind)<<",\"service\":"<<networkQuoted(r.service)
         <<",\"method\":"<<networkQuoted(r.method)<<",\"path\":"<<networkQuoted(r.path)<<",\"body_hex\":"<<networkQuoted(networkHex(r.body))<<"}";}
    out<<"}";
}
} // namespace preview
