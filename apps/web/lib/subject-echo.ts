/**
 * Detect when a click-resolved subject is just restating the parent page
 * title / seed query — the stuck-trail failure mode where every tap
 * regenerates the same theme.
 *
 * Mirrors `providers.llm.click.subject_echoes_parent` (CJK-safe normalize).
 */

function normalizeSubject(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    // Keep letters (incl. CJK) and digits; punctuation → space.
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Character bigram Dice coefficient on normalized strings (0..1). */
function bigramSimilarity(a: string, b: string): number {
  if (!a || !b) return a === b ? 1 : 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of ga) {
    overlap += Math.min(n, gb.get(g) ?? 0);
    total += n;
  }
  for (const n of gb.values()) total += n;
  return total === 0 ? 0 : (2 * overlap) / total;
}

const PARENT_ECHO_RATIO = 0.85;

/** True when `subject` is empty or a restatement of any parent title/query. */
export function subjectEchoesParent(
  subject: string,
  ...parents: Array<string | null | undefined>
): boolean {
  const sn = normalizeSubject(subject);
  if (!sn) return true;
  for (const p of parents) {
    if (!p?.trim()) continue;
    const pn = normalizeSubject(p);
    if (!pn) continue;
    if (sn === pn) return true;
    if (bigramSimilarity(sn, pn) >= PARENT_ECHO_RATIO) return true;
    // Compact CJK: only echo when the shorter string is a large fraction
    // of the longer (avoids rejecting "龙袍" inside a long emperor title).
    if (!sn.includes(" ") && !pn.includes(" ")) {
      const [shorter, longer] =
        sn.length <= pn.length ? [sn, pn] : [pn, sn];
      if (
        shorter.length >= 4 &&
        longer.includes(shorter) &&
        shorter.length / longer.length >= 0.55
      ) {
        return true;
      }
    }
  }
  return false;
}
