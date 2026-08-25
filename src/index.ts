import { type Plugin, tool } from "@opencode-ai/plugin"
import { join } from "node:path"
import { homedir } from "node:os"
import { transform } from "./obfuscate.ts"
import {
  createObfuscator,
  createRestorer,
  type CryptFn,
  type SessionMapping,
} from "./session-mapping.ts"
import {
  archiveSessionMapping,
  loadSessionMapping,
  saveSessionMapping,
  withSessionMappingLock,
} from "./mapping-sync.ts"

const DEFAULT_MAPPING_DIRECTORY = join(homedir(), ".config", "opencode", "plugins", "opencode_obfuscate")

function transformStrings(value: unknown, crypt: CryptFn): void {
  if (!value || typeof value !== "object") return

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i]
      if (typeof item === "string") value[i] = transform(item, crypt)
      else transformStrings(item, crypt)
    }
    return
  }

  const record = value as Record<string, unknown>
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") record[key] = transform(item, crypt)
    else transformStrings(item, crypt)
  }
}

export const ObfuscatePlugin: Plugin = async (_input) => {
  // Keep mappings with the globally installed plugin instead of inside the
  // current project. The environment override is intended for isolated tests.
  const mappingDirectory = process.env.OPENCODE_OBFUSCATE_DATA_DIR ?? DEFAULT_MAPPING_DIRECTORY
  const sessions = new Map<string, SessionMapping>()
  const debug = process.env.OPENCODE_OBFUSCATE_DEBUG === "1"
  if (debug) console.error(`[opencode_obfuscate] plugin initialized; mappings=${mappingDirectory}`)

  const getSession = async (sessionID: string): Promise<SessionMapping> => {
    const mapping = await loadSessionMapping(mappingDirectory, sessionID)
    sessions.set(sessionID, mapping)
    mapping.lastUsedAt = Date.now()
    return mapping
  }

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const sessionID = output.messages[0]?.info.sessionID
      if (!sessionID) return
      if (debug) console.error(`[opencode_obfuscate] transforming provider messages for ${sessionID}`)

      // These are ephemeral messages loaded from the database for this provider
      // request. OpenCode retains the array reference, so mutate its contents.
      await withSessionMappingLock(mappingDirectory, sessionID, async () => {
        const mapping = await getSession(sessionID)
        const sizeBefore = mapping.forward.size
        const obfuscate = createObfuscator(mapping)
        for (const message of output.messages) {
          transformStrings(message.parts, obfuscate)
        }
        if (mapping.forward.size !== sizeBefore) {
          await saveSessionMapping(mappingDirectory, sessionID, mapping)
        }
      })
    },

    "experimental.text.complete": async ({ sessionID }, output) => {
      if (!sessionID) return
      await withSessionMappingLock(mappingDirectory, sessionID, async () => {
        const mapping = await getSession(sessionID)
        output.text = transform(output.text, createRestorer(mapping))
      })
    },

    "tool.execute.before": async ({ sessionID }, output) => {
      if (!sessionID) return
      await withSessionMappingLock(mappingDirectory, sessionID, async () => {
        const mapping = await getSession(sessionID)
        transformStrings(output.args, createRestorer(mapping))
      })
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const sessionID = event.properties.info.id
        await withSessionMappingLock(mappingDirectory, sessionID, async () => {
          sessions.delete(sessionID)
          await archiveSessionMapping(mappingDirectory, sessionID)
        })
      }
    },

    tool: {
      restore_secret: tool({
        description: "Restore an obfuscated secret from the current session",
        args: { value: tool.schema.string() },
        async execute(args, context) {
          const mapping = await getSession(context.sessionID)
          if (mapping.forward.size === 0) return "No secret mappings exist for the current session."
          return transform(args.value, createRestorer(mapping))
        },
      }),
    },
  }
}

export default ObfuscatePlugin
