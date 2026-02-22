<p align="center">
  <img src="docs/favicon.svg" width="80" alt="Clawd Cursor">
</p>

<h1 align="center">Clawd Cursor</h1>

<p align="center">
  <strong>AI Desktop Agent — Native Screen Control</strong><br>
  Native Computer Use for complex tasks · Action Router for instant simple ones
</p>

<p align="center">
  <a href="https://clawdcursor.com">Website</a> · <a href="#quick-start">Quick Start</a> · <a href="#how-it-works">How It Works</a> · <a href="#api-endpoints">API</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

---

## What's New in v0.4.0

**Native desktop control.** Clawd Cursor no longer requires a VNC server. Desktop interaction is handled natively via [@nut-tree-fork/nut-js](https://github.com/nut-tree-fork/nut-js) — direct OS-level screen capture and input.

- **17× faster screenshots** — ~50ms native capture vs ~850ms over VNC
- **5× faster connect time** — ~38ms vs ~200ms+
- **Zero server setup** — no TightVNC, no VNC password, just `npm install && npm start`
- **Simpler onboarding** — three commands to get started
- **RGBA natively** — no more BGRA→RGBA color swap

### Performance Comparison

| Metric | v0.3 (VNC) | v0.4 (Native) |
|--------|-----------|---------------|
| Screenshot capture | ~850ms | ~50ms (17× faster) |
| Connect time | ~200ms+ | ~38ms (5× faster) |
| Simple task total | ~115–120s | ~101s |
| Complex task total | ~190–200s | ~156s |

---

## What is this?

Your AI controls your desktop natively — direct screen capture and OS-level mouse/keyboard input. Depending on the provider, it either:

**Path A — Computer Use API (Anthropic):** Claude receives the full task, takes screenshots of your desktop, and executes actions natively through the `computer_20250124` tool. It plans multi-step sequences, handles errors, and verifies results — all within a single conversation loop.

```
User: "Open Chrome, go to Google Docs, write a paragraph about dogs"

  Claude sees the desktop → plans the sequence → executes step by step
  10 API calls · 101.7s · All steps verified
```

**Path B — Decompose + Action Router (OpenAI/Offline):** The original approach. A text-only LLM call breaks the task into subtasks. The Action Router handles each one via Windows UI Automation (no screenshots, no vision). If the router can't handle a step, it falls back to vision.

```
User: "Open Notepad"

  1. Parse → 1 subtask (text LLM, fast)
  2. Action Router → find Notepad via UI Automation, launch it (no LLM)
  
  Total LLM calls: 1 (just parsing) · ~2s
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
AI_PROVIDER=anthropic
```

Run with Computer Use (recommended):
```bash
npm start -- --provider anthropic
```

Run with Action Router (fast/offline):
```bash
npm start -- --provider openai
```

Send a task:
```bash
curl http://localhost:3847/task -d '{"task": "Open Notepad and type hello world"}'
```

## How It Works

### Path A — Computer Use API

When `--provider anthropic` is set, the entire task is sent to Claude along with the `computer_20250124` tool definition. Claude:

1. Takes a screenshot of the desktop (native capture, ~50ms)
2. Plans the next action (click, type, key press, scroll, drag)
3. Executes via native desktop control (@nut-tree-fork/nut-js)
4. Waits with adaptive delays (1000ms app launch, 800ms navigation, 100ms typing)
5. Receives verification hint, screenshots again
6. Repeats until the task is complete

Key details:
- **Display**: Scaled to 1280×720 for API compatibility
- **Model**: `claude-sonnet-4-20250514`
- **Header**: `anthropic-beta: computer-use-2025-01-24`
- **System prompt**: Planning rules, ctrl+l for URLs, recovery strategies
- **Mouse drag**: Smooth interpolation between points

### Path B — Decompose + Action Router

The original v0.1.0 pipeline:

1. **Decompose** — Single text-only LLM call breaks the request into atomic subtasks
2. **Action Router** — Queries Windows UI Automation tree. Finds elements by name, invokes them directly. Zero LLM calls.
3. **Vision Fallback** — Only when the router can't handle a step: screenshot → vision LLM → coordinates → click

## Architecture

```
┌──────────────────────────────────────────────────┐
│            Your Desktop (Native Control)          │
│         @nut-tree-fork/nut-js · OS-level          │
└──────────────────────┬───────────────────────────┘
                       │ Native Screen Capture + Input
┌──────────────────────┴───────────────────────────┐
│              Clawd Cursor Agent                   │
│                                                   │
│  ┌─────────────┐          ┌────────────────────┐ │
│  │  PATH A      │          │  PATH B            │ │
│  │  Computer    │          │  Decompose +       │ │
│  │  Use API     │          │  Action Router     │ │
│  │              │          │                    │ │
│  │  Claude sees │          │  Parse → subtasks  │ │
│  │  screen,     │          │  UI Automation     │ │
│  │  plans, acts │          │  (no LLM)          │ │
│  │  natively    │          │  Vision fallback   │ │
│  └──────┬───────┘          └────────┬───────────┘ │
│         │ --provider anthropic      │ --provider  │
│         │                           │ openai      │
│         └───────────┬───────────────┘             │
│                     ↓                             │
│              Safety Layer                         │
│              REST API / CLI                       │
└───────────────────────────────────────────────────┘
```

## Test Results (v0.4.0 — Computer Use)

| Task | Time | API Calls | Result |
|------|------|-----------|--------|
| Open Chrome → Google Docs → write sentence | 101.7s | 10 | ✅ |
| GitHub profile → read repos → Notepad → save file | 156s | 18 | ✅ |
| Open Paint → draw stick figure | ~45s | N/A (scripted) | ✅ |

## API Endpoints

`http://localhost:3847`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/task` | POST | Execute a task: `{"task": "Open Chrome"}` |
| `/status` | GET | Agent state and current task |
| `/confirm` | POST | Approve/reject pending action |
| `/abort` | POST | Stop the current task |

## Manual Setup

If you prefer manual setup:

### 1. Install Dependencies

```bash
npm install
npm run build
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `AI_API_KEY` | **Yes** | Anthropic or OpenAI API key | `sk-ant-api03-...` |
| `AI_PROVIDER` | No | AI provider: `anthropic` or `openai` | `anthropic` |
| `ANTHROPIC_API_KEY` | No | Specific Anthropic API key (overrides AI_API_KEY) | `sk-ant-...` |
| `OPENAI_API_KEY` | No | Specific OpenAI API key (overrides AI_API_KEY) | `sk-...` |

### 3. Start the Agent

```bash
npm start
```

## Configuration

### CLI Options

```
--port <port>          API port (default: 3847)
--provider <provider>  anthropic (Computer Use) | openai (Action Router)
--model <model>        Vision model
--api-key <key>        AI provider API key
```

### Environment Variables

All CLI options can be set in `.env`:

```env
AI_API_KEY=sk-ant-api03-...
AI_PROVIDER=anthropic
AI_MODEL=claude-sonnet-4-20250514
```

## Safety Tiers

| Tier | Actions | Behavior |
|------|---------|----------|
| 🟢 Auto | Navigation, reading, opening apps | Runs immediately |
| 🟡 Preview | Typing, form filling | Logs before executing |
| 🔴 Confirm | Sending messages, deleting, purchases | Pauses for approval |

## Prerequisites

- **Node.js 20+**
- **PowerShell** (Windows) — for UI Automation features (Path B)
- **AI API Key** — Anthropic recommended for Computer Use (Path A). OpenAI optional for Path B. Works offline for common tasks via Action Router.

## Tech Stack

TypeScript · Node.js · @nut-tree-fork/nut-js (native desktop control) · sharp (screenshots) · Express + WebSocket · Anthropic Computer Use API · Windows UI Automation via PowerShell

## ClaWHub

Coming soon to ClaWHub — install with `openclaw skills install clawd-cursor`

## License

MIT

---

<p align="center">
  <a href="https://clawdcursor.com">clawdcursor.com</a>
</p>
