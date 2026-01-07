/**
 * PartsBuilder - Manages the structured parts array for assistant messages
 * 
 * Encapsulates all parts management logic:
 * - Creating and grouping parts (reasoning, content, tool_groups, images)
 * - Ensuring consecutive same-type parts are grouped correctly
 * - Providing a clean API for adding/updating content
 * 
 * Part Types:
 * - 'content': Text content { type: 'content', content: string }
 * - 'reasoning': Thinking/reasoning { type: 'reasoning', content: string }
 * - 'tool_group': Group of tools { type: 'tool_group', toolType: string, tools: array }
 * - 'image': Generated images { type: 'image', images: array }
 */
export class PartsBuilder {
    constructor() {
        this.parts = [];
    }

    /**
     * Get the last part in the array
     * @returns {Object|null} The last part or null if empty
     */
    getLastPart() {
        return this.parts[this.parts.length - 1] || null;
    }

    /**
     * Get or create a part of the specified type
     * @param {string} type - Part type: 'content', 'reasoning', 'tool_group', 'image'
     * @param {string|null} toolType - For tool_groups, the type of tools in this group
     * @returns {Object} The existing or newly created part
     */
    getOrCreatePart(type, toolType = null) {
        const lastPart = this.getLastPart();

        if (type === 'tool_group') {
            // Tool groups must match both type and toolType to be reused
            if (lastPart?.type === 'tool_group' && lastPart.toolType === toolType) {
                return lastPart;
            }
            const newPart = { type: 'tool_group', toolType, tools: [] };
            this.parts.push(newPart);
            return newPart;
        }

        if (type === 'image') {
            // Consecutive images should be grouped together
            if (lastPart?.type === 'image') {
                return lastPart;
            }
            const newPart = { type: 'image', images: [] };
            this.parts.push(newPart);
            return newPart;
        }

        // For content and reasoning - reuse if same type
        if (lastPart?.type === type) {
            return lastPart;
        }
        const newPart = { type, content: '' };
        this.parts.push(newPart);
        return newPart;
    }

    /**
     * Append text content to the current or new content part
     * @param {string} text - Text to append
     * @returns {Object} The content part that was updated
     */
    appendContent(text) {
        if (!text) return null;
        const part = this.getOrCreatePart('content');
        part.content += text;
        return part;
    }

    /**
     * Append reasoning text, handling whitespace-only content properly
     * @param {string} text - Reasoning text to append
     * @returns {Object} The reasoning part that was updated
     */
    appendReasoning(text) {
        if (!text || text.trim() === 'None') return null;

        const part = this.getOrCreatePart('reasoning');

        // If existing content is only whitespace and new text has content,
        // replace instead of append to avoid leading whitespace
        if (part.content.trim() === '' && text.trim() !== '') {
            part.content = text;
        } else {
            part.content += text;
        }
        return part;
    }

    /**
     * Add an image to the current or new image part
     * @param {string} url - Image URL (can be base64 data URL)
     * @param {string|null} revisedPrompt - Optional revised prompt from the model
     * @returns {Object} The image part that was updated
     */
    addImage(url, revisedPrompt = null) {
        if (!url) return null;
        const part = this.getOrCreatePart('image');
        part.images.push({
            url,
            revised_prompt: revisedPrompt
        });
        return part;
    }

    /**
     * Process an image object from the API response
     * Handles various image formats from different models
     * @param {Object} image - Image object from API
     * @returns {Object|null} The image part that was updated, or null if no valid URL
     */
    processImage(image) {
        // Handle different image format variations
        const url = image.image_url?.url || image.url;
        const revisedPrompt = image.revised_prompt || null;

        if (url) {
            return this.addImage(url, revisedPrompt);
        }
        return null;
    }

    /**
     * Add or update a tool in a tool group
     * @param {string} toolType - Type of the tool (e.g., 'function')
     * @param {Object} toolData - Tool data with index, id, type, function
     * @returns {Object} The tool that was added or updated
     */
    addOrUpdateTool(toolType, toolData) {
        const part = this.getOrCreatePart('tool_group', toolType);
        const existingTool = part.tools.find(t => t.index === toolData.index);

        if (existingTool) {
            // Update existing tool with new data
            if (toolData.function?.name) {
                existingTool.function.name = toolData.function.name;
            }
            if (toolData.function?.arguments) {
                existingTool.function.arguments += toolData.function.arguments;
            }
            if (toolData.id) {
                existingTool.id = toolData.id;
            }
            if (toolData.type) {
                existingTool.type = toolData.type;
            }
            return existingTool;
        }

        // Create new tool entry
        const newTool = {
            index: toolData.index,
            id: toolData.id || null,
            type: toolData.type || 'function',
            function: {
                name: toolData.function?.name || '',
                arguments: toolData.function?.arguments || ''
            }
        };
        part.tools.push(newTool);
        return newTool;
    }

    /**
     * Set the result for a tool by its ID
     * @param {string} toolId - The tool's ID
     * @param {any} result - The result to set
     * @returns {boolean} True if tool was found and updated
     */
    setToolResult(toolId, result) {
        for (const part of this.parts) {
            if (part.type === 'tool_group') {
                const tool = part.tools.find(t => t.id === toolId);
                if (tool) {
                    tool.result = result;
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get all tools as a flat array (for backward compatibility with tool_calls)
     * @returns {Array} Flat array of all tools
     */
    getAllTools() {
        return this.parts
            .filter(p => p.type === 'tool_group')
            .flatMap(p => p.tools);
    }

    /**
     * Check if any parts exist
     * @returns {boolean} True if there are parts
     */
    hasParts() {
        return this.parts.length > 0;
    }

    /**
     * Check if a content part exists
     * @returns {boolean} True if a content part exists
     */
    hasContentPart() {
        return this.parts.some(p => p.type === 'content');
    }

    /**
     * Check if an image part exists
     * @returns {boolean} True if an image part exists
     */
    hasImagePart() {
        return this.parts.some(p => p.type === 'image');
    }

    /**
     * Add a content part at the beginning if needed (for image-only responses)
     * @param {string} content - Content to add
     */
    ensureContentPartFirst(content) {
        if (this.hasImagePart() && !this.hasContentPart() && content) {
            this.parts.unshift({ type: 'content', content });
        }
    }

    /**
     * Get a shallow copy of the parts array
     * @returns {Array} Shallow copy of parts
     */
    toArray() {
        return [...this.parts];
    }

    /**
     * Create a deep copy suitable for Vue reactivity updates
     * This ensures Vue detects changes in nested objects
     * @returns {Array} Deep copy of parts with new object references
     */
    toReactiveArray() {
        return this.parts.map(part => {
            if (part.type === 'tool_group') {
                return { ...part, tools: [...part.tools] };
            }
            if (part.type === 'image') {
                return { ...part, images: [...part.images] };
            }
            return { ...part };
        });
    }
}

/**
 * TimingTracker - Tracks timing information for message streaming
 * 
 * Manages first token time, reasoning timing, and provides
 * a clean interface for timing-related updates.
 */
export class TimingTracker {
    constructor(message) {
        this.message = message;
        this.firstTokenReceived = false;
    }

    /**
     * Mark that the first token has been received
     */
    markFirstToken() {
        if (!this.firstTokenReceived) {
            this.message.firstTokenTime = new Date();
            this.firstTokenReceived = true;
        }
    }

    /**
     * Start reasoning timing if not already started
     */
    startReasoning() {
        if (this.message.reasoningStartTime === null) {
            this.message.reasoningStartTime = new Date();
        }
    }

    /**
     * End reasoning timing (called when content starts)
     */
    endReasoning() {
        if (this.message.reasoningStartTime !== null &&
            this.message.reasoningEndTime === null) {
            this.message.reasoningEndTime = new Date();
        }
    }

    /**
     * Calculate the reasoning duration
     * @returns {number|null} Duration in milliseconds or null
     */
    calculateReasoningDuration() {
        if (this.message.reasoningStartTime === null) {
            return null;
        }

        const endTime = this.message.reasoningEndTime || new Date();
        return endTime.getTime() - this.message.reasoningStartTime.getTime();
    }
}
