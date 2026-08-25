# opencode_obfuscate

[English](README.md)

这是一个 OpenCode 插件：在发送给模型之前识别消息中的**密钥**，并替换为**格式相同的假密钥**。

替换值会保持原始长度、大小写类别、数字和标点布局，因此模型不会感知到的任何的变化。每个会话使用随机且持久化的映射，恢复会话后依然可以正常对话。

> **重要：本地会话数据中仍然是真实密钥。** 映射文件默认保存在 `~/.config/opencode/plugins/opencode_obfuscate/<sessionID>.json`，并以明文保存真实值和假值。会话导出、备份、崩溃报告和调试日志也可能包含真实密钥。本插件只保护发给模型的内容，不是本地存储加密或日志脱敏工具。

## 工作原理

- 在会话已经保存、模型请求即将构建时，通过 `experimental.chat.messages.transform` 扫描 provider 请求中的消息。
- 模型生成文本完成后，通过 `experimental.text.complete` 将假值还原为真值，再写入会话记录。
- 工具即将执行时，通过 `tool.execute.before` 将模型参数中的假值还原为真值，工具实际收到真值。
- 使用正则匹配已知密钥格式，为每个密钥分配一个随机的会话级双向映射。
- 替换值保持原始长度以及 `A-Z`、`a-z`、`0-9` 字符类别；非字母数字字符保持不变。
- 保留可识别的前缀，例如 `AKIA`、`sk-`、`ghp_`。
- 同一密钥在同一会话中始终使用相同假值，即使 OpenCode 重启或恢复会话也保持不变。
- 映射保存到 `~/.config/opencode/plugins/opencode_obfuscate/<sessionID>.json`。
- 删除会话时，映射会移动到 `~/.config/opencode/plugins/opencode_obfuscate/.trash/`，以便恢复。

## 安装

```sh
npm install opencode_obfuscate
```

在 `opencode.json` 中加入插件：

```jsonc
{
  "plugin": [
    "opencode_obfuscate"
  ]
}
```

## 恢复密钥

插件注册了 `restore_secret` 工具。传入当前会话中的假值即可返回原始值：

```text
restore_secret("sk-UZSG3fQSNOvku0VMEpRbTkkpyqbgwuBB580ht6rBRK3ZQVbLxqqugdul0lm27vXu")
```

## 替换算法详解

插件不会对整段文本做加密，而是按下面的流程处理每个识别到的密钥：

1. **定位密钥：** 使用对应正则从消息或工具结果中找到完整匹配，并提取需要替换的值。
2. **拆分保留部分：** 对带前缀的格式，将前缀与可替换部分分开；例如 `AKIAIOSFODNN7EXAMPLE` 拆成 `AKIA` 和 `IOSFODNN7EXAMPLE`。
3. **生成同格式假值：** 对可替换部分逐字符随机生成新字符：大写字母仍生成大写字母，小写字母仍生成小写字母，数字仍生成数字，标点和分隔符原样保留。因此长度和整体格式不会改变。
4. **保存双向映射：** 将“原值 → 假值”和“假值 → 原值”保存到当前 session 的映射文件中。同一原值再次出现时直接复用已有假值，不会每次重新随机。
5. **避免冲突：** 如果随机假值与原值相同，或已经被当前会话中的其他原值占用，就重新生成。
6. **恢复原值：** `restore_secret` 使用反向映射“假值 → 原值”恢复；无法在当前 session 映射中找到的内容保持不变。

映射文件保存的是明文原值和假值，详见上面的存储安全提醒。

## 支持的格式

1. **GitHub Token**
   - **原密钥：** `github_pat_11ABCdef456GHI_jkl789MNOpqr012STUvwx`
   - **假密钥：** `github_pat_11QWErty789UIO_pas456DFGhjk123KLZxcv`
   - **格式分析：** `github_pat_` + 至少 20 个字母、数字或下划线；或 `ghp_`、`gho_`、`ghu_`、`ghs_`、`ghr_` + 至少 36 个字母或数字
   - **混淆算法：** `github_pat_` 格式保留完整的 11 个字符前缀，经典 GitHub token 保留 4 个字符前缀；对后面的 token 逐字符随机替换，并保持字母、数字和下划线类别不变。

2. **OpenAI API Key**
   - **原密钥：** `sk-proj-abcdefghijklmnopqrstuvwxyz1234567890`
   - **假密钥：** `sk-proj-qwertyuiopasdfghjklzxcvbnm0987654321`
   - **格式分析：** `sk-` + 至少 16 个字母、数字、`_` 或 `-`
   - **混淆算法：** 保留 `sk-`，对后面的 key body 逐字符随机替换，并保持原始长度和字符类别。

3. **Context7 API Key**
   - **原密钥：** `ctx7sk-01234567-89ab-cdef-0123-456789abcdef`
   - **假密钥：** `ctx7sk-98765432-fedc-ba98-7654-fedcba987654`
   - **格式分析：** `ctx7sk-` + 标准 UUID（8-4-4-4-12 位十六进制字符）
   - **混淆算法：** 保留 `ctx7sk-` 前缀和 UUID 分组中的连字符；`0-9` 仍替换为数字，`a-f`/`A-F` 分别替换为对应大小写的十六进制字母。

4. **AWS Access Key ID**
   - **原密钥：** `AKIAIOSFODNN7EXAMPLE`
   - **假密钥：** `AKIA7M2P9Q4R8T6Y1Z3K`
   - **格式分析：** `AKIA`/`ASIA` + 16 位大写字母或数字
   - **混淆算法：** 保留 `AKIA` 或 `ASIA`，对后面的 16 位字符逐字符随机替换。

5. **Google API Key**
   - **原密钥：** `AIzaA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Qr7`
   - **假密钥：** `AIzaZ9x8Y7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i`
   - **格式分析：** `AIza` + 35 个字母、数字、`_` 或 `-`
   - **混淆算法：** 保留 `AIza`，对后面的 35 个字符逐字符随机替换。

6. **Slack Token**
   - **原密钥：** `xoxb-1234567890-ABCD`
   - **假密钥：** `xoxb-8063142759-QWER`
   - **格式分析：** `xoxb-`、`xoxp-`、`xoxa-`、`xoxr-` 或 `xoxs-` + 至少 10 个字符
   - **混淆算法：** 保留对应的 4 字符 token 前缀（例如 `xoxb`），对后面的 token 内容逐字符随机替换，连接符保持不变。

7. **Stripe Key**
   - **原密钥：** `sk_live_1234567890abcdefghijklmnop`
   - **假密钥：** `sk_live_8042716395qwertyuiopasdfgh`
   - **格式分析：** `sk_`、`pk_` 或 `rk_` + `live`/`test` + 至少 20 个字母或数字
   - **混淆算法：** 保留 `sk_live_`、`pk_test_` 等 8 字符前缀，对后面的 key body 逐字符随机替换。

8. **NPM Token**
   - **原密钥：** `npm_abcdefghijklmnopqrstuvwxyz1234567890`
   - **假密钥：** `npm_qwertyuiopasdfghjklzxcvbnm0987654321`
   - **格式分析：** `npm_` + 36 个字母或数字
   - **混淆算法：** 保留 `npm_`，对后面的 36 个字符逐字符随机替换。

9. **JSON Web Token（JWT）**
   - **原密钥：** `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig_abc`
   - **假密钥：** `eyJx7KpLmN2Q9R8S1.TyU3VwX5YzA7B8C9.sig_xyz`
   - **格式分析：** 以 `eyJ` 开头、由点分隔的三个字母数字片段
   - **混淆算法：** 保留 `eyJ` 开头的前 4 个字符，对 JWT 的其余内容逐字符随机替换；点号等分隔符保持不变。

10. **PEM 私钥**
    - **原密钥：** `-----BEGIN PRIVATE KEY-----` + Base64 内容 + `-----END PRIVATE KEY-----`
    - **假密钥：** 保留同样的头尾标记，替换中间 Base64 内容
    - **格式分析：** 从 `BEGIN ... PRIVATE KEY` 到匹配的 `END ... PRIVATE KEY` 区块
    - **混淆算法：** 保留 PEM 头部和尾部标记，对每一条中间 Base64 内容行独立逐字符随机替换，换行保持不变。

11. **Bearer Token**
    - **原密钥：** `Bearer abcdefghijklmnopqrstuvwxyz0123456789`
    - **假密钥：** `Bearer qwertyuiopasdfghjklzxcvbnm9876543210`
    - **格式分析：** `Bearer <token>`，token 至少 16 个字母、数字或 token 符号
    - **混淆算法：** 保留 `Bearer` scheme 及 token 前 4 个字符，对 token 其余部分逐字符随机替换，空白分隔保持不变。

12. **Basic Auth**
    - **原密钥：** `Basic YWJjZGVmZ2hpamts`
    - **假密钥：** `Basic UHJxTnBvZ3Fsa3Rt`
    - **格式分析：** `Basic <Base64>`，编码值至少 8 个字符
    - **混淆算法：** 保留 `Basic` scheme，对整个 Base64 值建立映射并逐字符替换；编码长度和字符类别保持不变。

13. **敏感后缀的大写常量赋值**
    - **原密钥：** `AUTH_TOKEN="xxx"`、`API_KEY=dddd`、`DB_PASSWORD=secret123`、`APP_SECRET='secret456'`
    - **假密钥：** `AUTH_TOKEN="qwe"`、`API_KEY=xkpr`、`DB_PASSWORD=qwerty456`、`APP_SECRET='qazwsx789'`
    - **格式分析：** 变量名全部为大写字母/数字/下划线，并以 `_TOKEN`、`_KEY`、`_PASSWORD`、`_PASSWD`、`_PWD`、`_SECRET`、`_CREDENTIAL` 或 `_CREDENTIALS` 结尾，使用 `=` 赋值；值至少 3 个字符
    - **混淆算法：** 保留变量名、空白、等号和可选引号，对值逐字符按原类别随机替换。

14. **邮箱地址**
    - **原密钥：** `Alice.Smith+ops@gmail.com`
    - **假密钥：** `qwerty.uiop+abc@gmail.com`
    - **格式分析：** `用户名@域名`；常见域名包括 `gmail.com`、`outlook.com`、`hotmail.com`、`yahoo.com`、`qq.com`、`163.com`、`126.com`、`icloud.com`、`proton.me` 等
    - **混淆算法：** 常见域名保留域名，只对用户名逐字符替换；非常见域名同时替换用户名和域名，`@`、点号及其他分隔符保持不变。

通用的 `password=...`、`token: ...` 等赋值格式仍不处理。Azure、GitLab、Discord、数据库 URL 和非 PEM SSH 私钥也没有专门规则；只有符合其他专用格式时才会被识别。
