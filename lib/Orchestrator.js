const Agent = require('./Agent');
const Workspace = require('./Workspace');
const GeminiClient = require('./Gemini');
const Blackboard = require('./Blackboard');
const KnowledgeGraph = require('./KnowledgeGraph');
const { ToolSet } = require('./Tools');
const fs = require('fs-extra');
const path = require('path');
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

        this.toolSet = new ToolSet(projectDir, this.kg, this.workspace, this.blackboard);
        this.agents = this.initializeAgents();
    }

    initializeAgents() {
        const tools = this.toolSet;
        const READ_ONLY_TOOLS = ['read_file', 'list_files', 'search_files', 'search_symbols', 'get_file_context'];
        
        const modelManager = process.env.MODEL_MANAGER || 'gemini-1.5-pro';
        const modelArchitect = process.env.MODEL_ARCHITECT || 'gemini-1.5-pro';
        const modelEngineer = process.env.MODEL_ENGINEER || 'gemini-1.5-flash';
        const modelDevops = process.env.MODEL_DEVOPS || 'gemini-1.5-flash';
        const modelDebugger = process.env.MODEL_DEBUGGER || 'gemini-1.5-pro';

        return {
            pm: new Agent('Alex', 'Product Manager', 
                'Analyze the task. If requirements exist, only output the DELTA. Be decisive. Stop reading files once you have the core logic.', 
                this.gemini, modelManager, 4, tools, READ_ONLY_TOOLS, 20),
            
            architect: new Agent('Sarah', 'Software Architect', 
                'Design the system. If architecture exists, verify only. Output JSON quickly. Do not re-explore the whole project.', 
                this.gemini, modelArchitect, 5, tools, READ_ONLY_TOOLS, 20),
            
            devops: new Agent('Ops', 'DevOps Engineer', 
                'Manage the environment. Execute setup and build commands efficiently.', 
                this.gemini, modelDevops, 1, tools, null, 15),
            
            engineer: new Agent('Coder', 'Lead Developer', 
                'Implement changes. BATCH all tool calls. Use ONE replace_in_file per file with multiple blocks. Read only the target file.', 
                this.gemini, modelEngineer, 2, tools, null, 30),
            
            debugger: new Agent('Fixer', 'Senior Debugger', 
                'Fix specific bugs. Do not rewrite entire modules. Keep fixes surgical.', 
                this.gemini, modelDebugger, 6, tools, null, 25),

            manager: new Agent('Manager', 'Project Coordinator', 
                'Oversee quality. Be the judge. Decision between REFAC or PATCH must be instant.', 
                this.gemini, modelManager, 4, tools, READ_ONLY_TOOLS, 10),

            tester: new Agent('Tester', 'QA Engineer',
                'Audit logic. DO NOT write new test files during construction. Run existing tests only or do code-review.',
                this.gemini, modelEngineer, 3, tools, null, 20)
        };
    }

    async runWithRetry(agent, prompt, maxRetries = 2) {
        let lastError;
        for (let i = 0; i <= maxRetries; i++) {
            try {
                return await agent.execute(prompt);
            } catch (e) {
                lastError = e;
                console.warn(chalk.yellow(`\n⚠️  Agent ${agent.name} failed phase. Retry ${i + 1}/${maxRetries}...`));
                // Provide a hint to the agent on retry
                prompt += `\n\nNOTE: Your previous attempt failed with error: ${e.message}. Please adjust your strategy to avoid this.`;
            }
        }
        throw lastError;
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
        
        // Smart Resume: Check if we already have requirements/architecture
        const hasRequirements = this.blackboard.state.project.goals.length > 0;
        const hasArchitecture = this.blackboard.state.architecture.phases.length > 0;

        await this.blackboard.updateProject({ description: userPrompt });

        // --- Phase 1: Clarification & Requirements (PM) ---
        let requirements;
        if (isUpdate && hasRequirements && !userPrompt.toLowerCase().includes("check all files")) {
            console.log(chalk.gray("Using existing requirements..."));
            requirements = this.blackboard.state.project.goals[0];
        } else {
            const spinnerPM = ora('Agent Alex (PM) is analyzing...').start();
            const clarifyPrompt = `Analyze this request: "${userPrompt}". Are there ambiguities? If so, ask 1-3 questions. Otherwise, reply "CLEAR".`;
            const clarification = await this.agents.pm.execute(clarifyPrompt);
            if (clarification.trim() !== "CLEAR") {
                spinnerPM.stop();
                console.log(chalk.yellow(`\n🤔 PM Alex has some questions:`));
                console.log(chalk.white(clarification));
                const { answer } = await inquirer.prompt([{ type: 'input', name: 'answer', message: 'Your response:' }]);
                userPrompt += `\nUser clarification: ${answer}`;
                spinnerPM.start('Alex is finalizing requirements...');
            }

            const pmPrompt = isUpdate 
                ? `Update requirements for: "${userPrompt}". Project Snapshot: ${this.blackboard.getSnapshot()}` 
                : `Define requirements for: "${userPrompt}". Create a detailed plan.`;
            
            requirements = await this.runWithRetry(this.agents.pm, pmPrompt);
            spinnerPM.succeed('Requirements defined.');
            await this.blackboard.updateProject({ goals: [requirements] });
        }

        // --- Phase 2: Architecture (Architect) ---
        let archJson;
        const needsRecheck = userPrompt.toLowerCase().includes("recheck all files");

        if (isUpdate && hasArchitecture && !needsRecheck) {
            const spinnerVerify = ora('Sarah is verifying existing plan against current files...').start();
            const filesOnDisk = (await this.toolSet.listFiles('.', true)).split('\n');
            const ignoreList = ['node_modules', '.git', 'venv', '.venv', '__pycache__', 'dist', 'build', '.next', '.cache'];
            const filteredDisk = filesOnDisk.filter(f => !ignoreList.some(ignore => f.includes(ignore))).join('\n');

            // Quick integrity check: Does the disk match the plan?
            const verifyPrompt = `
Existing Plan: ${JSON.stringify(this.blackboard.state.architecture)}
Current Files on Disk:
${filteredDisk}

Is the existing plan still valid and complete for the current state of the project? 
If YES, reply exactly with "VALID".
If NO (incomplete files, missing modules, or disk out of sync), reply "STALE" and explain why.
`;
            const verification = await this.agents.architect.execute(verifyPrompt);
            
            if (verification.trim() === "VALID") {
                spinnerVerify.succeed("Existing architecture verified.");
                archJson = this.blackboard.state.architecture;
            } else {
                spinnerVerify.warn(`Plan is stale: ${verification.substring(0, 100)}...`);
                console.log(chalk.yellow("Re-designing to ensure robustness."));
                archJson = null; // Force re-design
            }
        }

        if (!archJson) {
            const spinnerArch = ora('Agent Sarah (Architect) is designing...').start();
            let projectSummary = "";
            if (isUpdate) {
                const files = (await this.toolSet.listFiles('.', true)).split('\n');
                const ignoreList = ['node_modules', '.git', 'venv', '.venv', '__pycache__', 'dist', 'build', '.next', '.cache'];
                projectSummary = "Existing Files:\n" + files.filter(f => !ignoreList.some(ignore => f.includes(ignore))).join('\n');
            }

            const archPrompt = `Based on requirements: ${requirements}\nDiscovery: ${projectSummary}\nOutput JSON: { "phases": [[{"path": "...", "description": "...", "independent": true}]], "stack": "...", "setupCommands": [], "runCommand": "..." }`;
            
            for (let i = 0; i < 3; i++) {
                const response = await this.runWithRetry(this.agents.architect, archPrompt);
                archJson = this.parseJson(response);
                if (archJson) break;
                console.warn(chalk.red("Architect provided invalid JSON. Retrying..."));
            }

            if (!archJson) throw new Error("Architect failed to produce valid JSON.");
            spinnerArch.succeed(`Plan: ${archJson.phases.flat().length} files.`);
            await this.blackboard.setArchitecture(archJson);
        }

        // --- User Approval ---
        console.log(chalk.yellow('\n📋 Plan:'));
        archJson.phases.flat().forEach(f => console.log(`  - ${f.path}`));
        
        const { start } = await inquirer.prompt([{ type: 'confirm', name: 'start', message: 'Start Build?', default: true }]);
        if (!start) process.exit();

        // --- Phase 2.5: Test Strategy (Tester) ---
        const spinnerTest = ora('Agent Tester is preparing test skeletons...').start();
        const existingTests = await this.toolSet.listFiles('tests', false);
        const testPrompt = `
Requirements: ${requirements}
Architecture: ${JSON.stringify(archJson)}
Existing Tests: ${existingTests}

TASK:
1. Create or update test skeletons ONLY for files that are new, modified, or missing tests.
2. If a test already exists and is valid, SKIP it.
3. Be surgical and fast. DO NOT RUN tests yet.
`;
        await this.agents.tester.execute(testPrompt);
        spinnerTest.succeed('Test strategy prepared.');

        // --- Phase 3: Construction (Engineer + DevOps) ---
        console.log(chalk.yellow('\n⚡ Construction Started...'));

        if (archJson.setupCommands) {
            const spinnerSetup = ora('DevOps: Setting up environment...').start();
            for (const cmd of archJson.setupCommands) {
                await this.agents.devops.execute(`Run setup command: ${cmd}. If it fails, try to fix it.`);
            }
            spinnerSetup.succeed('Environment Ready.');
        }

        const lastPhase = (this.blackboard.state.checkpoint && this.blackboard.state.checkpoint.lastPhase) || 0;

        for (let i = lastPhase; i < archJson.phases.length; i++) {
            const phase = archJson.phases[i];
            console.log(chalk.blue(`\n--- Phase ${i + 1} ---`));
            
            // Process files in parallel chunks to avoid rate limits but maximize speed
            const CHUNK_SIZE = 3;
            const chunks = [];
            for (let j = 0; j < phase.length; j += CHUNK_SIZE) {
                chunks.push(phase.slice(j, j + CHUNK_SIZE));
            }

            for (const chunk of chunks) {
                await Promise.all(chunk.map(async (file) => {
                    // Smart Checkpoint Skip
                    if (isUpdate && this.blackboard.state.architecture.files?.[file.path]?.status === 'PERFECTED') {
                        console.log(chalk.gray(`  ⏭️  Skipping perfected file: ${file.path}`));
                        return;
                    }

                    const spinnerFile = ora(`Processing ${file.path}...`).start();

                    try {
                        const exists = await fs.pathExists(path.join(projectDir, file.path));
                        let judgment = "BUILD";

                        // Optimization: Only Audit/Judge if file exists
                        if (exists) {
                            // 2. Judgment (Manager) - Combined with Audit for speed
                            // "Manager, check this file. If it meets requirements '${file.description}', reply SKIP. Else REFAC."
                            // We skip the separate "Tester Audit" step to save 1 round trip.
                            const context = await this.toolSet.getFileContext(file.path);
                            const judgmentPrompt = `
    Req: ${file.description}
    Code Context:
    ${context.substring(0, 5000)} ...

    Action: REFAC (if needs changes), SKIP (if perfect). Reply 1 word.
    `;
                            judgment = await this.agents.manager.execute(judgmentPrompt);
                        }

                        if (judgment.includes("SKIP")) {
                            spinnerFile.succeed(`${file.path} (Already Perfect)`);
                            await this.blackboard.updateFileStatus(file.path, 'PERFECTED', "Skipped by Manager");
                            return;
                        }

                        // 3. Build (Engineer)
                        const license = judgment.includes("REFAC") ? "LICENSE TO REFACTOR: The current code is sub-par. Overwrite or refactor." : "CREATION MODE: Build this file.";
                        
                        const devPrompt = `
    ${license}
    Target File: "${file.path}"
    Mission: ${file.description}
    Project Requirements: ${requirements}

    GUIDELINES:
    1. BATCH OPERATIONS: You can call read_file multiple times or replace_in_file multiple times in ONE turn.
    2. Focus ONLY on this file.
    3. Make it work.
    `;
                        await this.agents.engineer.execute(devPrompt);
                        
                        // 4. Post-Build Verification
                        // Use a lighter check.
                        const postAudit = await this.agents.tester.execute(`Quick sanity check on ${file.path}. PASS or FAIL?`);
                        await this.blackboard.updateFileStatus(file.path, postAudit.includes("PASS") ? 'PERFECTED' : 'BUILT', postAudit);
                        
                        await this.blackboard.saveCheckpoint(i, file.path);
                        await this.invalidateDependents(file.path);
                        spinnerFile.succeed(file.path);
                    } catch (e) {
                        spinnerFile.fail(`${file.path}: ${e.message}`);
                    }
                }));
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
        await this.agents.debugger.execute(verifyPrompt);

        console.log(chalk.green.bold('\n✨ Mission Complete! ✨'));
    }

    async invalidateDependents(filePath) {
        if (!this.kg) return;
        const dependents = this.kg.getDependents(filePath);
        for (const dep of dependents) {
            // Check if file is tracked in architecture
            if (this.blackboard.state.architecture.files && this.blackboard.state.architecture.files[dep]) {
                const currentStatus = this.blackboard.state.architecture.files[dep].status;
                if (currentStatus === 'PERFECTED' || currentStatus === 'BUILT') {
                    await this.blackboard.updateFileStatus(dep, 'STALE', `Dependency ${filePath} changed.`);
                    console.log(chalk.yellow(`  ⚠️  Invalidated ${dep} due to change in ${filePath}`));
                }
            }
        }
    }

    parseJson(text) {
        try {
            let clean = text;
            const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (match) {
                clean = match[1];
            } else {
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
