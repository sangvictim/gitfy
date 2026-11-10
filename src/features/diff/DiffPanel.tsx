import { useEffect, useRef, useState } from 'react'
import { DiffViewer, type DiffEditorInstance } from '../../components/DiffViewer'
import { Icon, type IconName } from '../../components/Icon'
import { cx } from '../../lib/format'
import { useActiveGit, useRepoStore, type FileDiffTarget } from '../../store/repo.store'
import { toast } from '../../store/toast.store'
import type { DiffContent, LineSelection } from '../../types/git'

type Side = 'old' | 'new'

/** Full-width diff shown in place of the graph */
export function DiffPanel({ target }: { target: FileDiffTarget }) {
  const setOpenDiff = useRepoStore((s) => s.setOpenDiff)
  const applyLines = useRepoStore((s) => s.applyLines)
  const busy = useRepoStore((s) => s.busy)
  const git = useActiveGit()
  // Working-copy diffs refresh whenever the status is polled (the file may have been edited)
  const status = useRepoStore((s) => (target.kind === 'working' ? s.status : null))
  const [diff, setDiff] = useState<DiffContent | null>(null)
  const [loading, setLoading] = useState(true)
  const editorRef = useRef<DiffEditorInstance | null>(null)
  /** The side the user last clicked / selected in: the selection that counts */
  const lastSide = useRef<Side>('new')

  useEffect(() => {
    if (!git) return
    let cancelled = false
    setLoading(true)
    const load =
      target.kind === 'working'
        ? git.fileDiff(target.path, target.staged, target.from)
        : git.commitFileDiff(target.hash, target.path, target.from)
    load
      .then((d) => {
        if (cancelled) return
        // Avoid resetting the editor if nothing changed
        setDiff((prev) =>
          prev && prev.path === d.path && prev.original === d.original && prev.modified === d.modified ? prev : d,
        )
      })
      .catch(() => !cancelled && setDiff(null))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [target, status, git])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenDiff(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpenDiff])

  const onEditor = (editor: DiffEditorInstance | null) => {
    editorRef.current = editor
    if (!editor) return
    editor.getOriginalEditor().onDidFocusEditorText(() => (lastSide.current = 'old'))
    editor.getModifiedEditor().onDidFocusEditorText(() => (lastSide.current = 'new'))
  }

  // Line staging only makes sense for a modified text file in the working copy
  const working = target.kind === 'working' ? target : null
  const file = working
    ? (working.staged ? status?.staged : status?.unstaged)?.find((f) => f.path === working.path)
    : null
  const partial = !!working && file?.type === 'modified' && !!diff && !diff.binary && !diff.tooLarge

  const run = (build: (editor: DiffEditorInstance, side: Side) => LineSelection | null) => {
    const editor = editorRef.current
    if (!editor || !working) return
    const sel = build(editor, lastSide.current)
    if (sel) applyLines(working.path, working.staged, sel)
    else toast.info('Click inside a change, or select some changed lines, first')
  }
  const verb = working?.staged ? 'Unstage' : 'Stage'

  const label =
    target.kind === 'working' ? (target.staged ? 'staged' : 'unstaged') : `commit ${target.hash.slice(0, 7)}`

  return (
    <DiffViewer
      diff={diff && diff.path === target.path ? diff : null}
      loading={loading}
      onClose={() => setOpenDiff(null)}
      onEditor={onEditor}
      title={
        <>
          <span className="mr-2 rounded bg-panel-2 px-1.5 py-0.5 font-sans text-[10px] text-muted uppercase">{label}</span>
          {target.from ? `${target.from} → ` : ''}
          {target.path}
        </>
      }
      actions={
        <div className="flex items-center gap-1">
          {partial && (
            <>
              <HeaderButton
                icon={working!.staged ? 'minus' : 'plus'}
                label={`${verb} hunk`}
                title={`${verb} the change block the cursor is in`}
                disabled={!!busy}
                onClick={() => run(hunkAtCursor)}
              />
              <HeaderButton
                icon={working!.staged ? 'minus' : 'plus'}
                label={`${verb} lines`}
                title={`${verb} only the selected lines (select them on either side first)`}
                disabled={!!busy}
                onClick={() => run(selectedLines)}
              />
              <div className="mx-1 h-4 w-px bg-border" />
            </>
          )}
          <HeaderButton
            icon="history"
            label="History"
            title="Commits that changed this file"
            onClick={() => setOpenDiff({ kind: 'history', path: target.path })}
          />
          <HeaderButton
            icon="search"
            label="Blame"
            title="Who last changed each line"
            onClick={() =>
              setOpenDiff({ kind: 'blame', path: target.path, rev: target.kind === 'commit' ? target.hash : undefined })
            }
          />
        </div>
      }
    />
  )
}

/** The hunk under the cursor, on whichever side was used last */
function hunkAtCursor(editor: DiffEditorInstance, side: Side): LineSelection | null {
  const ed = side === 'old' ? editor.getOriginalEditor() : editor.getModifiedEditor()
  const line = ed.getPosition()?.lineNumber
  return line ? { hunkAt: { side, line } } : null
}

/**
 * Selected lines -> line numbers on both sides. Lines picked on one side select those lines; a change
 * they touch also brings its lines on the other side along (selecting a replaced line stages both the
 * removal and the addition).
 */
function selectedLines(editor: DiffEditorInstance, side: Side): LineSelection | null {
  const ed = side === 'old' ? editor.getOriginalEditor() : editor.getModifiedEditor()
  const ranges = (ed.getSelections() ?? []).map((s) => {
    // A selection ending at column 1 of the next line doesn't include that line
    const end = s.endColumn === 1 && s.endLineNumber > s.startLineNumber ? s.endLineNumber - 1 : s.endLineNumber
    return [s.startLineNumber, end] as const
  })
  const oldLines = new Set<number>()
  const newLines = new Set<number>()
  for (const c of editor.getLineChanges() ?? []) {
    const mine = side === 'old' ? [c.originalStartLineNumber, c.originalEndLineNumber] : [c.modifiedStartLineNumber, c.modifiedEndLineNumber]
    const other = side === 'old' ? [c.modifiedStartLineNumber, c.modifiedEndLineNumber] : [c.originalStartLineNumber, c.originalEndLineNumber]
    const mineSet = side === 'old' ? oldLines : newLines
    const otherSet = side === 'old' ? newLines : oldLines
    for (const [a, b] of ranges) {
      let touched = false
      if (mine[1] === 0) {
        // Nothing on this side (pure addition / removal): it sits right after line mine[0]
        touched = mine[0] >= a - 1 && mine[0] <= b
      } else {
        for (let l = Math.max(a, mine[0]); l <= Math.min(b, mine[1]); l++) {
          mineSet.add(l)
          touched = true
        }
      }
      if (touched && other[1] !== 0) for (let l = other[0]; l <= other[1]; l++) otherSet.add(l)
    }
  }
  if (!oldLines.size && !newLines.size) return null
  return { oldLines: [...oldLines], newLines: [...newLines] }
}

function HeaderButton({
  icon,
  label,
  title,
  disabled,
  onClick,
}: {
  icon: IconName
  label: string
  title: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        'flex h-6 items-center gap-1 rounded px-1.5 font-sans text-[11px] text-muted hover:bg-panel-2 hover:text-fg disabled:opacity-50',
      )}
    >
      <Icon name={icon} size={12} />
      {label}
    </button>
  )
}
