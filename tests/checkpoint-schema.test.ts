import { describe, test, expect } from "bun:test";
import { 
  CheckpointManifestSchema, 
  validateCheckpointManifest,
  parseCheckpointManifest,
  RehydrationModeSchema,
  CheckpointStatusSchema,
  EmergencyReasonSchema,
  ArtifactEntrySchema,
  NotebookReferenceSchema,
  PythonEnvMetadataSchema,
  RehydrationConfigSchema,
  type CheckpointManifest,
} from "../src/lib/checkpoint-schema";

const validManifest: CheckpointManifest = {
  checkpointId: "ckpt-001",
  researchSessionID: "ses_abc123",
  reportTitle: "customer-churn-analysis",
  runId: "run-001",
  stageId: "S02_eda_exploration",
  createdAt: "2026-01-02T10:30:00Z",
  executionCount: 5,
  status: "saved",
  notebook: {
    path: "notebooks/customer-churn-analysis.ipynb",
    checkpointCellId: "cell-abc123",
  },
  pythonEnv: {
    pythonPath: "/project/.venv/bin/python",
    packages: ["pandas==2.0.0", "numpy==1.24.0"],
    platform: "linux",
  },
  artifacts: [
    {
      relativePath: "reports/customer-churn-analysis/run-001/S02_eda/df_clean.parquet",
      sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      sizeBytes: 1024000,
    },
  ],
  rehydration: {
    mode: "artifacts_only",
    rehydrationCellSource: ["import pandas as pd", "df = pd.read_parquet(...)"],
  },
  manifestSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};

describe("CheckpointSchema", () => {
  describe("Enum Schemas", () => {
    test("RehydrationModeSchema validates artifacts_only", () => {
      const result = RehydrationModeSchema.safeParse("artifacts_only");
      expect(result.success).toBe(true);
    });

    test("RehydrationModeSchema validates with_vars", () => {
      const result = RehydrationModeSchema.safeParse("with_vars");
      expect(result.success).toBe(true);
    });

    test("RehydrationModeSchema rejects invalid value", () => {
      const result = RehydrationModeSchema.safeParse("invalid");
      expect(result.success).toBe(false);
    });

    test("CheckpointStatusSchema validates all statuses", () => {
      expect(CheckpointStatusSchema.safeParse("saved").success).toBe(true);
      expect(CheckpointStatusSchema.safeParse("interrupted").success).toBe(true);
      expect(CheckpointStatusSchema.safeParse("emergency").success).toBe(true);
    });

    test("EmergencyReasonSchema validates all reasons", () => {
      expect(EmergencyReasonSchema.safeParse("timeout").success).toBe(true);
      expect(EmergencyReasonSchema.safeParse("abort").success).toBe(true);
      expect(EmergencyReasonSchema.safeParse("error").success).toBe(true);
    });
  });

  describe("Component Schemas", () => {
    test("ArtifactEntrySchema validates correct artifact", () => {
      const result = ArtifactEntrySchema.safeParse({
        relativePath: "path/to/file.parquet",
        sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        sizeBytes: 1024,
      });
      expect(result.success).toBe(true);
    });

    test("ArtifactEntrySchema rejects invalid SHA256", () => {
      const result = ArtifactEntrySchema.safeParse({
        relativePath: "path/to/file.parquet",
        sha256: "not-valid-sha256",
        sizeBytes: 1024,
      });
      expect(result.success).toBe(false);
    });

    test("ArtifactEntrySchema rejects negative size", () => {
      const result = ArtifactEntrySchema.safeParse({
        relativePath: "path/to/file.parquet",
        sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        sizeBytes: -1,
      });
      expect(result.success).toBe(false);
    });

    test("NotebookReferenceSchema validates correctly", () => {
      const result = NotebookReferenceSchema.safeParse({
        path: "notebooks/test.ipynb",
        checkpointCellId: "cell-123",
      });
      expect(result.success).toBe(true);
    });

    test("PythonEnvMetadataSchema validates correctly", () => {
      const result = PythonEnvMetadataSchema.safeParse({
        pythonPath: "/usr/bin/python3",
        packages: ["numpy==1.24.0"],
        platform: "linux",
      });
      expect(result.success).toBe(true);
    });

    test("RehydrationConfigSchema validates correctly", () => {
      const result = RehydrationConfigSchema.safeParse({
        mode: "artifacts_only",
        rehydrationCellSource: ["import pandas as pd"],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("CheckpointManifestSchema", () => {
    test("validates complete manifest", () => {
      const result = validateCheckpointManifest(validManifest);
      expect(result.success).toBe(true);
    });

    test("validates emergency checkpoint with reason", () => {
      const emergencyManifest = {
        ...validManifest,
        checkpointId: "ckpt-002",
        status: "emergency" as const,
        reason: "timeout" as const,
      };
      const result = validateCheckpointManifest(emergencyManifest);
      expect(result.success).toBe(true);
    });

    test("rejects emergency checkpoint without reason", () => {
      const invalidEmergency = {
        ...validManifest,
        status: "emergency" as const,
      };
      const result = validateCheckpointManifest(invalidEmergency);
      expect(result.success).toBe(false);
    });

    test("rejects invalid stage ID format", () => {
      const invalidStage = {
        ...validManifest,
        stageId: "invalid-stage",
      };
      const result = validateCheckpointManifest(invalidStage);
      expect(result.success).toBe(false);
    });

    test("accepts valid stage ID format", () => {
      const result = validateCheckpointManifest({
        ...validManifest,
        stageId: "S01_load_data",
      });
      expect(result.success).toBe(true);
    });

    test("rejects invalid manifest SHA256", () => {
      const invalid = {
        ...validManifest,
        manifestSha256: "not-valid",
      };
      const result = validateCheckpointManifest(invalid);
      expect(result.success).toBe(false);
    });

    test("rejects invalid createdAt timestamp", () => {
      const invalid = {
        ...validManifest,
        createdAt: "not-a-date",
      };
      const result = validateCheckpointManifest(invalid);
      expect(result.success).toBe(false);
    });

    test("rejects negative executionCount", () => {
      const invalid = {
        ...validManifest,
        executionCount: -5,
      };
      const result = validateCheckpointManifest(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("Helper Functions", () => {
    test("parseCheckpointManifest returns parsed manifest", () => {
      const parsed = parseCheckpointManifest(validManifest);
      expect(parsed.checkpointId).toBe("ckpt-001");
      expect(parsed.researchSessionID).toBe("ses_abc123");
      expect(parsed.status).toBe("saved");
    });

    test("parseCheckpointManifest throws on invalid input", () => {
      expect(() => parseCheckpointManifest({ invalid: true })).toThrow();
    });
  });
});
