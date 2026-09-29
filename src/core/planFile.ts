// src/core/planFile.ts — where a run's PLAN is written: one file per invocation, never a name a later run can reuse.
//
// A plan is the undo of a write that inserts no row (a state flip, a name overwritten in place), so it has to outlive
// the run. On 29 Sep 2026 two plans died two different ways in one afternoon: run 1350's was left in a deploy tree the
// next-but-one deploy deleted (deploy.sh now carries data/dryrun across), and run 1359's was OVERWRITTEN by the dry run
// that confirmed it, because both were named `<stem>-<date>.tsv`. Both were rebuilt (from the append-only store, and
// from the nightly dump) and marked RECONSTRUCTED. With the time to the millisecond in the name, a dry run and the commit
// after it write different files, and the run's inputs name the exact one.
import path from "node:path";

/** data/dryrun/<stem>-<YYYY-MM-DD>T<HHMMSSmmm>Z.tsv under `root`. */
export function planFile(root: string, stem: string, at: Date = new Date()): string {
  const iso = at.toISOString();                                   // 2026-09-29T11:55:22.483Z
  const stamp = `${iso.slice(0, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}${iso.slice(20, 23)}Z`;   // to the millisecond
  return path.join(root, "data", "dryrun", `${stem}-${stamp}.tsv`);
}
