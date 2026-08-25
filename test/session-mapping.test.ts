import { describe, expect, test } from "vitest"
import {
  createObfuscator,
  createRestorer,
  createSessionMapping,
} from "../src/session-mapping.ts"

describe("session mapping", () => {
  test("obfuscate then restore round-trips to the original value", () => {
    const mapping = createSessionMapping()
    const encrypt = createObfuscator(mapping)
    const decrypt = createRestorer(mapping)
    const plain = "AKIA1234567890ABCDEF"
    expect(decrypt(encrypt(plain))).toBe(plain)
  })

  test("obfuscated output preserves length and alphabet class per char", () => {
    const encrypt = createObfuscator(createSessionMapping())
    const plain = "AbC123XyZ"
    const out = encrypt(plain)
    expect(out).toHaveLength(plain.length)
    for (let i = 0; i < plain.length; i++) {
      const c = plain[i]
      const o = out[i]
      if (/[A-Z]/.test(c)) expect(o).toMatch(/[A-Z]/)
      else if (/[a-z]/.test(c)) expect(o).toMatch(/[a-z]/)
      else if (/[0-9]/.test(c)) expect(o).toMatch(/[0-9]/)
    }
  })

  test("the same value reuses its mapping within a session", () => {
    const mapping = createSessionMapping()
    const a = createObfuscator(mapping)
    const b = createObfuscator(mapping)
    const plain = "AKIA1234567890ABCDEF"
    expect(a(plain)).toBe(b(plain))
  })

  test("does not remap a fake value echoed by the model", () => {
    const mapping = createSessionMapping()
    const crypt = createObfuscator(mapping)
    const fake = crypt("AKIA1234567890ABCDEF")
    expect(crypt(fake)).toBe(fake)
  })

  test("non-alphanumeric characters pass through unchanged", () => {
    const crypt = createObfuscator(createSessionMapping())
    const plain = "hello-world_123"
    const out = crypt(plain)
    expect(out[5]).toBe("-")
    expect(out[11]).toBe("_")
    expect(out).not.toBe(plain)
  })

  test("empty string returns empty string", () => {
    const crypt = createObfuscator(createSessionMapping())
    expect(crypt("")).toBe("")
  })

  test("fails closed when the session mapping limit is exceeded", () => {
    const crypt = createObfuscator(createSessionMapping(), 1)
    crypt("first-secret")
    expect(() => crypt("second-secret")).toThrow("mapping limit")
  })
})
