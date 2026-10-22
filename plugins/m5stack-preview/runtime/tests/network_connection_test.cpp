#include "../src/network_connection.hpp"
#include <cassert>
using namespace preview;
int main(){
 NetworkPort n;NetworkConnection c;
 assert(!c.tick(n,0)&&!n.pending());c.start(n);assert(!c.tick(n,0)&&n.pending()->kind=="connect");
 auto first=n.pending()->id;assert(n.accept({first,"offline","wifi","WIFI_NETWORK_NOT_FOUND",0,""}));
 c.tick(n,100);assert(!n.pending());c.tick(n,1099);assert(!n.pending());c.tick(n,1100);assert(n.pending());
 n.accept({n.pending()->id,"online","wifi","",0,""});assert(c.tick(n,1200));
 n.request("api","POST","/events","{}");auto post=n.pending()->id;
 n.accept({post,"offline","wifi","OFFLINE",0,""});c.tick(n,1300);c.tick(n,2300);
 assert(n.pending()->kind=="connect"); // A failed POST is never automatically replayed.
 c.stop(n);auto off=n.pending()->id;assert(n.pending()->kind=="disconnect");
 assert(!n.accept({post,"online","wifi","",200,"late"}));n.accept({off,"offline","wifi","",0,""});
 c.tick(n,999999);assert(!n.pending()&&!c.wanted());
 c.start(n);c.tick(n,0);n.accept({n.pending()->id,"offline","wifi","WIFI_AUTH_FAILED",0,""});
 c.tick(n,1);assert(!c.wanted()&&!n.pending());c.tick(n,100000);assert(!n.pending());
 c.start(n);c.tick(n,0xfffffff0u);n.accept({n.pending()->id,"offline","wifi","WIFI_CONNECT_FAILED",0,""});
 c.tick(n,0xfffffff0u);c.tick(n,983);assert(!n.pending());c.tick(n,984);assert(n.pending());
}
