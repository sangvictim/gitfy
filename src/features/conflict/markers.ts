/**
 * Find git conflict blocks in a file, by line number:
 *
 *   <<<<<<< HEAD          ← start
 *   current (ours)
 *   ||||||| base          ← base (only with merge.conflictStyle=diff3 / zdiff3)
 *   base
 *   =======               ← mid
 *   incoming (theirs)
 *   >>>>>>> feature       ← end
 */

/** Line numbers are 1-based, like Monaco's */
export interface ConflictBlock {
  start: number
  base: number | null
  mid: number
  end: number
}

export type Choice = 'ours' | 'theirs' | 'both' | 'none'

const START = /^<{7}(?:\s|$)/
const BASE = /^\|{7}(?:\s|$)/
const MID = /^={7}\s*$/
const END = /^>{7}(?:\s|$)/

/** `lines` without line endings (e.g. `model.getLinesContent()` or `text.split(/\r?\n/)`) */
export function findBlocks(lines: string[]): ConflictBlock[] {
  const blocks: ConflictBlock[] = []
  let i = 0
  while (i < lines.length) {
    if (!START.test(lines[i])) {
      i++
      continue
    }
    let base: number | null = null
    let mid = -1
    let end = -1
    let j = i + 1
    for (; j < lines.length; j++) {
      const l = lines[j]
      if (START.test(l)) break // a new block starts: this one is broken
      if (mid === -1 && base === null && BASE.test(l)) base = j
      else if (mid === -1 && MID.test(l)) mid = j
      else if (mid !== -1 && END.test(l)) {
        end = j
        break
      }
    }
    if (mid !== -1 && end !== -1) {
      blocks.push({ start: i + 1, base: base === null ? null : base + 1, mid: mid + 1, end: end + 1 })
      i = end + 1
    } else {
      i = j // skip the broken marker
    }
  }
  return blocks
}

export function countBlocks(text: string): number {
  return findBlocks(text.split(/\r?\n/)).length
}

/** Lines that replace the block for a choice */
export function keptLines(lines: string[], b: ConflictBlock, choice: Choice): string[] {
  const ours = lines.slice(b.start, (b.base ?? b.mid) - 1)
  const theirs = lines.slice(b.mid, b.end - 1)
  switch (choice) {
    case 'ours':
      return ours
    case 'theirs':
      return theirs
    case 'both':
      return [...ours, ...theirs]
    case 'none':
      return []
  }
}
