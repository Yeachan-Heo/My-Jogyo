"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAutoLoopStatePath = getAutoLoopStatePath;
exports.loadState = loadState;
exports.saveState = saveState;
exports.createInitialState = createInitialState;
exports.hasPromiseTag = hasPromiseTag;
exports.extractPromiseTags = extractPromiseTags;
exports.checkBudgets = checkBudgets;
exports.isAttemptsExhausted = isAttemptsExhausted;
const path = __importStar(require("path"));
const atomic_write_1 = require("./atomic-write");
const paths_1 = require("./paths");
// =============================================================================
// PATH HELPERS
// =============================================================================
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
function getAutoLoopStatePath(reportTitle) {
    if (!reportTitle || typeof reportTitle !== "string") {
        throw new Error("reportTitle is required for getAutoLoopStatePath");
    }
    return path.join((0, paths_1.getReportDir)(reportTitle), "auto", "loop-state.json");
}
// =============================================================================
// STATE PERSISTENCE
// =============================================================================
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
async function loadState(reportTitle) {
    if (!reportTitle || typeof reportTitle !== "string") {
        return null;
    }
    const statePath = getAutoLoopStatePath(reportTitle);
    try {
        if (!(await (0, atomic_write_1.fileExists)(statePath))) {
            return null;
        }
        const state = await (0, atomic_write_1.readFile)(statePath, true);
        if (typeof state.active !== "boolean" ||
            typeof state.iteration !== "number" ||
            typeof state.reportTitle !== "string") {
            process.env.GYOSHU_DEBUG && console.warn(`[auto-loop-state] Invalid state file at ${statePath}: missing required fields`);
            return null;
        }
        return state;
    }
    catch (error) {
        process.env.GYOSHU_DEBUG && console.warn(`[auto-loop-state] Failed to load state from ${statePath}: ${error.message}`);
        return null;
    }
}
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
async function saveState(state) {
    const statePath = getAutoLoopStatePath(state.reportTitle);
    const stateDir = path.dirname(statePath);
    (0, paths_1.ensureDirSync)(stateDir);
    const content = JSON.stringify(state, null, 2);
    await (0, atomic_write_1.durableAtomicWrite)(statePath, content);
}
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
function createInitialState(reportTitle, researchSessionID, runId, options = {}) {
    const now = new Date().toISOString();
    return {
        active: true,
        iteration: 1,
        maxIterations: options.maxIterations ?? 25,
        reportTitle,
        runId,
        researchSessionID,
        budgets: {
            maxCycles: options.maxCycles ?? 25,
            currentCycle: 1,
            maxToolCalls: options.maxToolCalls ?? 300,
            totalToolCalls: 0,
            maxTimeMinutes: options.maxTimeMinutes ?? 180,
            startedAt: now,
        },
        attemptNumber: 1,
        maxAttempts: options.maxAttempts ?? 3,
        lastDecision: null,
        nextObjective: "",
        trustScore: undefined,
        goalGateStatus: undefined,
    };
}
// =============================================================================
// PROMISE TAG PARSING
// =============================================================================
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
function hasPromiseTag(output, tag) {
    // Escape special regex characters in the tag
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Pattern: <promise>\s*TAG\s*</promise> (case insensitive)
    const pattern = new RegExp(`<promise>\\s*${escapedTag}\\s*</promise>`, "i");
    return pattern.test(output);
}
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
function extractPromiseTags(output) {
    // Pattern to match <promise>CONTENT</promise> and capture CONTENT
    const pattern = /<promise>\s*([^<]+?)\s*<\/promise>/gi;
    const tags = [];
    let match;
    while ((match = pattern.exec(output)) !== null) {
        tags.push(match[1].trim());
    }
    return tags;
}
// =============================================================================
// BUDGET HELPERS
// =============================================================================
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
function checkBudgets(state) {
    const { budgets, iteration, maxIterations } = state;
    if (iteration >= maxIterations) {
        return {
            exceeded: true,
            reason: `Maximum iterations reached (${iteration}/${maxIterations})`,
        };
    }
    if (budgets.currentCycle >= budgets.maxCycles) {
        return {
            exceeded: true,
            reason: `Maximum cycles reached (${budgets.currentCycle}/${budgets.maxCycles})`,
        };
    }
    if (budgets.totalToolCalls >= budgets.maxToolCalls) {
        return {
            exceeded: true,
            reason: `Maximum tool calls reached (${budgets.totalToolCalls}/${budgets.maxToolCalls})`,
        };
    }
    const startTime = new Date(budgets.startedAt).getTime();
    const elapsedMinutes = (Date.now() - startTime) / 60000;
    if (elapsedMinutes >= budgets.maxTimeMinutes) {
        return {
            exceeded: true,
            reason: `Maximum time reached (${Math.round(elapsedMinutes)}/${budgets.maxTimeMinutes} minutes)`,
        };
    }
    return { exceeded: false };
}
/**
 * Check if attempt limit has been reached (for pivot decisions).
 *
 * @param state - The current auto-loop state
 * @returns True if attempts exhausted
 */
function isAttemptsExhausted(state) {
    return state.attemptNumber >= state.maxAttempts;
}
