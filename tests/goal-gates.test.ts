import { describe, expect, test } from "bun:test";
import {
  extractMetricValue,
  evaluateMetricThreshold,
  evaluateMarkerRequired,
  evaluateArtifactExists,
  evaluateFindingCount,
  evaluateGoalGate,
  recommendPivot,
} from "../src/lib/goal-gates";
import type { AcceptanceCriterion, GoalContract } from "../src/lib/notebook-frontmatter";

describe("goal-gates", () => {
  describe("extractMetricValue", () => {
    test("extracts simple metric value", () => {
      const output = "[METRIC:cv_accuracy_mean] 0.85";
      const value = extractMetricValue(output, "cv_accuracy_mean");
      expect(value).toBe(0.85);
    });

    test("extracts metric from multi-line output", () => {
      const output = `[OBJECTIVE] Test
[METRIC:baseline] 0.33
[METRIC:cv_accuracy_mean] 0.92
[FINDING] Model works`;
      expect(extractMetricValue(output, "baseline")).toBe(0.33);
      expect(extractMetricValue(output, "cv_accuracy_mean")).toBe(0.92);
    });

    test("returns undefined for missing metric", () => {
      const output = "[METRIC:accuracy] 0.85";
      expect(extractMetricValue(output, "cv_accuracy_mean")).toBeUndefined();
    });

    test("handles metric with equals sign", () => {
      const output = "[METRIC:accuracy] = 0.95";
      expect(extractMetricValue(output, "accuracy")).toBe(0.95);
    });

    test("handles integer values", () => {
      const output = "[METRIC:count] 42";
      expect(extractMetricValue(output, "count")).toBe(42);
    });
  });

  describe("evaluateMetricThreshold", () => {
    test("MET when value >= target", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC1",
        kind: "metric_threshold",
        metric: "cv_accuracy_mean",
        op: ">=",
        target: 0.90,
      };
      const output = "[METRIC:cv_accuracy_mean] 0.92";
      const result = evaluateMetricThreshold(criterion, output);

      expect(result.status).toBe("MET");
      expect(result.actualValue).toBe(0.92);
      expect(result.message).toContain("cv_accuracy_mean");
      expect(result.message).toContain("0.92");
    });

    test("NOT_MET when value < target", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC1",
        kind: "metric_threshold",
        metric: "cv_accuracy_mean",
        op: ">=",
        target: 0.90,
      };
      const output = "[METRIC:cv_accuracy_mean] 0.85";
      const result = evaluateMetricThreshold(criterion, output);

      expect(result.status).toBe("NOT_MET");
      expect(result.actualValue).toBe(0.85);
    });

    test("NOT_MET when metric not found", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC1",
        kind: "metric_threshold",
        metric: "cv_accuracy_mean",
        op: ">=",
        target: 0.90,
      };
      const output = "[METRIC:other] 0.95";
      const result = evaluateMetricThreshold(criterion, output);

      expect(result.status).toBe("NOT_MET");
      expect(result.message).toContain("not found");
    });

    test("UNKNOWN for invalid criterion", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC1",
        kind: "metric_threshold",
      };
      const result = evaluateMetricThreshold(criterion, "");

      expect(result.status).toBe("UNKNOWN");
      expect(result.message).toContain("Invalid");
    });

    test("handles different operators", () => {
      const makeCriterion = (op: ">=" | ">" | "<=" | "<" | "==" | "!="): AcceptanceCriterion => ({
        id: "AC1",
        kind: "metric_threshold",
        metric: "value",
        op,
        target: 0.5,
      });

      expect(evaluateMetricThreshold(makeCriterion(">="), "[METRIC:value] 0.5").status).toBe("MET");
      expect(evaluateMetricThreshold(makeCriterion(">"), "[METRIC:value] 0.5").status).toBe("NOT_MET");
      expect(evaluateMetricThreshold(makeCriterion(">"), "[METRIC:value] 0.6").status).toBe("MET");
      expect(evaluateMetricThreshold(makeCriterion("<="), "[METRIC:value] 0.5").status).toBe("MET");
      expect(evaluateMetricThreshold(makeCriterion("<"), "[METRIC:value] 0.4").status).toBe("MET");
      expect(evaluateMetricThreshold(makeCriterion("=="), "[METRIC:value] 0.5").status).toBe("MET");
      expect(evaluateMetricThreshold(makeCriterion("!="), "[METRIC:value] 0.6").status).toBe("MET");
    });
  });

  describe("evaluateMarkerRequired", () => {
    test("MET when marker found", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC2",
        kind: "marker_required",
        marker: "METRIC:baseline_accuracy",
      };
      const output = "[METRIC:baseline_accuracy] 0.65";
      const result = evaluateMarkerRequired(criterion, output);

      expect(result.status).toBe("MET");
      expect(result.actualValue).toBe(true);
      expect(result.message).toContain("found");
    });

    test("NOT_MET when marker not found", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC2",
        kind: "marker_required",
        marker: "METRIC:baseline_accuracy",
      };
      const output = "[METRIC:cv_accuracy] 0.85";
      const result = evaluateMarkerRequired(criterion, output);

      expect(result.status).toBe("NOT_MET");
      expect(result.actualValue).toBe(false);
      expect(result.message).toContain("not found");
    });

    test("case insensitive matching", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC2",
        kind: "marker_required",
        marker: "STAT:ci",
      };
      const output = "[stat:CI] 95% CI [0.8, 0.9]";
      const result = evaluateMarkerRequired(criterion, output);

      expect(result.status).toBe("MET");
    });

    test("UNKNOWN for missing marker field", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC2",
        kind: "marker_required",
      };
      const result = evaluateMarkerRequired(criterion, "");

      expect(result.status).toBe("UNKNOWN");
    });
  });

  describe("evaluateArtifactExists", () => {
    test("MET when artifact matches pattern", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC3",
        kind: "artifact_exists",
        artifactPattern: "*.pkl",
      };
      const artifacts = ["reports/my-research/model.pkl"];
      const result = evaluateArtifactExists(criterion, artifacts);

      expect(result.status).toBe("MET");
      expect(result.message).toContain("model.pkl");
    });

    test("NOT_MET when no artifact matches", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC3",
        kind: "artifact_exists",
        artifactPattern: "*.pkl",
      };
      const artifacts = ["reports/figures/plot.png", "data/output.csv"];
      const result = evaluateArtifactExists(criterion, artifacts);

      expect(result.status).toBe("NOT_MET");
      expect(result.message).toContain("No artifact");
    });

    test("matches multiple extensions", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC3",
        kind: "artifact_exists",
        artifactPattern: "*.joblib",
      };
      const artifacts = ["model.joblib", "model.pkl"];
      const result = evaluateArtifactExists(criterion, artifacts);

      expect(result.status).toBe("MET");
    });

    test("UNKNOWN for missing artifactPattern", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC3",
        kind: "artifact_exists",
      };
      const result = evaluateArtifactExists(criterion, []);

      expect(result.status).toBe("UNKNOWN");
    });

    test("handles empty artifacts list", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC3",
        kind: "artifact_exists",
        artifactPattern: "*.pkl",
      };
      const result = evaluateArtifactExists(criterion, []);

      expect(result.status).toBe("NOT_MET");
    });
  });

  describe("evaluateFindingCount", () => {
    test("MET when enough findings", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC4",
        kind: "finding_count",
        minCount: 2,
      };
      const output = `[FINDING] First finding
[FINDING] Second finding
[FINDING] Third finding`;
      const result = evaluateFindingCount(criterion, output);

      expect(result.status).toBe("MET");
      expect(result.actualValue).toBe(3);
    });

    test("NOT_MET when not enough findings", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC4",
        kind: "finding_count",
        minCount: 3,
      };
      const output = `[FINDING] First
[FINDING] Second`;
      const result = evaluateFindingCount(criterion, output);

      expect(result.status).toBe("NOT_MET");
      expect(result.actualValue).toBe(2);
      expect(result.message).toContain("need at least 3");
    });

    test("MET with exactly minCount", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC4",
        kind: "finding_count",
        minCount: 2,
      };
      const output = `[FINDING] One
[FINDING] Two`;
      const result = evaluateFindingCount(criterion, output);

      expect(result.status).toBe("MET");
    });

    test("MET with zero minCount and no findings", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC4",
        kind: "finding_count",
        minCount: 0,
      };
      const result = evaluateFindingCount(criterion, "No findings here");

      expect(result.status).toBe("MET");
      expect(result.actualValue).toBe(0);
    });

    test("UNKNOWN for invalid minCount", () => {
      const criterion: AcceptanceCriterion = {
        id: "AC4",
        kind: "finding_count",
        minCount: -1,
      };
      const result = evaluateFindingCount(criterion, "");

      expect(result.status).toBe("UNKNOWN");
    });
  });

  describe("evaluateGoalGate", () => {
    test("NO_CONTRACT when contract is undefined", () => {
      const result = evaluateGoalGate(undefined, "", []);

      expect(result.passed).toBe(true);
      expect(result.overallStatus).toBe("NO_CONTRACT");
      expect(result.totalCount).toBe(0);
    });

    test("MET when all criteria pass", () => {
      const contract: GoalContract = {
        version: 1,
        goal_text: "Build classifier with 90% accuracy",
        acceptance_criteria: [
          { id: "AC1", kind: "metric_threshold", metric: "cv_accuracy_mean", op: ">=", target: 0.90 },
          { id: "AC2", kind: "marker_required", marker: "METRIC:baseline_accuracy" },
        ],
      };
      const output = `[METRIC:cv_accuracy_mean] 0.92
[METRIC:baseline_accuracy] 0.65`;
      const result = evaluateGoalGate(contract, output, []);

      expect(result.passed).toBe(true);
      expect(result.overallStatus).toBe("MET");
      expect(result.metCount).toBe(2);
      expect(result.totalCount).toBe(2);
    });

    test("NOT_MET when some criteria fail", () => {
      const contract: GoalContract = {
        version: 1,
        goal_text: "Build classifier",
        acceptance_criteria: [
          { id: "AC1", kind: "metric_threshold", metric: "accuracy", op: ">=", target: 0.90 },
          { id: "AC2", kind: "artifact_exists", artifactPattern: "*.pkl" },
        ],
      };
      const output = "[METRIC:accuracy] 0.95";
      const result = evaluateGoalGate(contract, output, []);

      expect(result.passed).toBe(false);
      expect(result.overallStatus).toBe("NOT_MET");
      expect(result.metCount).toBe(1);
      expect(result.totalCount).toBe(2);
    });

    test("handles empty acceptance_criteria", () => {
      const contract: GoalContract = {
        version: 1,
        goal_text: "Explore data",
        acceptance_criteria: [],
      };
      const result = evaluateGoalGate(contract, "", []);

      expect(result.passed).toBe(true);
      expect(result.overallStatus).toBe("MET");
    });

    test("evaluates all criterion types", () => {
      const contract: GoalContract = {
        version: 1,
        goal_text: "Complete analysis",
        acceptance_criteria: [
          { id: "AC1", kind: "metric_threshold", metric: "accuracy", op: ">=", target: 0.80 },
          { id: "AC2", kind: "marker_required", marker: "CONCLUSION" },
          { id: "AC3", kind: "artifact_exists", artifactPattern: "*.png" },
          { id: "AC4", kind: "finding_count", minCount: 1 },
        ],
      };
      const output = `[METRIC:accuracy] 0.85
[FINDING] Key insight discovered
[CONCLUSION] Analysis complete`;
      const artifacts = ["figures/plot.png"];
      const result = evaluateGoalGate(contract, output, artifacts);

      expect(result.passed).toBe(true);
      expect(result.metCount).toBe(4);
    });
  });

  describe("recommendPivot", () => {
    test("no pivot when passed", () => {
      const gateResult = evaluateGoalGate(undefined, "", []);
      const pivot = recommendPivot(gateResult, 1, 3);

      expect(pivot.shouldPivot).toBe(false);
      expect(pivot.suggestions).toHaveLength(0);
    });

    test("suggests pivot when NOT_MET with attempts remaining", () => {
      const contract: GoalContract = {
        version: 1,
        goal_text: "Build model",
        acceptance_criteria: [
          { id: "AC1", kind: "metric_threshold", metric: "accuracy", op: ">=", target: 0.90 },
        ],
      };
      const output = "[METRIC:accuracy] 0.75";
      const gateResult = evaluateGoalGate(contract, output, []);
      const pivot = recommendPivot(gateResult, 1, 3);

      expect(pivot.shouldPivot).toBe(true);
      expect(pivot.attemptNumber).toBe(1);
      expect(pivot.maxAttempts).toBe(3);
      expect(pivot.suggestions.length).toBeGreaterThan(0);
    });

    test("no pivot when max attempts reached", () => {
      const contract: GoalContract = {
        version: 1,
        goal_text: "Build model",
        acceptance_criteria: [
          { id: "AC1", kind: "metric_threshold", metric: "accuracy", op: ">=", target: 0.90 },
        ],
      };
      const output = "[METRIC:accuracy] 0.75";
      const gateResult = evaluateGoalGate(contract, output, []);
      const pivot = recommendPivot(gateResult, 3, 3);

      expect(pivot.shouldPivot).toBe(false);
      expect(pivot.suggestions).toContain("Maximum attempts reached. Consider revising goal criteria or escalating.");
    });

    test("provides specific suggestions for missing markers", () => {
      const contract: GoalContract = {
        version: 1,
        goal_text: "Analysis",
        acceptance_criteria: [
          { id: "AC1", kind: "marker_required", marker: "METRIC:baseline_accuracy" },
        ],
      };
      const gateResult = evaluateGoalGate(contract, "", []);
      const pivot = recommendPivot(gateResult, 1, 3);

      expect(pivot.shouldPivot).toBe(true);
      const markerSuggestion = pivot.suggestions.find(s => s.includes("Add missing marker"));
      expect(markerSuggestion).toBeDefined();
    });

    test("provides specific suggestions for missing artifacts", () => {
      const contract: GoalContract = {
        version: 1,
        goal_text: "Build model",
        acceptance_criteria: [
          { id: "AC1", kind: "artifact_exists", artifactPattern: "*.pkl" },
        ],
      };
      const gateResult = evaluateGoalGate(contract, "", []);
      const pivot = recommendPivot(gateResult, 1, 3);

      expect(pivot.shouldPivot).toBe(true);
      const artifactSuggestion = pivot.suggestions.find(s => s.includes("Create artifact"));
      expect(artifactSuggestion).toBeDefined();
    });

    test("provides finding count suggestions", () => {
      const contract: GoalContract = {
        version: 1,
        goal_text: "Discover insights",
        acceptance_criteria: [
          { id: "AC1", kind: "finding_count", minCount: 3 },
        ],
      };
      const output = "[FINDING] Only one";
      const gateResult = evaluateGoalGate(contract, output, []);
      const pivot = recommendPivot(gateResult, 1, 3);

      expect(pivot.shouldPivot).toBe(true);
      const findingSuggestion = pivot.suggestions.find(s => s.includes("FINDING"));
      expect(findingSuggestion).toBeDefined();
    });
  });
});
