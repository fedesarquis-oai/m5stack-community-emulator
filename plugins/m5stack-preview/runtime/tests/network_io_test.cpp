#include "../src/network_io.hpp"
#include <cassert>
using namespace preview;
int main(){
 NetworkPort n;assert(!n.request("api","GET","/"));assert(n.connect());auto first=n.pending()->id;
 assert(n.disconnect());assert(!n.accept({first,"online","host","",0,""}));auto off=n.pending()->id;
 assert(n.accept({off,"offline","host","",0,""}));assert(n.connect());assert(n.accept({n.pending()->id,"online","wifi","",0,""}));
 for(auto path:{"https://evil.test/","//evil.test/","/bad path","/x#fragment","/\\x"})assert(!n.request("api","GET",path));
 assert(!n.request("api","GET","/","body"));assert(!n.request("api","POST","/",std::string(1025,'x')));
 assert(n.request("api","POST","/echo","hello"));auto id=n.pending()->id;n.cancel();assert(!n.accept({id,"online","wifi","",200,"late"}));
 assert(n.request("api","GET","/"));id=n.pending()->id;assert(!n.accept({id,"online","wifi","",200,std::string(8193,'x')}));assert(n.accept({id,"online","wifi","",503,"error"}));
 assert(networkUtf8("hello\xc3\xb1"));assert(!networkUtf8("\xc0\x80"));assert(!networkUtf8("\xed\xa0\x80"));assert(!networkUtf8("\xf4\x90\x80\x80"));assert(!networkUtf8("\xe2\x82"));
 std::string raw("a\0b",3),decoded;assert(networkUnhex(networkHex(raw),decoded,3));assert(raw==decoded);assert(!networkUnhex("aabb",decoded,1));
}
