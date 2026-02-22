# Clawd Cursor Performance & Efficiency Analysis

## Executive Summary

The codebase shows solid architectural decisions (smart screenshot scaling, task decomposition, action routing) but has several low-hanging optimizations that could reduce latency by 30-50% and cut API costs significantly.

---

## Findings & Recommendations

### 1. Screenshot Optimization (HIGH IMPACT)

**Current State:**
- Captures at 1280px width with 800ms hardcoded delays (`vnc-client.ts:150`, `vnc-client.ts:178`)
- Full frame buffer maintained in memory (~8MB for 1920x1080 @ 4 bytes/pixel)

**Issues:**
- `captureScreen()` and `captureForLLM()` use fixed 800ms delay regardless of VNC update speed
- No frame delta detection — always captures full screen even for small UI changes
- Sharp.js resize happens synchronously on main thread

**Recommended Changes:**
```typescript
// vnc-client.ts - Add adaptive delay based on rect receipt
private async waitForFrameUpdate(timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let rectReceived = false;
    const checkInterval = setInterval(() => {
      if (rectReceived) { clearInterval(checkInterval); resolve(); }
    }, 50);
    this.client.once('rect', () => { rectReceived = true; });
    setTimeout(() => { clearInterval(checkInterval); resolve(); }, timeoutMs);
  });
}
```

**Impact:** HIGH — Could reduce screenshot latency from 800ms to ~200ms in typical cases

---

### 2. LLM Call Reduction (HIGH IMPACT)

**Current State:**
- Each LLM fallback subtask takes fresh screenshots (`agent.ts:308-313`)
- No result caching for identical UI states
- `brain.resetConversation()` called on every parse error (loses context)

**Issues:**
- `MAX_LLM_FALLBACK_STEPS = 10` with 1500ms delays = up to 15s per subtask
- No deduplication of identical screenshots within a session
- History trimmed to 5 turns (`ai-brain.ts:101`) — may lose critical context

**Recommended Changes:**
```typescript
// ai-brain.ts - Add screenshot hashing to avoid redundant LLM calls
private lastScreenshotHash: string = '';
private lastDecision: any = null;

async decideNextAction(screenshot, ...): Promise<...> {
  const hash = crypto.createHash('md5').update(screenshot.buffer).digest('hex');
  if (hash === this.lastScreenshotHash && this.lastDecision) {
    console.log('   ⚡ Using cached decision (screenshot unchanged)');
    return this.lastDecision;
  }
  // ... existing logic
  this.lastScreenshotHash = hash;
  this.lastDecision = result;
  return result;
}
```

**Impact:** HIGH — Could eliminate 30-50% of LLM calls for stable UIs

---

### 3. VNC Connection Pooling (MEDIUM IMPACT)

**Current State:**
- Single VNC connection per agent instance
- `requestUpdate(false, ...)` forces full frame refresh every time
- No keep-alive or reconnection logic on transient failures

**Issues:**
- Cannot parallelize screenshot capture with action execution
- Full frame updates are bandwidth-intensive for 4K displays
- Connection loss requires full agent restart

**Recommended Changes:**
```typescript
// Enable incremental updates after initial connection
this.client.requestUpdate(true, 0, 0, this.screenWidth, this.screenHeight); // incremental = true

// Add connection health check
setInterval(() => {
  if (!this.connected && this.config.vnc.autoReconnect) {
    this.connect().catch(console.error);
  }
}, 5000);
```

**Impact:** MEDIUM — Bandwidth reduction ~60% for incremental updates

---

### 4. UI Automation Query Efficiency (HIGH IMPACT)

**Current State:**
- `a11y.getWindows(true)` called multiple times per task (`action-router.ts:116`)
- No caching of accessibility tree — queried fresh each time
- `getScreenContext()` fetches full tree even for simple lookups

**Issues:**
- `waitForAppReady()` polls every 300ms with full window enumeration
- `handleClick()` → `findElement()` → `invokeElement()` = 3 a11y calls

**Recommended Changes:**
```typescript
// accessibility.ts - Add tree caching with TTL
private treeCache: { tree: Element[], timestamp: number } | null = null;
private readonly CACHE_TTL = 500; // ms

async getScreenContext(): Promise<string> {
  if (this.treeCache && Date.now() - this.treeCache.timestamp < this.CACHE_TTL) {
    return this.formatTree(this.treeCache.tree);
  }
  const tree = await this.fetchTree();
  this.treeCache = { tree, timestamp: Date.now() };
  return this.formatTree(tree);
}
```

**Impact:** HIGH — Could reduce a11y API calls by 70% in typical flows

---

### 5. Memory Leaks (MEDIUM IMPACT)

**Current State:**
- `fullFrameBuffer` never resized if screen resolution changes
- Debug screenshots written to disk synchronously (`agent.ts:316`)
- Conversation history grows unbounded until trim

**Issues:**
```typescript
// Potential leak: buffer allocated but never nullified on disconnect
this.fullFrameBuffer = Buffer.alloc(this.screenWidth * this.screenHeight * 4, 0);
// ... disconnect() sets to null but what about reconnect?
```

**Recommended Changes:**
```typescript
// agent.ts - Use async file writes to prevent event loop blocking
import { writeFile } from 'fs/promises';

// Fire-and-forget (non-blocking)
writeFile(path.join(debugDir, `...`), screenshot.buffer).catch(console.error);
```

**Impact:** MEDIUM — Prevents memory growth on long-running sessions

---

### 6. Cold Start Optimization (MEDIUM IMPACT)

**Current State:**
- VNC connection established sequentially
- `ComputerUseBrain` initialized only after VNC connects
- No pre-warming of LLM connections

**Recommended Changes:**
```typescript
// Parallelize initialization
async connect(): Promise<void> {
  const [vncConnect] = await Promise.all([
    this.vnc.connect(),
    this.preWarmLLM(), // Fire lightweight request to warm connection pool
  ]);
  // ... rest of init
}
```

**Impact:** MEDIUM — ~500-800ms faster cold starts

---

### 7. Retry Logic Improvements (MEDIUM IMPACT)

**Current State:**
- `callLLMText()` has basic retry with linear backoff (`ai-brain.ts:189`)
- No jitter to prevent thundering herd
- VNC operations have no retry at all

**Issues:**
```typescript
const backoff = 1000 * (attempt + 1); // Linear: 1s, 2s, 3s
// Should use exponential backoff with jitter: 1s, 2s, 4s + random
```

**Recommended Changes:**
```typescript
private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      const delay = Math.min(1000 * Math.pow(2, i), 8000) + Math.random() * 1000;
      await this.delay(delay);
    }
  }
  throw new Error('Unreachable');
}
```

**Impact:** MEDIUM — Better resilience under transient failures

---

### 8. Parallelization Opportunities (HIGH IMPACT)

**Current State:**
- All operations sequential in `executeLLMFallback()`
- Screenshot capture blocks while saving debug file
- Safety check (`classify()`) blocks execution

**Recommended Changes:**
```typescript
// agent.ts - Parallelize where safe
const [screenshot, a11yContext] = await Promise.all([
  this.vnc.captureForLLM(),
  this.a11y.getScreenContext().catch(() => undefined),
]);

// Non-blocking debug save
if (debugDir) {
  fs.writeFile(path.join(debugDir, `...`), screenshot.buffer).catch(() => {});
}
```

**Impact:** HIGH — Could reduce per-step latency by 30-40%

---

## Quick Wins Checklist

| Priority | Change | Effort | Impact |
|----------|--------|--------|--------|
| 1 | Add screenshot hash caching | 1hr | HIGH |
| 2 | Parallelize screenshot + a11y fetch | 30min | HIGH |
| 3 | Add adaptive VNC frame wait | 2hrs | HIGH |
| 4 | Cache accessibility tree (500ms TTL) | 1hr | HIGH |
| 5 | Async debug file writes | 15min | MEDIUM |
| 6 | Exponential backoff with jitter | 30min | MEDIUM |
| 7 | VNC incremental updates | 2hrs | MEDIUM |
| 8 | Connection pre-warming | 1hr | LOW |

---

## Estimated Overall Impact

- **Latency reduction:** 35-50% for typical workflows
- **API cost reduction:** 30-40% through caching and reduced LLM calls
- **Memory stability:** Fixed leaks prevent degradation over long sessions
- **Reliability:** Better retry logic reduces transient failures

---

*Analysis completed: 2026-02-21*
