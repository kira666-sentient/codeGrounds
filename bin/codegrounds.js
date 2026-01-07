#!/usr/bin/env node

const Orchestrator = require('../lib/Orchestrator');
const Workspace = require('../lib/Workspace');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from the current directory
dotenv.config({ path: path.join(process.cwd(), '.env') });

async function main() {
    console.clear();
    console.log(chalk.cyan.bold('╔════════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('║           CODEGROUNDS 7.0              ║'));
    console.log(chalk.cyan.bold('║      Autonomous AI Coding Studio       ║'));
    console.log(chalk.cyan.bold('╚════════════════════════════════════════╝'));
    console.log('');

    // Check if .env exists
    const hasKeys = [1,2,3,4,5,6].some(i => process.env[`GEMINI_API_KEY_${i}`]) || process.env.GEMINI_API_KEY;

    if (!hasKeys) {
        console.error(chalk.red('Error: No Gemini API keys found.'));
        console.log(chalk.yellow('Please create a .env file in this directory.'));
        process.exit(1);
    }

    const workspace = new Workspace();
    let projects = [];
    try {
        projects = await workspace.getProjects();
    } catch (e) {}

    const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'Select an option:',
        choices: [
            { name: '✨ Create New Project', value: 'new' },
            ...(projects.length > 0 ? [{ name: '📂 Resume Existing Project', value: 'resume' }] : []),
            { name: '❌ Exit', value: 'exit' }
        ]
    }]);

    if (action === 'exit') process.exit(0);

    let projectPath = null;
    let userPrompt = "";

    if (action === 'resume') {
        const { selectedProject } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedProject',
            message: 'Select a project to resume:',
            choices: projects.map(p => ({ name: p.name, value: p.path }))
        }]);
        projectPath = selectedProject;
        
        const { updateRequest } = await inquirer.prompt([{
            type: 'input',
            name: 'updateRequest',
            message: 'What would you like to update/change/add?',
            validate: input => input.trim().length > 0 ? true : 'Please enter a request.'
        }]);
        userPrompt = updateRequest;
    } else {
        const { newPrompt } = await inquirer.prompt([{
            type: 'input',
            name: 'newPrompt',
            message: chalk.green('What would you like the team to build?'),
            validate: input => input.trim().length > 0 ? true : 'Please enter a description.'
        }]);
        userPrompt = newPrompt;
    }

    const orchestrator = new Orchestrator();
    try {
        await orchestrator.run(userPrompt, projectPath);
    } catch (error) {
        console.error(chalk.red('\n❌ System Error:'), error.message);
        if (process.env.DEBUG) console.error(error);
    }
}

main();
