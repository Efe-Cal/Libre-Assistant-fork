import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import localforage from 'localforage';
import { createConversation as createNewConversation, storeMessages, deleteConversation as deleteConv } from './storeConversations';
import { handleIncomingMessage } from './message';
import { availableModels, findModelById } from './availableModels';
import { addMemory, modifyMemory, deleteMemory } from './memory';
import DEFAULT_PARAMETERS from './defaultParameters';
import { useSettings } from './useSettings';
import { useGlobalIncognito } from './useGlobalIncognito';
import { emitter } from './emitter';
import { PartsBuilder, TimingTracker } from './partsBuilder';

/**
 * Creates a centralized message manager for handling all chat message operations
 * Uses the shared settings instance for consistency across the app
 * @param {Object} chatPanel - Reference to the ChatPanel component
 * @returns {Object} Messages manager with reactive state and methods
 */
export function useMessagesManager(chatPanel) {
  // Use the shared settings instance
  const settingsManager = useSettings();

  // Use global incognito state
  const { isIncognito, toggleIncognito: globalToggleIncognito } = useGlobalIncognito();

  // Reactive state for messages
  const messages = ref([]);
  const isLoading = ref(false);
  const controller = ref(new AbortController());
  const currConvo = ref('');
  const conversationTitle = ref('');
  const isTyping = ref(false);
  const chatLoading = ref(false);


  // Computed properties
  const hasMessages = computed(() => messages.value.length > 0);
  const isEmptyConversation = computed(() => !currConvo.value && messages.value.length === 0);

  // Set up event listener for title updates
  const handleTitleUpdate = ({ conversationId, title }) => {
    if (currConvo.value === conversationId) {
      conversationTitle.value = title;
    }
  };

  onMounted(() => {
    emitter.on('conversationTitleUpdated', handleTitleUpdate);
  });

  onUnmounted(() => {
    emitter.off('conversationTitleUpdated', handleTitleUpdate);
  });

  // Method to update chat panel reference (for dynamic pages)
  function setChatPanel(newChatPanel) {
    chatPanel.value = newChatPanel;
  }

  /**
   * Generates a unique ID for messages
   * @returns {string} Unique ID
   */
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Adds a user message to the messages array
   * @param {string} content - The user's message content
   * @param {Array} attachments - Optional array of file attachments
   */
  function addUserMessage(content, attachments = []) {
    if (!content.trim() && attachments.length === 0) return;

    const userMessage = {
      id: generateId(),
      role: "user",
      content: content,
      attachments: attachments.map(a => ({
        id: a.id,
        type: a.type,
        filename: a.filename,
        dataUrl: a.dataUrl,
        mimeType: a.mimeType
      })),
      timestamp: new Date(),
      complete: true,
    };

    messages.value.push(userMessage);
  }

  /**
   * Creates a new assistant message and adds it to the messages array
   * @returns {Object} The created assistant message object
   */
  function createAssistantMessage() {
    const assistantMsg = {
      id: generateId(),
      role: "assistant",
      reasoning: "",
      content: "",
      tool_calls: [],
      timestamp: new Date(),
      complete: false,
      // New timing properties
      apiCallTime: new Date(), // Time when the API was called
      firstTokenTime: null,    // Time when the first token was received
      completionTime: null,    // Time when the message was completed
      // Token counting - now using actual counts from OpenRouter API
      tokenCount: 0,           // Completion tokens (generated tokens)
      totalTokens: 0,          // Total tokens (prompt + completion)
      promptTokens: 0,         // Prompt tokens (input tokens)
      reasoningStartTime: null,
      reasoningEndTime: null,
      reasoningDuration: null,
      error: false,
      errorDetails: null,
      annotations: null  // For PDF parsing reuse
    };

    messages.value.push(assistantMsg);
    return assistantMsg;
  }

  /**
   * Updates an assistant message with new content
   * @param {Object} message - The message to update
   * @param {Object} updates - The updates to apply
   */
  function updateAssistantMessage(message, updates) {
    const index = messages.value.findIndex(m => m.id === message.id);
    if (index !== -1) {
      // Use Vue's array mutation method to ensure reactivity
      messages.value.splice(index, 1, { ...messages.value[index], ...updates });
    }
  }

  /**
   * Sends a message to the AI and handles the response
   * @param {string} message - The user's message
   * @param {string} originalMessage - The original user message (before any reasoning prepends)
   * @param {Array} attachments - Optional array of file attachments
   * @param {Object} options - Optional settings
   * @param {boolean} options.skipUserMessage - If true, don't add user message (already exists in messages array)
   */
  async function sendMessage(message, originalMessage = null, attachments = [], options = {}) {
    const { skipUserMessage = false } = options;

    if ((!message.trim() && attachments.length === 0) || isLoading.value) return;

    controller.value = new AbortController();
    isLoading.value = true;
    isTyping.value = false;

    // Add user message using the original message (without /no_think prepended)
    // Skip if the message was already added (e.g., for initial messages from createNewConversationWithMessage)
    const messageToStore = originalMessage !== null ? originalMessage : message;
    if (!skipUserMessage) {
      addUserMessage(messageToStore, attachments);
    }

    // Create assistant message
    const assistantMsg = createAssistantMessage();

    // Create conversation if needed
    if (!currConvo.value && !isIncognito.value) {
      currConvo.value = await createNewConversation(messages.value, new Date());
      if (currConvo.value) {
        const convData = await localforage.getItem(`conversation_${currConvo.value}`);
        conversationTitle.value = convData?.title || "";
      }
    }

    await nextTick();
    // Use requestAnimationFrame for more reliable scrolling
    requestAnimationFrame(() => {
      chatPanel?.value?.scrollToEnd("smooth");
    });

    // Get current model details
    const selectedModelDetails = findModelById(availableModels, settingsManager.settings.selected_model_id);

    if (!selectedModelDetails) {
      console.error("No model selected or model details not found. Aborting message send.");
      updateAssistantMessage(assistantMsg, {
        content: (assistantMsg.content ? assistantMsg.content + "\n\n" : "") + "Error: No AI model selected.",
        complete: true
      });
      isLoading.value = false;
      return;
    }

    // Construct model parameters
    const savedReasoningEffort = settingsManager.getModelSetting(selectedModelDetails.id, "reasoning_effort") ||
      (selectedModelDetails.extra_parameters?.reasoning_effort?.[1] || "default");

    const parameterConfig = settingsManager.settings.parameter_config || { ...DEFAULT_PARAMETERS };

    // Check if this model has toggleable reasoning [true, false]
    const hasToggleableReasoning = Array.isArray(selectedModelDetails.reasoning) &&
      selectedModelDetails.reasoning.length === 2 &&
      selectedModelDetails.reasoning[0] === true &&
      selectedModelDetails.reasoning[1] === false;

    const model_parameters = {
      ...parameterConfig,
      ...selectedModelDetails.extra_parameters,
      reasoning: hasToggleableReasoning
        ? {
          effort: savedReasoningEffort,
          enabled: savedReasoningEffort !== 'none'
        }
        : { effort: savedReasoningEffort }
    };

    // Initialize parts builder and timing tracker (outside try so they're accessible in finally)
    const partsBuilder = new PartsBuilder();
    const timing = new TimingTracker(assistantMsg);

    try {
      // Pass only the conversation history BEFORE the current user message
      // handleIncomingMessage will add the current user message itself via the query parameter
      // This prevents the user message from being duplicated in the request
      // Pass full message objects so formatMessageForAPI can access all properties
      console.log('[messagesManager.js] ========== START: About to create streamGenerator ==========');

      const streamGenerator = handleIncomingMessage(
        message,
        messages.value.filter(msg => msg.complete && msg.content !== messageToStore),
        controller.value,
        settingsManager.settings.selected_model_id,
        model_parameters,
        settingsManager.settings,
        selectedModelDetails.extra_functions || [],
        settingsManager.settings.parameter_config?.grounding ?? DEFAULT_PARAMETERS.grounding,
        isIncognito.value,
        attachments  // Pass attachments to API
      );

      console.log('[messagesManager.js] streamGenerator created successfully');
      console.log('[messagesManager.js] streamGenerator type:', typeof streamGenerator);

      console.log('[messagesManager.js] PartsBuilder initialized, about to enter for await loop');

      // Helper to update message with Vue reactivity
      const updateMessageReactivity = () => {
        const updatedMsg = {
          ...assistantMsg,
          parts: partsBuilder.toReactiveArray(),
          tool_calls: partsBuilder.getAllTools(),
        };
        messages.value.splice(messages.value.length - 1, 1, updatedMsg);
      };

      console.log('[messagesManager.js] ========== ENTERING FOR AWAIT LOOP ==========');

      for await (const chunk of streamGenerator) {
        console.log('[messagesManager.js] Chunk received:', JSON.stringify({
          hasContent: chunk.content !== null && chunk.content !== undefined && chunk.content !== '',
          contentType: typeof chunk.content,
          contentValue: chunk.content,
          hasImages: !!chunk.images,
          imagesCount: chunk.images?.length || 0,
          hasReasoning: chunk.reasoning !== null && chunk.reasoning !== undefined,
          hasToolCalls: !!chunk.tool_calls && chunk.tool_calls.length > 0,
          chunkKeys: Object.keys(chunk)
        }));

        // Process content
        if (chunk.content) {
          partsBuilder.appendContent(chunk.content);
          assistantMsg.content = (assistantMsg.content || '') + chunk.content;
          timing.markFirstToken();
          timing.endReasoning();
        }

        // Process images
        if (chunk.images && chunk.images.length > 0) {
          console.log('[messagesManager.js] Images found:', JSON.stringify(chunk.images, null, 2));
          for (const image of chunk.images) {
            partsBuilder.processImage(image);
          }
        }

        // Process reasoning
        if (chunk.reasoning && chunk.reasoning.trim() !== 'None') {
          partsBuilder.appendReasoning(chunk.reasoning);

          // Update legacy reasoning field
          if (assistantMsg.reasoning.trim() === '' && chunk.reasoning.trim() !== '') {
            assistantMsg.reasoning = chunk.reasoning;
          } else {
            assistantMsg.reasoning += chunk.reasoning;
          }

          timing.markFirstToken();
          timing.startReasoning();
        }

        // Process tool calls
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          for (const tool of chunk.tool_calls) {
            const toolType = tool.type || 'function';
            partsBuilder.addOrUpdateTool(toolType, tool);
          }
        }

        // Process tool results
        if (chunk.tool_result) {
          partsBuilder.setToolResult(chunk.tool_result.id, chunk.tool_result.result);
        }

        // Process usage information from OpenRouter
        if (chunk.usage) {
          if (chunk.usage.completion_tokens !== undefined) {
            assistantMsg.tokenCount = chunk.usage.completion_tokens;
          }
          if (chunk.usage.total_tokens !== undefined) {
            assistantMsg.totalTokens = chunk.usage.total_tokens;
          }
          if (chunk.usage.prompt_tokens !== undefined) {
            assistantMsg.promptTokens = chunk.usage.prompt_tokens;
          }
        }

        // Process annotations from OpenRouter (for PDF reuse)
        if (chunk.annotations) {
          console.log('[PDF Annotations] Received annotations:', chunk.annotations);
          assistantMsg.annotations = chunk.annotations;
        }

        // Update Vue reactivity
        updateMessageReactivity();

        // Allow Vue to render updates before scrolling
        await new Promise(resolve => setTimeout(resolve, 0));

        if (chatPanel?.value?.isAtBottom) {
          chatPanel.value.scrollToEnd("smooth");
        }
      }

      // Store final parts on assistantMsg for persistence
      assistantMsg.parts = partsBuilder.toArray();
      assistantMsg.tool_calls = partsBuilder.getAllTools();

    } catch (error) {
      console.error('Error in stream processing:', error);
    } finally {
      console.log('[messagesManager.js] ========== FINALLY BLOCK ==========');

      // Ensure parts are stored from partsBuilder (in case of early error)
      if (!assistantMsg.parts || assistantMsg.parts.length === 0) {
        assistantMsg.parts = partsBuilder.toArray();
        assistantMsg.tool_calls = partsBuilder.getAllTools();
      }

      // Discard reasoning that is entirely whitespace
      if (assistantMsg.reasoning?.trim() === '') {
        assistantMsg.reasoning = '';
      }

      // If there are images but no content part, add content part at the beginning
      if (partsBuilder.hasImagePart() && !partsBuilder.hasContentPart() && assistantMsg.content) {
        partsBuilder.ensureContentPartFirst(assistantMsg.content);
        assistantMsg.parts = partsBuilder.toArray();
      }

      // Mark message as complete and set completion time
      updateAssistantMessage(assistantMsg, {
        complete: true,
        completionTime: new Date(),
        reasoningDuration: timing.calculateReasoningDuration()
      });

      // Process any memory commands from the completed message content
      if (assistantMsg.content) {
        // Look for memory command patterns in the content
        const memoryCommandPattern = /\{[^}]*"memory_action"[^}]*\}/g;
        const matches = assistantMsg.content.match(memoryCommandPattern);

        if (matches) {
          for (const match of matches) {
            try {
              const command = JSON.parse(match);
              if (command.memory_action) {
                switch (command.memory_action) {
                  case 'add':
                    if (command.fact) {
                      await addMemory(command.fact);
                    }
                    break;
                  case 'modify':
                    if (command.old_fact && command.new_fact) {
                      await modifyMemory(command.old_fact, command.new_fact);
                    }
                    break;
                  case 'delete':
                    if (command.fact) {
                      await deleteMemory(command.fact);
                    }
                    break;
                  case 'list':
                    // list action doesn't require processing here,
                    // since the facts are already available in context
                    break;
                  default:
                    console.log(`Unknown memory action: ${command.memory_action}`);
                }
              }
            } catch (error) {
              console.error(`Error parsing memory command: ${match}`, error);
            }
          }
        }
      }

      // Handle error display
      if (assistantMsg.complete && !assistantMsg.content && assistantMsg.errorDetails) {
        updateAssistantMessage(assistantMsg, {
          content: `\n[ERROR: ${assistantMsg.errorDetails.message}]` +
            (assistantMsg.errorDetails.status ? ` HTTP ${assistantMsg.errorDetails.status}` : '')
        });
      }

      isLoading.value = false;

      // Store messages if not in incognito mode
      if (!isIncognito.value) {
        await storeMessages(currConvo.value, messages.value, new Date());
      }
    }
  }


  /**
   * Changes the current conversation
   * @param {string} id - Conversation ID to load
   */
  async function changeConversation(id) {
    if (isIncognito.value) {
      return;
    }

    chatLoading.value = true;
    messages.value = [];
    currConvo.value = id;

    const conv = await localforage.getItem(`conversation_${currConvo.value}`);
    if (conv?.messages) {
      messages.value = conv.messages.map(msg => {
        if (msg.role === 'assistant') {
          return {
            ...msg,
            apiCallTime: msg.apiCallTime ? new Date(msg.apiCallTime) : null,
            firstTokenTime: msg.firstTokenTime ? new Date(msg.firstTokenTime) : null,
            completionTime: msg.completionTime ? new Date(msg.completionTime) : null,
            reasoningStartTime: msg.reasoningStartTime ? new Date(msg.reasoningStartTime) : null,
            reasoningEndTime: msg.reasoningEndTime ? new Date(msg.reasoningEndTime) : null,
            tool_calls: msg.tool_calls || [],
            // Initialize new token fields if they don't exist (for backward compatibility)
            tokenCount: msg.tokenCount || 0,
            totalTokens: msg.totalTokens || 0,
            promptTokens: msg.promptTokens || 0
          };
        }
        return msg;
      });
    } else {
      messages.value = [];
    }

    conversationTitle.value = conv?.title || '';
    chatLoading.value = false;
  }

  /**
   * Deletes a conversation
   * @param {string} id - Conversation ID to delete
   */
  async function deleteConversation(id) {
    if (isIncognito.value) {
      return;
    }

    await deleteConv(id);
    if (currConvo.value === id) {
      currConvo.value = '';
      messages.value = [];
      conversationTitle.value = '';
    }
  }

  /**
   * Starts a new conversation
   */
  async function newConversation() {
    currConvo.value = '';
    messages.value = [];
    conversationTitle.value = '';
    isIncognito.value = false;
  }

  /**
   * Toggles incognito mode
   */
  function toggleIncognito() {
    globalToggleIncognito();
  }

  // Return the reactive state and methods
  return {
    // Reactive state
    messages,
    isLoading,
    controller,
    currConvo,
    conversationTitle,
    isIncognito,
    isTyping,
    chatLoading,

    // Computed properties
    hasMessages,
    isEmptyConversation,

    // Methods
    sendMessage,
    changeConversation,
    deleteConversation,
    newConversation,
    toggleIncognito,
    generateId,
    setChatPanel
  };
}