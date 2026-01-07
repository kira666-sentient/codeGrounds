const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
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
        const genAI = this.getClient(keyIndex);
        const selectedModel = modelName || process.env.DEFAULT_MODEL || "gemini-1.5-pro";
        
        const tools = [];
        if (toolDefinitions) {
            tools.push(toolDefinitions); // { function_declarations: [...] }
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
            console.error(`Gemini API Error (Key ${keyIndex}, Model ${selectedModel}):`, error.message);
            throw error;
        }
    }
}

module.exports = GeminiClient;
                    // We could log progress here if we wanted "Thinking Summaries"
