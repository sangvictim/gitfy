import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Replace a file's content all at once: write a temporary file next to it, then rename it over the
 * original. A crash or power loss mid-write then leaves the old file instead of an empty / torn one.
 */
export async function writeFileAtomic(file: string, data: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  await fs.writeFile(tmp, data)
  try {
    await fs.rename(tmp, file)
  } catch {
    // Windows can refuse to replace a file another program holds open (e.g. a virus scanner)
    await fs.rm(tmp, { force: true }).catch(() => {})
    await fs.writeFile(file, data)
  }
}

/** Run async tasks one after another (read-modify-write of the same file must not interleave) */
export function serial() {
  let last: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = last.then(task, task)
    last = next.catch(() => {})
    return next
  }
}
