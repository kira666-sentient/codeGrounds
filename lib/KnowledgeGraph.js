const fs = require('fs-extra');
const path = require('path');

class KnowledgeGraph {
    constructor(workspaceDir) {
        this.workspaceDir = workspaceDir;
        this.indexPath = path.join(workspaceDir, 'codegrounds.index.json');
        this.symbols = {}; // symbol_name -> { file, type, signature }
        this.fileMap = {}; // file -> [symbols]
    }

    async load() {
        if (await fs.pathExists(this.indexPath)) {
            try {
                const data = await fs.readJson(this.indexPath);
                this.symbols = data.symbols || {};
                this.fileMap = data.fileMap || {};
            } catch (e) {}
        }
    }

    async save() {
        await fs.writeJson(this.indexPath, { 
            symbols: this.symbols,
            fileMap: this.fileMap 
        }, { spaces: 2 });
    }

    async indexFile(filePath, content) {
        // Clear old symbols for this file
        if (this.fileMap[filePath]) {
            this.fileMap[filePath].forEach(symName => {
                if (this.symbols[symName]) {
                    // Filter out entries belonging to this file
                    this.symbols[symName] = this.symbols[symName].filter(entry => entry.file !== filePath);
                    // If empty, delete key
                    if (this.symbols[symName].length === 0) {
                        delete this.symbols[symName];
                    }
                }
            });
        }
        this.fileMap[filePath] = [];

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
        
        for (const pat of patterns) {
            let match;
            // Reset regex state just in case
            pat.regex.lastIndex = 0;
            while ((match = pat.regex.exec(content)) !== null) {
                const name = match[1];
                
                if (!this.symbols[name]) {
                    this.symbols[name] = [];
                }
                
                this.symbols[name].push({ 
                    file: filePath, 
                    type: pat.type, 
                    signature: match[0].substring(0, 100) // Truncate signature 
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
                // this.symbols[token] is now an array
                this.symbols[token].forEach(entry => seenFiles.add(entry.file));
            }
        }
        return Array.from(seenFiles);
    }
}

module.exports = KnowledgeGraph;
