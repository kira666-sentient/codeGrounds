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
                goals: []
            },
            architecture: {
                stack: '',
                phases: [],
                files: {} // path -> description
            },
            qa: {
                bugs: [], // { id, description, status, file }
                testResults: []
            },
            history: [] // Chronological log of major events
        };
    }

    async load() {
        if (await fs.pathExists(this.statePath)) {
            try {
                this.state = await fs.readJson(this.statePath);
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

    recordEvent(type, message) {
        this.state.history.push({
            timestamp: new Date().toISOString(),
            type,
            message
        });
    }

    getSnapshot() {
        return JSON.stringify(this.state, null, 2);
    }
}

module.exports = Blackboard;
