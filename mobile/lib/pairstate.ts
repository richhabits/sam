// Deciding what a failed claim MEANS — kept out of App.tsx so it can be tested, because the
// situation it exists for is one the component cannot easily be put into: a cold launch from a
// QR banner, where a keychain read and a network claim race each other.
//
// The failure this answers: a pairing code is single-use, iOS delivers a launch link twice, and
// the second claim of a code the first one already spent comes back "already used". That error
// is evidence the phone IS paired, not that it failed — and treating it as a failure left the
// operator on the pairing form holding a working token, with "This phone is paired" sitting on
// their lock screen. Reported from a real device, 2026-08-11.

/** The one normalizer for a SAM host. Every comparison between a typed host, a host that
 *  arrived in a pairing link, and the host stored at pairing time has to agree on what
 *  "the same machine" means — two copies of this rule drifting apart is a phone that thinks
 *  it is paired to the wrong Mac. */
export function normalizeHost(host: string): string {
  return host.trim().replace(/\/+$/, "");
}

/** Is this phone already paired to the machine the claim was aimed at, despite the claim
 *  failing? True only when a token is stored AND it belongs to that same host.
 *
 *  Host-matched deliberately: "we hold some token" would wave a phone re-pairing to a DIFFERENT
 *  Mac through on the strength of its previous machine's token — authenticating against nothing,
 *  looking paired. A token for another host is not a pairing with this one. */
export function pairedDespiteError(opts: {
  targetHost: string;
  storedHost: string | null | undefined;
  storedToken: string | null | undefined;
}): boolean {
  if (!opts.storedToken || !opts.storedHost) return false;
  return normalizeHost(opts.storedHost) === normalizeHost(opts.targetHost);
}
