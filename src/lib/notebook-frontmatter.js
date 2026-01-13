"use strict";
/**
 * Notebook Frontmatter Library - Parse and update YAML frontmatter in Jupyter notebooks.
 *
 * Features:
 * - Parse YAML frontmatter from first raw cell
 * - Update frontmatter preserving rest of notebook
 * - Validate against schema version
 * - Handle Quarto compatibility
 *
 * YAML Format:
 * ```yaml
 * ---
 * title: "Research Title"
 * gyoshu:
 *   schema_version: 1
 *   reportTitle: churn-prediction
 *   status: active
 *   ...
 * ---
 * ```
 *
 * @module notebook-frontmatter
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
exports.parseSimpleYaml = parseSimpleYaml;
exports.serializeToYaml = serializeToYaml;
exports.extractFrontmatter = extractFrontmatter;
exports.extractFullFrontmatter = extractFullFrontmatter;
exports.updateFrontmatter = updateFrontmatter;
exports.ensureFrontmatterCell = ensureFrontmatterCell;
exports.validateFrontmatter = validateFrontmatter;
exports.validateGoalContract = validateGoalContract;
exports.hasFrontmatter = hasFrontmatter;
exports.getCurrentRun = getCurrentRun;
exports.addRun = addRun;
exports.updateRun = updateRun;
const crypto = __importStar(require("crypto"));
// =============================================================================
// YAML PARSING (Simple subset, no external library)
// =============================================================================
/**
 * Parse a simple YAML string into an object.
 * Supports: top-level keys, nested objects (one level), arrays, quoted strings.
 *
 * @param yamlString - The YAML string to parse
 * @returns Parsed object
 */
function parseSimpleYaml(yamlString) {
    const result = {};
    const lines = yamlString.split("\n");
    let currentKey = null;
    let currentObject = null;
    let currentArray = null;
    let currentArrayKey = null;
    let arrayItemBuffer = null;
    let level3Object = null;
    let level3Key = null;
    let level3Array = null;
    let level3ArrayKey = null;
    let level3ArrayItemBuffer = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimEnd();
        if (trimmed === "" || trimmed.startsWith("#")) {
            continue;
        }
        const indent = line.length - line.trimStart().length;
        const arrayItemMatch = trimmed.match(/^\s*- (.+)$/);
        if (arrayItemMatch) {
            const itemContent = arrayItemMatch[1].trim();
            const kvMatch = itemContent.match(/^([^:]+):\s*(.*)$/);
            if (level3ArrayKey && level3Array) {
                if (kvMatch) {
                    if (level3ArrayItemBuffer) {
                        level3Array.push(level3ArrayItemBuffer);
                    }
                    level3ArrayItemBuffer = {};
                    level3ArrayItemBuffer[kvMatch[1].trim()] = parseYamlValue(kvMatch[2].trim());
                }
                else {
                    if (level3ArrayItemBuffer) {
                        level3Array.push(level3ArrayItemBuffer);
                        level3ArrayItemBuffer = null;
                    }
                    level3Array.push(parseYamlValue(itemContent));
                }
                continue;
            }
            if (kvMatch && currentArrayKey) {
                if (arrayItemBuffer) {
                    currentArray?.push(arrayItemBuffer);
                }
                arrayItemBuffer = {};
                const key = kvMatch[1].trim();
                const value = parseYamlValue(kvMatch[2].trim());
                arrayItemBuffer[key] = value;
            }
            else if (currentArrayKey && currentArray) {
                if (arrayItemBuffer) {
                    currentArray.push(arrayItemBuffer);
                    arrayItemBuffer = null;
                }
                currentArray.push(parseYamlValue(itemContent));
            }
            continue;
        }
        if (level3ArrayItemBuffer && indent >= 8) {
            const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
            if (kvMatch) {
                level3ArrayItemBuffer[kvMatch[1].trim()] = parseYamlValue(kvMatch[2].trim());
                continue;
            }
        }
        if (arrayItemBuffer && indent >= 6 && !level3Object) {
            const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
            if (kvMatch) {
                const key = kvMatch[1].trim();
                const value = parseYamlValue(kvMatch[2].trim());
                arrayItemBuffer[key] = value;
                continue;
            }
        }
        const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
        if (kvMatch) {
            const key = kvMatch[1].trim();
            const value = kvMatch[2].trim();
            if (level3Array && level3ArrayKey) {
                if (level3ArrayItemBuffer) {
                    level3Array.push(level3ArrayItemBuffer);
                    level3ArrayItemBuffer = null;
                }
                if (level3Object) {
                    level3Object[level3ArrayKey] = level3Array;
                }
                level3Array = null;
                level3ArrayKey = null;
            }
            if (indent === 0) {
                if (level3Object && level3Key && currentObject) {
                    currentObject[level3Key] = level3Object;
                    level3Object = null;
                    level3Key = null;
                }
                if (currentArray && currentArrayKey) {
                    if (arrayItemBuffer) {
                        currentArray.push(arrayItemBuffer);
                        arrayItemBuffer = null;
                    }
                    if (currentObject) {
                        currentObject[currentArrayKey] = currentArray;
                    }
                    else {
                        result[currentArrayKey] = currentArray;
                    }
                    currentArray = null;
                    currentArrayKey = null;
                }
                currentObject = null;
                currentKey = key;
                if (value === "") {
                    if (i + 1 < lines.length && lines[i + 1].trim().startsWith("-")) {
                        currentArray = [];
                        currentArrayKey = key;
                    }
                    else {
                        currentObject = {};
                        result[key] = currentObject;
                    }
                }
                else {
                    result[key] = parseYamlValue(value);
                }
            }
            else if (indent === 2 && currentObject) {
                if (level3Object && level3Key) {
                    currentObject[level3Key] = level3Object;
                    level3Object = null;
                    level3Key = null;
                }
                if (currentArray && currentArrayKey) {
                    if (arrayItemBuffer) {
                        currentArray.push(arrayItemBuffer);
                        arrayItemBuffer = null;
                    }
                    currentObject[currentArrayKey] = currentArray;
                    currentArray = null;
                    currentArrayKey = null;
                }
                if (value === "") {
                    if (i + 1 < lines.length && lines[i + 1].trim().startsWith("-")) {
                        currentArray = [];
                        currentArrayKey = key;
                    }
                    else {
                        level3Object = {};
                        level3Key = key;
                    }
                }
                else {
                    currentObject[key] = parseYamlValue(value);
                }
            }
            else if (indent === 4 && level3Object) {
                if (level3Array && level3ArrayKey) {
                    if (level3ArrayItemBuffer) {
                        level3Array.push(level3ArrayItemBuffer);
                        level3ArrayItemBuffer = null;
                    }
                    level3Object[level3ArrayKey] = level3Array;
                    level3Array = null;
                    level3ArrayKey = null;
                }
                if (value === "") {
                    if (i + 1 < lines.length && lines[i + 1].trim().startsWith("-")) {
                        level3Array = [];
                        level3ArrayKey = key;
                    }
                    else {
                        level3Object[key] = null;
                    }
                }
                else {
                    level3Object[key] = parseYamlValue(value);
                }
            }
            else if (indent >= 2 && !currentObject && value === "") {
                if (i + 1 < lines.length && lines[i + 1].trim().startsWith("-")) {
                    currentArray = [];
                    currentArrayKey = key;
                }
            }
        }
    }
    if (level3Array && level3ArrayKey) {
        if (level3ArrayItemBuffer) {
            level3Array.push(level3ArrayItemBuffer);
        }
        if (level3Object) {
            level3Object[level3ArrayKey] = level3Array;
        }
    }
    if (level3Object && level3Key && currentObject) {
        currentObject[level3Key] = level3Object;
    }
    if (currentArray && currentArrayKey) {
        if (arrayItemBuffer) {
            currentArray.push(arrayItemBuffer);
        }
        if (currentObject) {
            currentObject[currentArrayKey] = currentArray;
        }
        else {
            result[currentArrayKey] = currentArray;
        }
    }
    return result;
}
/**
 * Parse a YAML value, handling quoted strings, numbers, booleans, null.
 */
function parseYamlValue(value) {
    if (value === "" || value === "null" || value === "~") {
        return null;
    }
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }
    // Handle quoted strings
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    // Handle numbers
    if (/^-?\d+$/.test(value)) {
        return parseInt(value, 10);
    }
    if (/^-?\d+\.\d+$/.test(value)) {
        return parseFloat(value);
    }
    // Plain string
    return value;
}
/**
 * Serialize an object back to YAML format.
 *
 * @param obj - The object to serialize
 * @returns YAML string
 */
function serializeToYaml(obj) {
    const lines = [];
    for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) {
            continue;
        }
        if (typeof value === "object" && !Array.isArray(value)) {
            lines.push(`${key}:`);
            const nested = value;
            for (const [nestedKey, nestedValue] of Object.entries(nested)) {
                if (nestedValue === null || nestedValue === undefined) {
                    continue;
                }
                if (Array.isArray(nestedValue)) {
                    lines.push(`  ${nestedKey}:`);
                    for (const item of nestedValue) {
                        if (typeof item === "object" && item !== null) {
                            const objItem = item;
                            const entries = Object.entries(objItem);
                            if (entries.length > 0) {
                                const [firstKey, firstValue] = entries[0];
                                lines.push(`    - ${firstKey}: ${formatYamlValue(firstValue)}`);
                                for (let i = 1; i < entries.length; i++) {
                                    const [k, v] = entries[i];
                                    if (v !== null && v !== undefined) {
                                        lines.push(`      ${k}: ${formatYamlValue(v)}`);
                                    }
                                }
                            }
                        }
                        else {
                            lines.push(`    - ${formatYamlValue(item)}`);
                        }
                    }
                }
                else if (typeof nestedValue === "object") {
                    lines.push(`  ${nestedKey}:`);
                    const level3Obj = nestedValue;
                    for (const [l3Key, l3Value] of Object.entries(level3Obj)) {
                        if (l3Value === null || l3Value === undefined) {
                            continue;
                        }
                        if (Array.isArray(l3Value)) {
                            lines.push(`    ${l3Key}:`);
                            for (const item of l3Value) {
                                if (typeof item === "object" && item !== null) {
                                    const objItem = item;
                                    const entries = Object.entries(objItem);
                                    if (entries.length > 0) {
                                        const [firstKey, firstValue] = entries[0];
                                        lines.push(`      - ${firstKey}: ${formatYamlValue(firstValue)}`);
                                        for (let i = 1; i < entries.length; i++) {
                                            const [k, v] = entries[i];
                                            if (v !== null && v !== undefined) {
                                                lines.push(`        ${k}: ${formatYamlValue(v)}`);
                                            }
                                        }
                                    }
                                }
                                else {
                                    lines.push(`      - ${formatYamlValue(item)}`);
                                }
                            }
                        }
                        else {
                            lines.push(`    ${l3Key}: ${formatYamlValue(l3Value)}`);
                        }
                    }
                }
                else {
                    lines.push(`  ${nestedKey}: ${formatYamlValue(nestedValue)}`);
                }
            }
        }
        else if (Array.isArray(value)) {
            lines.push(`${key}:`);
            for (const item of value) {
                if (typeof item === "object" && item !== null) {
                    const objItem = item;
                    const entries = Object.entries(objItem);
                    if (entries.length > 0) {
                        const [firstKey, firstValue] = entries[0];
                        lines.push(`  - ${firstKey}: ${formatYamlValue(firstValue)}`);
                        for (let i = 1; i < entries.length; i++) {
                            const [k, v] = entries[i];
                            if (v !== null && v !== undefined) {
                                lines.push(`    ${k}: ${formatYamlValue(v)}`);
                            }
                        }
                    }
                }
                else {
                    lines.push(`  - ${formatYamlValue(item)}`);
                }
            }
        }
        else {
            lines.push(`${key}: ${formatYamlValue(value)}`);
        }
    }
    return lines.join("\n");
}
/**
 * Format a value for YAML output.
 */
function formatYamlValue(value) {
    if (value === null || value === undefined) {
        return "null";
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (typeof value === "number") {
        return String(value);
    }
    if (typeof value === "string") {
        // Quote if contains special characters or looks like a number
        if (value.includes(":") ||
            value.includes("#") ||
            value.includes("\n") ||
            /^[\d.-]/.test(value)) {
            return `"${value.replace(/"/g, '\\"')}"`;
        }
        return value;
    }
    return String(value);
}
// =============================================================================
// FRONTMATTER EXTRACTION AND MANIPULATION
// =============================================================================
/**
 * Check if a cell is a frontmatter cell (raw type with YAML delimiters).
 * Uses line-based detection to avoid false positives from "---" within content.
 *
 * Requirements:
 * - Delimiters must start at column 0 (no leading whitespace)
 * - Accepts "---" or "..." as valid closing delimiter (YAML document end marker)
 * - Normalizes CRLF to LF for Windows compatibility
 */
function isFrontmatterCell(cell) {
    if (cell.cell_type !== "raw") {
        return false;
    }
    const source = Array.isArray(cell.source)
        ? cell.source.join("")
        : cell.source;
    // Normalize CRLF to LF for Windows compatibility
    const normalized = source.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    // First line must be exactly "---" (no leading whitespace)
    if (lines.length < 2 || lines[0] !== "---") {
        return false;
    }
    // Find closing delimiter: "---" or "..." on its own line (no leading whitespace)
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "---" || lines[i] === "...") {
            return true;
        }
    }
    return false;
}
/**
 * Extract the YAML content from a frontmatter cell.
 * Uses line-based detection for delimiters.
 */
function extractYamlContent(cell) {
    const source = Array.isArray(cell.source)
        ? cell.source.join("")
        : cell.source;
    // Normalize CRLF to LF for Windows compatibility
    const normalized = source.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    // First line must be exactly "---" (no leading whitespace)
    if (lines.length < 2 || lines[0] !== "---") {
        return null;
    }
    // Find closing delimiter: "---" or "..." on its own line (no leading whitespace)
    let closingIndex = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "---" || lines[i] === "...") {
            closingIndex = i;
            break;
        }
    }
    if (closingIndex === -1) {
        return null;
    }
    // Extract content between delimiters (lines 1 to closingIndex-1)
    const contentLines = lines.slice(1, closingIndex);
    return contentLines.join("\n").trim();
}
/**
 * Extract GyoshuFrontmatter from a notebook's first cell.
 *
 * @param notebook - The notebook to extract frontmatter from
 * @returns GyoshuFrontmatter if found and valid, null otherwise
 */
function extractFrontmatter(notebook) {
    if (notebook.cells.length === 0) {
        return null;
    }
    const firstCell = notebook.cells[0];
    if (!isFrontmatterCell(firstCell)) {
        return null;
    }
    const yamlContent = extractYamlContent(firstCell);
    if (!yamlContent) {
        return null;
    }
    try {
        const parsed = parseSimpleYaml(yamlContent);
        const gyoshu = parsed.gyoshu;
        if (!gyoshu) {
            return null;
        }
        // Validate required fields (workspace and slug are now optional)
        if (typeof gyoshu.schema_version !== "number" ||
            typeof gyoshu.status !== "string" ||
            typeof gyoshu.created !== "string" ||
            typeof gyoshu.updated !== "string") {
            return null;
        }
        // Validate status
        if (!["active", "completed", "archived"].includes(gyoshu.status)) {
            return null;
        }
        // Build the frontmatter object
        const frontmatter = {
            schema_version: gyoshu.schema_version,
            status: gyoshu.status,
            created: gyoshu.created,
            updated: gyoshu.updated,
            tags: Array.isArray(gyoshu.tags)
                ? gyoshu.tags
                : [],
        };
        // Optional fields: workspace, slug, reportTitle
        if (typeof gyoshu.workspace === "string") {
            frontmatter.workspace = gyoshu.workspace;
        }
        if (typeof gyoshu.slug === "string") {
            frontmatter.slug = gyoshu.slug;
        }
        if (typeof gyoshu.reportTitle === "string") {
            frontmatter.reportTitle = gyoshu.reportTitle;
        }
        // Optional fields
        if (typeof gyoshu.python_env === "string") {
            frontmatter.python_env = gyoshu.python_env;
        }
        if (typeof gyoshu.outputs_dir === "string") {
            frontmatter.outputs_dir = gyoshu.outputs_dir;
        }
        if (Array.isArray(gyoshu.runs)) {
            frontmatter.runs = gyoshu.runs;
        }
        if (gyoshu.goal_contract && typeof gyoshu.goal_contract === "object") {
            const gc = gyoshu.goal_contract;
            if (typeof gc.version === "number" && typeof gc.goal_text === "string") {
                frontmatter.goal_contract = {
                    version: gc.version,
                    goal_text: gc.goal_text,
                    goal_type: typeof gc.goal_type === "string" ? gc.goal_type : undefined,
                    acceptance_criteria: Array.isArray(gc.acceptance_criteria)
                        ? gc.acceptance_criteria
                        : [],
                    max_goal_attempts: typeof gc.max_goal_attempts === "number" ? gc.max_goal_attempts : undefined,
                };
            }
        }
        return frontmatter;
    }
    catch (error) {
        console.debug(`[notebook-frontmatter] Failed to parse YAML in extractFrontmatter: ${error}`);
        return null;
    }
}
/**
 * Extract full notebook frontmatter including Quarto fields.
 *
 * @param notebook - The notebook to extract frontmatter from
 * @returns Full frontmatter object or null if not found
 */
function extractFullFrontmatter(notebook) {
    if (notebook.cells.length === 0) {
        return null;
    }
    const firstCell = notebook.cells[0];
    if (!isFrontmatterCell(firstCell)) {
        return null;
    }
    const yamlContent = extractYamlContent(firstCell);
    if (!yamlContent) {
        return null;
    }
    try {
        const parsed = parseSimpleYaml(yamlContent);
        return parsed;
    }
    catch (error) {
        console.debug(`[notebook-frontmatter] Failed to parse YAML in extractFullFrontmatter: ${error}`);
        return null;
    }
}
/**
 * Update frontmatter in a notebook, returning a new notebook object (immutable).
 *
 * @param notebook - The notebook to update
 * @param updates - Partial frontmatter updates to merge
 * @returns New notebook with updated frontmatter
 */
function updateFrontmatter(notebook, updates) {
    // Deep clone the notebook to maintain immutability
    const newNotebook = JSON.parse(JSON.stringify(notebook));
    if (newNotebook.cells.length === 0) {
        throw new Error("Cannot update frontmatter: notebook has no cells");
    }
    const firstCell = newNotebook.cells[0];
    if (!isFrontmatterCell(firstCell)) {
        throw new Error("Cannot update frontmatter: first cell is not a frontmatter cell");
    }
    // Extract existing frontmatter
    const existingFull = extractFullFrontmatter(notebook);
    if (!existingFull || !existingFull.gyoshu) {
        throw new Error("Cannot update frontmatter: no valid gyoshu frontmatter found");
    }
    // Merge updates
    const mergedGyoshu = {
        ...existingFull.gyoshu,
        ...updates,
        updated: new Date().toISOString(),
    };
    // Preserve tags array properly (merge if both exist)
    if (updates.tags) {
        mergedGyoshu.tags = updates.tags;
    }
    // Preserve runs array properly (merge if both exist)
    if (updates.runs) {
        mergedGyoshu.runs = updates.runs;
    }
    // Build new frontmatter object
    const newFrontmatter = {
        ...existingFull,
        gyoshu: mergedGyoshu,
    };
    // Serialize to YAML
    const yamlContent = serializeToYaml(newFrontmatter);
    const newSource = `---\n${yamlContent}\n---`;
    // Update the cell source
    firstCell.source = newSource.split("\n").map((line, i, arr) => i < arr.length - 1 ? line + "\n" : line);
    return newNotebook;
}
/**
 * Ensure a notebook has a frontmatter cell, adding one if not present.
 *
 * @param notebook - The notebook to ensure has frontmatter
 * @param initial - Initial frontmatter values to use if creating new cell
 * @returns New notebook with frontmatter cell at position 0
 */
function ensureFrontmatterCell(notebook, initial) {
    // Deep clone the notebook to maintain immutability
    const newNotebook = JSON.parse(JSON.stringify(notebook));
    // Check if first cell already has frontmatter
    if (newNotebook.cells.length > 0 && isFrontmatterCell(newNotebook.cells[0])) {
        return newNotebook;
    }
    // Build frontmatter object
    const frontmatter = {
        gyoshu: initial,
    };
    // Serialize to YAML
    const yamlContent = serializeToYaml(frontmatter);
    const source = `---\n${yamlContent}\n---`;
    // Create new raw cell
    const frontmatterCell = {
        cell_type: "raw",
        id: `frontmatter-${crypto.randomUUID().slice(0, 8)}`,
        source: source.split("\n").map((line, i, arr) => i < arr.length - 1 ? line + "\n" : line),
        metadata: {
            gyoshu: {
                type: "frontmatter",
            },
        },
    };
    // Insert at position 0
    newNotebook.cells.unshift(frontmatterCell);
    return newNotebook;
}
/**
 * Validate frontmatter against schema version.
 *
 * @param frontmatter - The frontmatter to validate
 * @returns Object with isValid boolean and errors array
 */
function validateFrontmatter(frontmatter) {
    const errors = [];
    // Check schema version
    if (frontmatter.schema_version !== 1) {
        errors.push(`Unsupported schema version: ${frontmatter.schema_version}. Expected: 1`);
    }
    // Check required string fields (workspace and slug are now optional)
    if (frontmatter.workspace !== undefined && typeof frontmatter.workspace !== "string") {
        errors.push("Invalid workspace (must be string if provided)");
    }
    if (frontmatter.slug !== undefined && typeof frontmatter.slug !== "string") {
        errors.push("Invalid slug (must be string if provided)");
    }
    if (frontmatter.reportTitle !== undefined && typeof frontmatter.reportTitle !== "string") {
        errors.push("Invalid reportTitle (must be string if provided)");
    }
    if (!frontmatter.created || typeof frontmatter.created !== "string") {
        errors.push("Missing or invalid created timestamp");
    }
    if (!frontmatter.updated || typeof frontmatter.updated !== "string") {
        errors.push("Missing or invalid updated timestamp");
    }
    // Check status
    if (!["active", "completed", "archived"].includes(frontmatter.status)) {
        errors.push(`Invalid status: ${frontmatter.status}. Expected: active, completed, or archived`);
    }
    // Check tags is array
    if (!Array.isArray(frontmatter.tags)) {
        errors.push("Tags must be an array");
    }
    // Validate runs if present
    if (frontmatter.runs) {
        if (!Array.isArray(frontmatter.runs)) {
            errors.push("Runs must be an array");
        }
        else {
            for (let i = 0; i < frontmatter.runs.length; i++) {
                const run = frontmatter.runs[i];
                if (!run.id || typeof run.id !== "string") {
                    errors.push(`Run ${i}: missing or invalid id`);
                }
                if (!run.started || typeof run.started !== "string") {
                    errors.push(`Run ${i}: missing or invalid started timestamp`);
                }
                if (!["in_progress", "completed", "failed"].includes(run.status)) {
                    errors.push(`Run ${i}: invalid status: ${run.status}`);
                }
            }
        }
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}
const VALID_CRITERIA_KINDS = [
    "metric_threshold",
    "marker_required",
    "artifact_exists",
    "finding_count",
];
const VALID_OPERATORS = [">=", ">", "<=", "<", "==", "!="];
function validateGoalContract(contract) {
    const errors = [];
    if (contract.version !== 1) {
        errors.push(`Unsupported goal contract version: ${contract.version}. Expected: 1`);
    }
    if (!contract.goal_text || typeof contract.goal_text !== "string") {
        errors.push("Missing or invalid goal_text");
    }
    if (contract.goal_type !== undefined && typeof contract.goal_type !== "string") {
        errors.push("Invalid goal_type (must be string if provided)");
    }
    if (contract.max_goal_attempts !== undefined) {
        if (typeof contract.max_goal_attempts !== "number" || contract.max_goal_attempts < 1) {
            errors.push("Invalid max_goal_attempts (must be positive number if provided)");
        }
    }
    if (!Array.isArray(contract.acceptance_criteria)) {
        errors.push("acceptance_criteria must be an array");
    }
    else {
        for (let i = 0; i < contract.acceptance_criteria.length; i++) {
            const criterion = contract.acceptance_criteria[i];
            const prefix = `Criterion ${i}`;
            if (!criterion.id || typeof criterion.id !== "string") {
                errors.push(`${prefix}: missing or invalid id`);
            }
            if (!VALID_CRITERIA_KINDS.includes(criterion.kind)) {
                errors.push(`${prefix}: invalid kind '${criterion.kind}'`);
            }
            if (criterion.kind === "metric_threshold") {
                if (!criterion.metric || typeof criterion.metric !== "string") {
                    errors.push(`${prefix}: metric_threshold requires 'metric' field`);
                }
                if (!criterion.op || !VALID_OPERATORS.includes(criterion.op)) {
                    errors.push(`${prefix}: metric_threshold requires valid 'op' field`);
                }
                if (typeof criterion.target !== "number") {
                    errors.push(`${prefix}: metric_threshold requires 'target' number`);
                }
            }
            if (criterion.kind === "marker_required") {
                if (!criterion.marker || typeof criterion.marker !== "string") {
                    errors.push(`${prefix}: marker_required requires 'marker' field`);
                }
            }
            if (criterion.kind === "artifact_exists") {
                if (!criterion.artifactPattern || typeof criterion.artifactPattern !== "string") {
                    errors.push(`${prefix}: artifact_exists requires 'artifactPattern' field`);
                }
            }
            if (criterion.kind === "finding_count") {
                if (typeof criterion.minCount !== "number" || criterion.minCount < 0) {
                    errors.push(`${prefix}: finding_count requires 'minCount' non-negative number`);
                }
            }
        }
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}
/**
 * Check if a notebook has valid Gyoshu frontmatter.
 *
 * @param notebook - The notebook to check
 * @returns true if notebook has valid frontmatter
 */
function hasFrontmatter(notebook) {
    return extractFrontmatter(notebook) !== null;
}
/**
 * Get the current run from frontmatter (the one with status "in_progress").
 *
 * @param frontmatter - The frontmatter to check
 * @returns The current run or null if none in progress
 */
function getCurrentRun(frontmatter) {
    if (!frontmatter.runs) {
        return null;
    }
    return frontmatter.runs.find((run) => run.status === "in_progress") || null;
}
/**
 * Add a new run to the frontmatter, keeping only the last 10 runs.
 *
 * @param frontmatter - The frontmatter to update
 * @param run - The new run to add
 * @returns New frontmatter with the run added
 */
function addRun(frontmatter, run) {
    const runs = [...(frontmatter.runs || []), run];
    // Keep only last 10 runs
    const boundedRuns = runs.slice(-10);
    return {
        ...frontmatter,
        runs: boundedRuns,
        updated: new Date().toISOString(),
    };
}
/**
 * Update a run in the frontmatter by ID.
 *
 * @param frontmatter - The frontmatter to update
 * @param runId - The ID of the run to update
 * @param updates - Partial run updates
 * @returns New frontmatter with the run updated
 */
function updateRun(frontmatter, runId, updates) {
    if (!frontmatter.runs) {
        return frontmatter;
    }
    const newRuns = frontmatter.runs.map((run) => run.id === runId ? { ...run, ...updates } : run);
    return {
        ...frontmatter,
        runs: newRuns,
        updated: new Date().toISOString(),
    };
}
