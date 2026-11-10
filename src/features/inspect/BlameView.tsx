import { Editor, type OnMount } from '@monaco-editor/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { languageFor, relativeTime, splitPath } from '../../lib/format'
import { useActiveGit, useRepoStore } from '../../store/repo.store'
import type { BlameResult } from '../../types/git'
import { ViewHeader } from './ViewHeader'

type EditorInstance = Parameters<OnMount>[0]
type MonacoApi = Parameters<OnMount>[1]

const GUTTER_CHARS = 28
/** The gutter collapses normal spaces, so labels are padded with non-breaking ones */
const NBSP = '\u00a0'
const AGE_STEPS = 5

/**
 * The file with, in the gutter, the commit that last changed each block of lines. The coloured bar
 * shows age (brighter = more recent); hover it for details, click a block to open its commit.
 */
export function BlameView({ path, rev }: { path: string; rev?: string }) {
  const git = useActiveGit()
  const setOpenDiff = useRepoStore((s) => s.setOpenDiff)
  const focusCommit = useRepoStore((s) => s.focusCommit)
  const [data, setData] = useState<BlameResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<EditorInstance | null>(null)
  const monacoRef = useRef<MonacoApi | null>(null)
  const decorations = useRef<string[]>([])
  const [mounted, setMounted] = useState(false)
  /** Line under the mouse (or the cursor): its commit is described in the bar at the bottom */
  const [line, setLine] = useState<number | null>(null)

  useEffect(() => {
    if (!git) return
    let cancelled = false
    setData(null)
    setError(null)
    git
      .blame(path, rev)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [git, path, rev])

  const text = useMemo(() => data?.lines.map((l) => l.text).join('\n') ?? '', [data])

  /** Gutter label per line: shown on the first line of each block of lines from the same commit */
  const labels = useMemo(() => {
    if (!data) return []
    return data.lines.map((l, i) => {
      if (i > 0 && data.lines[i - 1].hash === l.hash) return ''
      const c = data.commits[l.hash]
      if (!c) return ''
      const hash = isLocal(c.hash) ? 'local'.padEnd(7, NBSP) : c.hash.slice(0, 7)
      const author = c.author.length > 12 ? c.author.slice(0, 11) + '…' : c.author.padEnd(12, NBSP)
      return `${hash}${NBSP}${author}${NBSP}${shortAge(c.date)}`
    })
  }, [data])

  // Age bar + hover details
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco || !data) return
    const times = Object.values(data.commits).map((c) => new Date(c.date).getTime())
    const min = Math.min(...times)
    const max = Math.max(...times)
    const deco = data.lines.map((l, i) => {
      const c = data.commits[l.hash]
      const t = c ? new Date(c.date).getTime() : min
      const step = max === min ? AGE_STEPS - 1 : Math.round(((t - min) / (max - min)) * (AGE_STEPS - 1))
      const first = i === 0 || data.lines[i - 1].hash !== l.hash
      return {
        range: new monaco.Range(i + 1, 1, i + 1, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: `blame-age-${step}${first ? ' blame-block-start' : ''}`,
        },
      }
    })
    decorations.current = editor.deltaDecorations(decorations.current, deco)
  }, [data, mounted])

  const { dir, name } = splitPath(path)
  const committed = data ? Object.values(data.commits).filter((c) => !isLocal(c.hash)) : []
  const authors = new Set(committed.map((c) => c.author)).size
  const hovered = data && line ? data.commits[data.lines[line - 1]?.hash ?? ''] : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader
        icon="search"
        title={
          <>
            Blame <span className="text-muted">{dir}</span>
            <span className="font-semibold">{name}</span>
            <span className="ml-2 rounded bg-panel-2 px-1.5 py-0.5 font-sans text-[10px] text-muted uppercase">
              {rev ? rev.slice(0, 7) : 'working copy'}
            </span>
          </>
        }
        info={data ? `${committed.length} commit${committed.length === 1 ? '' : 's'} · ${authors} author${authors === 1 ? '' : 's'}` : undefined}
        actions={[{ icon: 'history', label: 'History', onClick: () => setOpenDiff({ kind: 'history', path }) }]}
        onClose={() => setOpenDiff(null)}
      />
      {data?.tooLarge && (
        <div className="shrink-0 bg-warn/15 px-3 py-1 text-xs text-warn">File is large; only the first 2 MB is shown.</div>
      )}
      <div className="blame-editor relative min-h-0 flex-1">
        {error ? (
          <div className="flex h-full items-center justify-center text-danger">{error}</div>
        ) : !data ? (
          <div className="flex h-full items-center justify-center text-muted">Loading blame…</div>
        ) : (
          <Editor
            theme="gitfy-dark"
            value={text}
            language={languageFor(path)}
            loading={<div className="flex h-full items-center justify-center text-muted">Loading editor…</div>}
            onMount={(editor, monaco) => {
              editorRef.current = editor
              monacoRef.current = monaco
              setMounted(true)
              editor.onMouseMove((e) => e.target.position && setLine(e.target.position.lineNumber))
              editor.onDidChangeCursorPosition((e) => setLine(e.position.lineNumber))
              // Click a block's label to open its commit
              editor.onMouseDown((e) => {
                const t = e.target.type
                if (t !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS && t !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
                const line = e.target.position?.lineNumber
                const hash = line ? data.lines[line - 1]?.hash : null
                if (hash && !isLocal(hash)) focusCommit(hash)
              })
            }}
            options={{
              readOnly: true,
              domReadOnly: true,
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 12.5,
              lineHeight: 20,
              fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
              glyphMargin: true,
              lineNumbers: (n) => labels[n - 1] ?? '',
              lineNumbersMinChars: GUTTER_CHARS,
              renderLineHighlight: 'none',
              folding: false,
            }}
          />
        )}
      </div>
      {/* What the line under the mouse comes from */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-panel px-3 text-[11.5px]">
        {hovered ? (
          isLocal(hovered.hash) ? (
            <span className="text-muted">Line {line}: changed in your working copy, not committed yet</span>
          ) : (
            <>
              <span className="font-mono text-accent">{hovered.hash.slice(0, 7)}</span>
              <span className="min-w-0 truncate">{hovered.summary}</span>
              <span className="shrink-0 text-muted">
                {hovered.author} · {new Date(hovered.date).toLocaleDateString()} ({relativeTime(hovered.date)})
              </span>
              <span className="ml-auto shrink-0 text-muted">click the label to open the commit</span>
            </>
          )
        ) : (
          <span className="text-muted">Point at a line to see which commit it comes from</span>
        )}
      </div>
    </div>
  )
}

/** The all-zero hash git blame uses for uncommitted lines */
function isLocal(hash: string): boolean {
  return /^0+$/.test(hash)
}

/** "3d", "5mo", "2y" — keeps the gutter narrow */
function shortAge(iso: string): string {
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000
  if (days < 1) return relativeTime(iso).startsWith('a few') ? 'now' : `${Math.max(1, Math.round(days * 24))}h`
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365)}y`
}
