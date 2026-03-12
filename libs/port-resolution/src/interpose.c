// macOS DYLD_INTERPOSE table — maps hooked_bind/hooked_connect (Zig) to the
// real libc bind/connect. This file exists because DYLD_INTERPOSE requires
// referencing the original symbol by name, which Zig cannot do when it also
// exports a function with the same name.
#include <sys/socket.h>

extern int hooked_bind(int, const struct sockaddr *, socklen_t);
extern int hooked_connect(int, const struct sockaddr *, socklen_t);

#define DYLD_INTERPOSE(replacement, replacee)                              \
  __attribute__((used)) static struct {                                    \
    const void *r;                                                         \
    const void *o;                                                         \
  } _interpose_##replacee __attribute__((section("__DATA,__interpose"))) = \
      {(const void *)(unsigned long long)&replacement,                     \
       (const void *)(unsigned long long)&replacee};

DYLD_INTERPOSE(hooked_bind, bind)
DYLD_INTERPOSE(hooked_connect, connect)
