// Minimal inline icon set (stroke icons, 24x24 viewBox) — avoids an icon font/CDN.
const paths = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  plus: 'M12 5v14M5 12h14',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  commit: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 12h6m6 0h6',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v5l3 3',
  changes: 'M12 3v18M3 12h18',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4m-4 5a8 8 0 0 0 14.9 3M20 20v-4h-4',
  check: 'm5 12 5 5L20 7',
  x: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 16v-4m0-4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  trash: 'M4 7h16M10 11v6m4-6v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  cloud: 'M7 18a5 5 0 0 1-.9-9.9A6 6 0 0 1 17.7 9 4.5 4.5 0 0 1 17 18z',
  chevron: 'm9 6 6 6-6 6',
  close: 'M15 18l-6-6 6-6',
  external: 'M14 4h6v6m0-6L10 14M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6',
  minus: 'M5 12h14',
  git: 'M12 3 3 12l9 9 9-9zM12 8v8m0-8a1.5 1.5 0 1 0 0 .01M9 11l3-3',
  laptop: 'M5 6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v9H5zM3 18h18',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 7.5h.01',
  stash: 'M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM3 4h18v4H3zM10 12h4',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  filter: 'M4 5h16l-6 8v5l-4 2v-7z',
  terminal: 'm5 7 5 5-5 5M12 19h7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4.2-4.2',
  up: 'm6 15 6-6 6 6',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6zM9 12l2 2 4-4',
  exit: 'M10 17l-5-5 5-5M5 12h11M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4',
  key: 'M15 7a4 4 0 1 1-3.9 4.9L4 19v2H2v-3l7.1-7.1A4 4 0 0 1 15 7zM16.5 8.5h.01',
  redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h1',
  pull: 'M12 3v13m0 0-4.5-4.5M12 16l4.5-4.5M5 21h14',
  push: 'M12 21V8m0 0-4.5 4.5M12 8l4.5 4.5M5 3h14',
  down: 'm6 9 6 6 6-6',
  ignore: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  unstash: 'M4 12h16v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM12 3v6m0-6-3 3m3-3 3 3M10 16h4',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
