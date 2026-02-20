/**
 * Accessibility Bridge — calls PowerShell scripts to query
 * the Windows UI Automation tree. No vision needed for most actions.
 * 
 * Flow: Node.js → spawn powershell → .NET UI Automation → JSON back
 * 
 * v2: Added window management helpers (focusWindow, launchApp, getActiveWindow)
 * v2.1: Fixed hardcoded process IDs, added PowerShell check, proper foreground window detection
 */

import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const PS_TIMEOUT = 10000; // 10s timeout for PowerShell calls

/** Cached PowerShell availability */
let psAvailable: boolean | null = null;

export interface UIElement {
  name: string;
  automationId: string;
  controlType: string;
  className: string;
  bounds: { x: number; y: number; width: number; height: number };
  children?: UIElement[];
}

export interface WindowInfo {
  handle: number;
  title: string;
  processName: string;
  processId: number;
  bounds: { x: number; y: number; width: number; height: number };
  isMinimized: boolean;
}

/** Cached window list with TTL */
interface WindowCache {
  windows: WindowInfo[];
  timestamp: number;
}

export class AccessibilityBridge {
  private windowCache: WindowCache | null = null;
  private readonly WINDOW_CACHE_TTL = 2000; // 2s cache for window list
  private explorerProcessId: number | null = null; // Cached Explorer PID for taskbar detection

  /**
   * Check if PowerShell is available on this system.
   * Caches result after first check.
   */
  async isPowerShellAvailable(): Promise<boolean> {
    if (psAvailable !== null) return psAvailable;
    
    try {
      await execFileAsync('powershell.exe', ['-Command', 'exit 0'], { timeout: 5000 });
      psAvailable = true;
    } catch {
      psAvailable = false;
      console.error('❌ PowerShell not available. Accessibility bridge will not function.');
    }
    return psAvailable;
  }

  /**
   * Get the Explorer process ID (for taskbar detection).
   * Caches result to avoid repeated lookups.
   */
  private async getExplorerProcessId(): Promise<number | null> {
    if (this.explorerProcessId !== null) return this.explorerProcessId;
    
    try {
      const windows = await this.getWindows(true);
      const explorer = windows.find(w => w.processName.toLowerCase() === 'explorer');
      if (explorer) {
        this.explorerProcessId = explorer.processId;
        return explorer.processId;
      }
    } catch {
      // Fall through to null
    }
    return null;
  }

  /**
   * List all visible top-level windows (cached for 2s)
   */
  async getWindows(forceRefresh = false): Promise<WindowInfo[]> {
    // Check PowerShell availability on first call
    if (psAvailable === null) {
      const available = await this.isPowerShellAvailable();
      if (!available) {
        throw new Error('PowerShell is not available. Accessibility features disabled.');
      }
    }
    
    if (
      !forceRefresh &&
      this.windowCache &&
      Date.now() - this.windowCache.timestamp < this.WINDOW_CACHE_TTL
    ) {
      return this.windowCache.windows;
    }

    const windows = await this.runScript('get-windows.ps1');
    this.windowCache = { windows, timestamp: Date.now() };
    return windows;
  }

  /**
   * Invalidate the window cache (call after actions that change window state)
   */
  invalidateCache(): void {
    this.windowCache = null;
  }

  /**
   * Get UI tree for a window (or all top-level if no processId)
   */
  async getUITree(processId?: number, maxDepth = 3): Promise<UIElement[]> {
    const args: string[] = [];
    if (processId) args.push('-ProcessId', String(processId));
    args.push('-MaxDepth', String(maxDepth));
    return this.runScript('get-ui-tree.ps1', args);
  }

  /**
   * Find elements matching criteria
   */
  async findElement(opts: {
    name?: string;
    automationId?: string;
    controlType?: string;
    processId?: number;
  }): Promise<UIElement[]> {
    const args: string[] = [];
    if (opts.name) args.push('-Name', opts.name);
    if (opts.automationId) args.push('-AutomationId', opts.automationId);
    if (opts.controlType) args.push('-ControlType', opts.controlType);
    if (opts.processId) args.push('-ProcessId', String(opts.processId));
    return this.runScript('find-element.ps1', args);
  }

  /**
   * Invoke an action on an element (click, set value, etc.)
   * Auto-discovers processId by finding the element first.
   * Falls back to coordinate click if element has bounds but no processId.
   */
  async invokeElement(opts: {
    name?: string;
    automationId?: string;
    controlType?: string;
    action: 'click' | 'set-value' | 'get-value' | 'focus' | 'expand' | 'collapse';
    value?: string;
    processId?: number;
  }): Promise<{ success: boolean; value?: string; error?: string; clickPoint?: { x: number; y: number } }> {
    let processId = opts.processId;
    let elementBounds: { x: number; y: number; width: number; height: number } | null = null;

    // Auto-discover processId if not provided
    if (!processId) {
      const searchOpts: any = {};
      if (opts.automationId) {
        searchOpts.automationId = opts.automationId;
      } else if (opts.controlType) {
        searchOpts.controlType = opts.controlType;
      }
      if (Object.keys(searchOpts).length === 0 && opts.name) {
        searchOpts.automationId = opts.name;
      }
      const elements = await this.findElement(searchOpts);
      if (!elements || elements.length === 0) {
        return { success: false, error: `Element not found: ${opts.name || opts.automationId}` };
      }
      const element = elements[0];
      processId = (element as any).processId;
      elementBounds = element.bounds;
      
      // Fallback to coordinate click if we have bounds but no processId
      if (!processId && elementBounds && elementBounds.width > 0 && opts.action === 'click') {
        const centerX = elementBounds.x + Math.floor(elementBounds.width / 2);
        const centerY = elementBounds.y + Math.floor(elementBounds.height / 2);
        console.log(`   ♿ No processId for "${opts.name}", falling back to coordinate click at (${centerX}, ${centerY})`);
        return { 
          success: true, 
          clickPoint: { x: centerX, y: centerY },
          error: `Coordinate click fallback — caller should execute mouse click at (${centerX}, ${centerY})`
        };
      }
      
      if (!processId) {
        return { success: false, error: `No processId for element: ${opts.name || opts.automationId}` };
      }
    }

    const args: string[] = ['-Action', opts.action, '-ProcessId', String(processId)];
    if (opts.name) args.push('-Name', opts.name);
    if (opts.automationId) args.push('-AutomationId', opts.automationId);
    if (opts.controlType) args.push('-ControlType', opts.controlType);
    if (opts.value) args.push('-Value', opts.value);
    return this.runScript('invoke-element.ps1', args);
  }

  // ─── Window Management Helpers (deterministic, no LLM) ────────────

  /**
   * Focus (bring to front) a window by title substring or processId.
   * Reliable — uses UIA WindowPattern + Win32 SetForegroundWindow fallback.
   */
  async focusWindow(title?: string, processId?: number): Promise<{ success: boolean; title?: string; processId?: number; error?: string }> {
    const args: string[] = [];
    if (title) args.push('-Title', title);
    if (processId) args.push('-ProcessId', String(processId));
    args.push('-Restore');  // Always restore from minimized

    try {
      const result = await this.runScript('focus-window.ps1', args);
      this.invalidateCache(); // Window state changed
      return result;
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Get the currently active/focused window using Win32 GetForegroundWindow.
   * Returns the window info for the actual foreground window, not a heuristic guess.
   */
  async getActiveWindow(): Promise<WindowInfo | null> {
    try {
      // Use Win32 API to get actual foreground window
      const fgResult = await this.runScript('get-foreground-window.ps1');
      if (!fgResult.success) return null;

      // Get full window list to find matching window with full info
      const windows = await this.getWindows(true);
      const match = windows.find(w => w.processId === fgResult.processId);
      
      if (match) return match;
      
      // Window might be new — construct minimal info from foreground result
      return {
        handle: fgResult.handle,
        title: fgResult.title,
        processName: fgResult.processName,
        processId: fgResult.processId,
        bounds: { x: 0, y: 0, width: 0, height: 0 }, // Unknown without full query
        isMinimized: false, // Foreground window can't be minimized
      };
    } catch {
      // Fallback: return first non-minimized window (better than nothing)
      try {
        const windows = await this.getWindows(true);
        return windows.find(w => !w.isMinimized) || null;
      } catch {
        return null;
      }
    }
  }

  /**
   * Find a window by app name/title (fuzzy match).
   */
  async findWindow(appNameOrTitle: string): Promise<WindowInfo | null> {
    const lower = appNameOrTitle.toLowerCase();
    const windows = await this.getWindows();

    // Exact process name match
    let match = windows.find(w => w.processName.toLowerCase() === lower);
    if (match) return match;

    // Title contains
    match = windows.find(w => w.title.toLowerCase().includes(lower));
    if (match) return match;

    // Process name contains
    match = windows.find(w => w.processName.toLowerCase().includes(lower));
    if (match) return match;

    return null;
  }

  /**
   * Get a text summary of the UI for the AI.
   * Includes windows list and taskbar buttons (always useful).
   * Optionally includes focused window UI tree.
   */
  async getScreenContext(focusedProcessId?: number): Promise<string> {
    try {
      const windows = await this.getWindows();
      let context = `WINDOWS:\n`;
      for (const w of windows) {
        context += `  ${w.isMinimized ? '🔽' : '🟢'} [${w.processName}] "${w.title}" pid:${w.processId}`;
        if (!w.isMinimized) context += ` at (${w.bounds.x},${w.bounds.y}) ${w.bounds.width}x${w.bounds.height}`;
        context += `\n`;
      }

      // Always include taskbar buttons (useful for launching/switching apps)
      try {
        const explorerPid = await this.getExplorerProcessId();
        if (explorerPid) {
          const taskbarButtons = await this.findElement({ controlType: 'Button' });
          // Filter for taskbar buttons: owned by Explorer + has Taskbar in class name
          const tbButtons = taskbarButtons.filter((b: any) =>
            b.processId === explorerPid && 
            (b.className?.includes('Taskbar') || b.className?.includes('MSTaskList'))
          );
          if (tbButtons.length > 0) {
            context += `\nTASKBAR APPS:\n`;
            for (const b of tbButtons) {
              context += `  📌 "${b.name}" at (${b.bounds.x},${b.bounds.y})\n`;
            }
          }
        }
      } catch { /* taskbar query failed, skip */ }

      // Include focused window's UI tree if provided
      if (focusedProcessId) {
        try {
          const tree = await this.getUITree(focusedProcessId, 2);
          context += `\nFOCUSED WINDOW UI TREE (pid:${focusedProcessId}):\n`;
          context += this.formatTree(Array.isArray(tree) ? tree : [tree], '  ');
        } catch { /* tree query failed, skip */ }
      }

      return context;
    } catch (err) {
      return `(Accessibility unavailable: ${err})`;
    }
  }

  private formatTree(elements: UIElement[], indent: string): string {
    let result = '';
    for (const el of elements) {
      const name = el.name ? `"${el.name}"` : '';
      const id = el.automationId ? `id:${el.automationId}` : '';
      const bounds = `@${el.bounds.x},${el.bounds.y}`;
      result += `${indent}[${el.controlType}] ${name} ${id} ${bounds}\n`;
      if (el.children) {
        result += this.formatTree(el.children, indent + '  ');
      }
    }
    return result;
  }

  private runScript(scriptName: string, args: string[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(SCRIPTS_DIR, scriptName);

      execFile('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        ...args,
      ], {
        timeout: PS_TIMEOUT,
        maxBuffer: 1024 * 1024 * 5, // 5MB buffer
      }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Accessibility script error (${scriptName}):`, error.message);
          reject(error);
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
        } catch (parseErr) {
          console.error(`Failed to parse ${scriptName} output:`, stdout.substring(0, 200));
          reject(parseErr);
        }
      });
    });
  }
}
