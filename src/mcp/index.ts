/**
 * Gyoshu MCP Server
 *
 * Model Context Protocol server that exposes Gyoshu research tools to Claude Code.
 * This provides the same functionality as the OpenCode plugin but via MCP.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

// Import tool handlers
import { pythonReplTool, handlePythonRepl } from "./tools/python-repl.js";
import { researchManagerTool, handleResearchManager } from "./tools/research-manager.js";
import { sessionManagerTool, handleSessionManager } from "./tools/session-manager.js";
import { notebookWriterTool, handleNotebookWriter } from "./tools/notebook-writer.js";
import { gyoshuCompletionTool, handleGyoshuCompletion } from "./tools/gyoshu-completion.js";
import { gyoshuSnapshotTool, handleGyoshuSnapshot } from "./tools/gyoshu-snapshot.js";
import { notebookSearchTool, handleNotebookSearch } from "./tools/notebook-search.js";
import { checkpointManagerTool, handleCheckpointManager } from "./tools/checkpoint-manager.js";
import { retrospectiveStoreTool, handleRetrospectiveStore } from "./tools/retrospective-store.js";
import { migrationTool, handleMigration } from "./tools/migration-tool.js";
import { parallelManagerTool, handleParallelManager } from "./tools/parallel-manager.js";
import { sessionStructureValidatorTool, handleSessionStructureValidator } from "./tools/session-structure-validator.js";

// Tool definitions
const TOOLS = [
  pythonReplTool,
  researchManagerTool,
  sessionManagerTool,
  notebookWriterTool,
  gyoshuCompletionTool,
  gyoshuSnapshotTool,
  notebookSearchTool,
  checkpointManagerTool,
  retrospectiveStoreTool,
  migrationTool,
  parallelManagerTool,
  sessionStructureValidatorTool,
];

// Tool handlers map
const TOOL_HANDLERS: Record<string, (args: unknown) => Promise<unknown>> = {
  "python_repl": handlePythonRepl,
  "research_manager": handleResearchManager,
  "session_manager": handleSessionManager,
  "notebook_writer": handleNotebookWriter,
  "gyoshu_completion": handleGyoshuCompletion,
  "gyoshu_snapshot": handleGyoshuSnapshot,
  "notebook_search": handleNotebookSearch,
  "checkpoint_manager": handleCheckpointManager,
  "retrospective_store": handleRetrospectiveStore,
  "migration_tool": handleMigration,
  "parallel_manager": handleParallelManager,
  "session_structure_validator": handleSessionStructureValidator,
};

// Create server
const server = new Server(
  {
    name: "gyoshu-mcp-server",
    version: "0.4.33",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    throw new McpError(
      ErrorCode.MethodNotFound,
      `Unknown tool: ${name}`
    );
  }

  try {
    const result = await handler(args);
    return {
      content: [
        {
          type: "text",
          text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${message}`,
        },
      ],
      isError: true,
    };
  }
});

// Main entry point
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[gyoshu-mcp] Server started on stdio");
}

main().catch((error) => {
  console.error("[gyoshu-mcp] Fatal error:", error);
  process.exit(1);
});
