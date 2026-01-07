const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');

class Workspace {
    constructor(baseDir = 'projects') {
        this.baseDir = path.resolve(process.cwd(), baseDir);
        this.projectDir = null;
    }

    async createProject(projectName) {
        // Sanitize project name
        const safeName = projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.projectDir = path.join(this.baseDir, `${safeName}_${timestamp}`);
        
        await fs.ensureDir(this.projectDir);
        
        // Initialize Git
        try {
            await this.initGit();
        } catch (e) {
            console.warn("Failed to initialize Git:", e.message);
        }

        console.log(`Created new workspace: ${this.projectDir}`);
        return this.projectDir;
    }

    async initGit() {
        if (!this.projectDir) return;
        await this.runCommand('git init');
        await this.runCommand('git add .');
        await this.runCommand('git commit -m "Initial commit: Project scaffold"');
    }

    async gitCommit(message) {
        if (!this.projectDir) return;
        try {
            await this.runCommand('git add .');
            await this.runCommand(`git commit -m "${message}"`);
        } catch (e) {
            // Ignore empty commits or errors
        }
    }

    setProjectDir(dirPath) {
        this.projectDir = dirPath;
    }

    async getProjects() {
        await fs.ensureDir(this.baseDir);
        const items = await fs.readdir(this.baseDir);
        const projects = [];
        for (const item of items) {
            const fullPath = path.join(this.baseDir, item);
            const stat = await fs.stat(fullPath);
            if (stat.isDirectory()) {
                projects.push({ name: item, path: fullPath });
            }
        }
        // Sort by newest first
        return projects.sort((a, b) => b.name.localeCompare(a.name));
    }

    async writeFile(filePath, content) {
        if (!this.projectDir) throw new Error("Project not created yet. Call createProject() first.");
        
        // Remove markdown code blocks if present (```javascript ... ```)
        const cleanContent = this.cleanCode(content);
        
        const fullPath = path.join(this.projectDir, filePath);
        await fs.outputFile(fullPath, cleanContent);
        return fullPath;
    }

    async appendLog(message) {
        if (!this.projectDir) return;
        const logPath = path.join(this.projectDir, 'PROJECT_LOG.md');
        const timestamp = new Date().toLocaleTimeString();
        const entry = `\n## [${timestamp}] Update\n${message}\n`;
        await fs.appendFile(logPath, entry);
        return entry;
    }

    async readLog() {
        if (!this.projectDir) return "";
        const logPath = path.join(this.projectDir, 'PROJECT_LOG.md');
        try {
            return await fs.readFile(logPath, 'utf8');
        } catch (e) {
            return "";
        }
    }

    cleanCode(content) {
        // Attempt to extract content between ```...```
        // Allow for optional language identifier and flexible spacing
        const codeBlockRegex = /```(?:[\w\-\+]*)?\s*([\s\S]*?)```/g;
        const matches = [...content.matchAll(codeBlockRegex)];
        
        if (matches.length > 0) {
            // Strategy: Return the LARGEST code block found.
            // Often agents output small blocks for explanation (e.g. "Run this:") and one large block for the file.
            // Joining them causes syntax errors.
            return matches.reduce((longest, current) => {
                const currentContent = current[1].trim();
                return currentContent.length > longest.length ? currentContent : longest;
            }, "");
        }
        
        // Fallback: if content seems to be code but no markdown blocks, return it.
        // If it contains "Here is the code:" text, we might want to strip that, but strictly 
        // relying on markdown blocks is safer. If no blocks, we return raw content 
        // hoping the agent obeyed "Output ONLY code".
        return content;
    }

    async readFile(filePath) {
        if (!this.projectDir) throw new Error("Project not created");
        const fullPath = path.join(this.projectDir, filePath);
        return await fs.readFile(fullPath, 'utf8');
    }

    async listFiles() {
        if (!this.projectDir) throw new Error("Project not created");
        const files = [];
        async function getFiles(dir) {
            const items = await fs.readdir(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stat = await fs.stat(fullPath);
                if (stat.isDirectory()) {
                    await getFiles(fullPath);
                } else {
                    files.push(fullPath);
                }
            }
        }
        await getFiles(this.projectDir);
        return files.map(f => path.relative(this.projectDir, f));
    }

    async validateSyntax(filePath) {
        if (!this.projectDir) throw new Error("Project not created");
        const fullPath = path.join(this.projectDir, filePath);
        const ext = path.extname(fullPath);

        const checks = {
            '.js': `node --check "${fullPath}"`,
            '.py': `python3 -m py_compile "${fullPath}"`,
            '.go': `go vet "${fullPath}"`,
            '.rs': `rustc --crate-type lib --emit=metadata "${fullPath}"`,
            '.php': `php -l "${fullPath}"`,
            '.rb': `ruby -c "${fullPath}"`,
            '.ts': `tsc --noEmit "${fullPath}"`
        };

        if (checks[ext]) {
            return new Promise((resolve) => {
                exec(checks[ext], { cwd: this.projectDir }, (error, stdout, stderr) => {
                    if (error) {
                        resolve({ valid: false, error: stderr || stdout });
                    } else {
                        resolve({ valid: true });
                    }
                });
            });
        }
        
        if (ext === '.json') {
            try {
                const content = await fs.readFile(fullPath, 'utf8');
                JSON.parse(content);
                return { valid: true };
            } catch (e) {
                return { valid: false, error: e.message };
            }
        }

        return { valid: true }; // Unknown type, assume valid
    }

    async applyPatch(filePath, searchContent, replaceContent) {
        if (!this.projectDir) throw new Error("Project not created");
        const fullPath = path.join(this.projectDir, filePath);
        
        try {
            let content = await fs.readFile(fullPath, 'utf8');
            
            // 1. Try Exact Match
            const cleanSearch = searchContent.trim();
            if (content.includes(cleanSearch)) {
                const newContent = content.replace(cleanSearch, replaceContent.trim());
                await fs.outputFile(fullPath, newContent);
                return { success: true };
            }

            // 2. Try Robust Line-by-Line Match (Ignoring Whitespace and Empty Lines)
            const contentLines = content.split(/\r?\n/);
            
            // Map content lines to objects { text: trimmed, originalIndex: i }
            // Filter out empty lines
            const normalizedContent = contentLines
                .map((line, index) => ({ text: line.trim(), index }))
                .filter(l => l.text.length > 0);
                
            const normalizedSearch = cleanSearch
                .split(/\r?\n/)
                .map(l => l.trim())
                .filter(l => l.length > 0);
            
            if (normalizedSearch.length === 0) return { success: false, error: "Search content empty" };

            let matchStartIndex = -1;

            // Search for the sequence
            for (let i = 0; i <= normalizedContent.length - normalizedSearch.length; i++) {
                let match = true;
                for (let j = 0; j < normalizedSearch.length; j++) {
                    if (normalizedContent[i + j].text !== normalizedSearch[j]) {
                        match = false;
                        break;
                    }
                }
                
                if (match) {
                    matchStartIndex = i;
                    break;
                }
            }

            if (matchStartIndex !== -1) {
                // Found match!
                // Get the original line numbers
                const startLine = normalizedContent[matchStartIndex].index;
                const endLine = normalizedContent[matchStartIndex + normalizedSearch.length - 1].index;
                
                // Get indentation of the start line
                const originalIndentation = contentLines[startLine].match(/^\s*/)[0];
                
                // Prepare replacement with correct indentation
                const replaceLines = replaceContent.trim().split(/\r?\n/);
                const indentedReplace = replaceLines.map((line, i) => {
                    // If the line is empty, don't indent it
                    if (line.trim().length === 0) return "";
                    return originalIndentation + line;
                }).join('\n');

                // Construct new content
                const before = contentLines.slice(0, startLine);
                const after = contentLines.slice(endLine + 1);
                
                const newContent = [...before, indentedReplace, ...after].join('\n');
                await fs.outputFile(fullPath, newContent);
                return { success: true };
            }
            
            return { success: false, error: "Search content not found (even with robust match)." };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async runCommand(command) {
        if (!this.projectDir) throw new Error("Project not created");
        
        console.log(`Executing in ${this.projectDir}: ${command}`);
        return new Promise((resolve, reject) => {
            // timeout 5 minutes
            exec(command, { cwd: this.projectDir, timeout: 300000 }, (error, stdout, stderr) => {
                const combinedOutput = (stdout || '') + '\n' + (stderr || '');
                if (error) {
                    resolve({ success: false, output: combinedOutput, error: error.message });
                } else {
                    resolve({ success: true, output: combinedOutput });
                }
            });
        });
    }
}

module.exports = Workspace;
