# 🚀 CodeGrounds 8.0: Ultra-Autonomous AI Coding Studio

CodeGrounds is a state-of-the-art multi-agent software engineering studio powered by Google Gemini. It transforms your ideas into fully functional applications through a collaborative team of specialized AI agents.

## ✨ Why CodeGrounds?

Unlike traditional AI coding assistants, CodeGrounds operates as a **complete engineering team**. It doesn't just write code; it plans, architects, builds, tests, and self-corrects until the mission is complete.

- **FAST:** Optimized token management and parallel tool execution.
- **EFFICIENT:** "Surgical" updates—only modifies the lines that need changing.
- **RELIABLE:** Robust fuzzy-matching patching engine and automatic syntax validation.
- **QUALITY:** Integrated QA loop where the Debugger autonomously fixes its own bugs.
- **SMART:** Context-aware agents with a shared Blackboard and Knowledge Graph.

---

## 👥 Meet Your AI Team

- **Alex (PM):** Analyzes your prompt and defines clear, actionable requirements.
- **Sarah (Architect):** Designs the system architecture and chooses the best stack.
- **Coder (Lead Developer):** Writes clean, high-quality code with surgical precision.
- **Ops (DevOps):** Sets up the environment, installs dependencies, and manages builds.
- **Fixer (Senior Debugger):** Runs the app, identifies bugs, and fixes them autonomously.
- **Manager:** Oversees the entire project and ensures the plan is followed.
- **Tester (QA):** Writes and executes test suites to ensure everything works perfectly.

---

## 🛠️ Key Features

### 🧩 Surgical Iteration
Powered by a robust patching engine, CodeGrounds can iterate on existing projects without rewriting entire files. It understands indentation and code structure, making "seamless iteration" a reality.

### 🛡️ Syntax Guardrails
Every time code is written or modified, CodeGrounds automatically validates the syntax for languages like JavaScript, Python, Go, Rust, and more. If a mistake is made, the agent is notified immediately to self-correct.

### 🧠 Knowledge Graph & Blackboard
Agents share a centralized "Blackboard" for state management and a "Knowledge Graph" for fast symbol lookup across the entire project. This ensures everyone is always on the same page.

---

## 🚀 Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [Gemini API Keys](https://aistudio.google.com/)

### 2. Setup
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file and add your Gemini API keys:
   ```env
   GEMINI_API_KEY_1=your_key_here
   GEMINI_API_KEY_2=your_key_here
   # You can add up to 6 keys for better rate limiting
   ```

### 3. Usage
Run the studio:
```bash
node bin/codegrounds.js
```

- **✨ Create New Project:** Describe your idea (e.g., "Build a full-stack Todo app with React and Express").
- **📂 Resume Existing Project:** Select an existing project and tell the team what to change (e.g., "Add user authentication" or "Change the theme to dark mode").

---

## 📜 Roadmap
- [x] Multi-agent autonomous loop
- [x] Robust patching engine
- [x] Automatic syntax validation
- [x] Shared Knowledge Graph
- [ ] Integration with more LLM providers
- [ ] Web-based UI for real-time monitoring
- [ ] Support for complex microservices architectures

---

## ⚖️ License
MIT License. Built with ❤️ for the future of software engineering.
