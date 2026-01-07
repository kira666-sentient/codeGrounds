const fs = require('fs-extra');
const path = require('path');

class Blackboard {
    constructor(workspaceDir) {
        this.workspaceDir = workspaceDir;
        this.statePath = path.join(workspaceDir, 'codegrounds.state.json');
        this.state = {
            project: {
                name: '',
                description: '',
                goals: [],
                deltas: [] // List of changes in requirements
            },
            architecture: {
                stack: '',
                phases: [],
                files: {} // path -> { description, status, lastAudit }
            },
            checkpoint: {
                lastPhase: 0,
                lastFile: '',
                timestamp: null
            },
            qa: {
                bugs: [], // { id, description, status, file, qualityScore }
                testResults: []
            },
            history: [] // Chronological log of major events
        };
    }

    async load() {
        if (await fs.pathExists(this.statePath)) {
            try {
                const savedState = await fs.readJson(this.statePath);
                // Smart Migration: Merge saved state with defaults to handle new fields
                this.state = {
                    ...this.state,
                    ...savedState,
                    project: { ...this.state.project, ...savedState.project },
                    architecture: { ...this.state.architecture, ...savedState.architecture },
                    checkpoint: { ...this.state.checkpoint, ...savedState.checkpoint },
                    qa: { ...this.state.qa, ...savedState.qa }
                };
            } catch (e) {
                console.error("Failed to load blackboard state, resetting:", e.message);
            }
        } else {
            await this.save();
        }
    }

    async save() {
        await fs.writeJson(this.statePath, this.state, { spaces: 2 });
    }

    async updateProject(details) {
        Object.assign(this.state.project, details);
        this.recordEvent('PROJECT_UPDATE', `Updated project details: ${details.description}`);
        await this.save();
    }

    async setArchitecture(arch) {
        this.state.architecture = arch;
        this.recordEvent('ARCH_UPDATE', 'Architecture defined');
        await this.save();
    }

    async logBug(bug) {
        this.state.qa.bugs.push({ ...bug, status: 'open', id: Date.now().toString() });
        this.recordEvent('BUG_REPORT', `Bug found in ${bug.file}`);
        await this.save();
    }

    async resolveBug(id) {
        const bug = this.state.qa.bugs.find(b => b.id === id);
        if (bug) bug.status = 'resolved';
        await this.save();
    }

    async saveCheckpoint(phaseIndex, filePath) {
        this.state.checkpoint = {
            lastPhase: phaseIndex,
            lastFile: filePath,
            timestamp: new Date().toISOString()
        };
        await this.save();
    }

    async updateFileStatus(filePath, status, auditReport = null) {
        if (!this.state.architecture.files) this.state.architecture.files = {};
        this.state.architecture.files[filePath] = {
            status,
            lastAudit: auditReport,
            updatedAt: new Date().toISOString()
        };
        await this.save();
    }

    recordEvent(type, message) {
        this.state.history.push({
            timestamp: new Date().toISOString(),
            type,
            message
        });
        // Keep history manageable
        if (this.state.history.length > 50) this.state.history.shift();
    }

    addMessage(from, to, content) {
        if (!this.state.messages) this.state.messages = [];
        this.state.messages.push({
            timestamp: new Date().toISOString(),
            from,
            to,
            content
        });
        if (this.state.messages.length > 20) this.state.messages.shift();
    }

    getSnapshot() {
        return JSON.stringify(this.state, null, 2);
    }
}

module.exports = Blackboard;
