export type CryptFormat = "default" | "hex"
export type CryptFn = (text: string, format?: CryptFormat) => string

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
const LOWER = "abcdefghijklmnopqrstuvwxyz"
const DIGITS = "0123456789"

export const DEFAULT_MAX_SECRETS_PER_SESSION = 10_000

export interface SessionMapping {
  readonly forward: Map<string, string>
  readonly reverse: Map<string, string>
  lastUsedAt: number
}

function alphabetOf(ch: string, format: CryptFormat = "default"): string | undefined {
  if (format === "hex") {
    if (ch >= "A" && ch <= "F") return "ABCDEF"
    if (ch >= "a" && ch <= "f") return "abcdef"
    if (ch >= "0" && ch <= "9") return DIGITS
    return undefined
  }
  if (ch >= "A" && ch <= "Z") return UPPER
  if (ch >= "a" && ch <= "z") return LOWER
  if (ch >= "0" && ch <= "9") return DIGITS
  return undefined
}

function randomIndex(length: number): number {
  const limit = Math.floor(256 / length) * length
  const bytes = new Uint8Array(1)
  do {
    crypto.getRandomValues(bytes)
  } while (bytes[0] >= limit)
  return bytes[0] % length
}

function randomizeFormat(text: string, format: CryptFormat = "default"): string {
  let output = ""
  for (const ch of text) {
    const alphabet = alphabetOf(ch, format)
    output += alphabet ? alphabet[randomIndex(alphabet.length)] : ch
  }
  return output
}

export function createSessionMapping(): SessionMapping {
  return {
    forward: new Map(),
    reverse: new Map(),
    lastUsedAt: Date.now(),
  }
}

export function createObfuscator(
  mapping: SessionMapping,
  maxSecrets = DEFAULT_MAX_SECRETS_PER_SESSION,
): CryptFn {
  return (plain: string, format: CryptFormat = "default") => {
    mapping.lastUsedAt = Date.now()
    const existing = mapping.forward.get(plain)
    if (existing !== undefined) return existing
    // Assistant messages may persist a fake value echoed by the model. Keep it
    // stable instead of assigning a second fake value on the next model request.
    if (mapping.reverse.has(plain)) return plain

    // With no alphanumeric characters there is no format-preserving change to make.
    if (![...plain].some((ch) => alphabetOf(ch) !== undefined)) return plain
    if (mapping.forward.size >= maxSecrets) {
      throw new Error(`Session secret mapping limit (${maxSecrets}) exceeded`)
    }

    for (let attempt = 0; attempt < 256; attempt++) {
      const fake = randomizeFormat(plain, format)
      if (fake === plain || mapping.reverse.has(fake)) continue

      mapping.forward.set(plain, fake)
      mapping.reverse.set(fake, plain)
      return fake
    }

    throw new Error("Unable to allocate a unique format-preserving secret mapping")
  }
}

export function createRestorer(mapping: SessionMapping): CryptFn {
  return (fake: string) => {
    mapping.lastUsedAt = Date.now()
    return mapping.reverse.get(fake) ?? fake
  }
}
