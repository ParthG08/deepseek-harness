/**
 * Dependency-free subsequence fuzzy matcher. Case-insensitive; rewards
 * consecutive runs and matches at word boundaries, and mildly prefers shorter
 * targets and earlier matches so ties resolve sensibly.
 */

/** One successful match: a score (higher is better) and the matched indices in the target. */
export interface FuzzyMatch {
  score: number
  indices: number[]
}

/** Characters that count as a word boundary for the boundary bonus. */
const BOUNDARY = /[\s\-_/.]/

/**
 * Match `query` as a subsequence of `target`.
 * @param query - non-empty user query.
 * @param target - candidate string to match against.
 * @returns the match, or null when the query is not a subsequence of the target.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  const indices: number[] = []
  let score = 0
  let from = 0
  let previous = -1

  for (const ch of q) {
    let found = -1
    for (let i = from; i < t.length; i++) {
      if (t[i] === ch) {
        found = i
        break
      }
    }
    if (found === -1) return null

    if (found === previous + 1) score += 8
    if (found === 0 || BOUNDARY.test(target[found - 1] ?? '')) score += 10
    score += 1

    indices.push(found)
    previous = found
    from = found + 1
  }

  score -= target.length * 0.05
  score -= (indices[0] ?? 0) * 0.2
  return { score, indices }
}
