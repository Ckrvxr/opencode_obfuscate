import { describe, expect, test } from "vitest"
import { transform } from "../src/obfuscate.ts"
import { createObfuscator, createRestorer, createSessionMapping } from "../src/session-mapping.ts"

const mapping = createSessionMapping()
const encrypt = (t: string) => transform(t, createObfuscator(mapping))
const decrypt = (t: string) => transform(t, createRestorer(mapping))

describe("transform", () => {
  test("keeps non-secret text unchanged", () => {
    const text = "The quick brown fox jumps over the lazy dog."
    expect(encrypt(text)).toBe(text)
  })

  test("does not change empty string", () => {
    expect(encrypt("")).toBe("")
  })

  test("does not treat generic key/value assignments as secrets", () => {
    const plain = "password=supersecret123 token: ordinary-value"
    expect(encrypt(plain)).toBe(plain)
    expect(encrypt("_TOKEN=dddd")).toBe("_TOKEN=dddd")
  })

  test("obfuscates uppercase constants ending in token or key", () => {
    const plain = `AUTH_TOKEN="xxx" API_KEY=dddd SERVICE_KEY='dddd'`
    const out = encrypt(plain)
    expect(out).not.toBe(plain)
    expect(out).toMatch(/^AUTH_TOKEN="[A-Za-z0-9]{3}" API_KEY=[A-Za-z0-9]{4} SERVICE_KEY='[A-Za-z0-9]{4}'$/)
    expect(decrypt(out)).toBe(plain)
  })

  test("obfuscates additional sensitive uppercase suffixes", () => {
    const plain = "DB_PASSWORD=secret123 USER_PASSWD=pass123 LOCAL_PWD=pwd123 APP_SECRET=secret456 SERVICE_CREDENTIAL=cred123 TEAM_CREDENTIALS=creds123"
    const out = encrypt(plain)
    expect(out).not.toBe(plain)
    expect(decrypt(out)).toBe(plain)
  })

  test("does not consume sentence punctuation after an unquoted assignment", () => {
    const plain = "TEAM_CREDENTIALS=creds123."
    const out = encrypt(plain)
    expect(out.endsWith(".")).toBe(true)
    expect(decrypt(out)).toBe(plain)
  })

  test("obfuscates uppercase environment-style constants", () => {
    const plain = `export CONTEXT7_API_KEY="ordinary-value"`
    const out = encrypt(plain)
    expect(out).not.toBe(plain)
    expect(out).toMatch(/^export CONTEXT7_API_KEY="[A-Za-z0-9-]+"$/)
    expect(decrypt(out)).toBe(plain)
  })

  test("keeps dedicated formats recognizable inside uppercase assignments", () => {
    const plain = "_TOKEN=AKIA1234567890ABCDEF"
    const out = encrypt(plain)
    expect(out).toContain("AKIA")
    expect(out).not.toContain("AKIA1234567890ABCDEF")
    expect(decrypt(out)).toBe(plain)
  })

  test("obfuscates the local part while preserving common email domains", () => {
    const plain = "Contact Alice.Smith+ops@gmail.com"
    const out = encrypt(plain)
    expect(out).toContain("@gmail.com")
    expect(out).not.toContain("Alice.Smith+ops")
    expect(decrypt(out)).toBe(plain)
  })

  test("obfuscates both parts of uncommon email domains", () => {
    const plain = "owner@private-example.dev"
    const out = encrypt(plain)
    expect(out).not.toContain("owner@private-example.dev")
    expect(out).not.toContain("@private-example.dev")
    expect(out).toContain("@")
    expect(decrypt(out)).toBe(plain)
  })

  test("obfuscates an AWS access key and restores it", () => {
    const plain = "creds: AKIA1234567890ABCDEF"
    const out = encrypt(plain)
    expect(out).not.toContain("AKIA1234567890ABCDEF")
    expect(out).toContain("AKIA")
    expect(decrypt(out)).toBe(plain)
  })

  test("obfuscates an OpenAI API key keeping the sk- prefix", () => {
    const plain = "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890"
    const out = encrypt(plain)
    expect(out.startsWith("sk-")).toBe(true)
    expect(out).not.toBe(plain)
    expect(decrypt(out)).toBe(plain)
  })

  test("obfuscates a Context7 API key keeping the ctx7sk- prefix", () => {
    const plain = "ctx7sk-01234567-89ab-cdef-0123-456789abcdef"
    const out = encrypt(plain)
    expect(out.startsWith("ctx7sk-")).toBe(true)
    expect(out).toMatch(/^ctx7sk-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(out).not.toBe(plain)
    expect(decrypt(out)).toBe(plain)
  })

  test("obfuscates a GitHub token keeping the prefix", () => {
    const plain = "ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD"
    const out = encrypt(plain)
    expect(out.startsWith("ghp_")).toBe(true)
    expect(out).not.toBe(plain)
    expect(decrypt(out)).toBe(plain)
  })

  test("obfuscates a fine-grained GitHub PAT keeping github_pat_", () => {
    const plain = "github_pat_11ABCdef456GHI_jkl789MNOpqr012STUvwx"
    const out = encrypt(plain)
    expect(out.startsWith("github_pat_")).toBe(true)
    expect(out).not.toBe(plain)
    expect(decrypt(out)).toBe(plain)
  })

  test("obfuscates a JWT keeping the header prefix", () => {
    const plain = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig_abc"
    const out = encrypt(plain)
    expect(out.startsWith("eyJ")).toBe(true)
    expect(out).not.toBe(plain)
    expect(decrypt(out)).toBe(plain)
  })

  test("round-trips a recognized secret inside an assignment without double-encryption", () => {
    const aws = "password=AKIA1234567890ABCDEF"
    expect(decrypt(encrypt(aws))).toBe(aws)
    const openai = "secret=sk-proj-abcdefghijklmnopqrstuvwxyz123"
    expect(decrypt(encrypt(openai))).toBe(openai)
    const bearer = "auth=Bearer abcdefghijklmnopqrstuvwxyz0123456789"
    expect(decrypt(encrypt(bearer))).toBe(bearer)
  })

  test("obfuscates a bearer token keeping the scheme", () => {
    const plain = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789"
    const out = encrypt(plain)
    expect(out).toContain("Bearer ")
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789")
    expect(decrypt(out)).toBe(plain)
  })

  test("obfuscates and restores a PEM private key", () => {
    const plain = [
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
      "S1B0aW9uIGlzIGZha2UgZGF0YSBmb3IgdGVz",
      "-----END PRIVATE KEY-----",
    ].join("\n")
    const out = encrypt(plain)
    expect(out.startsWith("-----BEGIN PRIVATE KEY-----")).toBe(true)
    expect(out.endsWith("-----END PRIVATE KEY-----")).toBe(true)
    expect(out).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC")
    expect(decrypt(out)).toBe(plain)
  })

  test("obfuscates multiple secrets in one string", () => {
    const plain = "a=AKIA1234567890ABCDEF b=sk-test1234567890abcdefghijklmnop"
    const out = encrypt(plain)
    expect(out).not.toContain("AKIA1234567890ABCDEF")
    expect(out).not.toContain("sk-test1234567890abcdefghijklmnop")
    expect(decrypt(out)).toBe(plain)
  })
})
