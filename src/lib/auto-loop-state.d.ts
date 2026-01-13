/**
 * Auto-Loop State Management for Gyoshu-Auto
 *
 * Provides state persistence for the Ralph-Loop style auto-continuation system.
 * The AutoLoopState tracks loop iteration, budgets, gate results, and decision state
 * to enable automatic continuation without user prompts.
 *
 * Storage Path: `reports/{reportTitle}/auto/loop-state.json`
 *
 * Key Features:
 * - Durable state persistence using atomic writes
 * - Budget tracking (cycles, tool calls, time)
 * - Two-Gate decision state caching
 * - Promise tag parsing for exit condition detection
 *
 * @module auto-loop-state
 */
/**
 * Budget tracking for auto-loop execution.
 * Enforces limits to prevent infinite loops and runaway resource usage.
 */
export interface AutoLoopBudgets {
    /** Maximum number of planning/execution cycles allowed */
    maxCycles: number;
    /** Current cycle count (1-indexed) */
    currentCycle: number;
    /** Maximum total tool calls allowed across all cycles */
    maxToolCalls: number;
    /** Running total of tool calls made */
    totalToolCalls: number;
    /** Maximum execution time in minutes */
    maxTimeMinutes: number;
    /** ISO 8601 timestamp when the auto-loop started */
    startedAt: string;
}
/**
 * Decision actions that can be taken after evaluating gates.
 *
 * - `CONTINUE`: Proceed with next objective (no user prompt)
 * - `PIVOT`: Goal not met, try different approach (increment attempt)
 * - `REWORK`: Trust failed, improve evidence quality (max 3 rounds)
 * - `COMPLETE`: Both gates passed, generate report and exit
 * - `BLOCKED`: Cannot proceed, user intervention needed
 */
export type AutoLoopDecision = "CONTINUE" | "PIVOT" | "REWORK" | "COMPLETE" | "BLOCKED" | "BUDGET_EXHAUSTED" | null;
/**
 * Goal gate status from Two-Gate evaluation.
 *
 * - `MET`: All acceptance criteria passed
 * - `NOT_MET`: Some criteria failed, retry possible
 * - `BLOCKED`: Goal is impossible with current data/methods
 */
export type GoalGateStatus = "MET" | "NOT_MET" | "BLOCKED";
/**
 * Complete state for the auto-loop controller.
 *
 * Persisted to disk between iterations to enable:
 * - Recovery from crashes/interruptions
 * - Re-injection of continuation prompts
 * - Budget enforcement across restarts
 *
 * @example
 * ```typescript
 * const state = await loadState("customer-churn");
 * if (state?.active && state.lastDecision !== "COMPLETE") {
 *   // Re-inject continuation prompt
 * }
 * ```
 */
export interface AutoLoopState {
    /** Whether the auto-loop is currently active */
    active: boolean;
    /** Current iteration number (1-indexed) */
    iteration: number;
    /** Maximum iterations before forced stop (default: 25) */
    maxIterations: number;
    /** Research report title (used for path resolution) */
    reportTitle: string;
    /** Unique run identifier */
    runId: string;
    /** Session ID for the research session */
    researchSessionID: string;
    /** Budget limits and current usage */
    budgets: AutoLoopBudgets;
    /** Current pivot attempt number (1-indexed) */
    attemptNumber: number;
    /** Maximum pivot attempts before BLOCKED (from goal_contract or default 3) */
    maxAttempts: number;
    /** Last decision made by the auto-loop controller */
    lastDecision: AutoLoopDecision;
    /** Next objective to pursue in the upcoming cycle */
    nextObjective: string;
    /** Cached trust score from last Baksa verification (0-100) */
    trustScore?: number;
    /** Cached goal gate status from last evaluation */
    goalGateStatus?: GoalGateStatus;
}
/**
 * Get the path to the auto-loop state file for a given report.
 *
 * @param reportTitle - The report/research title (e.g., "customer-churn-analysis")
 * @returns Absolute path to `reports/{reportTitle}/auto/loop-state.json`
 *
 * @example
 * getAutoLoopStatePath("customer-churn");
 * // Returns: "/home/user/my-project/reports/customer-churn/auto/loop-state.json"
 */
export declare function getAutoLoopStatePath(reportTitle: string): string;
/**
 * Load the auto-loop state for a given report.
 *
 * Returns `null` if:
 * - The state file doesn't exist
 * - The file is corrupted or invalid JSON
 *
 * @param reportTitle - The report/research title
 * @returns The auto-loop state or null if not found/invalid
 *
 * @example
 * ```typescript
 * const state = await loadState("customer-churn");
 * if (state && state.active) {
 *   console.log(`Auto-loop active at iteration ${state.iteration}`);
 * }
 * ```
 */
export declare function loadState(reportTitle: string): Promise<AutoLoopState | null>;
/**
 * Save the auto-loop state to disk.
 *
 * Uses atomic writes to prevent corruption:
 * - Writes to a temp file first
 * - Syncs to disk
 * - Atomically renames to target
 *
 * @param state - The auto-loop state to persist
 * @throws Error if write fails
 *
 * @example
 * ```typescript
 * state.iteration += 1;
 * state.lastDecision = "CONTINUE";
 * await saveState(state);
 * ```
 */
export declare function saveState(state: AutoLoopState): Promise<void>;
/**
 * Create a new auto-loop state with default values.
 *
 * @param reportTitle - The report/research title
 * @param researchSessionID - The session ID
 * @param runId - The run identifier
 * @param options - Optional overrides for default values
 * @returns A new AutoLoopState with sensible defaults
 *
 * @example
 * ```typescript
 * const state = createInitialState("customer-churn", "ses_123", "run-001", {
 *   maxIterations: 30,
 *   maxAttempts: 5,
 * });
 * await saveState(state);
 * ```
 */
export declare function createInitialState(reportTitle: string, researchSessionID: string, runId: string, options?: Partial<{
    maxIterations: number;
    maxAttempts: number;
    maxCycles: number;
    maxToolCalls: number;
    maxTimeMinutes: number;
}>): AutoLoopState;
/**
 * Check if output contains a specific promise tag.
 *
 * Promise tags are used to signal exit conditions in the Ralph-loop:
 * - `<promise>GYOSHU_AUTO_COMPLETE</promise>` - Goal achieved
 * - `<promise>GYOSHU_AUTO_BLOCKED</promise>` - Cannot proceed
 * - `<promise>GYOSHU_AUTO_BUDGET_EXHAUSTED</promise>` - Resources exhausted
 *
 * The regex is case-insensitive and allows whitespace around the tag.
 *
 * @param output - The text output to search (e.g., agent transcript)
 * @param tag - The promise tag to look for (e.g., "GYOSHU_AUTO_COMPLETE")
 * @returns True if the tag is found, false otherwise
 *
 * @example
 * ```typescript
 * const output = "Research complete! <promise> GYOSHU_AUTO_COMPLETE </promise>";
 * hasPromiseTag(output, "GYOSHU_AUTO_COMPLETE");  // true
 * hasPromiseTag(output, "GYOSHU_AUTO_BLOCKED");   // false
 * ```
 */
export declare function hasPromiseTag(output: string, tag: string): boolean;
/**
 * Extract all promise tags from output.
 *
 * Useful for detecting multiple exit conditions or debugging.
 *
 * @param output - The text output to search
 * @returns Array of promise tag values found (without the <promise> wrapper)
 *
 * @example
 * ```typescript
 * const output = "<promise>TAG1</promise> some text <promise>TAG2</promise>";
 * extractPromiseTags(output);  // ["TAG1", "TAG2"]
 * ```
 */
export declare function extractPromiseTags(output: string): string[];
/**
 * Check if the auto-loop has exceeded any budget limits.
 *
 * @param state - The current auto-loop state
 * @returns Object with budget status and optional reason
 *
 * @example
 * ```typescript
 * const result = checkBudgets(state);
 * if (result.exceeded) {
 *   console.log(`Budget exceeded: ${result.reason}`);
 * }
 * ```
 */
export declare function checkBudgets(state: AutoLoopState): {
    exceeded: boolean;
    reason?: string;
};
/**
 * Check if attempt limit has been reached (for pivot decisions).
 *
 * @param state - The current auto-loop state
 * @returns True if attempts exhausted
 */
export declare function isAttemptsExhausted(state: AutoLoopState): boolean;
