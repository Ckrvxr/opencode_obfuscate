# opencode_obfuscate

[中文版](README.zh-CN.md)

This is an OpenCode plugin that detects **secrets** before messages are sent to a model and replaces them with **fake values in the same format**.

Replacement values preserve the original length, character classes, digits, and punctuation, so the model does not observe structural changes. Each session uses a random, persistent mapping, allowing conversations to continue normally after a session is resumed.

> **Important: local session data still contains the real secrets.** Mapping files at `~/.config/opencode/plugins/opencode_obfuscate/<sessionID>.json` also store real and fake values in plaintext. Session exports, backups, crash reports, and debug logs may contain real secrets as well. This plugin only protects content sent to the model; it is not local storage encryption or log redaction.

<img width="573" height="305" alt="PixPin_2026-08-25_15-42-05" src="https://github.com/user-attachments/assets/5eb49a52-1cb6-4954-bbe0-4f0619851c8c" />

## How it works

- Scans provider-bound messages through `experimental.chat.messages.transform` after the session has been stored and just before the model request is built.
- Restores fake values to their originals through `experimental.text.complete` after model text completes and before it is persisted in the session.
- Restores fake values in model-generated tool arguments through `tool.execute.before`, so tools receive the original values at execution time.
- Matches known secret formats with regular expressions and assigns each secret a random, session-scoped bidirectional mapping.
- Replacement values preserve the original length and `A-Z`, `a-z`, and `0-9` character classes; non-alphanumeric characters remain unchanged.
- Recognizable prefixes such as `AKIA`, `sk-`, and `ghp_` are preserved.
- The same secret uses the same fake value throughout a session, including after OpenCode restarts or the session is resumed.
- Mappings are stored at `~/.config/opencode/plugins/opencode_obfuscate/<sessionID>.json`.
- When a session is deleted, its mapping is moved to `~/.config/opencode/plugins/opencode_obfuscate/.trash/` for recovery.

## Install

```sh
npm install opencode_obfuscate
```

Add the plugin to `opencode.json`:

```jsonc
{
  "plugin": [
    "opencode_obfuscate"
  ]
}
```

## Restore a secret

The plugin registers a `restore_secret` tool. Pass it a fake value from the current session to get the original value back:

```text
restore_secret("sk-UZSG3fQSNOvku0VMEpRbTkkpyqbgwuBB580ht6rBRK3ZQVbLxqqugdul0lm27vXu")
```

## Replacement algorithm in detail

The plugin does not encrypt the entire text. It processes each detected secret as follows:

1. **Locate the secret:** Use the relevant regular expression to find a complete match in a message or tool result and extract the value to replace.
2. **Separate preserved parts:** For formats with prefixes, separate the prefix from the replaceable part. For example, `AKIAIOSFODNN7EXAMPLE` becomes `AKIA` plus `IOSFODNN7EXAMPLE`.
3. **Generate a same-format fake:** Generate a random replacement character by character: uppercase letters remain uppercase, lowercase letters remain lowercase, digits remain digits, and punctuation/separators remain unchanged. Length and overall format therefore stay the same.
4. **Save a bidirectional mapping:** Store `original → fake` and `fake → original` in the current session mapping file. Repeated occurrences of the same original value reuse the existing fake instead of being randomized again.
5. **Avoid collisions:** If a generated fake equals the original or is already assigned to another original value in the session, generate another candidate.
6. **Restore the original:** `restore_secret` uses the reverse `fake → original` mapping. Values not found in the current session mapping are left unchanged.

Mapping files contain the original and fake values in plaintext; see the storage warning above.

## Supported formats

Each format uses a random, session-persisted, format-preserving mapping. The examples below are documentation examples; actual fake values vary by session.

1. **GitHub Token**
   - **Original:** `github_pat_11ABCdef456GHI_jkl789MNOpqr012STUvwx`
   - **Fake:** `github_pat_11QWErty789UIO_pas456DFGhjk123KLZxcv`
   - **Format analysis:** `github_pat_` followed by at least 20 letters, digits, or underscores; or `ghp_`, `gho_`, `ghu_`, `ghs_`, or `ghr_` followed by at least 36 letters or digits
   - **Obfuscation:** For `github_pat_`, keep the full 11-character prefix; for classic GitHub tokens, keep the four-character prefix. Randomly replace the remaining token character by character while preserving letter, digit, and underscore classes.

2. **OpenAI API Key**
   - **Original:** `sk-proj-abcdefghijklmnopqrstuvwxyz1234567890`
   - **Fake:** `sk-proj-qwertyuiopasdfghjklzxcvbnm0987654321`
   - **Format analysis:** `sk-` followed by at least 16 letters, digits, `_`, or `-`
   - **Obfuscation:** Keep `sk-`; randomly replace the key body character by character while preserving length and character classes.

3. **Context7 API Key**
   - **Original:** `ctx7sk-01234567-89ab-cdef-0123-456789abcdef`
   - **Fake:** `ctx7sk-98765432-fedc-ba98-7654-fedcba987654`
   - **Format analysis:** `ctx7sk-` followed by a standard UUID (8-4-4-4-12 hexadecimal characters)
   - **Obfuscation:** Keep the `ctx7sk-` prefix and UUID group hyphens; replace digits with digits and `a-f`/`A-F` with hexadecimal letters of the same case.

4. **AWS Access Key ID**
   - **Original:** `AKIAIOSFODNN7EXAMPLE`
   - **Fake:** `AKIA7M2P9Q4R8T6Y1Z3K`
   - **Format analysis:** `AKIA` or `ASIA` followed by 16 uppercase letters or digits
   - **Obfuscation:** Keep `AKIA` or `ASIA`; randomly replace the following 16 characters one by one.

5. **Google API Key**
   - **Original:** `AIzaA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Qr7`
   - **Fake:** `AIzaZ9x8Y7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i`
   - **Format analysis:** `AIza` followed by 35 letters, digits, `_`, or `-`
   - **Obfuscation:** Keep `AIza`; randomly replace the following 35 characters one by one.

6. **Slack Token**
   - **Original:** `xoxb-1234567890-ABCD`
   - **Fake:** `xoxb-8063142759-QWER`
   - **Format analysis:** `xoxb-`, `xoxp-`, `xoxa-`, `xoxr-`, or `xoxs-` followed by at least 10 characters
   - **Obfuscation:** Keep the four-character token prefix, such as `xoxb`; randomly replace the token body character by character while leaving separators unchanged.

7. **Stripe Key**
   - **Original:** `sk_live_1234567890abcdefghijklmnop`
   - **Fake:** `sk_live_8042716395qwertyuiopasdfgh`
   - **Format analysis:** `sk_`, `pk_`, or `rk_` plus `live`/`test` and at least 20 letters or digits
   - **Obfuscation:** Keep the eight-character prefix such as `sk_live_` or `pk_test_`; randomly replace the remaining key body.

8. **npm Token**
   - **Original:** `npm_abcdefghijklmnopqrstuvwxyz1234567890`
   - **Fake:** `npm_qwertyuiopasdfghjklzxcvbnm0987654321`
   - **Format analysis:** `npm_` followed by 36 letters or digits
   - **Obfuscation:** Keep `npm_`; randomly replace the following 36 characters one by one.

9. **JSON Web Token (JWT)**
   - **Original:** `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig_abc`
   - **Fake:** `eyJx7KpLmN2Q9R8S1.TyU3VwX5YzA7B8C9.sig_xyz`
   - **Format analysis:** Three dot-separated alphanumeric segments beginning with `eyJ`
   - **Obfuscation:** Keep the first four characters beginning with `eyJ`; randomly replace the rest character by character while preserving dots and other separators.

10. **PEM Private Key**
   - **Original:** `-----BEGIN PRIVATE KEY-----` + Base64 content + `-----END PRIVATE KEY-----`
   - **Fake:** Keep the same header and footer markers while replacing the Base64 content
   - **Format analysis:** A block from `BEGIN ... PRIVATE KEY` through the matching `END ... PRIVATE KEY`
   - **Obfuscation:** Keep the PEM header and footer; independently randomly replace each Base64 body line character by character while preserving newlines.

11. **Bearer Token**
    - **Original:** `Bearer abcdefghijklmnopqrstuvwxyz0123456789`
    - **Fake:** `Bearer qwertyuiopasdfghjklzxcvbnm9876543210`
    - **Format analysis:** `Bearer <token>` with at least 16 token letters, digits, or token symbols
    - **Obfuscation:** Keep the `Bearer` scheme and the first four token characters; randomly replace the rest while preserving the whitespace separator.

12. **Basic Auth**
    - **Original:** `Basic YWJjZGVmZ2hpamts`
    - **Fake:** `Basic UHJxTnBvZ3Fsa3Rt`
    - **Format analysis:** `Basic <Base64>` with an encoded value of at least 8 characters
    - **Obfuscation:** Keep the `Basic` scheme; map and randomly replace the entire Base64 value while preserving its length and character classes.

13. **Uppercase constant assignment with sensitive suffixes**
    - **Original:** `AUTH_TOKEN="xxx"`, `API_KEY=dddd`, `DB_PASSWORD=secret123`, `APP_SECRET='secret456'`
    - **Fake:** `AUTH_TOKEN="qwe"`, `API_KEY=xkpr`, `DB_PASSWORD=qwerty456`, `APP_SECRET='qazwsx789'`
    - **Format analysis:** An all-uppercase name made of letters/digits/underscores, ending in `_TOKEN`, `_KEY`, `_PASSWORD`, `_PASSWD`, `_PWD`, `_SECRET`, `_CREDENTIAL`, or `_CREDENTIALS`, assigned with `=`; value length is at least 3 characters
    - **Obfuscation:** Keep the variable name, whitespace, equals sign, and optional quotes; randomly replace the value character by character while preserving its original character classes.

14. **Email Address**
    - **Original:** `Alice.Smith+ops@gmail.com`
    - **Fake:** `qwerty.uiop+abc@gmail.com`
    - **Format analysis:** `local-part@domain`; common domains include `gmail.com`, `outlook.com`, `hotmail.com`, `yahoo.com`, `qq.com`, `163.com`, `126.com`, `icloud.com`, and `proton.me`
    - **Obfuscation:** For common domains, keep the domain and replace only the local part character by character. For uncommon domains, replace both local part and domain while preserving `@`, dots, and other separators.

Generic `password=...` and `token: ...` assignment formats are still not handled. Azure, GitLab, Discord, database URLs, and non-PEM SSH keys also have no dedicated patterns; they are detected only when they match another supported format.
