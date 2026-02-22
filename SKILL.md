# Clawd Cursor

AI desktop agent that controls Windows/Mac via VNC. Lets AI see the screen, click, type, and automate any GUI application. Use when user wants to set up or use Clawd Cursor for desktop automation, VNC-based AI control, or GUI testing.

## Installation

```bash
# Clone the repository
git clone https://github.com/AmrDab/clawd-cursor.git
cd clawd-cursor

# Install dependencies
npm install

# Build TypeScript
npx tsc
```

### Windows One-Command Setup

```powershell
git clone https://github.com/AmrDab/clawd-cursor.git
cd clawd-cursor
powershell -ExecutionPolicy Bypass -File setup.ps1
```

The setup script downloads TightVNC, installs dependencies, builds TypeScript, and creates `.env`.

## Configuration

Create a `.env` file in the project root (or copy from `.env.example`):

```env
# Required: VNC Server connection
VNC_PASSWORD=your_vnc_password

# Required for AI features: API key
AI_API_KEY=sk-ant-api03-...

# Optional: AI Provider (anthropic or openai)
AI_PROVIDER=anthropic

# Optional: VNC connection settings
VNC_HOST=localhost
VNC_PORT=5900

# Optional: Specific provider API keys (override AI_API_KEY)
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
```

### Configuration Details

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `VNC_PASSWORD` | **Yes** | Password for VNC server | `mysecret123` |
| `AI_API_KEY` | For AI path | Anthropic or OpenAI API key | `sk-ant-api03-...` |
| `AI_PROVIDER` | No | Provider: `anthropic` or `openai` | `anthropic` |
| `VNC_HOST` | No | VNC server hostname | `localhost` |
| `VNC_PORT` | No | VNC server port | `5900` |
| `ANTHROPIC_API_KEY` | No | Specific Anthropic key | `sk-ant-...` |
| `OPENAI_API_KEY` | No | Specific OpenAI key | `sk-...` |

## How to Run

```bash
# Start the agent with Computer Use (Anthropic - recommended)
npm start -- --vnc-password yourpass --provider anthropic

# Or start with Action Router (OpenAI/offline)
npm start -- --vnc-password yourpass --provider openai

# Send a task via API
curl http://localhost:3847/task -d '{"task": "Open Notepad and type hello world"}'
```

## Execution Paths

Clawd Cursor has two execution paths depending on the provider:

### Path A: Computer Use API (Anthropic)

When `--provider anthropic` is set, the entire task goes directly to Claude with native `computer_20250124` tools. Claude sees the screen, plans multi-step sequences, and executes them natively.

- **Best for:** Complex multi-app workflows
- **Speed:** ~90-190s for complex tasks
- **Reliability:** Very high
- **Requires:** Anthropic API key
- **Model:** `claude-sonnet-4-20250514`

```
User: "Open Chrome, go to Google Docs, write a paragraph about dogs"

Claude sees the desktop → plans the sequence → executes step by step
14 API calls · 187s · All steps verified
```

### Path B: Decompose + Route + LLM Fallback (OpenAI/Offline)

For other providers, the task is decomposed into subtasks. The Action Router handles simple tasks via Windows UI Automation (zero LLM calls). If the router can't handle a step, it falls back to vision LLM.

- **Best for:** Simple single-action tasks
- **Speed:** ~2s for simple tasks
- **Reliability:** Good for supported patterns
- **Works offline:** Yes (for supported patterns)

```
User: "Open Notepad"

1. Parse → 1 subtask (text LLM, fast)
2. Action Router → find Notepad via UI Automation, launch it (no LLM)

Total LLM calls: 1 (just parsing) · ~2s
```

## Safety Tiers

| Tier | Actions | Behavior |
|------|---------|----------|
| 🟢 **Auto** | Navigation, reading, opening apps | Runs immediately |
| 🟡 **Preview** | Typing, form filling | Logs before executing |
| 🔴 **Confirm** | Sending messages, deleting, purchases | Pauses for approval |

Safety tier is determined by action classification. Confirm actions require POST to `/confirm {"approved": true}`.

## API Endpoints

Base URL: `http://localhost:3847`

| Endpoint | Method | Description | Example Request |
|----------|--------|-------------|-----------------|
| `/task` | POST | Execute a task | `{"task": "Open Chrome"}` |
| `/status` | GET | Get agent state | - |
| `/confirm` | POST | Approve/reject pending action | `{"approved": true}` |
| `/abort` | POST | Stop the current task | - |
| `/health` | GET | Health check | - |

## CLI Options

```
--vnc-host <host>      VNC server host (default: localhost)
--vnc-port <port>      VNC server port (default: 5900)
--vnc-password <pass>  VNC password (required)
--port <port>          API port (default: 3847)
--provider <provider>  anthropic (Computer Use) | openai (Action Router)
--model <model>        Vision model to use
--api-key <key>        AI provider API key
```

## Prerequisites

- **Node.js 20+**
- **VNC Server** — TightVNC (Windows), built-in Screen Sharing (macOS), x11vnc/tigervnc (Linux)
- **PowerShell** (Windows) — for UI Automation features (Path B)
- **AI API Key** — Anthropic recommended for Computer Use (Path A)

## Troubleshooting

- **VNC connection fails:** Make sure TightVNC server is running and password is correct
- **npm install fails:** Ensure Node.js 20+ is installed
- **Build fails:** Run `npx tsc` manually to see errors
- **AI features not working:** Check that `AI_API_KEY` is set in `.env`

## License

MIT
