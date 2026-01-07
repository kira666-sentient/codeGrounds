const fs = require('fs-extra');
const path = require('path');

class KnowledgeGraph {
    constructor(workspaceDir) {
        this.workspaceDir = workspaceDir;
        this.indexPath = path.join(workspaceDir, 'codegrounds.index.json');
        this.symbols = {}; // symbol_name -> [{ file, type, signature }]
        this.fileMap = {}; // file -> [symbols]
        this.dependencies = {}; // file -> [imported_files/modules]
    }

    async load() {
        if (await fs.pathExists(this.indexPath)) {
            try {
                const data = await fs.readJson(this.indexPath);
                this.symbols = data.symbols || {};
                this.fileMap = data.fileMap || {};
                this.dependencies = data.dependencies || {};
            } catch (e) {}
        }
    }

    async save() {
        await fs.writeJson(this.indexPath, { 
            symbols: this.symbols,
            fileMap: this.fileMap,
            dependencies: this.dependencies
        }, { spaces: 2 });
    }

    async indexFile(filePath, content) {
        // Clear old symbols for this file
        if (this.fileMap[filePath]) {
            for (const symName of this.fileMap[filePath]) {
                if (this.symbols[symName]) {
                    this.symbols[symName] = this.symbols[symName].filter(entry => entry.file !== filePath);
                    if (this.symbols[symName].length === 0) delete this.symbols[symName];
                }
            }
        }
        this.fileMap[filePath] = [];
        this.dependencies[filePath] = [];

        // Optimization: Don't index massive files like minified JS or large JSON
        if (content.length > 100000) return;

        // Robust Regex Extractor
        const patterns = [
            // JS/TS/Go/Rust/C/C++ Functions
            { type: 'function', regex: /(?:async\s+)?(?:function|func|def|fn|void|int|string|bool)\s+([a-zA-Z0-9_]+)\s*\(.*?\)/g },
            // Arrow Functions / Variable Assignments as Functions
            { type: 'function', regex: /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\(.*?\)\s*=>/g },
            // Classes/Structs/Interfaces
            { type: 'class', regex: /(?:class|struct|interface|type)\s+([a-zA-Z0-9_]+)/g },
            // Variables
            { type: 'variable', regex: /(?:const|let|var|global|static)\s+([a-zA-Z0-9_]+)\s*=/g },
            // Exports
            { type: 'export', regex: /(?:export|pub)\s+(?:const|let|var|function|class|struct|fn)?\s*([a-zA-Z0-9_]+)/g },
            // React Components (Functional)
            { type: 'component', regex: /function\s+([A-Z][a-zA-Z0-9_]*)\s*\(.*?\)\s*\{/g },
            // Method definitions in classes
            { type: 'method', regex: /^\s*([a-zA-Z0-9_]+)\s*\(.*?\)\s*\{/gm }
        ];

        // Dependency Extraction (Basic JS/TS)
        const depPatterns = [
            /require\(['"](.+?)['"]\)/g,
            /from\s+['"](.+?)['"]/g,
            /import\s+['"](.+?)['"]/g
        ];

        for (const regex of depPatterns) {
            let match;
            while ((match = regex.exec(content)) !== null) {
                this.dependencies[filePath].push(match[1]);
            }
        }
        
        for (const pat of patterns) {
            let match;
            pat.regex.lastIndex = 0;
            while ((match = pat.regex.exec(content)) !== null) {
                const name = match[1];
                
                if (!this.symbols[name]) {
                    this.symbols[name] = [];
                }
                
                this.symbols[name].push({ 
                    file: filePath, 
                    type: pat.type, 
                    signature: match[0].substring(0, 100) 
                });
                
                this.fileMap[filePath].push(name);
            }
        }

        await this.save();
    }

    getRelevantFiles(query) {
        const seenFiles = new Set();
        const tokens = query.split(/[^a-zA-Z0-9_]+/).filter(t => t.length > 3);
        
        for (const token of tokens) {
            if (this.symbols[token]) {
                this.symbols[token].forEach(entry => seenFiles.add(entry.file));
            }
        }
        return Array.from(seenFiles);
    }

    getDependencies(filePath) {
        return this.dependencies[filePath] || [];
    }

    getDependents(targetFile) {
        const dependents = [];
        for (const [file, deps] of Object.entries(this.dependencies)) {
            // Check if 'file' imports 'targetFile'
            // Naive check: does the import string contain the filename?
            // Realistically, we need to resolve paths, but for now we'll match on partials
            // or the exact relative path if possible.
            const targetBase = path.basename(targetFile, path.extname(targetFile));
            
            if (deps.some(d => d.includes(targetBase) || d.includes(targetFile))) {
                dependents.push(file);
            }
        }
        return dependents;
    }
}

module.exports = KnowledgeGraph;
