const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const chalk = require('chalk');
require("dotenv").config();

class GeminiClient {
    constructor() {
        this.clients = {}; // Map of index -> GoogleGenerativeAI instance
        
        // Load specific keys 1-6
        for (let i = 1; i <= 6; i++) {
            const key = process.env[`GEMINI_API_KEY_${i}`];
            if (key) {
                this.clients[i] = new GoogleGenerativeAI(key);
            }
        }
        
        // Fallback
        if (!this.clients[1] && process.env.GEMINI_API_KEY) {
            this.clients[1] = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        }

        if (Object.keys(this.clients).length === 0) {
            console.warn("Warning: No Gemini API keys found in environment variables.");
        }
    }

    getClient(index) {
        if (this.clients[index]) return this.clients[index];
        const availableKeys = Object.keys(this.clients);
        if (availableKeys.length > 0) return this.clients[availableKeys[0]];
        throw new Error(`No API Key available. Requested Key ${index}, but none found.`);
    }

    async generateText(prompt, systemInstruction = "", modelName, keyIndex = 1, toolDefinitions = null, chatHistory = []) {
        let currentKeyIndex = keyIndex;
        let currentModel = modelName || process.env.DEFAULT_MODEL || "gemini-1.5-pro";
        let attempt = 0;
        const maxRetries = 3;
        
        while (attempt <= maxRetries) {
            try {
                return await this._executeRequest(prompt, systemInstruction, currentModel, currentKeyIndex, toolDefinitions, chatHistory);
            } catch (error) {
                const msg = error.message;
                const isRateLimit = msg.includes("429") || msg.includes("Resource has been exhausted");
                const isContextError = msg.includes("maximum context length") || msg.includes("too many tokens");
                const isTransient = msg.includes("fetch failed") || msg.includes("ETIMEDOUT") || 
                                   msg.includes("ECONNRESET") || msg.includes("500") || 
                                   msg.includes("503") || msg.includes("Deadline exceeded");
                
                if (isRateLimit || isTransient || isContextError) {
                    const errorType = isRateLimit ? "Rate Limit" : (isContextError ? "Context Overflow" : "Network Error");
                    console.warn(chalk.yellow(`\n⚠️  ${errorType} on Key ${currentKeyIndex} (${currentModel}). Attempt ${attempt + 1}/${maxRetries}...`));
                    
                    if (isContextError) {
                        // If context overflows, immediately try to prune history and fallback to a larger model
                        console.warn(chalk.magenta("✂️  Context overflow detected. Pruning history..."));
                        if (chatHistory.length > 2) chatHistory.splice(0, chatHistory.length - 2); 
                        if (!currentModel.includes("pro")) currentModel = "gemini-1.5-pro"; // Switch to Pro for larger window
                        attempt = 0;
                        continue;
                    }

                    if (attempt === maxRetries) {
                        const nextKey = this._getNextAvailableKey(currentKeyIndex);
                        if (nextKey && nextKey !== currentKeyIndex) {
                            console.warn(chalk.magenta(`🔄 Rotating to Key ${nextKey}...`));
                            currentKeyIndex = nextKey;
                            attempt = 0;
                            continue;
                        }

                        if (currentModel.includes("pro") || currentModel.includes("preview")) {
                            console.warn(chalk.red(`🚨 Falling back to stable Flash model...`));
                            currentModel = "gemini-1.5-flash";
                            attempt = 0;
                            continue;
                        }
                    } else {
                        const delay = Math.pow(2, attempt) * 2000;
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                } else {
                    throw error;
                }
            }
            attempt++;
        }
        throw new Error(`Critical Failure: AI exhausted all retries, rotations, and fallbacks.`);
    }

    _getNextAvailableKey(currentKey) {
        const keys = Object.keys(this.clients).map(Number);
        if (keys.length <= 1) return null;
        
        // Simple rotation strategy: Find next highest key, wrap around
        const next = keys.find(k => k > currentKey) || keys[0];
        return next;
    }

    async _executeRequest(prompt, systemInstruction, modelName, keyIndex, toolDefinitions, chatHistory) {
        const genAI = this.getClient(keyIndex);
        const selectedModel = modelName || process.env.DEFAULT_MODEL || "gemini-1.5-pro";
        
        const tools = [];
        if (toolDefinitions) {
            tools.push(toolDefinitions);
        }

        const model = genAI.getGenerativeModel({ 
            model: selectedModel, 
            systemInstruction: {
                role: "system",
                parts: [{ text: systemInstruction }]
            },
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
            ],
            tools: tools.length > 0 ? tools : undefined
        });

        const generationConfig = {
            temperature: 1.0,
            maxOutputTokens: 65536
        };

        try {
            const chat = model.startChat({
                history: chatHistory,
                generationConfig: generationConfig
            });

            const result = await chat.sendMessage(prompt);
            const response = await result.response;
            return response;
        } catch (error) {
            throw error; // Let the wrapper handle it
        }
    }
}

module.exports = GeminiClient;
