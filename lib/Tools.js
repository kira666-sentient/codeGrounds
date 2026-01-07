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
        name: "fetch_url",
        description: "Fetch the content of a URL. Use to verify server responses.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "URL to fetch." }
            },
            required: ["url"]
        }
    }
];

class ToolSet {
    constructor(workspaceDir, knowledgeGraph = null, workspace = null) {
        this.workspaceDir = workspaceDir;
        this.kg = knowledgeGraph;
        this.workspace = workspace;
    }

    getDefinitions() {
        return {
            function_declarations: TOOL_DEFINITIONS
        };
    }

    async execute(name, args) {
        try {
            switch (name) {
                case 'read_file': return await this.readFile(args.path);
                case 'list_files': return await this.listFiles(args.path, args.recursive);
                case 'run_command': return await this.runCommand(args.command);
                case 'write_file': return await this.writeFile(args.path, args.content);
                case 'replace_in_file': return await this.replaceInFile(args.path, args.search, args.replace);
                case 'search_files': return await this.searchFiles(args.pattern, args.path);
                case 'search_symbols': return await this.searchSymbols(args.query);
                case 'fetch_url': return await this.fetchUrl(args.url);
                default: return `Error: Unknown tool ${name}`;
            }
        } catch (e) {
            return `Error executing ${name}: ${e.message}`;
        }
    }

    async fetchUrl(url) {
        try {
            // Using global fetch if available (Node 18+), otherwise need polyfill.
            // Assuming Node 18+ for this environment.
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
        // Use workspace.writeFile if available to benefit from cleanCode logic
        if (this.workspace) {
            await this.workspace.writeFile(filePath, content);
        } else {
            await fs.outputFile(fullPath, content);
        }
        
        // Update Knowledge Graph
        if (this.kg) {
            const updatedContent = await fs.readFile(fullPath, 'utf8');
            await this.kg.indexFile(path.relative(this.workspaceDir, fullPath), updatedContent);
        }

        // Syntax Validation
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
            // Use robust applyPatch logic
            result = await this.workspace.applyPatch(filePath, search, replace);
        } else {
            // Fallback to basic match
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
            // Update Knowledge Graph
            if (this.kg) {
                const newContent = await fs.readFile(fullPath, 'utf8');
                await this.kg.indexFile(path.relative(this.workspaceDir, fullPath), newContent);
            }
            
            // Syntax Validation
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
        const files = await this.listFiles(dirPath, true);
        const fileList = files.split('\n');
        let results = "";
        const regex = new RegExp(pattern, 'g');
        
        for (const file of fileList) {
            try {
                const content = await this.readFile(file);
                if (content.match(regex)) {
                    results += `Match in ${file}\n`;
                }
            } catch (e) {}
        }
        return results || "No matches found.";
    }

    async searchSymbols(query) {
        if (!this.kg) return "Error: Knowledge Graph not active.";
        const files = this.kg.getRelevantFiles(query);
        if (files.length === 0) return "No relevant symbols found in Knowledge Graph.";
        
        return `Found relevant symbols in:\n${files.join('\n')}`;
    }
}

module.exports = { ToolSet, TOOL_DEFINITIONS };
