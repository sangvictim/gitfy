import { Editor, type OnMount } from '@monaco-editor/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { cx, languageFor, splitPath } from '../../lib/format'
import { useActiveGit, useRepoStore } from '../../store/repo.store'
import type { ConflictDetail, ConflictResolution } from '../../types/git'
import { describeConflict, isTextConflict, sideNames } from './labels'
import { countBlocks, findBlocks, keptLines, type Choice, type ConflictBlock } from './markers'

type Names = { ours: string; theirs: string }
type EditorInstance = Parameters<OnMount>[0]
type MonacoApi = Parameters<OnMount>[1]

/**
 * Resolve one conflicted file. Text files open in an editor showing the whole file, with every
 * conflict highlighted and "Accept current | incoming | both" actions above it; the file can also be
 * edited freely. Binary / deleted / too-large files offer keeping one side's whole file instead.
 */
export function ConflictResolver({ path }: { path: string }) {
  const git = useActiveGit()
  const status = useRepoStore((s) => s.status)
  const setOpenDiff = useRepoStore((s) => s.setOpenDiff)
  const openConflict = useRepoStore((s) => s.openConflict)
  const resolveConflict = useRepoStore((s) => s.resolveConflict)
  const busy = useRepoStore((s) => s.busy)
  const names = sideNames(status)

  const [detail, setDetail] = useState<ConflictDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<EditorInstance | null>(null)
  const loadId = useRef(0)

  const load = useCallback(() => {
    if (!git) return
    const id = ++loadId.current
    setError(null)
    git
      .conflict(path)
      .then((d) => {
        if (id !== loadId.current) return
        setDetail(d)
        setText(d.working)
      })
      .catch((e) => id === loadId.current && setError(e instanceof Error ? e.message : String(e)))
  }, [git, path])

  useEffect(load, [load])

  const remaining = countBlocks(text)

  const resolve = async (resolution: ConflictResolution) => {
    setSaving(true)
    try {
      await resolveConflict(path, resolution)
    } finally {
      setSaving(false)
    }
  }

  /** Accept the same side for every remaining conflict (one undo step) */
  const acceptAll = (choice: Choice) => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    const lines = model.getLinesContent()
    editor.pushUndoStop()
    editor.executeEdits(
      'conflict',
      findBlocks(lines).map((b) => blockEdit(model, lines, b, choice)),
    )
    editor.pushUndoStop()
  }

  /** Jump to the next (or previous) conflict after the cursor */
  const jump = (dir: 1 | -1) => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    const blocks = findBlocks(model.getLinesContent())
    if (!blocks.length) return
    const line = editor.getPosition()?.lineNumber ?? 0
    const target =
      dir === 1
        ? (blocks.find((b) => b.start > line) ?? blocks[0])
        : ([...blocks].reverse().find((b) => b.start < line) ?? blocks[blocks.length - 1])
    editor.setPosition({ lineNumber: target.start, column: 1 })
    editor.revealLineInCenter(target.start)
    editor.focus()
  }

  const files = status?.conflicted ?? []
  const idx = files.indexOf(path)
  const disabled = saving || !!busy
  const textMode =
    !!detail &&
    isTextConflict(detail.kind) &&
    !detail.binary &&
    !detail.tooLarge &&
    detail.ours !== null &&
    detail.theirs !== null
  const { dir, name } = splitPath(path)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* File header */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Icon name="alert" size={15} className="shrink-0 text-danger" />
        <div className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
          <span className="text-muted">{dir}</span>
          <span className="font-semibold text-fg">{name}</span>
        </div>
        {detail && (
          <span className="shrink-0 rounded bg-panel-2 px-2 py-0.5 text-[11px] text-muted">
            {describeConflict(detail.kind, names.ours, names.theirs)}
          </span>
        )}
        {files.length > 1 && idx !== -1 && (
          <div className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted">
            <button
              onClick={() => openConflict(files[(idx - 1 + files.length) % files.length])}
              className="rounded p-1 hover:bg-panel-2 hover:text-fg"
              title="Previous conflicted file"
              aria-label="Previous conflicted file"
            >
              <Icon name="close" size={13} />
            </button>
            <span>
              file {idx + 1} of {files.length}
            </span>
            <button
              onClick={() => openConflict(files[(idx + 1) % files.length])}
              className="rounded p-1 hover:bg-panel-2 hover:text-fg"
              title="Next conflicted file"
              aria-label="Next conflicted file"
            >
              <Icon name="chevron" size={13} />
            </button>
          </div>
        )}
        <button
          onClick={() => setOpenDiff(null)}
          className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg"
          title="Close (changes not yet marked as resolved are discarded)"
          aria-label="Close conflict"
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      {error ? (
        <Centered>
          <p className="text-danger">{error}</p>
          <Button size="sm" onClick={load}>
            Try again
          </Button>
        </Centered>
      ) : !detail ? (
        <Centered>
          <p className="text-muted">Loading conflict…</p>
        </Centered>
      ) : !textMode ? (
        <WholeFileChoice detail={detail} names={names} disabled={disabled} onResolve={resolve} />
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex shrink-0 items-center gap-1 overflow-hidden border-b border-border bg-panel px-3 py-1.5 whitespace-nowrap">
            <span
              className={cx(
                'mr-1 rounded px-2 py-0.5 text-[11.5px] font-medium',
                remaining ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok',
              )}
            >
              {remaining ? `${remaining} conflict${remaining === 1 ? '' : 's'} left` : 'No conflicts left'}
            </span>
            <Button size="sm" variant="ghost" disabled={!remaining} onClick={() => jump(-1)} title="Previous conflict">
              <Icon name="up" size={13} />
            </Button>
            <Button size="sm" variant="ghost" disabled={!remaining} onClick={() => jump(1)} title="Next conflict">
              <Icon name="down" size={13} />
            </Button>
            <div className="mx-1 h-4 w-px bg-border" />
            <Button size="sm" variant="ghost" disabled={!remaining} onClick={() => acceptAll('ours')} title={`Keep ${names.ours}'s side of every conflict`}>
              <span className="text-ok">All current</span>
            </Button>
            <Button size="sm" variant="ghost" disabled={!remaining} onClick={() => acceptAll('theirs')} title={`Keep ${names.theirs}'s side of every conflict`}>
              <span className="text-accent">All incoming</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={load} title="Throw away your changes and reload the file from disk">
              <Icon name="refresh" size={13} /> Reset
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="primary"
              disabled={disabled || remaining > 0}
              onClick={() => resolve({ content: text })}
              title={remaining > 0 ? 'Handle every conflict in this file first' : 'Save the file and mark it as resolved'}
            >
              <Icon name="check" size={13} /> Mark as resolved
            </Button>
          </div>
          <p className="flex shrink-0 items-center gap-x-3 overflow-hidden border-b border-border px-3 py-1 text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-ok/60" /> Current · {names.ours}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-accent/60" /> Incoming · {names.theirs}
            </span>
            <span className="truncate">Pick a side with the actions above each conflict, or edit the file directly (Ctrl+Z undoes).</span>
          </p>
          <ConflictEditor
            key={path}
            path={path}
            text={text}
            names={names}
            onChange={setText}
            onMount={(e) => (editorRef.current = e)}
          />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The editor: whole file, conflicts highlighted, actions above each one
// ---------------------------------------------------------------------------

type Model = NonNullable<ReturnType<EditorInstance['getModel']>>

/** Edit replacing a whole conflict block (markers included) with the chosen side */
function blockEdit(model: Model, lines: string[], b: ConflictBlock, choice: Choice) {
  const kept = keptLines(lines, b, choice)
  const eol = model.getEOL()
  const last = b.end >= model.getLineCount()
  // Monaco ranges are 1-based; the block's lines are replaced together with their line breaks
  const range = last
    ? { startLineNumber: b.start, startColumn: 1, endLineNumber: b.end, endColumn: model.getLineMaxColumn(b.end) }
    : { startLineNumber: b.start, startColumn: 1, endLineNumber: b.end + 1, endColumn: 1 }
  const text = last ? kept.join(eol) : kept.map((l) => l + eol).join('')
  return { range, text, forceMoveMarkers: true }
}

function ConflictEditor({
  path,
  text,
  names,
  onChange,
  onMount,
}: {
  path: string
  text: string
  names: Names
  onChange: (t: string) => void
  onMount: (e: EditorInstance) => void
}) {
  const editorRef = useRef<EditorInstance | null>(null)
  const monacoRef = useRef<MonacoApi | null>(null)
  const decorations = useRef<string[]>([])
  const zones = useRef<string[]>([])
  const widgets = useRef<Parameters<EditorInstance['addContentWidget']>[0][]>([])
  const [mounted, setMounted] = useState(false)
  const namesRef = useRef(names)
  namesRef.current = names

  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = editor?.getModel()
    if (!editor || !monaco || !model) return
    const lines = model.getLinesContent()
    const blocks = findBlocks(lines)

    // Colours: a strong header / footer line, tinted bodies, and marks in the scrollbar
    const deco: Parameters<EditorInstance['deltaDecorations']>[1] = []
    const whole = (from: number, to: number, className: string, ruler?: string) => {
      if (to < from) return
      deco.push({
        range: new monaco.Range(from, 1, to, 1),
        options: {
          isWholeLine: true,
          className,
          ...(ruler && {
            overviewRuler: { color: ruler, position: monaco.editor.OverviewRulerLane.Full },
            minimap: { color: ruler, position: monaco.editor.MinimapPosition.Inline },
          }),
        },
      })
    }
    const label = (line: number, content: string, cls: string) =>
      deco.push({
        range: new monaco.Range(line, model.getLineMaxColumn(line), line, model.getLineMaxColumn(line)),
        options: { showIfCollapsed: true, after: { content, inlineClassName: cls } },
      })
    for (const b of blocks) {
      whole(b.start, b.start, 'conflict-head-ours')
      label(b.start, `   (Current Change · ${namesRef.current.ours})`, 'conflict-label-ours')
      whole(b.start + 1, (b.base ?? b.mid) - 1, 'conflict-ours', '#3fb950aa')
      if (b.base !== null) {
        whole(b.base, b.base, 'conflict-head-base')
        label(b.base, '   (Common Ancestor)', 'conflict-label-base')
        whole(b.base + 1, b.mid - 1, 'conflict-base')
      }
      whole(b.mid, b.mid, 'conflict-sep')
      whole(b.mid + 1, b.end - 1, 'conflict-theirs', '#6d8bffaa')
      whole(b.end, b.end, 'conflict-head-theirs')
      label(b.end, `   (Incoming Change · ${namesRef.current.theirs})`, 'conflict-label-theirs')
    }
    decorations.current = editor.deltaDecorations(decorations.current, deco)

    // An action bar above every conflict: a view zone makes room, a content widget (which, unlike
    // a zone, receives mouse clicks) holds the buttons
    const choose = (start: number, choice: Choice) => {
      // Re-read the block: the user may have edited the file since the bar was drawn
      const now = model.getLinesContent()
      const target = findBlocks(now).find((x) => x.start === start)
      if (!target) return
      editor.pushUndoStop()
      editor.executeEdits('conflict', [blockEdit(model, now, target, choice)])
      editor.pushUndoStop()
      editor.focus()
    }
    editor.changeViewZones((acc) => {
      zones.current.forEach((z) => acc.removeZone(z))
      zones.current = blocks.map((b) =>
        acc.addZone({ afterLineNumber: b.start - 1, heightInPx: ACTION_BAR_HEIGHT, domNode: document.createElement('div') }),
      )
    })
    widgets.current.forEach((w) => editor.removeContentWidget(w))
    widgets.current = blocks.map((b, i) => {
      const node = actionBar(i + 1, blocks.length, (c) => choose(b.start, c))
      const widget = {
        getId: () => `gitfy.conflict.${i}`,
        getDomNode: () => node,
        getPosition: () => ({
          position: { lineNumber: b.start, column: 1 },
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
        }),
      }
      editor.addContentWidget(widget)
      return widget
    })
  }, [text, mounted])

  return (
    <div className="relative min-h-0 flex-1">
      <Editor
        theme="gitfy-dark"
        value={text}
        language={languageFor(path)}
        onChange={(v) => onChange(v ?? '')}
        onMount={(editor, monaco) => {
          editorRef.current = editor
          monacoRef.current = monaco
          onMount(editor)
          setMounted(true)
          // Start at the first conflict
          const first = findBlocks(editor.getModel()?.getLinesContent() ?? [])[0]
          if (first) {
            editor.setPosition({ lineNumber: first.start, column: 1 })
            editor.revealLineNearTop(first.start)
          }
        }}
        loading={<Centered>Loading editor…</Centered>}
        options={{
          automaticLayout: true,
          minimap: { enabled: true, renderCharacters: false, scale: 1 },
          scrollBeyondLastLine: false,
          fontSize: 12.5,
          lineHeight: 20,
          fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
          renderLineHighlight: 'none',
          // The highlight already shows the blocks; these just add noise
          occurrencesHighlight: 'off',
          selectionHighlight: false,
        }}
      />
    </div>
  )
}

const ACTION_BAR_HEIGHT = 24

/** DOM for the bar above a conflict (Monaco widgets take plain DOM nodes) */
function actionBar(n: number, total: number, onChoose: (c: Choice) => void): HTMLElement {
  // Monaco sets its own inline styles on the widget node, so the flex layout goes on a child
  const zone = document.createElement('div')
  const bar = document.createElement('div')
  bar.className = 'conflict-actions'
  bar.style.height = `${ACTION_BAR_HEIGHT}px`
  zone.appendChild(bar)
  const title = document.createElement('span')
  title.className = 'conflict-actions-title'
  title.textContent = `Conflict ${n} of ${total}`
  bar.appendChild(title)
  const actions: [string, Choice, string][] = [
    ['Accept Current Change', 'ours', 'conflict-action-ours'],
    ['Accept Incoming Change', 'theirs', 'conflict-action-theirs'],
    ['Accept Both Changes', 'both', ''],
    ['Discard Both', 'none', 'conflict-action-muted'],
  ]
  actions.forEach(([label, choice, cls], i) => {
    if (i > 0) {
      const sep = document.createElement('span')
      sep.className = 'conflict-actions-sep'
      sep.textContent = '|'
      bar.appendChild(sep)
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = label
    btn.className = `conflict-action ${cls}`
    // The editor would otherwise take the mouse down and move the cursor instead
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      onChoose(choice)
    })
    bar.appendChild(btn)
  })
  return zone
}

// ---------------------------------------------------------------------------
// Binary / deleted / too-large files: keep one side's whole file
// ---------------------------------------------------------------------------

const TONES = {
  ok: { head: 'text-ok', bg: 'bg-ok/[0.06]', btn: 'border-ok/40 text-ok hover:bg-ok/15' },
  accent: { head: 'text-accent', bg: 'bg-accent/[0.06]', btn: 'border-accent/40 text-accent hover:bg-accent/15' },
}

function WholeFileChoice({
  detail,
  names,
  disabled,
  onResolve,
}: {
  detail: ConflictDetail
  names: Names
  disabled: boolean
  onResolve: (r: ConflictResolution) => void
}) {
  const reason = detail.binary
    ? "This is a binary file, so its changes can't be combined line by line."
    : detail.tooLarge
      ? 'This file is too large to edit here.'
      : describeConflict(detail.kind, names.ours, names.theirs) + '.'
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <p className="mb-1 font-medium">Choose which version of the file to keep</p>
      <p className="mb-5 text-xs text-muted">{reason}</p>
      <div className="grid grid-cols-2 gap-4">
        <VersionCard
          tone="ok"
          title="Current"
          name={names.ours}
          content={detail.ours}
          binary={detail.binary}
          disabled={disabled}
          onPick={() => onResolve({ side: 'ours' })}
        />
        <VersionCard
          tone="accent"
          title="Incoming"
          name={names.theirs}
          content={detail.theirs}
          binary={detail.binary}
          disabled={disabled}
          onPick={() => onResolve({ side: 'theirs' })}
        />
      </div>
    </div>
  )
}

function VersionCard({
  tone,
  title,
  name,
  content,
  binary,
  disabled,
  onPick,
}: {
  tone: keyof typeof TONES
  title: string
  name: string
  content: string | null
  binary: boolean
  disabled: boolean
  onPick: () => void
}) {
  const t = TONES[tone]
  const deleted = content === null
  const preview = content?.split('\n').slice(0, 20).join('\n') ?? ''
  return (
    <div className={cx('flex min-w-0 flex-col overflow-hidden rounded-md border border-border', t.bg)}>
      <div className="flex items-center gap-1.5 px-3 pt-3 text-[11px] font-semibold tracking-wide uppercase">
        <span className={t.head}>{title}</span>
        <span className="truncate font-normal tracking-normal text-muted normal-case">· {name}</span>
      </div>
      <div className="flex-1 px-3 py-2">
        {deleted ? (
          <p className="flex items-center gap-1.5 text-sm text-danger">
            <Icon name="trash" size={14} /> File deleted on this side
          </p>
        ) : binary ? (
          <p className="text-sm text-muted">Binary file</p>
        ) : (
          <pre className="max-h-64 overflow-auto rounded bg-bg p-2 font-mono text-[11.5px] leading-5 whitespace-pre text-muted">
            {preview || '(empty file)'}
          </pre>
        )}
      </div>
      <div className="px-3 pb-3">
        <button
          disabled={disabled}
          onClick={onPick}
          className={cx('h-8 w-full rounded-md border text-[12.5px] font-medium disabled:opacity-50', t.btn)}
        >
          {deleted ? 'Delete the file' : `Keep ${title.toLowerCase()} version`}
        </button>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm">{children}</div>
}
