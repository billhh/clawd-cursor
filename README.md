<p align="center">
  <img src="docs/favicon.svg" width="80" alt="Clawd Cursor">
</p>

<h1 align="center">Clawd Cursor</h1>

<p align="center">
  <strong>AI Desktop Agent that thinks like a screen reader</strong><br>
  80% of tasks need zero LLM calls · 6x faster · 30x cheaper
</p>

<p align="center">
  <a href="https://clawdcursor.com">Website</a> · <a href="#quick-start">Quick Start</a> · <a href="#how-it-actually-works">How It Works</a> · <a href="#api-endpoints">API</a>
</p>

---

## What is this?

Your AI connects to your desktop via VNC — like a remote user. But instead of staring at pixels, it reads the **UI Automation tree** (the same system screen readers use). Common tasks like opening apps, clicking buttons, and typing text happen instantly without any LLM calls.

When something unfamiliar comes up, it falls back to vision AI.

```
User: "Open Chrome and go to github.com"

  1. Parse → decompose into subtasks (text LLM, fast)
  2. Action Router → find Chrome in taskbar via UI Automation, click it (no LLM)
  3. Type URL → VNC keystrokes (no LLM)
  
  Total LLM calls: 1 (just parsing)
  Time: ~1.5s
```

## Quick Start

```bash
git clone https://github.com/AmrDab/clawd-cursor.git
cd clawd-cursor
npm install && npm run build
```

Set up your `.env`:
```env
AI_API_KEY=sk-ant-api03-...
VNC_PASSWORD=yourpass
```

Run it:
```bash
npm start -- --vnc-password yourpass
```

Send a task:
```bash
curl http://localhost:3847/task -d '{"task": "Open Notepad and type hello world"}'
```

### Windows One-Command Setup

```powershell
git clone https://github.com/AmrDab/clawd-cursor.git
cd clawd-cursor
powershell -ExecutionPolicy Bypass -File setup.ps1
```

The setup script downloads TightVNC, installs deps, builds TypeScript, and creates `.env`.

## How It Actually Works

### Two paths, fastest wins

**Path A — Action Router (80% of tasks, zero LLM)**

Uses Windows UI Automation to handle common patterns directly:

| Pattern | What happens |
|---------|-------------|
| `open [app]` | Find in taskbar/start menu → click via accessibility tree |
| `type [text]` | VNC keystroke injection |
| `click [button]` | Find element by name in UI tree → invoke |
| `go to [url]` | Focus browser → Ctrl+L → type |
| `focus [window]` | Win32 `SetForegroundWindow` |

**Path B — Vision Fallback (complex stuff)**

Screenshot → vision LLM → coordinates → VNC click. Only used when the router can't handle it.

### Why it matters

- **~500ms** for "Open Paint" (no LLM round-trip)
- **80%** of common tasks use zero tokens
- **UI Automation** is more precise than pixel-clicking
- **Privacy** — common actions never leave your machine

## Architecture

```
┌──────────────────────────┐
│     Your Desktop         │
│   (VNC Server running)   │
└──────────┬───────────────┘
           │ VNC Protocol
┌──────────┴───────────────┐
│   Clawd Cursor Agent     │
│                          │
│   VNC Client (rfb2)      │
│         ↓                │
│   Action Router          │  ← UI Automation (no LLM)
│         ↓                │
│   AI Brain (fallback)    │  ← Vision LLM when needed
│         ↓                │
│   Safety Layer           │  ← Tiered confirmations
│         ↓                │
│   REST API / CLI         │
└──────────────────────────┘
```

## API Endpoints

`http://localhost:3847`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/task` | POST | Execute a task: `{"task": "Open Chrome"}` |
| `/status` | GET | Agent state and current task |
| `/confirm` | POST | Approve/reject pending action |
| `/abort` | POST | Stop the current task |

## Configuration

### CLI Options

```
--vnc-host <host>      VNC server host (default: localhost)
--vnc-port <port>      VNC server port (default: 5900)
--vnc-password <pass>  VNC password
--port <port>          API port (default: 3847)
--provider <provider>  anthropic | openai
--model <model>        Vision model
--api-key <key>        AI provider API key
```

### Environment Variables

All CLI options can be set in `.env`:

```env
AI_API_KEY=sk-ant-api03-...
VNC_HOST=localhost
VNC_PORT=5900
VNC_PASSWORD=yourpass
AI_PROVIDER=anthropic
AI_MODEL=claude-opus-4
```

## Safety Tiers

| Tier | Actions | Behavior |
|------|---------|----------|
| 🟢 Auto | Navigation, reading, opening apps | Runs immediately |
| 🟡 Preview | Typing, form filling | Logs before executing |
| 🔴 Confirm | Sending messages, deleting, purchases | Pauses for approval |

## Prerequisites

- **Node.js 20+**
- **VNC Server** — [TightVNC](https://www.tightvnc.com/) (Windows), built-in Screen Sharing (macOS), `x11vnc`/`tigervnc` (Linux)
- **PowerShell** (Windows) — for UI Automation features
- **AI API Key** — Anthropic or OpenAI (optional — works offline for common tasks)

## Tech Stack

TypeScript · Node.js · rfb2 (VNC) · sharp (screenshots) · Express + WebSocket · Windows UI Automation via PowerShell

## License

MIT

---

<p align="center">
  <a href="https://clawdcursor.com">clawdcursor.com</a>
</p>
