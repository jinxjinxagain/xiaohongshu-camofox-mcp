/**
 * Xiaohongshu Camofox MCP Server
 *
 * Phase 1: Project skeleton — MCP bootstrap, CamofoxClient smoke test.
 * Subsequent phases add tools for login, search, feed detail, and user profile.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { config } from './config.js'
import { CamofoxClient } from './camofox/client.js'

// ── Server bootstrap ───────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'xiaohongshu-camofox-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  },
)

const camofox = new CamofoxClient(config.camofoxBaseUrl)

// ── Tool registry ─────────────────────────────────────────────────────────────

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>
}

const tools: ToolDef[] = []

function registerTool(tool: ToolDef): void {
  tools.push(tool)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params
  const tool = tools.find((t) => t.name === name)
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }
  try {
    const result = await tool.handler(args as Record<string, unknown>)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
  }
})

server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }))
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }))

// ── Phase 1 smoke-test tool ───────────────────────────────────────────────────

registerTool({
  name: 'smoke_test',
  description: 'Smoke test: verify Camofox connectivity and list open tabs. No XHS interaction.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async () => {
    try {
      const tabs = await camofox.listTabs(config.camofoxUserId)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                camofoxBaseUrl: config.camofoxBaseUrl,
                userId: config.camofoxUserId,
                sessionKey: config.camofoxSessionKey,
                openTabs: tabs.length,
                tabs: tabs.map((t) => ({ tabId: t.tabId, url: t.url, title: t.title })),
              },
              null,
              2,
            ),
          },
        ],
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }, null, 2) }],
        isError: true,
      }
    }
  },
})

// ── Boot ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.error('[xhs-camofox-mcp] Starting on port', config.port)
  console.error('[xhs-camofox-mcp] Camofox base URL:', config.camofoxBaseUrl)
  console.error('[xhs-camofox-mcp] Camofox userId:', config.camofoxUserId)
  console.error('[xhs-camofox-mcp] Session key:', config.camofoxSessionKey)
  console.error('[xhs-camofox-mcp] Dry run:', config.dryRun)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[xhs-camofox-mcp] Connected. MCP tools available:', tools.map((t) => t.name).join(', '))
}

main().catch((err) => {
  console.error('[xhs-camofox-mcp] Fatal:', err)
  process.exit(1)
})
