/**
 * Goal Gates Library - Evaluate acceptance criteria against notebook outputs.
 *
 * This module implements the "Goal Gate" component of the Two-Gate system:
 * - Trust Gate: Evidence quality (implemented in quality-gates.ts)
 * - Goal Gate: Acceptance criteria met (THIS MODULE)
 *
 * Goal Gate Rules:
 * - Evaluates acceptance criteria defined in notebook frontmatter
 * - Checks metric thresholds, marker existence, artifact creation, finding counts
 * - Provides pivot recommendations when criteria are not met
 *
 * @module goal-gates
 */

import {
  GoalContract,
  AcceptanceCriterion,
  ComparisonOperator,
} from "./notebook-frontmatter";
import { parseMarkers, getMarkersByType } from "./marker-parser";

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Status of a single acceptance criterion evaluation.
 */
export type CriterionStatus = "MET" | "NOT_MET" | "BLOCKED" | "UNKNOWN";

/**
 * Result of evaluating a single acceptance criterion.
 */
export interface CriterionResult {
  /** The criterion that was evaluated */
  criterion: AcceptanceCriterion;
  /** Whether the criterion was met */
  status: CriterionStatus;
  /** Actual value found (for metric_threshold and finding_count) */
  actualValue?: number | string | boolean;
  /** Human-readable message describing the result */
  message: string;
}

/**
 * Result of evaluating all goal gate criteria.
 */
export interface GoalGateResult {
  /** Whether all criteria are MET */
  passed: boolean;
  /** Overall status of the goal gate */
  overallStatus: "MET" | "NOT_MET" | "BLOCKED" | "NO_CONTRACT";
  /** Individual results for each criterion */
  criteriaResults: CriterionResult[];
  /** Number of criteria that were MET */
  metCount: number;
  /** Total number of criteria evaluated */
  totalCount: number;
  /** List of blocker messages (for BLOCKED status) */
  blockers?: string[];
}

/**
 * Recommendation for pivoting when goal criteria are not met.
 */
export interface PivotRecommendation {
  /** Whether a pivot is recommended */
  shouldPivot: boolean;
  /** Current attempt number */
  attemptNumber: number;
  /** Maximum attempts allowed */
  maxAttempts: number;
  /** List of suggested actions to improve results */
  suggestions: string[];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract a metric value from notebook output.
 *
 * Searches for pattern: [METRIC:name] value
 *
 * @param output - Combined stdout from notebook cells
 * @param metricName - Name of the metric to extract (e.g., "cv_accuracy_mean")
 * @returns Extracted numeric value or undefined if not found
 *
 * @example
 * ```typescript
 * const output = "[METRIC:cv_accuracy_mean] 0.85\n[METRIC:baseline] 0.65";
 * const value = extractMetricValue(output, "cv_accuracy_mean");
 * // value === 0.85
 * ```
 */
export function extractMetricValue(
  output: string,
  metricName: string
): number | undefined {
  // Pattern to match [METRIC:name] value
  // Handles various formats:
  // - [METRIC:name] 0.85
  // - [METRIC:name] 0.85 (with description)
  // - [METRIC:name] value = 0.85
  const escapedName = metricName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\[METRIC:${escapedName}\\]\\s*(?:=\\s*)?(\\d+\\.?\\d*)`,
    "i"
  );

  const match = output.match(pattern);
  if (match && match[1]) {
    const value = parseFloat(match[1]);
    if (!isNaN(value)) {
      return value;
    }
  }

  return undefined;
}

/**
 * Compare two values using a comparison operator.
 *
 * @param actual - The actual value to compare
 * @param op - Comparison operator
 * @param target - Target value to compare against
 * @returns true if comparison passes
 */
function compareValues(
  actual: number,
  op: ComparisonOperator,
  target: number
): boolean {
  switch (op) {
    case ">=":
      return actual >= target;
    case ">":
      return actual > target;
    case "<=":
      return actual <= target;
    case "<":
      return actual < target;
    case "==":
      return actual === target;
    case "!=":
      return actual !== target;
    default:
      return false;
  }
}

/**
 * Get the human-readable comparison description.
 *
 * @param op - Comparison operator
 * @returns Human-readable comparison string
 */
function getComparisonDescription(op: ComparisonOperator): string {
  switch (op) {
    case ">=":
      return ">=";
    case ">":
      return ">";
    case "<=":
      return "<=";
    case "<":
      return "<";
    case "==":
      return "==";
    case "!=":
      return "!=";
    default:
      return op;
  }
}

/**
 * Match a glob pattern against a file path.
 *
 * Supports basic glob patterns:
 * - * matches any characters except /
 * - ** matches any characters including /
 * - ? matches single character
 *
 * @param pattern - Glob pattern (e.g., "*.pkl", "models/*.joblib")
 * @param path - File path to match
 * @returns true if pattern matches
 */
function matchGlobPattern(pattern: string, path: string): boolean {
  // Escape regex special chars except * and ?
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // Handle ** first (match any including /)
    .replace(/\*\*/g, ".*")
    // Handle * (match any except /)
    .replace(/(?<!\.\*)\*/g, "[^/]*")
    // Handle ?
    .replace(/\?/g, ".");

  // Ensure pattern matches the end of the path (basename or relative path)
  if (!pattern.includes("/")) {
    // Pattern is just a filename pattern, match against basename
    const basename = path.split("/").pop() || path;
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(basename);
  }

  // Pattern includes path separators, match against full path
  const regex = new RegExp(`${regexStr}$`);
  return regex.test(path);
}

// =============================================================================
// EVALUATOR FUNCTIONS
// =============================================================================

/**
 * Evaluate a metric threshold criterion.
 *
 * Extracts the metric value from output and compares against target.
 *
 * @param criterion - The metric_threshold criterion to evaluate
 * @param output - Combined stdout from notebook cells
 * @returns Evaluation result
 *
 * @example
 * ```typescript
 * const criterion = {
 *   id: "AC1",
 *   kind: "metric_threshold",
 *   metric: "cv_accuracy_mean",
 *   op: ">=",
 *   target: 0.90
 * };
 * const result = evaluateMetricThreshold(criterion, "[METRIC:cv_accuracy_mean] 0.85");
 * // result.status === "NOT_MET"
 * // result.actualValue === 0.85
 * // result.message === "cv_accuracy_mean (0.85) < target (0.90)"
 * ```
 */
export function evaluateMetricThreshold(
  criterion: AcceptanceCriterion,
  output: string
): CriterionResult {
  // Validate criterion has required fields
  if (!criterion.metric || !criterion.op || criterion.target === undefined) {
    return {
      criterion,
      status: "UNKNOWN",
      message: `Invalid metric_threshold criterion: missing metric, op, or target`,
    };
  }

  const actualValue = extractMetricValue(output, criterion.metric);

  if (actualValue === undefined) {
    return {
      criterion,
      status: "NOT_MET",
      message: `Metric [METRIC:${criterion.metric}] not found in output`,
    };
  }

  const passed = compareValues(actualValue, criterion.op, criterion.target);
  const compDesc = getComparisonDescription(criterion.op);

  if (passed) {
    return {
      criterion,
      status: "MET",
      actualValue,
      message: `${criterion.metric} (${actualValue}) ${compDesc} target (${criterion.target})`,
    };
  } else {
    // Invert the operator for the failure message
    const failedOp = criterion.op.replace(">=", "<")
      .replace(">", "<=")
      .replace("<=", ">")
      .replace("<", ">=")
      .replace("==", "!=")
      .replace("!=", "==");
    return {
      criterion,
      status: "NOT_MET",
      actualValue,
      message: `${criterion.metric} (${actualValue}) ${failedOp.charAt(0) === criterion.op.charAt(0) ? "does not meet" : failedOp} target (${criterion.target})`,
    };
  }
}

/**
 * Evaluate a marker required criterion.
 *
 * Checks if the specified marker exists in the output.
 *
 * @param criterion - The marker_required criterion to evaluate
 * @param output - Combined stdout from notebook cells
 * @returns Evaluation result
 *
 * @example
 * ```typescript
 * const criterion = {
 *   id: "AC2",
 *   kind: "marker_required",
 *   marker: "METRIC:baseline_accuracy"
 * };
 * const result = evaluateMarkerRequired(criterion, "[METRIC:baseline_accuracy] 0.65");
 * // result.status === "MET"
 * // result.message === "Marker [METRIC:baseline_accuracy] found"
 * ```
 */
export function evaluateMarkerRequired(
  criterion: AcceptanceCriterion,
  output: string
): CriterionResult {
  // Validate criterion has required fields
  if (!criterion.marker) {
    return {
      criterion,
      status: "UNKNOWN",
      message: `Invalid marker_required criterion: missing marker field`,
    };
  }

  // Build pattern to match the marker
  // Marker format: "METRIC:baseline_accuracy" matches [METRIC:baseline_accuracy]
  const escapedMarker = criterion.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\[${escapedMarker}\\]`, "i");

  const found = pattern.test(output);

  if (found) {
    return {
      criterion,
      status: "MET",
      actualValue: true,
      message: `Marker [${criterion.marker}] found`,
    };
  } else {
    return {
      criterion,
      status: "NOT_MET",
      actualValue: false,
      message: `Marker [${criterion.marker}] not found in output`,
    };
  }
}

/**
 * Evaluate an artifact exists criterion.
 *
 * Checks if any artifact matches the specified glob pattern.
 *
 * @param criterion - The artifact_exists criterion to evaluate
 * @param artifacts - List of artifact file paths
 * @returns Evaluation result
 *
 * @example
 * ```typescript
 * const criterion = {
 *   id: "AC3",
 *   kind: "artifact_exists",
 *   artifactPattern: "*.pkl"
 * };
 * const result = evaluateArtifactExists(criterion, ["reports/my-research/model.pkl"]);
 * // result.status === "MET"
 * // result.message === "Artifact matching *.pkl found: model.pkl"
 * ```
 */
export function evaluateArtifactExists(
  criterion: AcceptanceCriterion,
  artifacts: string[]
): CriterionResult {
  // Validate criterion has required fields
  if (!criterion.artifactPattern) {
    return {
      criterion,
      status: "UNKNOWN",
      message: `Invalid artifact_exists criterion: missing artifactPattern field`,
    };
  }

  // Find matching artifacts
  const matchingArtifacts = artifacts.filter((artifact) =>
    matchGlobPattern(criterion.artifactPattern!, artifact)
  );

  if (matchingArtifacts.length > 0) {
    const matchedNames = matchingArtifacts
      .map((a) => a.split("/").pop())
      .join(", ");
    return {
      criterion,
      status: "MET",
      actualValue: matchingArtifacts[0],
      message: `Artifact matching ${criterion.artifactPattern} found: ${matchedNames}`,
    };
  } else {
    return {
      criterion,
      status: "NOT_MET",
      message: `No artifact matching ${criterion.artifactPattern} found`,
    };
  }
}

/**
 * Evaluate a finding count criterion.
 *
 * Counts [FINDING] markers in the output and compares against minimum.
 *
 * @param criterion - The finding_count criterion to evaluate
 * @param output - Combined stdout from notebook cells
 * @returns Evaluation result
 *
 * @example
 * ```typescript
 * const criterion = {
 *   id: "AC4",
 *   kind: "finding_count",
 *   minCount: 3
 * };
 * const text = "[FINDING] First\n[FINDING] Second";
 * const result = evaluateFindingCount(criterion, text);
 * // result.status === "NOT_MET"
 * // result.actualValue === 2
 * // result.message === "Found 2 findings, need at least 3"
 * ```
 */
export function evaluateFindingCount(
  criterion: AcceptanceCriterion,
  output: string
): CriterionResult {
  // Validate criterion has required fields
  if (criterion.minCount === undefined || criterion.minCount < 0) {
    return {
      criterion,
      status: "UNKNOWN",
      message: `Invalid finding_count criterion: missing or invalid minCount field`,
    };
  }

  // Parse markers and count FINDING markers
  const parseResult = parseMarkers(output);
  const findings = getMarkersByType(parseResult.markers, "FINDING");
  const count = findings.length;

  if (count >= criterion.minCount) {
    return {
      criterion,
      status: "MET",
      actualValue: count,
      message: `Found ${count} finding${count !== 1 ? "s" : ""}, meets minimum of ${criterion.minCount}`,
    };
  } else {
    return {
      criterion,
      status: "NOT_MET",
      actualValue: count,
      message: `Found ${count} finding${count !== 1 ? "s" : ""}, need at least ${criterion.minCount}`,
    };
  }
}

// =============================================================================
// MAIN EVALUATION FUNCTION
// =============================================================================

/**
 * Evaluate goal contract against notebook outputs.
 *
 * Runs all acceptance criteria evaluators and aggregates results.
 *
 * @param contract - Goal contract with acceptance criteria (or undefined)
 * @param notebookOutput - Combined stdout from all notebook cells
 * @param artifacts - List of artifact file paths
 * @returns Goal gate evaluation result
 *
 * @example
 * ```typescript
 * const contract = {
 *   version: 1,
 *   goal_text: "Build a classifier with 90% accuracy",
 *   acceptance_criteria: [
 *     { id: "AC1", kind: "metric_threshold", metric: "cv_accuracy_mean", op: ">=", target: 0.90 },
 *     { id: "AC2", kind: "marker_required", marker: "METRIC:baseline_accuracy" }
 *   ]
 * };
 * const output = "[METRIC:cv_accuracy_mean] 0.92\n[METRIC:baseline_accuracy] 0.65";
 * const result = evaluateGoalGate(contract, output, []);
 * // result.passed === true
 * // result.overallStatus === "MET"
 * ```
 */
export function evaluateGoalGate(
  contract: GoalContract | undefined,
  notebookOutput: string,
  artifacts: string[]
): GoalGateResult {
  // Handle missing contract
  if (!contract) {
    return {
      passed: true,
      overallStatus: "NO_CONTRACT",
      criteriaResults: [],
      metCount: 0,
      totalCount: 0,
    };
  }

  // Handle empty criteria
  if (
    !contract.acceptance_criteria ||
    contract.acceptance_criteria.length === 0
  ) {
    return {
      passed: true,
      overallStatus: "MET",
      criteriaResults: [],
      metCount: 0,
      totalCount: 0,
    };
  }

  const criteriaResults: CriterionResult[] = [];
  const blockers: string[] = [];

  // Evaluate each criterion
  for (const criterion of contract.acceptance_criteria) {
    let result: CriterionResult;

    switch (criterion.kind) {
      case "metric_threshold":
        result = evaluateMetricThreshold(criterion, notebookOutput);
        break;
      case "marker_required":
        result = evaluateMarkerRequired(criterion, notebookOutput);
        break;
      case "artifact_exists":
        result = evaluateArtifactExists(criterion, artifacts);
        break;
      case "finding_count":
        result = evaluateFindingCount(criterion, notebookOutput);
        break;
      default:
        result = {
          criterion,
          status: "UNKNOWN",
          message: `Unknown criterion kind: ${(criterion as AcceptanceCriterion).kind}`,
        };
    }

    criteriaResults.push(result);

    // Track blockers
    if (result.status === "BLOCKED") {
      blockers.push(result.message);
    }
  }

  // Calculate aggregate status
  const metCount = criteriaResults.filter((r) => r.status === "MET").length;
  const totalCount = criteriaResults.length;
  const blockedCount = criteriaResults.filter(
    (r) => r.status === "BLOCKED"
  ).length;
  const notMetCount = criteriaResults.filter(
    (r) => r.status === "NOT_MET"
  ).length;

  let overallStatus: "MET" | "NOT_MET" | "BLOCKED" | "NO_CONTRACT";
  let passed: boolean;

  if (blockedCount > 0) {
    overallStatus = "BLOCKED";
    passed = false;
  } else if (metCount === totalCount) {
    overallStatus = "MET";
    passed = true;
  } else {
    overallStatus = "NOT_MET";
    passed = false;
  }

  const result: GoalGateResult = {
    passed,
    overallStatus,
    criteriaResults,
    metCount,
    totalCount,
  };

  if (blockers.length > 0) {
    result.blockers = blockers;
  }

  return result;
}

// =============================================================================
// PIVOT RECOMMENDATION
// =============================================================================

/**
 * Generate pivot recommendations based on goal gate results.
 *
 * Analyzes which criteria failed and suggests actions to improve results.
 *
 * @param result - Goal gate evaluation result
 * @param attemptNumber - Current attempt number (1-indexed)
 * @param maxAttempts - Maximum attempts allowed (default: 3)
 * @returns Pivot recommendation with suggestions
 *
 * @example
 * ```typescript
 * const gateResult = evaluateGoalGate(contract, output, artifacts);
 * const pivot = recommendPivot(gateResult, 1, 3);
 * if (pivot.shouldPivot) {
 *   console.log("Suggestions:", pivot.suggestions);
 * }
 * ```
 */
export function recommendPivot(
  result: GoalGateResult,
  attemptNumber: number,
  maxAttempts: number = 3
): PivotRecommendation {
  const suggestions: string[] = [];

  // If all criteria met, no pivot needed
  if (result.passed || result.overallStatus === "NO_CONTRACT") {
    return {
      shouldPivot: false,
      attemptNumber,
      maxAttempts,
      suggestions: [],
    };
  }

  // If blocked, can't pivot - need to resolve blockers
  if (result.overallStatus === "BLOCKED") {
    return {
      shouldPivot: false,
      attemptNumber,
      maxAttempts,
      suggestions: result.blockers || ["Resolve blocking issues before retrying"],
    };
  }

  // If no attempts remaining, can't pivot
  if (attemptNumber >= maxAttempts) {
    return {
      shouldPivot: false,
      attemptNumber,
      maxAttempts,
      suggestions: [
        "Maximum attempts reached. Consider revising goal criteria or escalating.",
      ],
    };
  }

  // Generate suggestions based on failed criteria
  for (const criterionResult of result.criteriaResults) {
    if (criterionResult.status !== "MET") {
      const criterion = criterionResult.criterion;

      switch (criterion.kind) {
        case "metric_threshold":
          if (criterionResult.actualValue !== undefined) {
            const actual = criterionResult.actualValue as number;
            const target = criterion.target!;
            const gap = Math.abs(target - actual);
            const percentGap = ((gap / target) * 100).toFixed(1);

            if (gap > 0) {
              suggestions.push(
                `Improve ${criterion.metric}: current ${actual.toFixed(3)}, need ${criterion.op} ${target} (gap: ${percentGap}%)`
              );
              // Add specific suggestions based on metric type
              if (criterion.metric?.includes("accuracy")) {
                suggestions.push(
                  "Consider: feature engineering, hyperparameter tuning, or trying different algorithms"
                );
              } else if (criterion.metric?.includes("cv_")) {
                suggestions.push(
                  "Consider: increasing cross-validation folds, stratified sampling, or data augmentation"
                );
              }
            }
          } else {
            suggestions.push(
              `Add [METRIC:${criterion.metric}] output to track ${criterion.metric}`
            );
          }
          break;

        case "marker_required":
          suggestions.push(
            `Add missing marker: [${criterion.marker}] - required for acceptance`
          );
          if (criterion.marker?.startsWith("METRIC:baseline")) {
            suggestions.push(
              "Tip: Compute baseline model performance before training main model"
            );
          }
          break;

        case "artifact_exists":
          suggestions.push(
            `Create artifact matching: ${criterion.artifactPattern}`
          );
          if (criterion.artifactPattern?.includes(".pkl")) {
            suggestions.push(
              "Tip: Use joblib.dump() or pickle.dump() to save model artifacts"
            );
          }
          break;

        case "finding_count":
          const actual = (criterionResult.actualValue as number) || 0;
          const needed = criterion.minCount! - actual;
          suggestions.push(
            `Add ${needed} more [FINDING] marker${needed !== 1 ? "s" : ""} with statistical evidence`
          );
          suggestions.push(
            "Remember: Each finding needs [STAT:ci] and [STAT:effect_size] within 10 lines before it"
          );
          break;
      }
    }
  }

  // Add general pivot suggestions based on attempt number
  if (attemptNumber === 1) {
    suggestions.push(
      "First attempt incomplete. Review the specific criteria above and iterate."
    );
  } else if (attemptNumber === 2) {
    suggestions.push(
      "Second attempt. Consider more aggressive changes: different algorithms, data transformations, or feature sets."
    );
  }

  return {
    shouldPivot: true,
    attemptNumber,
    maxAttempts,
    suggestions,
  };
}
