import { patterns } from "./patterns.ts"
import type { CryptFn } from "./session-mapping.ts"

export function transform(text: string, crypt: CryptFn): string {
  if (!text) return text
  let out = ""
  let pos = 0
  while (pos < text.length) {
    let best: { pattern: (typeof patterns)[number]; groups: string[]; index: number; end: number } | null = null
    for (let pi = 0; pi < patterns.length; pi++) {
      const p = patterns[pi]
      p.regex.lastIndex = pos
      const m = p.regex.exec(text)
      if (!m) continue
      if (
        !best ||
        m.index < best.index ||
        (m.index === best.index && pi < patterns.indexOf(best.pattern))
      ) {
        best = { pattern: p, groups: m.slice(1), index: m.index, end: m.index + m[0].length }
      }
    }
    if (!best) {
      out += text.slice(pos)
      break
    }
    out += text.slice(pos, best.index)
    out += best.pattern.apply(text.slice(best.index, best.end), best.groups, crypt)
    pos = Math.max(best.end, best.index + 1)
  }
  return out
}
