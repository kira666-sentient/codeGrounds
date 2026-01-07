const chalk = require('chalk');

class Agent {
    constructor(name, role, description, geminiClient, modelName, keyIndex = 1, toolSet = null) {
        this.name = name;
        this.role = role;
        this.description = description;
        this.geminiClient = geminiClient;
        this.modelName = modelName || process.env.DEFAULT_MODEL || "gemini-1.5-pro";
        this.keyIndex = keyIndex;
        this.toolSet = toolSet;
    }

    async execute(task, context = {}) {
        // Construct a focused system prompt
        const systemInstruction = `You are ${this.name}, the ${this.role} in the CodeGrounds team.
Your Description: ${this.description}

You are collaborating with other agents to build a high-quality application.
Follow instructions precisely.
If asked to output JSON, ensure it is valid JSON.
If asked to output code, provide the code clearly.
`;

        // Efficiently include context only in the first message or when it changes
        let history = [];
        const contextStr = typeof context === 'string' ? context : JSON.stringify(context, null, 2);
        const initialTask = `CONTEXT:\n${contextStr}\n\nTASK:\n${task}`;
        let currentPrompt = task;
        const maxSteps = 15;

        for (let i = 0; i < maxSteps; i++) {
            try {
                const promptToUse = (i === 0) ? initialTask : currentPrompt;
                const response = await this.geminiClient.generateText(
                    promptToUse, 
                    systemInstruction, 
                    this.modelName, 
                    this.keyIndex, 
                    this.toolSet ? this.toolSet.getDefinitions() : null,
                    history
                );

                // Check for function calls
                // The SDK helper might differ based on version, checking raw candidates is safer
                const candidate = response.candidates[0];
                const parts = candidate.content.parts;
                const funcCallPart = parts.find(p => p.functionCall);

                if (funcCallPart) {
                    const call = funcCallPart.functionCall;
                    console.log(chalk.gray(`[${this.name}] 🛠️  ${call.name}(${JSON.stringify(call.args).slice(0, 50)}...)`));
                    
                    // Execute Tool
                    let result;
                    if (this.toolSet) {
                        result = await this.toolSet.execute(call.name, call.args);
                    } else {
                        result = "Error: No tools available.";
                    }

                    // Update History
                    // 1. Add the model's function call
                    history.push({ role: 'model', parts: parts });
                    
                    // 2. Add the function response
                    history.push({
                        role: 'function',
                        parts: [{
                            functionResponse: {
                                name: call.name,
                                response: { content: result } 
                            }
                        }]
                    });

                    // Clear prompt for next turn (using history now)
                    currentPrompt = "";
                } else {
                    // It's text, we are done
                    return response.text();
                }

            } catch (error) {
                console.error(`[${this.name}] Error executing task:`, error.message);
                throw error;
            }
        }
        
        throw new Error(`[${this.name}] Exceeded max tool steps.`);
    }
}

module.exports = Agent;
