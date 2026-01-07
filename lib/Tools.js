const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Define tool schemas for Gemini
const TOOL_DEFINITIONS = [
    {
        name: "read_file",
        description: "Read the contents of a file. Use this to inspect code, configuration, or text files.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "The relative path to the file." }
            },
            required: ["path"]
        }
    },
    {
        name: "list_files",
        description: "List files in a directory. Recursive by default.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "The directory path (default: .)" },
                recursive: { type: "boolean", description: "List recursively?" }
            }
        }
    },
    {
        name: "run_command",
        description: "Execute a shell command. Use this to run build scripts, tests, installs, or git commands.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "The command to run (e.g., 'npm install', 'ls -la')." }
            },
            required: ["command"]
        }
    },
    {
        name: "write_file",
        description: "Write content to a file. Overwrites existing content. Creates directories if needed. Automatically updates the Knowledge Graph.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "File path." },
                content: { type: "string", description: "File content." }
            },
            required: ["path", "content"]
        }
    },
    {
        name: "replace_in_file",
        description: "Replace a section of a file with new content. Use this for small edits.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "File path." },
                search: { type: "string", description: "The exact content to replace." },
                replace: { type: "string", description: "The new content." }
            },
            required: ["path", "search", "replace"]
        }
    },
    {
        name: "search_files",
        description: "Search for a regex pattern in files.",
        parameters: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "Regex pattern." },
                path: { type: "string", description: "Directory to search (default: .)" }
            },
            required: ["pattern"]
        }
    },
    {
        name: "search_symbols",
        description: "Search the Knowledge Graph for symbols (functions, classes, etc.). FAST and indexed.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Symbol name or keyword." }
            },
            required: ["query"]
        }
    },
    {
        name: "get_file_context",
        description: "Get full context of a file including content, symbols, and dependencies.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "File path." }
            },
            required: ["path"]
        }
    },
    {
        name: "fetch_url",
        description: "Fetch the content of a URL. Use to verify server responses.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "URL to fetch." }
            },
            required: ["url"]
        }
    },
    {
        name: "post_message",
        description: "Post a message to the shared Blackboard for other agents or the Orchestrator to see.",
        parameters: {
            type: "object",
            properties: {
                to: { type: "string", description: "Recipient agent name (Alex, Sarah, Coder, Ops, Fixer, Manager, Tester) or 'All'." },
                content: { type: "string", description: "The message content." }
            },
            required: ["to", "content"]
        }
    }
];

class ToolSet {
    constructor(workspaceDir, knowledgeGraph = null, workspace = null, blackboard = null) {
        this.workspaceDir = workspaceDir;
        this.kg = knowledgeGraph;
        this.workspace = workspace;
        this.blackboard = blackboard;
    }

    getDefinitions(allowedTools = null) {
        if (!allowedTools) {
            return { function_declarations: TOOL_DEFINITIONS };
        }
        
        return {
            function_declarations: TOOL_DEFINITIONS.filter(t => allowedTools.includes(t.name))
        };
    }

    async execute(name, args, agentName = "Unknown") {
        try {
            switch (name) {
                case 'read_file': return await this.readFile(args.path);
                case 'list_files': return await this.listFiles(args.path, args.recursive);
                case 'run_command': return await this.runCommand(args.command);
                case 'write_file': return await this.writeFile(args.path, args.content);
                case 'replace_in_file': return await this.replaceInFile(args.path, args.search, args.replace);
                case 'search_files': return await this.searchFiles(args.pattern, args.path);
                case 'search_symbols': return await this.searchSymbols(args.query);
                case 'get_file_context': return await this.getFileContext(args.path);
                case 'fetch_url': return await this.fetchUrl(args.url);
                case 'post_message': return await this.postMessage(agentName, args.to, args.content);
                default: return `Error: Unknown tool ${name}`;
            }
        } catch (e) {
            return `Error executing ${name}: ${e.message}`;
        }
    }

    async postMessage(from, to, content) {
        if (!this.blackboard) return "Error: Blackboard not active.";
        this.blackboard.addMessage(from, to, content);
        await this.blackboard.save();
        return `Message posted to ${to}.`;
    }

    async fetchUrl(url) {
        try {
            const res = await fetch(url);
            const text = await res.text();
            return `Status: ${res.status}\nContent:\n${text.substring(0, 2000)}...`; 
        } catch (e) {
            return `Fetch Failed: ${e.message}`;
        }
    }

    resolvePath(p) {
        return path.resolve(this.workspaceDir, p || '.');
    }

    async readFile(filePath) {
        const fullPath = this.resolvePath(filePath);
        if (!await fs.pathExists(fullPath)) return "Error: File not found.";
        return await fs.readFile(fullPath, 'utf8');
    }

    async writeFile(filePath, content) {
        const fullPath = this.resolvePath(filePath);
        if (this.workspace) {
            await this.workspace.writeFile(filePath, content);
        } else {
            await fs.outputFile(fullPath, content);
        }
        
        if (this.kg) {
            const updatedContent = await fs.readFile(fullPath, 'utf8');
            await this.kg.indexFile(path.relative(this.workspaceDir, fullPath), updatedContent);
        }

        let syntaxMsg = "";
        if (this.workspace) {
            const check = await this.workspace.validateSyntax(filePath);
            if (!check.valid) {
                syntaxMsg = `\n⚠️  WARNING: Syntax error detected:\n${check.error}`;
            }
        }

        return `Successfully wrote to ${filePath}${syntaxMsg}`;
    }

    async replaceInFile(filePath, search, replace) {
        const fullPath = this.resolvePath(filePath);
        if (!await fs.pathExists(fullPath)) return "Error: File not found.";
        
        let result;
        if (this.workspace) {
            result = await this.workspace.applyPatch(filePath, search, replace);
        } else {
            const content = await fs.readFile(fullPath, 'utf8');
            if (content.includes(search)) {
                const newContent = content.split(search).join(replace);
                await fs.outputFile(fullPath, newContent);
                result = { success: true };
            } else {
                result = { success: false, error: "Search content not found." };
            }
        }

        if (result.success) {
            if (this.kg) {
                const newContent = await fs.readFile(fullPath, 'utf8');
                await this.kg.indexFile(path.relative(this.workspaceDir, fullPath), newContent);
            }
            
            let syntaxMsg = "";
            if (this.workspace) {
                const check = await this.workspace.validateSyntax(filePath);
                if (!check.valid) {
                    syntaxMsg = `\n⚠️  WARNING: Syntax error detected after edit:\n${check.error}`;
                }
            }
            
            return `Successfully replaced content in ${filePath}${syntaxMsg}`;
        } else {
            return `Error: ${result.error}`;
        }
    }

    async listFiles(dirPath = '.', recursive = true) {
        const fullPath = this.resolvePath(dirPath);
        if (recursive) {
            const files = [];
            const getFiles = async (dir) => {
                const dirents = await fs.readdir(dir, { withFileTypes: true });
                for (const dirent of dirents) {
                    const res = path.resolve(dir, dirent.name);
                    if (dirent.isDirectory()) {
                        if (dirent.name !== 'node_modules' && dirent.name !== '.git') {
                            await getFiles(res);
                        }
                    } else {
                        files.push(path.relative(this.workspaceDir, res));
                    }
                }
            };
            await getFiles(fullPath);
            return files.length > 0 ? files.join('\n') : "No files found.";
        } else {
            const files = await fs.readdir(fullPath);
            return files.join('\n');
        }
    }

    async runCommand(command) {
        try {
            const { stdout, stderr } = await execPromise(command, { cwd: this.workspaceDir });
            return `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
        } catch (e) {
            return `Execution Failed:\n${e.message}\nSTDOUT:\n${e.stdout}\nSTDERR:\n${e.stderr}`;
        }
    }

    async searchFiles(pattern, dirPath = '.') {
        const fullPath = this.resolvePath(dirPath);
        
        try {
            const safePattern = pattern.replace(/"/g, '\\"');
            const command = `grep -r -n -I -i -E -C 2 "${safePattern}" "${fullPath}" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=.next --exclude-dir=.cache --exclude=package-lock.json`;
            
            const { stdout } = await execPromise(command, { encoding: 'utf8' }).catch(e => ({ stdout: "" })); 
            
            if (!stdout) return "No matches found.";
            
            if (stdout.length > 8000) {
                return stdout.substring(0, 8000) + "\n... (Truncated)";
            }
            return stdout;
        } catch (e) {
            return `Search failed: ${e.message}`;
        }
    }

    async searchSymbols(query) {
        if (!this.kg) return "Error: Knowledge Graph not active.";
        const files = this.kg.getRelevantFiles(query);
        if (files.length === 0) return "No relevant symbols found in Knowledge Graph.";
        
        return `Found relevant symbols in:\n${files.join('\n')}`;
    }

    async getFileContext(filePath) {
        const content = await this.readFile(filePath);
        if (content.startsWith("Error")) return content;

        let context = `--- FILE: ${filePath} ---\n${content}\n`;

        if (this.kg) {
            const symbols = this.kg.fileMap[filePath] || [];
            const deps = this.kg.getDependencies(filePath);
            context += `\nSymbols defined: ${symbols.join(', ')}`;
            context += `\nDependencies: ${deps.join(', ')}`;
        }

        return context;
    }
}

module.exports = { ToolSet, TOOL_DEFINITIONS };
            
