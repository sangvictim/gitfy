import { Editor } from '@monaco-editor/react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Field, Input } from '../../components/Input'
import { cx } from '../../lib/format'
import { useActiveGit, useRepoStore } from '../../store/repo.store'
import { toast } from '../../store/toast.store'
import type { IgnoreCheck, LfsInfo, RepoIdentity } from '../../types/git'

/** user.name / user.email for this repository only (e.g. a work address in a work repository) */
export function IdentitySection() {
  const git = useActiveGit()
  const [id, setId] = useState<RepoIdentity | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    git
      ?.identity()
      .then((i) => {
        setId(i)
        setName(i.local.name ?? '')
        setEmail(i.local.email ?? '')
      })
      .catch((e) => toast.error(e.message))
  }, [git])
  useEffect(load, [load])

  const save = async (n: string, e: string) => {
    if (!git) return
    setSaving(true)
    try {
      await git.setIdentity(n, e)
      toast.success(n || e ? 'Saved the identity for this repository' : 'This repository now uses your global identity')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const dirty = !!id && (name.trim() !== (id.local.name ?? '') || email.trim() !== (id.local.email ?? ''))
  const effective = {
    name: id?.local.name ?? id?.inherited.name ?? null,
    email: id?.local.email ?? id?.inherited.email ?? null,
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <p className="text-[13px] text-muted">
        Commits in this repository are made as{' '}
        {effective.name || effective.email ? (
          <span className="text-fg">
            {effective.name ?? '(no name)'} &lt;{effective.email ?? 'no email'}&gt;
          </span>
        ) : (
          <span className="text-danger">nobody yet — set a name and email so you can commit</span>
        )}
        . Leave the fields empty to use your global identity.
      </p>
      <Field label="Name" hint={id?.inherited.name ? `Global: ${id.inherited.name}` : 'No global name set'}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={id?.inherited.name ?? 'Your Name'} />
      </Field>
      <Field label="Email" hint={id?.inherited.email ? `Global: ${id.inherited.email}` : 'No global email set'}>
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={id?.inherited.email ?? 'you@example.com'}
          onKeyDown={(e) => e.key === 'Enter' && dirty && save(name, email)}
        />
      </Field>
      <div className="flex gap-2">
        <Button variant="primary" disabled={!dirty || saving} onClick={() => save(name, email)}>
          Save
        </Button>
        {(id?.local.name || id?.local.email) && (
          <Button variant="ghost" disabled={saving} onClick={() => save('', '')}>
            Use global identity
          </Button>
        )}
      </div>
    </div>
  )
}

/** Edit the root .gitignore and test which rule (if any) ignores a path */
export function GitignoreSection() {
  const git = useActiveGit()
  const refreshStatus = useRepoStore((s) => s.refreshStatus)
  const [saved, setSaved] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [probe, setProbe] = useState('')
  const [result, setResult] = useState<(IgnoreCheck & { path: string }) | null>(null)

  useEffect(() => {
    git
      ?.readGitignore()
      .then((t) => {
        setSaved(t)
        setText(t)
      })
      .catch((e) => toast.error(e.message))
  }, [git])

  const save = async () => {
    if (!git) return
    setSaving(true)
    try {
      await git.writeGitignore(text)
      setSaved(text)
      toast.success('Saved .gitignore')
      refreshStatus()
      if (probe.trim()) test()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (!git || !probe.trim()) return
    try {
      setResult({ ...(await git.checkIgnore(probe)), path: probe.trim() })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const dirty = saved !== null && text !== saved

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-[13px] text-muted">
        Files matching these patterns are not offered for commit. Rules here only affect untracked files.
      </p>
      <div className="h-80 overflow-hidden rounded-md border border-border">
        {saved === null ? (
          <div className="flex h-full items-center justify-center text-muted">Loading…</div>
        ) : (
          <Editor
            theme="gitfy-dark"
            value={text}
            language="ini"
            onChange={(v) => setText(v ?? '')}
            options={{
              minimap: { enabled: false },
              automaticLayout: true,
              scrollBeyondLastLine: false,
              fontSize: 12.5,
              fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
            }}
          />
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={!dirty || saving} onClick={save}>
          Save .gitignore
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setText(saved ?? '')}>
            Revert
          </Button>
        )}
        {!dirty && saved !== null && <span className="text-xs text-muted">{saved ? 'Saved' : 'No .gitignore yet'}</span>}
      </div>

      <div className="mt-2 flex flex-col gap-2 border-t border-border pt-5">
        <span className="text-xs font-medium text-muted">Test a path</span>
        <div className="flex gap-2">
          <Input
            value={probe}
            onChange={(e) => setProbe(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && test()}
            placeholder="e.g. build/output.log"
            className="max-w-md font-mono"
          />
          <Button onClick={test} disabled={!probe.trim()}>
            Check
          </Button>
        </div>
        {dirty && <p className="text-[11px] text-warn">Save first — the check uses the saved file.</p>}
        {result && (
          <p
            className={cx(
              'flex items-start gap-1.5 rounded-md px-2.5 py-2 text-[12.5px]',
              result.ignored ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok',
            )}
          >
            <Icon name={result.ignored ? 'ignore' : 'check'} size={14} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-mono">{result.path}</span> {result.ignored ? 'is ignored' : 'is not ignored'}
              {result.rule && (
                <>
                  {' '}
                  by <span className="font-mono">{result.rule.pattern}</span>{' '}
                  <span className="opacity-75">
                    ({result.rule.source}, line {result.rule.line})
                  </span>
                </>
              )}
              .{result.tracked && result.ignored && ' Git still tracks it though, so the rule has no effect until you remove it from the repository.'}
            </span>
          </p>
        )}
      </div>
    </div>
  )
}

/** Git LFS status and submodules */
export function LfsSection() {
  const git = useActiveGit()
  const submodules = useRepoStore((s) => s.submodules)
  const updateSubmodules = useRepoStore((s) => s.updateSubmodules)
  const busy = useRepoStore((s) => s.busy)
  const [lfs, setLfs] = useState<LfsInfo | null>(null)

  useEffect(() => {
    git?.lfsInfo().then(setLfs).catch(() => setLfs(null))
  }, [git])

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-medium">Git LFS</h2>
        {!lfs ? (
          <p className="text-[13px] text-muted">Checking…</p>
        ) : (
          <>
            <StatusLine
              ok
              neutral
              text={
                lfs.used
                  ? `This repository uses Git LFS${lfs.files ? ` for ${lfs.files} file${lfs.files === 1 ? '' : 's'}` : ''}.`
                  : 'This repository does not use Git LFS.'
              }
            />
            <StatusLine
              ok={lfs.installed}
              neutral={!lfs.used}
              text={lfs.installed ? `git-lfs ${lfs.version} is installed.` : 'git-lfs is not installed on this computer.'}
            />
            {lfs.used && !lfs.installed && (
              <p className="text-xs text-muted">
                Without it, large files appear as small text pointers. Install it from git-lfs.com, run{' '}
                <span className="font-mono text-fg">git lfs install</span> once, then reopen the repository.
              </p>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-medium">Submodules</h2>
          {submodules.length > 0 && (
            <Button size="sm" disabled={!!busy} onClick={() => updateSubmodules()}>
              <Icon name="refresh" size={12} /> Update all
            </Button>
          )}
        </div>
        {submodules.length === 0 ? (
          <p className="text-[13px] text-muted">This repository has no submodules.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {submodules.map((m) => (
              <li key={m.path} className="flex items-center gap-3 px-3 py-2">
                <Icon name="folder" size={15} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[13px]">{m.path}</span>
                  <span className="block truncate text-[11px] text-muted">{m.url}</span>
                </span>
                <span
                  className={cx(
                    'shrink-0 text-xs',
                    m.state === 'ok' ? 'text-ok' : m.state === 'uninitialized' ? 'text-muted' : 'text-warn',
                  )}
                >
                  {{ ok: 'up to date', uninitialized: 'not cloned', changed: 'different commit', conflict: 'conflict' }[m.state]}
                </span>
                {m.state !== 'ok' && (
                  <Button size="sm" disabled={!!busy} onClick={() => updateSubmodules(m.path)}>
                    {m.state === 'uninitialized' ? 'Clone' : 'Update'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatusLine({ ok, neutral, text }: { ok: boolean; neutral?: boolean; text: string }) {
  return (
    <p className="flex items-center gap-2 text-[13px]">
      <Icon
        name={neutral ? 'info' : ok ? 'check' : 'alert'}
        size={14}
        className={neutral ? 'text-muted' : ok ? 'text-ok' : 'text-warn'}
      />
      {text}
    </p>
  )
}
