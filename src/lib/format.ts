const LANGS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', markdown: 'markdown',
  css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', dart: 'dart',
  sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
  xml: 'xml', svg: 'xml', sql: 'sql', graphql: 'graphql', dockerfile: 'dockerfile', lua: 'lua',
}

export function languageFor(path: string): string {
  const base = path.split('/').pop()?.toLowerCase() ?? ''
  if (base === 'dockerfile') return 'dockerfile'
  if (base === 'makefile') return 'makefile'
  const ext = base.includes('.') ? base.split('.').pop()! : ''
  return LANGS[ext] ?? 'plaintext'
}

/** "a few seconds ago", "5 minutes ago", "an hour ago", "21 hours ago", "yesterday", "3 days ago", "a week ago"… */
export function relativeTime(iso: string): string {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  const min = sec / 60
  const hr = min / 60
  const day = hr / 24
  const plural = (n: number, unit: string, one: string) => (n <= 1 ? `${one} ${unit} ago` : `${n} ${unit}s ago`)
  if (sec < 45) return 'a few seconds ago'
  if (min < 45) return plural(Math.max(1, Math.round(min)), 'minute', 'a')
  if (hr < 22) return plural(Math.max(1, Math.round(hr)), 'hour', 'an')
  if (hr < 36) return 'yesterday'
  const days = Math.round(day)
  if (days < 7) return `${days} days ago`
  if (days < 30) return plural(Math.round(days / 7), 'week', 'a')
  if (day < 365) return plural(Math.max(1, Math.round(day / 30)), 'month', 'a')
  return plural(Math.max(1, Math.round(day / 365)), 'year', 'a')
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/')
  return i === -1 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) }
}

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}
