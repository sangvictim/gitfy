// Load Monaco from the local bundle instead of a CDN (works offline and under a strict CSP).
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

monaco.editor.defineTheme('gitfy-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0f1115',
    'editorGutter.background': '#0f1115',
    'diffEditor.insertedTextBackground': '#3fb95026',
    'diffEditor.removedTextBackground': '#f8514926',
    'diffEditor.insertedLineBackground': '#3fb95014',
    'diffEditor.removedLineBackground': '#f8514914',
  },
})

loader.config({ monaco })
