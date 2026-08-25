import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import {
  createSessionMapping,
  DEFAULT_MAX_SECRETS_PER_SESSION,
  type SessionMapping,
} from "./session-mapping.ts"

interface PersistedMapping {
  version: 1
  sessionID: string
  mappings: Array<{ plain: string; fake: string }>
}

function assertSessionID(sessionID: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionID)) {
    throw new Error(`Invalid OpenCode session ID: ${sessionID}`)
  }
}

function mappingPath(directory: string, sessionID: string): string {
  assertSessionID(sessionID)
  return join(directory, `${sessionID}.json`)
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function withSessionMappingLock<T>(
  directory: string,
  sessionID: string,
  action: () => Promise<T>,
): Promise<T> {
  assertSessionID(sessionID)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const lockPath = join(directory, `.${sessionID}.lock`)

  for (let attempt = 0; attempt < 400; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600)
      try {
        await handle.writeFile(`${process.pid} ${Date.now()}\n`)
        return await action()
      } finally {
        await handle.close()
        await unlink(lockPath).catch((error) => {
          if (!isNotFound(error)) throw error
        })
      }
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error

      // Recover a lock left behind by a terminated OpenCode process. It is moved
      // to the recoverable archive instead of being deleted.
      try {
        const info = await stat(lockPath)
        if (Date.now() - info.mtimeMs > 30_000) {
          const archiveDirectory = join(directory, ".trash")
          await mkdir(archiveDirectory, { recursive: true, mode: 0o700 })
          await rename(lockPath, join(archiveDirectory, `${sessionID}.${Date.now()}.lock`))
          continue
        }
      } catch (lockError) {
        if (!isNotFound(lockError)) throw lockError
      }
      await wait(25)
    }
  }

  throw new Error(`Timed out waiting for session mapping lock: ${sessionID}`)
}

export async function loadSessionMapping(
  directory: string,
  sessionID: string,
): Promise<SessionMapping> {
  const mapping = createSessionMapping()
  let raw: string
  try {
    raw = await readFile(mappingPath(directory, sessionID), "utf8")
  } catch (error) {
    if (isNotFound(error)) return mapping
    throw error
  }

  const data = JSON.parse(raw) as Partial<PersistedMapping>
  if (data.version !== 1 || data.sessionID !== sessionID || !Array.isArray(data.mappings)) {
    throw new Error(`Invalid persisted mapping for session ${sessionID}`)
  }
  if (data.mappings.length > DEFAULT_MAX_SECRETS_PER_SESSION) {
    throw new Error(`Persisted mapping limit exceeded for session ${sessionID}`)
  }

  for (const entry of data.mappings) {
    if (!entry || typeof entry.plain !== "string" || typeof entry.fake !== "string") {
      throw new Error(`Invalid mapping entry for session ${sessionID}`)
    }
    if (
      mapping.forward.has(entry.plain) ||
      mapping.reverse.has(entry.fake) ||
      entry.plain === entry.fake
    ) {
      throw new Error(`Conflicting mapping entry for session ${sessionID}`)
    }
    mapping.forward.set(entry.plain, entry.fake)
    mapping.reverse.set(entry.fake, entry.plain)
  }
  return mapping
}

export async function saveSessionMapping(
  directory: string,
  sessionID: string,
  mapping: SessionMapping,
): Promise<void> {
  assertSessionID(sessionID)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)

  const data: PersistedMapping = {
    version: 1,
    sessionID,
    mappings: [...mapping.forward].map(([plain, fake]) => ({ plain, fake })),
  }
  const target = mappingPath(directory, sessionID)
  const temporary = join(directory, `.${sessionID}.${randomUUID()}.tmp`)
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  })
  await rename(temporary, target)
  await chmod(target, 0o600)
}

export async function archiveSessionMapping(directory: string, sessionID: string): Promise<void> {
  const source = mappingPath(directory, sessionID)
  const archiveDirectory = join(directory, ".trash")
  await mkdir(archiveDirectory, { recursive: true, mode: 0o700 })
  await chmod(archiveDirectory, 0o700)
  try {
    await rename(source, join(archiveDirectory, `${sessionID}.${Date.now()}.json`))
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
}
