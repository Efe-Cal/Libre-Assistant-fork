/**
 * Tool Manager for handling AI tool calls
 * Provides a flexible framework for registering and executing tools
 */

// Import necessary functions
import { addMemory, modifyMemory, deleteMemory, listMemory } from './memory';

class ToolManager {
  constructor() {
    this.tools = new Map();
    this.registerDefaultTools();
  }

  /**
   * Register a new tool
   * @param {string} name - The tool name
   * @param {Function} executor - Function that executes the tool with parameters
   * @param {Object} schema - Tool schema definition in OpenAI format
   */
  registerTool(name, executor, schema) {
    this.tools.set(name, { executor, schema });
  }

  /**
   * Unregister a tool
   * @param {string} name - The tool name to remove
   */
  unregisterTool(name) {
    this.tools.delete(name);
  }

  /**
   * Get all registered tools' schemas for API requests
   */
  getToolSchemas() {
    return Array.from(this.tools.values()).map(tool => tool.schema);
  }

  /**
   * Get a specific tool
   */
  getTool(name) {
    return this.tools.get(name);
  }

  /**
   * Execute a tool with given arguments
   * @param {string} name - Tool name
   * @param {Object} args - Arguments for the tool
   * @returns {Promise<any>} - Tool execution result
   */
  async executeTool(name, args) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }

    try {
      return await tool.executor(args);
    } catch (error) {
      console.error(`Error executing tool "${name}":`, error);
      throw error;
    }
  }

  /**
   * Get schemas for specific tool names
   */
  getSchemasByNames(names = []) {
    return names
      .map(name => this.tools.get(name))
      .filter(Boolean)
      .map(tool => tool.schema);
  }

  /**
   * Get all tool names
   */
  getToolNames() {
    return Array.from(this.tools.keys());
  }

  /**
   * Register default tools
   */
  registerDefaultTools() {
    // Memory tools
    this.registerTool(
      'listMemory',
      async () => {
        return await listMemory();
      },
      {
        type: "function",
        function: {
          name: "listMemory",
          description: "Retrieve all stored memory facts",
          parameters: {
            type: "object",
            properties: {},
          }
        }
      }
    );

    this.registerTool(
      'addMemory',
      async (args, messageHistory = []) => {
        if (!args.fact) {
          throw new Error('addMemory tool requires a "fact" argument');
        }
        await addMemory(args.fact, args.isGlobal || false, messageHistory);
        const memoryType = args.isGlobal ? 'global' : 'local';
        return { success: true, message: `Added ${memoryType} fact: "${args.fact}"` };
      },
      {
        type: "function",
        function: {
          name: "addMemory",
          description: "Add a new fact to memory. Use isGlobal=true for style preferences and basic info that applies to all conversations. Use isGlobal=false (default) for specific contextual facts.",
          parameters: {
            type: "object",
            properties: {
              fact: {
                type: "string",
                description: "The fact to add to memory"
              },
              isGlobal: {
                type: "boolean",
                description: "Whether this is a global memory (always included) or local memory (filtered by relevance). Defaults to false."
              }
            },
            required: ["fact"]
          }
        }
      }
    );

    this.registerTool(
      'modifyMemory',
      async (args, messageHistory = []) => {
        if (!args.oldFact || !args.newFact) {
          throw new Error('modifyMemory tool requires "oldFact" and "newFact" arguments');
        }
        await modifyMemory(args.oldFact, args.newFact, args.isGlobal, messageHistory);
        return {
          success: true,
          message: `Modified fact: "${args.oldFact}" -> "${args.newFact}"`
        };
      },
      {
        type: "function",
        function: {
          name: "modifyMemory",
          description: "Update an existing fact in memory. Optionally change whether it's a global or local memory.",
          parameters: {
            type: "object",
            properties: {
              oldFact: {
                type: "string",
                description: "The existing fact to modify"
              },
              newFact: {
                type: "string",
                description: "The new fact to replace it with"
              },
              isGlobal: {
                type: "boolean",
                description: "Whether this should be a global memory (always included) or local memory (filtered by relevance). If not specified, preserves the current setting."
              }
            },
            required: ["oldFact", "newFact"]
          }
        }
      }
    );

    this.registerTool(
      'deleteMemory',
      async (args) => {
        if (!args.fact) {
          throw new Error('deleteMemory tool requires a "fact" argument');
        }
        await deleteMemory(args.fact);
        return { success: true, message: `Deleted fact: "${args.fact}"` };
      },
      {
        type: "function",
        function: {
          name: "deleteMemory",
          description: "Remove a specific fact from memory",
          parameters: {
            type: "object",
            properties: {
              fact: {
                type: "string",
                description: "The fact to delete from memory"
              }
            },
            required: ["fact"]
          }
        }
      }
    );

    // Search Tool
    this.registerTool(
      'search',
      async (args) => {
        if (!args.q) {
          throw new Error('Search tool requires a "q" (query) argument');
        }

        try {
          const params = new URLSearchParams({
            q: args.q,
            count: args.count || 5, // Default to 5 results for AI to avoid context bloat
            safesearch: args.safesearch || 'moderate',
          });

          if (args.freshness) {
            params.append('freshness', args.freshness);
          }

          const response = await fetch(`/api/search?${params.toString()}`);
          if (!response.ok) {
            throw new Error(`Search request failed with status ${response.status}`);
          }

          const data = await response.json();

          // Format results for the AI
          if (!data.web || !data.web.results || data.web.results.length === 0) {
            return {
              results: [],
              message: "No results found for query."
            };
          }

          return {
            results: data.web.results.map(r => ({
              title: r.title,
              url: r.url,
              description: r.description,
              date: r.age // Some results might have age/date
            })),
            query: args.q
          };

        } catch (error) {
          console.error("Search tool error:", error);
          throw error;
        }
      },
      {
        type: "function",
        function: {
          name: "search",
          description: "Search the web for current information, news, or specific topics. Use this when you need information beyond your knowledge cutoff.",
          parameters: {
            type: "object",
            properties: {
              q: {
                type: "string",
                description: "The search query"
              },
              count: {
                type: "integer",
                description: "Number of results to return (default 5, max 10)",
                maximum: 10
              },
              freshness: {
                type: "string",
                description: "Filter by time: 'pd' (24h), 'pw' (7d), 'pm' (31d), 'py' (365d). Use if user asks for 'recent' or 'latest' news."
              }
            },
            required: ["q"]
          }
        }
      }
    );
  }
}

// Create a singleton instance
const toolManager = new ToolManager();

export { toolManager, ToolManager };