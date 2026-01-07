const Agent = require('./Agent');
const Workspace = require('./Workspace');
const GeminiClient = require('./Gemini');
const Blackboard = require('./Blackboard');
const KnowledgeGraph = require('./KnowledgeGraph');
const { ToolSet } = require('./Tools');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');

class Orchestrator {
    constructor() {
        this.gemini = new GeminiClient();
        this.workspace = new Workspace();
        this.blackboard = null; 
        this.kg = null;
        this.toolSet = null; // Will init with project dir
        this.agents = {};
    }

    async init(projectDir) {
        this.blackboard = new Blackboard(projectDir);
        await this.blackboard.load();
        
        this.kg = new KnowledgeGraph(projectDir);
        await this.kg.load();

        this.toolSet = new ToolSet(projectDir, this.kg, this.workspace);
        this.agents = this.initializeAgents();
    }

    initializeAgents() {
        // All agents get tools!
        const tools = this.toolSet;
        
        return {
            pm: new Agent('Alex', 'Product Manager', 
                'You define requirements. Use list_files/read_file to check existing docs.', 
                this.gemini, process.env.MODEL_MANAGER || 'gemini-1.5-pro', 1, tools),
            
            architect: new Agent('Sarah', 'Software Architect', 
                'You design the system. You can explore the codebase. Output JSON plans.', 
                this.gemini, process.env.MODEL_ARCHITECT || 'gemini-1.5-pro', 2, tools),
            
            devops: new Agent('Ops', 'DevOps Engineer', 
                'You manage the environment. You run commands to build/test. You can read/write config files.', 
                this.gemini, process.env.MODEL_DEVOPS || 'gemini-1.5-flash', 3, tools),
            
            engineer: new Agent('Coder', 'Lead Developer', 
                'You write code. Use read_file to understand context. Use write_file for new files and replace_in_file for edits. Use search_symbols to find definitions.', 
                this.gemini, process.env.MODEL_ENGINEER || 'gemini-1.5-flash', 4, tools),
            
            debugger: new Agent('Fixer', 'Senior Debugger', 
                'You fix bugs. Read error logs. Use search_symbols/search_files to locate code. Use replace_in_file to fix specific lines.', 
                this.gemini, process.env.MODEL_DEBUGGER || 'gemini-1.5-pro', 5, tools),

            manager: new Agent('Manager', 'Project Coordinator', 
                'You oversee the project. You verify plans and results.', 
                this.gemini, process.env.MODEL_MANAGER || 'gemini-1.5-pro', 6, tools),

            tester: new Agent('Tester', 'QA Engineer',
                'You write and run tests. You can use run_command to execute test scripts.',
                this.gemini, process.env.MODEL_ENGINEER || 'gemini-1.5-flash', 4, tools)
        };
    }

    async run(userPrompt, existingProjectPath = null) {
        console.log(chalk.blue.bold('\n🚀 CodeGrounds 8.0: The "Real" Multi-Agent Studio...'));
        let projectDir;
        let isUpdate = false;

        if (existingProjectPath) {
            projectDir = existingProjectPath;
            this.workspace.setProjectDir(projectDir);
            isUpdate = true;
            console.log(`Resumed Workspace: ${chalk.green(projectDir)}`);
        } else {
            const spinner = ora('Creating Workspace...').start();
            projectDir = await this.workspace.createProject(userPrompt.slice(0, 20)); 
            spinner.succeed(`Workspace: ${chalk.green(projectDir)}`);
        }

        await this.init(projectDir);
        await this.blackboard.updateProject({ description: userPrompt });

        // --- Phase 1: Requirements (PM) ---
        const spinnerPM = ora('Agent Alex (PM) is analyzing...').start();
        const pmPrompt = isUpdate 
            ? `Update requirements for: "${userPrompt}". Check existing README.md if it exists.` 
            : `Define requirements for: "${userPrompt}". Create a detailed plan.`;
        
        const requirements = await this.agents.pm.execute(pmPrompt);
        spinnerPM.succeed('Requirements defined.');
        await this.blackboard.updateProject({ goals: [requirements] });

        // --- Phase 2: Architecture (Architect) ---
        const spinnerArch = ora('Agent Sarah (Architect) is designing...').start();
        
        let fileStructure = "";
        if (isUpdate) {
            const files = (await this.toolSet.listFiles('.', true)).split('\n');
            for (const f of files) {
                if (f.endsWith('.js') || f.endsWith('.json') || f.endsWith('.md') || f.endsWith('.html') || f.endsWith('.css')) {
                    try {
                        const content = await this.toolSet.readFile(f);
                        fileStructure += `\n--- FILE: ${f} ---\n${content.substring(0, 5000)}\n`;
                    } catch (e) {}
                }
            }
        }

        const archPrompt = isUpdate ? `
Based on requirements: ${requirements}
The project already exists.
Existing File Contents (Context):
${fileStructure}

Analyze the changes needed.
Output JSON: { "phases": [[{"path": "...", "description": "..."}]], "stack": "...", "setupCommands": ["..."], "runCommand": "..." }
IMPORTANT: List ONLY the files that need to be created or modified. Do NOT list files that remain unchanged.
` : `
Based on requirements: ${requirements}
Design the app.
Output JSON: { "phases": [[{"path": "...", "description": "..."}]], "stack": "...", "setupCommands": ["..."], "runCommand": "..." }
Ensure you list ALL necessary files.
`;
        let archJson = this.parseJson(await this.agents.architect.execute(archPrompt));
        if (!archJson) throw new Error("Architect failed to produce JSON");
        
        spinnerArch.succeed(`Plan: ${archJson.phases.flat().length} files.`);
        await this.blackboard.setArchitecture(archJson);

        // --- User Approval ---
        console.log(chalk.yellow('\n📋 Plan:'));
        archJson.phases.flat().forEach(f => console.log(`  - ${f.path}`));
        
        const { start } = await inquirer.prompt([{ type: 'confirm', name: 'start', message: 'Start Build?', default: true }]);
        if (!start) process.exit();

        // --- Phase 3: Construction (Engineer + DevOps) ---
        console.log(chalk.yellow('\n⚡ Construction Started...'));

        // Setup first
        if (archJson.setupCommands) {
            const spinnerSetup = ora('DevOps: Setting up environment...').start();
            for (const cmd of archJson.setupCommands) {
                // DevOps agent executes the command itself via tool, or we ask it to.
                // Let's ask the agent to do it to ensure it handles errors.
                await this.agents.devops.execute(`Run setup command: ${cmd}. If it fails, try to fix it.`);
            }
            spinnerSetup.succeed('Environment Ready.');
        }

        // Build Files
        for (let i = 0; i < archJson.phases.length; i++) {
            const phase = archJson.phases[i];
            console.log(chalk.blue(`\n--- Phase ${i + 1} ---`));
            
            for (const file of phase) {
                const spinnerFile = ora(`Creating ${file.path}...`).start();
                
                // We ask the Engineer to "ensure the file exists with correct content"
                // The Engineer has 'write_file' tool.
                const devPrompt = `
Create/Update file: "${file.path}"
Description: ${file.description}
Stack: ${archJson.stack}
Requirements: ${requirements}

Use your tools to write the file. 
If it depends on other files, check them first.
`;
                await this.agents.engineer.execute(devPrompt);
                spinnerFile.succeed(file.path);
            }
        }

        // --- Phase 4: Verification (Tester & Debugger) ---
        console.log(chalk.magenta('\n🔄 Verification...'));
        const verifyPrompt = `
Verify the application "${archJson.stack}".
Run Command: ${archJson.runCommand}
1. Create a test script if needed.
2. Run the app.
3. If it fails, analyze the error and fix the files.
4. Repeat until success or max retries.
`;
        
        // We let the Debugger/Tester handle the loop entirely!
        // "Fixer" has the tools to run commands, read logs, and write files.
        await this.agents.debugger.execute(verifyPrompt);

        console.log(chalk.green.bold('\n✨ Mission Complete! ✨'));
    }

    parseJson(text) {
        try {
            let clean = text;
            // 1. Try extracting from markdown
            const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (match) {
                clean = match[1];
            } else {
                // 2. Try finding the first '{' and last '}'
                const firstBrace = text.indexOf('{');
                const lastBrace = text.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1) {
                    clean = text.substring(firstBrace, lastBrace + 1);
                }
            }
            return JSON.parse(clean);
        } catch (e) {
            console.error(chalk.red("JSON Parse Failed:"), e.message);
            return null;
        }
    }
}

module.exports = Orchestrator;
