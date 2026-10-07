// src/core/printedPid.ts — is a PID PRINTED on a page, as an exact token? (reviewer ruling (C), 7 Oct 2026)
//
// The ruling's boundary, verbatim: "an exact match only, so C8200-1N-4T must not link from C8200-1N-4T= or C8200-1N-4T-xx, and
// the reverse." A PID is made of [a-z0-9-/+.=] (lower-cased); a token is a maximal run of those characters with trailing
// ".", "-" and "/" removed (a sentence's full stop, a dangling hyphen). So "C8200-1N-4T=" is one token and never the base's, and
// "C8200-1N-4T-xx" is one token and never "C8200-1N-4T".
//
// TWO IMPLEMENTATIONS ON PURPOSE: pageTokens() splits the page once (fast, used to plan), printedAt() searches with explicit
// lookarounds (\b is wrong for product strings), and the link writer's gate requires both to agree on every planned link.
// Input text is cachedText()'s: entity-decoded, whitespace-collapsed, lower-cased.

const SPLIT = /[^a-z0-9\-\/+.=]+/;
const PID_SHAPE = /^[a-z0-9\-\/+.=]+$/;

/** The key a SKU is matched by: lower-cased, or null when it holds a character no token can (a space, a bracket) or ENDS in one a
 *  token sheds (". - /"): such a key can never equal a token, so no link is honest -- the 7 Oct dry run met catalogue rows like
 *  "C8151-CVAP-G2/", where the lookaround matched the head of "C8151-CVAP-G2/..." and the token set could not. */
export function pidKey(sku: string): string | null {
  const k = sku.trim().toLowerCase();
  return PID_SHAPE.test(k) && /[a-z0-9]/.test(k) && !/[.\-\/]$/.test(k) ? k : null;
}

/** Every token on the page. */
export function pageTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(SPLIT)) {
    const t = raw.replace(/[.\-\/]+$/, "");
    if (t) out.add(t);
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
/** Where the key is printed as a whole token, or -1. Before it: the start or a character no PID holds. After it: the end, a
 *  character no PID holds, or a run of ". - /" that is itself followed by one of those (the trailing characters a token sheds). */
export function printedAt(text: string, key: string): number {
  const re = new RegExp(`(?<![a-z0-9\\-\\/+.=])${esc(key)}(?=$|[^a-z0-9\\-\\/+.=]|[.\\-\\/]+(?:$|[^a-z0-9\\-\\/+.=]))`);
  const m = re.exec(text);
  return m ? m.index : -1;
}
