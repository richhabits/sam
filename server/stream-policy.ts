// What a /api/stream request is allowed to set in motion.
//
// `untrusted: true` marks a message carrying content SAM did not get from its owner (a web page
// from the Safari extension, a shared file). Text like that can contain instructions aimed at SAM
// (prompt injection), so for it: no tools (one plain model call), no routine phrase matching,
// nothing learned into long-term memory, nothing cached. Enforced here, on the server, so a client
// can't talk its way past it with a prompt.
export interface StreamPolicy {
  turbo: boolean;          // one fast call, no tools
  routines: boolean;       // may a phrase trigger a saved routine
  learn: boolean;          // may the exchange be learned into memory
  cache: boolean;          // may the answer be stored in / served from the semantic cache
}

export function streamPolicy(body: { tier?: unknown; untrusted?: unknown } | null | undefined): StreamPolicy {
  const untrusted = body?.untrusted === true;
  return {
    turbo: untrusted || body?.tier === "turbo",
    routines: !untrusted,
    learn: !untrusted,
    cache: !untrusted,
  };
}
