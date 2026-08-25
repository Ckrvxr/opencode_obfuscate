import type { CryptFn, CryptFormat } from "./session-mapping.ts"

export interface SecretPattern {
  id: string
  name: string
  regex: RegExp
  apply: (match: string, groups: string[], crypt: CryptFn) => string
}

function prefix(keepPrefix: number, groupIndex = 0, format?: CryptFormat) {
  return (match: string, groups: string[], crypt: CryptFn) => {
    const secret = groups[groupIndex]
    return match.replace(secret, secret.slice(0, keepPrefix) + crypt(secret.slice(keepPrefix), format))
  }
}

function full(groupIndex = 0) {
  return (match: string, groups: string[], crypt: CryptFn) => {
    const secret = groups[groupIndex]
    return match.replace(secret, crypt(secret))
  }
}

function uppercaseConstantAssignment(match: string, groups: string[], crypt: CryptFn) {
  const [context, key, separator, quote, value] = groups
  return `${context}${key}${separator}${quote}${crypt(value)}${quote}`
}

const COMMON_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "qq.com",
  "163.com",
  "126.com",
  "foxmail.com",
  "sina.com",
  "sohu.com",
  "yeah.net",
  "139.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "aol.com",
  "yandex.com",
  "naver.com",
  "daum.net",
])

function email(match: string, groups: string[], crypt: CryptFn) {
  const [local, domain] = groups
  const obfuscatedDomain = COMMON_EMAIL_DOMAINS.has(domain.toLowerCase()) ? domain : crypt(domain)
  return `${crypt(local)}@${obfuscatedDomain}`
}

export const patterns: SecretPattern[] = [
  { id: "github-pat", name: "GitHub Fine-grained PAT", regex: /\b(github_pat_[A-Za-z0-9_]{20,})\b/g, apply: prefix(11) },
  { id: "github-token", name: "GitHub Token", regex: /\b(gh[pousr]_[A-Za-z0-9]{36,})\b/g, apply: prefix(4) },
  { id: "openai-api-key", name: "OpenAI API Key", regex: /\b(sk-[A-Za-z0-9_-]{16,})\b/g, apply: prefix(3) },
  { id: "context7-api-key", name: "Context7 API Key", regex: /\b(ctx7sk-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi, apply: prefix(7, 0, "hex") },
  { id: "aws-access-key", name: "AWS Access Key ID", regex: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/g, apply: prefix(4) },
  { id: "google-api-key", name: "Google API Key", regex: /\b(AIza[0-9A-Za-z_-]{35})\b/g, apply: prefix(4) },
  { id: "slack-token", name: "Slack Token", regex: /\b(xox[baprs]-[0-9A-Za-z-]{10,})\b/g, apply: prefix(4) },
  { id: "stripe-key", name: "Stripe Key", regex: /\b((?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{20,})\b/g, apply: prefix(8) },
  { id: "npm-token", name: "npm Token", regex: /\b(npm_[A-Za-z0-9]{36})\b/g, apply: prefix(4) },
  { id: "jwt", name: "JSON Web Token", regex: /\b(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, apply: prefix(4) },
  {
    id: "pem-private-key",
    name: "PEM Private Key",
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    apply: (match, _groups, crypt) => {
      const lines = match.split(/\r?\n/)
      return lines.map((line, i) => (i === 0 || i === lines.length - 1 ? line : crypt(line))).join("\n")
    },
  },
  { id: "bearer-token", name: "Bearer Token", regex: /(Bearer\s+)([A-Za-z0-9\-._~+/]{16,}=*)/gi, apply: prefix(4, 1) },
  { id: "basic-auth", name: "Basic Auth", regex: /(Basic\s+)([A-Za-z0-9+/=]{8,})/gi, apply: full(1) },
  {
    id: "uppercase-suffix-assignment",
    name: "Uppercase Suffix Assignment",
    regex: /(^|[^\w])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:TOKEN|KEY|PASSWORD|PASSWD|PWD|SECRET|CREDENTIALS?))(\s*=\s*)(["']?)((?!(?:github_pat_|gh[pousr]_|sk-|ctx7sk-|(?:AKIA|ASIA)[0-9A-Z]{16}\b|AIza|xox[baprs]-|(?:sk|pk|rk)_(?:live|test)_|npm_|eyJ|-----BEGIN|Bearer\s|Basic\s))[^"'\\\s,.!?;)\]}@]{3,})(\4)/g,
    apply: uppercaseConstantAssignment,
  },
  {
    id: "email",
    name: "Email Address",
    regex: /\b([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)\b/g,
    apply: email,
  },
]
