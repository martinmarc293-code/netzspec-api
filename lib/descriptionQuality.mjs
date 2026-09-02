// lib/descriptionQuality.mjs — decide whether an extracted product description is publishable.
//
// Single source of truth, imported by both the apply script and its test. The rules exist
// because the first extraction run over the cache produced, alongside 75,699 good
// descriptions, two junk classes that would have gone straight onto live pages:
//
//   69 parts described as "VOID"
//   120 parts described as "SFP+ 10Gbps-RPHY; dist = ddK km; ITU nn.n"
//
// The second is the dangerous one: it reads as a real spec until you notice "ddK" and
// "nn.n" are Cisco's fill-in-the-blank placeholders in a template row. A description like
// that on a product page is worse than none, because it looks authoritative.
//
// Every rule returns a REASON, so a rejection can be audited and so the test can assert
// that a given input is rejected for the RIGHT reason rather than by luck.

// Literal placeholder tokens Cisco uses in template rows. Written as explicit character
// classes rather than word-boundary escapes -- \b through a shell heredoc becomes 0x08 and
// silently matches nothing (CLAUDE.md section 4), so the pattern avoids the construct entirely.
const PLACEHOLDER_TOKENS = [
  "ddk", "dd k", "nn.n", "nnn", "xx.x", "xxx", "yyy", "zzz",
  "tbd", "to be determined", "placeholder", "lorem ipsum",
];

// Whole-value rejects: the cell is present but says nothing about a product.
const VOID_VALUES = new Set([
  "void", "n/a", "na", "none", "not applicable", "reserved", "spare", "blank",
  "no description", "description", "product description", "-", "--", "---", "tbd",
]);

// A description that is only a part number repeats what the page already shows. It must
// contain a LETTER to count as a PID -- otherwise "10/100/1000", which is a speed triple
// and not a part number at all, gets rejected as "pid_only" and sends whoever reads the
// rejection log looking for the wrong problem.
const PID_ONLY = /^[A-Z0-9]+(?:[-/=+.][A-Z0-9]+)*=?$/i;
const HAS_LETTER = /[A-Za-z]/;

// Rule ORDER is part of the contract, not an implementation detail: each input must be
// rejected for the reason that actually describes it. "VOID" is four characters, so a
// length check placed first would call it too_short and hide what it really is.
export function describeQuality(desc, sku = "") {
  if (desc == null) return { ok: false, reason: "missing" };
  const raw = String(desc);
  const text = raw.replace(/\s+/g, " ").trim();

  if (!text) return { ok: false, reason: "empty" };
  if (VOID_VALUES.has(text.toLowerCase())) return { ok: false, reason: "void_value" };
  if (text.length < 6) return { ok: false, reason: "too_short" };
  if (text.length > 400) return { ok: false, reason: "too_long" };

  if (sku && text.toUpperCase() === String(sku).toUpperCase()) {
    return { ok: false, reason: "same_as_sku" };
  }
  if (!/ /.test(text) && PID_ONLY.test(text) && HAS_LETTER.test(text)) {
    return { ok: false, reason: "pid_only" };
  }

  // A run of repeated fill characters ("....", "____", "xxxx") is a template artefact.
  // Checked before the prose test: "Switch......" has only one real word, so a prose-first
  // order would report it as not_prose and hide that the defect is the filler run.
  if (/(.)\1{5,}/.test(text)) return { ok: false, reason: "repeated_filler" };

  // No word-like tokens at all: a code fragment or a number series, not a description.
  const words = text.match(/[A-Za-z]{2,}/g) || [];
  if (words.length < 2) return { ok: false, reason: "not_prose" };

  const lower = text.toLowerCase();
  for (const tok of PLACEHOLDER_TOKENS) {
    // Surround-check without word-boundary escapes: the token must not be embedded inside a
    // longer alphanumeric run, or "nnn" would fire on a legitimate "ANNNEX" style string.
    let from = 0;
    for (;;) {
      const i = lower.indexOf(tok, from);
      if (i < 0) break;
      const before = i === 0 ? " " : lower[i - 1];
      const after = i + tok.length >= lower.length ? " " : lower[i + tok.length];
      const alnum = (c) => /[a-z0-9]/.test(c);
      if (!alnum(before) && !alnum(after)) {
        return { ok: false, reason: `placeholder:${tok}` };
      }
      from = i + 1;
    }
  }

  return { ok: true, reason: "ok", text };
}

export const PLACEHOLDER_TOKENS_FOR_TEST = PLACEHOLDER_TOKENS;
