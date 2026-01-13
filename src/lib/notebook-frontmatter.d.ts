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
import { Notebook } from "./cell-identity";
/**
 * Status of a research notebook.
 */
export type ResearchStatus = "active" | "completed" | "archived";
/**
 * Status of an individual run within a research.
 */
export type RunStatus = "in_progress" | "completed" | "failed";
/**
 * Represents a single run entry in the frontmatter.
 */
export interface RunEntry {
    /** Unique identifier for the run */
    id: string;
    /** ISO 8601 timestamp when run started */
    started: string;
    /** ISO 8601 timestamp when run ended (optional) */
    ended?: string;
    /** Status of the run */
    status: RunStatus;
    /** Optional notes about the run */
    notes?: string;
}
/**
 * Kind of acceptance criterion for goal completion.
 */
export type AcceptanceCriteriaKind = "metric_threshold" | "marker_required" | "artifact_exists" | "finding_count";
/**
 * Comparison operators for metric thresholds.
 */
export type ComparisonOperator = ">=" | ">" | "<=" | "<" | "==" | "!=";
/**
 * Single acceptance criterion for goal completion.
 *
 * Kept flat (no nested objects) for YAML parser compatibility.
 */
export interface AcceptanceCriterion {
    /** Unique identifier, e.g., "AC1", "AC2" */
    id: string;
    /** Type of acceptance criterion */
    kind: AcceptanceCriteriaKind;
    /** Human-readable description */
    description?: string;
    /** Metric name, e.g., "cv_accuracy_mean" */
    metric?: string;
    /** Comparison operator */
    op?: ComparisonOperator;
    /** Target threshold value */
    target?: number;
    /** Marker pattern, e.g., "METRIC:baseline_accuracy" */
    marker?: string;
    /** Glob pattern for artifact, e.g., "*.pkl" */
    artifactPattern?: string;
    /** Minimum required findings */
    minCount?: number;
}
/**
 * Goal contract defining acceptance criteria for research completion.
 *
 * Stored in notebook frontmatter under gyoshu.goal_contract.
 */
export interface GoalContract {
    /** Schema version for goal contracts (currently 1) */
    version: number;
    /** Original user goal text */
    goal_text: string;
    /** Goal classification, e.g., "ml_classification", "eda", "hypothesis_test" */
    goal_type?: string;
    /** List of acceptance criteria */
    acceptance_criteria: AcceptanceCriterion[];
    /** Maximum attempts before escalation (default: 3) */
    max_goal_attempts?: number;
}
/**
 * Gyoshu-specific frontmatter stored in the `gyoshu:` namespace.
 */
export interface GyoshuFrontmatter {
    /** Schema version for future migrations */
    schema_version: number;
    /** Workspace folder name (optional - for workspace-organized research) */
    workspace?: string;
    /** Notebook basename without .ipynb extension (optional - can use reportTitle instead) */
    slug?: string;
    /** Report title - alternative identifier when not using workspace/slug */
    reportTitle?: string;
    /** Research status */
    status: ResearchStatus;
    /** ISO 8601 timestamp when created */
    created: string;
    /** ISO 8601 timestamp when last updated */
    updated: string;
    /** Tags for categorization */
    tags: string[];
    /** Python environment path (optional) */
    python_env?: string;
    /** Outputs directory path (optional) */
    outputs_dir?: string;
    /** Run history - bounded to last 10 runs (optional) */
    runs?: RunEntry[];
    /** Goal contract for Two-Gate acceptance criteria (optional) */
    goal_contract?: GoalContract;
}
/**
 * Complete frontmatter including optional Quarto-compatible fields.
 */
export interface NotebookFrontmatter {
    /** Document title (Quarto-compatible) */
    title?: string;
    /** Author name (Quarto-compatible) */
    author?: string;
    /** Date string (Quarto-compatible) */
    date?: string;
    /** Gyoshu-specific metadata */
    gyoshu?: GyoshuFrontmatter;
    /** Any other top-level fields for Quarto compatibility */
    [key: string]: unknown;
}
/**
 * Parse a simple YAML string into an object.
 * Supports: top-level keys, nested objects (one level), arrays, quoted strings.
 *
 * @param yamlString - The YAML string to parse
 * @returns Parsed object
 */
export declare function parseSimpleYaml(yamlString: string): Record<string, unknown>;
/**
 * Serialize an object back to YAML format.
 *
 * @param obj - The object to serialize
 * @returns YAML string
 */
export declare function serializeToYaml(obj: Record<string, unknown>): string;
/**
 * Extract GyoshuFrontmatter from a notebook's first cell.
 *
 * @param notebook - The notebook to extract frontmatter from
 * @returns GyoshuFrontmatter if found and valid, null otherwise
 */
export declare function extractFrontmatter(notebook: Notebook): GyoshuFrontmatter | null;
/**
 * Extract full notebook frontmatter including Quarto fields.
 *
 * @param notebook - The notebook to extract frontmatter from
 * @returns Full frontmatter object or null if not found
 */
export declare function extractFullFrontmatter(notebook: Notebook): NotebookFrontmatter | null;
/**
 * Update frontmatter in a notebook, returning a new notebook object (immutable).
 *
 * @param notebook - The notebook to update
 * @param updates - Partial frontmatter updates to merge
 * @returns New notebook with updated frontmatter
 */
export declare function updateFrontmatter(notebook: Notebook, updates: Partial<GyoshuFrontmatter>): Notebook;
/**
 * Ensure a notebook has a frontmatter cell, adding one if not present.
 *
 * @param notebook - The notebook to ensure has frontmatter
 * @param initial - Initial frontmatter values to use if creating new cell
 * @returns New notebook with frontmatter cell at position 0
 */
export declare function ensureFrontmatterCell(notebook: Notebook, initial: GyoshuFrontmatter): Notebook;
/**
 * Validate frontmatter against schema version.
 *
 * @param frontmatter - The frontmatter to validate
 * @returns Object with isValid boolean and errors array
 */
export declare function validateFrontmatter(frontmatter: GyoshuFrontmatter): {
    isValid: boolean;
    errors: string[];
};
export declare function validateGoalContract(contract: GoalContract): {
    isValid: boolean;
    errors: string[];
};
/**
 * Check if a notebook has valid Gyoshu frontmatter.
 *
 * @param notebook - The notebook to check
 * @returns true if notebook has valid frontmatter
 */
export declare function hasFrontmatter(notebook: Notebook): boolean;
/**
 * Get the current run from frontmatter (the one with status "in_progress").
 *
 * @param frontmatter - The frontmatter to check
 * @returns The current run or null if none in progress
 */
export declare function getCurrentRun(frontmatter: GyoshuFrontmatter): RunEntry | null;
/**
 * Add a new run to the frontmatter, keeping only the last 10 runs.
 *
 * @param frontmatter - The frontmatter to update
 * @param run - The new run to add
 * @returns New frontmatter with the run added
 */
export declare function addRun(frontmatter: GyoshuFrontmatter, run: RunEntry): GyoshuFrontmatter;
/**
 * Update a run in the frontmatter by ID.
 *
 * @param frontmatter - The frontmatter to update
 * @param runId - The ID of the run to update
 * @param updates - Partial run updates
 * @returns New frontmatter with the run updated
 */
export declare function updateRun(frontmatter: GyoshuFrontmatter, runId: string, updates: Partial<RunEntry>): GyoshuFrontmatter;
