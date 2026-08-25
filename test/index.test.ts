import { afterAll, describe, expect, test } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ObfuscatePlugin, { ObfuscatePlugin as Named } from "../src/index.ts"

const temporaryDirectories: string[] = []

async function createPlugin(directory?: string) {
  const projectDirectory = directory ?? await mkdtemp(join(tmpdir(), "opencode_obfuscate-test-"))
  if (!directory) temporaryDirectories.push(projectDirectory)
  const previous = process.env.OPENCODE_OBFUSCATE_DATA_DIR
  process.env.OPENCODE_OBFUSCATE_DATA_DIR = join(projectDirectory, ".opencode", "opencode_obfuscate")
  try {
    return await ObfuscatePlugin({ directory: projectDirectory } as never)
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_OBFUSCATE_DATA_DIR
    else process.env.OPENCODE_OBFUSCATE_DATA_DIR = previous
  }
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("ObfuscatePlugin", () => {
  test("exports a plugin with the expected hooks and tool", async () => {
    const plugin = await createPlugin()
    expect(plugin).toBeDefined()
    expect(typeof plugin["experimental.chat.messages.transform"]).toBe("function")
    expect(typeof plugin["experimental.text.complete"]).toBe("function")
    expect(typeof plugin["tool.execute.before"]).toBe("function")
    expect(plugin["tool.execute.after"]).toBeUndefined()
    expect(plugin["chat.message"]).toBeUndefined()
    expect(plugin.tool?.restore_secret).toBeDefined()
  })

  test("default and named exports are the same function", () => {
    expect(ObfuscatePlugin).toBe(Named)
  })

  test("obfuscates provider-bound messages in place without changing a stored snapshot", async () => {
    const plugin = await createPlugin()
    const messages = [{
      info: { sessionID: "session-a" },
      parts: [{ type: "text", text: "key=AKIA1234567890ABCDEF" }],
    }]
    const storedSnapshot = structuredClone(messages)
    const output = { messages }

    await plugin["experimental.chat.messages.transform"]!({}, output as never)

    expect(storedSnapshot[0].parts[0].text).toBe("key=AKIA1234567890ABCDEF")
    expect(output.messages).toBe(messages)
    expect(messages[0].parts[0].text).not.toContain("AKIA1234567890ABCDEF")
    expect(messages[0].parts[0].text).toContain("AKIA")

    const restored = await plugin.tool!.restore_secret.execute!(
      { value: messages[0].parts[0].text },
      { sessionID: "session-a" } as never,
    )
    expect(restored).toBe("key=AKIA1234567890ABCDEF")
  })

  test("obfuscates strings nested in completed tool results", async () => {
    const plugin = await createPlugin()
    const output = {
      messages: [{
        info: { sessionID: "session-a" },
        parts: [{
          type: "tool",
          state: {
            status: "completed",
            input: { token: "sk-input1234567890abcdefghijklmnop" },
            output: "AKIA1234567890ABCDEF",
            title: "AKIA1234567890ABCDEF",
          },
        }],
      }],
    }
    await plugin["experimental.chat.messages.transform"]!({}, output as never)
    const state = output.messages[0].parts[0].state
    expect(state.input.token).not.toBe("sk-input1234567890abcdefghijklmnop")
    expect(state.output).not.toBe("AKIA1234567890ABCDEF")
    expect(state.title).not.toBe("AKIA1234567890ABCDEF")
  })

  test("restores completed model text before it is persisted", async () => {
    const plugin = await createPlugin()
    const messageOutput = {
      messages: [{
        info: { sessionID: "session-complete" },
        parts: [{ type: "text", text: "AKIA1234567890ABCDEF" }],
      }],
    }
    await plugin["experimental.chat.messages.transform"]!({}, messageOutput as never)
    const fake = messageOutput.messages[0].parts[0].text
    const completeOutput = { text: fake }

    await plugin["experimental.text.complete"]!({ sessionID: "session-complete", messageID: "m", partID: "p" }, completeOutput as never)

    expect(completeOutput.text).toBe("AKIA1234567890ABCDEF")
  })

  test("restores fake tool arguments before execution", async () => {
    const plugin = await createPlugin()
    const messageOutput = {
      messages: [{
        info: { sessionID: "session-tool" },
        parts: [{ type: "text", text: "AKIA1234567890ABCDEF" }],
      }],
    }
    await plugin["experimental.chat.messages.transform"]!({}, messageOutput as never)
    const fake = messageOutput.messages[0].parts[0].text
    const toolOutput = { args: { command: `use ${fake}`, nested: [fake] } }

    await plugin["tool.execute.before"]!({ tool: "shell", sessionID: "session-tool", callID: "call" }, toolOutput as never)

    expect(toolOutput.args.command).toBe("use AKIA1234567890ABCDEF")
    expect(toolOutput.args.nested[0]).toBe("AKIA1234567890ABCDEF")
  })

  test("keeps mappings isolated by session", async () => {
    const plugin = await createPlugin()
    const output = {
      messages: [{
        info: { sessionID: "session-a" },
        parts: [{ type: "text", text: "AKIA1234567890ABCDEF" }],
      }],
    }
    await plugin["experimental.chat.messages.transform"]!({}, output as never)
    const fake = output.messages[0].parts[0].text

    const restored = await plugin.tool!.restore_secret.execute!(
      { value: fake },
      { sessionID: "session-b" } as never,
    )
    expect(restored).toBe("No secret mappings exist for the current session.")
  })

  test("reloads the same mapping after the plugin process restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode_obfuscate-persist-"))
    temporaryDirectories.push(directory)
    const sessionID = "session-persist"
    const makeOutput = () => ({
      messages: [{
        info: { sessionID },
        parts: [{ type: "text", text: "AKIA1234567890ABCDEF" }],
      }],
    })

    const firstPlugin = await createPlugin(directory)
    const firstOutput = makeOutput()
    await firstPlugin["experimental.chat.messages.transform"]!({}, firstOutput as never)
    const firstFake = firstOutput.messages[0].parts[0].text

    const restartedPlugin = await createPlugin(directory)
    const restartedOutput = makeOutput()
    await restartedPlugin["experimental.chat.messages.transform"]!({}, restartedOutput as never)
    expect(restartedOutput.messages[0].parts[0].text).toBe(firstFake)

    const restored = await restartedPlugin.tool!.restore_secret.execute!(
      { value: firstFake },
      { sessionID } as never,
    )
    expect(restored).toBe("AKIA1234567890ABCDEF")
  })

  test("serializes concurrent plugin instances creating the first mapping", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode_obfuscate-concurrent-"))
    temporaryDirectories.push(directory)
    const sessionID = "session-concurrent"
    const makeOutput = () => ({
      messages: [{
        info: { sessionID },
        parts: [{ type: "text", text: "AKIA1234567890ABCDEF" }],
      }],
    })
    const firstPlugin = await createPlugin(directory)
    const secondPlugin = await createPlugin(directory)
    const firstOutput = makeOutput()
    const secondOutput = makeOutput()

    await Promise.all([
      firstPlugin["experimental.chat.messages.transform"]!({}, firstOutput as never),
      secondPlugin["experimental.chat.messages.transform"]!({}, secondOutput as never),
    ])

    expect(secondOutput.messages[0].parts[0].text).toBe(firstOutput.messages[0].parts[0].text)
  })
})
