import type { Commit } from '../types/git'

/** Case-insensitive match on subject, body, author name/e-mail, or a hash prefix */
export function commitMatches(c: Commit, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (/^[0-9a-f]{4,40}$/.test(q) && c.hash.startsWith(q)) return true
  return (
    c.subject.toLowerCase().includes(q) ||
    c.body.toLowerCase().includes(q) ||
    c.authorName.toLowerCase().includes(q) ||
    c.authorEmail.toLowerCase().includes(q)
  )
}
