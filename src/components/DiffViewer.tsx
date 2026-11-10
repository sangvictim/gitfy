import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'
import { cx, languageFor } from '../lib/format'
import { Icon } from './Icon'
import type { DiffContent } from '../types/git'

export type DiffEditorInstance = Parameters<DiffOnMount>[0]

interface Props {
  diff: DiffContent | null
  loading?: boolean
  title?: React.ReactNode
  onClose?: () => void
  /** Extra buttons in the header (left of Split / Inline) */
  actions?: React.ReactNode
  /** Access to the Monaco diff editor (e.g. to read the selection) */
  onEditor?: (editor: DiffEditorInstance | null) => void
}

export function DiffViewer({ diff, loading, title, onClose, actions, onEditor }: Props) {
  const [sideBySide, setSideBySide] = useState(true)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="min-w-0 flex-1 truncate font-mono text-xs">{title ?? diff?.path}</div>
        {actions}
        {diff && !diff.binary && (
          <div className="flex rounded-md border border-border p-0.5 text-[11px]">
            {(['Split', 'Inline'] as const).map((label) => {
              const active = (label === 'Split') === sideBySide
              return (
                <button
                  key={label}
                  onClick={() => setSideBySide(label === 'Split')}
                  className={cx('rounded px-2 py-0.5', active ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg')}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg"
            title="Close diff (Esc)"
            aria-label="Close diff"
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {!diff ? (
          <Empty>{loading ? 'Loading diff…' : 'Select a file to view its changes'}</Empty>
        ) : diff.binary ? (
          <Empty>Binary file — no text diff available</Empty>
        ) : (
          <>
            {diff.tooLarge && (
              <div className="absolute top-0 right-0 left-0 z-10 bg-warn/15 px-3 py-1 text-xs text-warn">
                File is large; only the first 2 MB is shown.
              </div>
            )}
            <MonacoDiff
              onMount={(editor) => onEditor?.(editor)}
              onUnmount={() => onEditor?.(null)}
              theme="gitfy-dark"
              original={diff.original}
              modified={diff.modified}
              language={languageFor(diff.path)}
              loading={<Empty>Loading editor…</Empty>}
              options={{
                readOnly: true,
                originalEditable: false,
                renderSideBySide: sideBySide,
                useInlineViewWhenSpaceIsLimited: false,
                automaticLayout: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12.5,
                fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
                renderOverviewRuler: false,
                hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 5 },
              }}
            />
          </>
        )}
      </div>
    </div>
  )
}

/**
 * DiffEditor wrapper that detaches and disposes its models itself.
 * The stock unmount disposes the models before resetting the widget, which makes newer
 * Monaco versions throw "TextModel got disposed before DiffEditorWidget model got reset".
 * This component's cleanup runs before its child's, so the editor is already detached.
 */
function MonacoDiff({ onUnmount, ...props }: React.ComponentProps<typeof DiffEditor> & { onUnmount?: () => void }) {
  const editorRef = useRef<DiffEditorInstance | null>(null)
  useEffect(
    () => () => {
      onUnmount?.()
      const editor = editorRef.current
      const model = editor?.getModel()
      editor?.setModel(null)
      model?.original.dispose()
      model?.modified.dispose()
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )
  return (
    <DiffEditor
      {...props}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={(editor, monaco) => {
        editorRef.current = editor
        props.onMount?.(editor, monaco)
      }}
    />
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-muted">{children}</div>
}
