# Performance Optimizations Applied

## Summary
This document details the performance optimizations applied to Clawd Cursor core files.

---

## 1. ai-brain.ts — Screenshot Hash Cache + Exponential Backoff

### Changes
- **Added screenshot hash caching** to skip redundant LLM calls when the screen hasn't changed
  - Samples 1KB evenly spaced from screenshot buffer for fast comparison (cheaper than full MD5)
  - Caches the last LLM decision and returns it immediately when screenshot is unchanged
  - Cache is cleared when conversation is reset or task is done

- **Added exponential backoff with jitter** for LLM retries in `callLLMText()`
  - Backoff: `Math.min(1000 * Math.pow(2, attempt), 8000) + Math.random() * 1000`
  - Prevents thundering herd and reduces API rate limit pressure

### Expected Impact
- **50-90% reduction in LLM calls** for static or slowly-changing screens
- More resilient retry behavior for transient API failures
- Reduced API costs and faster task completion

---

## 2. agent.ts — Parallel Screenshot+A11y Fetch + Async Debug Writes

### Changes
- **Parallelized screenshot and accessibility context fetch** in `executeLLMFallback()`
  - Uses `Promise.all()` to fetch both simultaneously instead of sequentially
  - A11y context is best-effort and won't block screenshot capture

- **Made debug file writes non-blocking**
  - Changed from `fs.writeFileSync()` to async `writeFile()` from `fs/promises`
  - Uses `.catch(() => {})` to silently ignore errors (debug writes are non-critical)

### Expected Impact
- **~20-50ms faster per LLM step** (parallel fetch vs sequential)
- Debug writes no longer block the event loop
- Smoother UI responsiveness during task execution

---

## 3. vnc-client.ts — Adaptive VNC Frame Wait

### Changes
- **Replaced fixed 800ms delay with adaptive polling**
  - New `waitForFrameUpdate()` method polls for rect updates every 50ms
  - Waits minimum 100ms for rects to batch, then polls until received or max wait (800ms)
  - Falls back gracefully to max wait for static screens

- **Added `pendingRectReceived` tracking**
  - Resets flag before requesting update, sets on 'rect' event
  - Ensures we capture the freshest frame possible

### Expected Impact
- **Up to 700ms faster per screenshot** when UI is changing rapidly
- Maintains reliability for static screens
- Overall snappier response during interactive tasks

---

## 4. accessibility.ts — 500ms TTL Screen Context Cache

### Changes
- **Added 500ms TTL cache for `getScreenContext()`**
  - Caches the formatted window list + taskbar buttons
  - Skips expensive PowerShell queries when called within TTL window
  - Cache is bypassed when `focusedProcessId` is provided (UI tree always fetched fresh)
  - Cache invalidated on window state changes via `invalidateCache()`

### Expected Impact
- **~50-100ms saved per LLM step** (context reused within 500ms)
- Reduces PowerShell process spawn overhead
- Better performance for rapid-fire actions on same screen

---

## Files Modified
- `src/ai-brain.ts` — Screenshot hash cache, exponential backoff
- `src/agent.ts` — Parallel fetch, async debug writes
- `src/vnc-client.ts` — Adaptive frame wait
- `src/accessibility.ts` — Screen context cache

## Backups
Original files backed up as `.orig` in `src/`:
- `src/ai-brain.ts.orig`
- `src/agent.ts.orig`
- `src/vnc-client.ts.orig`
- `src/accessibility.ts.orig`

## Build Status
- ✅ `npx tsc --noEmit` passes with zero errors
- ✅ `npx tsc` full build succeeds
