const chalk = require('chalk');

class Agent {
    constructor(name, role, description, geminiClient, modelName, keyIndex = 1, toolSet = null, allowedTools = null, maxSteps = 15) {
        this.name = name;
        this.role = role;
        this.description = description;
        this.geminiClient = geminiClient;
        this.modelName = modelName || process.env.DEFAULT_MODEL || "gemini-1.5-pro";
        this.keyIndex = keyIndex;
        this.toolSet = toolSet;
        this.allowedTools = allowedTools;
        this.maxSteps = maxSteps;
    }

    async execute(task, context = {}) {
        // Construct a focused system prompt
        const systemInstruction = `
CRITICAL IDENTITY: You are ${this.name}, the ${this.role}.
YOUR ROLE: ${this.description}
CONSTRAINTS: Do NOT deviate from this role. Do NOT perform tasks belonging to other agents.

Collaborative Guidelines:
1. PRECISION: When writing code, ensure interfaces match other files exactly. Use get_file_context to verify dependencies.
2. DEFENSIVE WRITING: Before writing or editing a file, use list_files/read_file to check if it exists or if another agent has already modified it. Never overwrite logic blindly.
3. SURGICAL EDITS: Use replace_in_file for modifications. If replace_in_file fails with "content not found", DO NOT get stuck. Immediately fall back to read_file to check the current state, and then use write_file to overwrite the file with the correct content.
4. SELF-CORRECTION: If you see a syntax warning or tool error, fix it immediately.
5. ATOMICITY: Each tool call should be a complete, logical step.
6. JSON: If asked for JSON, output ONLY valid JSON in a code block.
7. BATCHING: You can execute multiple tools in one turn. Use this to read multiple files or apply multiple edits at once.

You are building a great application from ideas. FAST, EFFICIENT, RELIABLE, QUALITY, SMART.
`;

        // Efficiently include context only in the first message or when it changes
        let history = [];
        const contextStr = typeof context === 'string' ? context : JSON.stringify(context, null, 2);
        
        // Use a leaner initial prompt. If context is too big, the first turn will be slow,
        // but subsequent turns will be fast because we don't re-send it.
        const initialTask = `CONTEXT:\n${contextStr}\n\nTASK:\n${task}`;
        
        let currentMaxSteps = this.maxSteps;
        for (let i = 0; i < currentMaxSteps; i++) {
            try {
                // IMPORTANT: Only send the full context/task in the first iteration.
                // In subsequent iterations, the model relies on 'history'.
                const promptToUse = (i === 0) ? initialTask : "Continue.";

                const response = await this.geminiClient.generateText(
                    promptToUse, 
                    systemInstruction, 
                    this.modelName, 
                    this.keyIndex, 
                    this.toolSet ? this.toolSet.getDefinitions(this.allowedTools) : null,
                    history
                );

                // Smart Grace Period: If we are near the limit but the agent is still active,
                // allow a few extra steps to finish the task.
                if (i === currentMaxSteps - 1 && currentMaxSteps < 100) {
                    currentMaxSteps += 5;
                }

                // Check for function calls
                const candidate = response.candidates[0];
                const parts = candidate.content.parts;
                
                // Filter for ALL function calls
                const funcCallParts = parts.filter(p => p.functionCall);

                if (funcCallParts.length > 0) {
                    // Log all calls
                    funcCallParts.forEach(p => {
                         console.log(chalk.gray(`[${this.name}] 🛠️  ${p.functionCall.name}(${JSON.stringify(p.functionCall.args).slice(0, 50)}...)`));
                    });

                    // Execute Tools Sequentially (to avoid race conditions on same files)
                    const functionResponses = [];
                    for (const part of funcCallParts) {
                        const call = part.functionCall;
                        let result;
                        if (this.toolSet) {
                            result = await this.toolSet.execute(call.name, call.args, this.name);
                        } else {
                            result = "Error: No tools available.";
                        }
                        
                        functionResponses.push({
                            functionResponse: {
                                name: call.name,
                                response: { content: result } 
                            }
                        });
                    }

                    // Update History
                    history.push({ role: 'model', parts: parts });
                    history.push({ role: 'function', parts: functionResponses });
                    
                } else {
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
