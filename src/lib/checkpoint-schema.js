"use strict";
/**
 * Checkpoint Manifest Schema
 *
 * Defines TypeScript interfaces and Zod validation schemas for the checkpoint system.
 * Checkpoints enable research resume capability by capturing:
 * - Session and execution state metadata
 * - Notebook cell reference for the checkpoint marker
 * - Python environment for reproducibility
 * - Artifact locations with integrity checksums
 * - Rehydration configuration for state restoration
 *
 * Storage Location:
 * ```
 * reports/{reportTitle}/checkpoints/{runId}/{checkpointId}/
 * ├── checkpoint.json    # This manifest
 * └── artifacts/         # Checkpoint artifacts
 * ```
 *
 * @see docs/stage-protocol.md for stage and checkpoint protocol
 * @module checkpoint-schema
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckpointManifestSchema = exports.RehydrationConfigSchema = exports.PythonEnvMetadataSchema = exports.NotebookReferenceSchema = exports.ArtifactEntrySchema = exports.TrustLevelSchema = exports.EmergencyReasonSchema = exports.CheckpointStatusSchema = exports.RehydrationModeSchema = void 0;
exports.validateCheckpointManifest = validateCheckpointManifest;
exports.parseCheckpointManifest = parseCheckpointManifest;
exports.createPartialCheckpointManifestSchema = createPartialCheckpointManifestSchema;
const zod_1 = require("zod");
// =============================================================================
// ZOD VALIDATION SCHEMAS (2.2.9)
// =============================================================================
/**
 * Zod schema for RehydrationMode enum.
 */
exports.RehydrationModeSchema = zod_1.z.enum(["artifacts_only", "with_vars"]);
/**
 * Zod schema for CheckpointStatus enum.
 */
exports.CheckpointStatusSchema = zod_1.z.enum(["saved", "interrupted", "emergency"]);
/**
 * Zod schema for EmergencyReason enum.
 */
exports.EmergencyReasonSchema = zod_1.z.enum(["timeout", "abort", "error"]);
/**
 * Zod schema for TrustLevel enum.
 */
exports.TrustLevelSchema = zod_1.z.enum(["local", "imported", "untrusted"]);
/**
 * Zod schema for ArtifactEntry.
 */
exports.ArtifactEntrySchema = zod_1.z.object({
    relativePath: zod_1.z.string().min(1, "Artifact path cannot be empty"),
    sha256: zod_1.z.string().regex(/^[a-f0-9]{64}$/i, "Invalid SHA256 hash format"),
    sizeBytes: zod_1.z.number().int().nonnegative("Size must be a non-negative integer"),
});
/**
 * Zod schema for NotebookReference.
 */
exports.NotebookReferenceSchema = zod_1.z.object({
    path: zod_1.z.string().min(1, "Notebook path cannot be empty"),
    checkpointCellId: zod_1.z.string().min(1, "Cell ID cannot be empty"),
});
/**
 * Zod schema for PythonEnvMetadata.
 */
exports.PythonEnvMetadataSchema = zod_1.z.object({
    pythonPath: zod_1.z.string().min(1, "Python path cannot be empty"),
    packages: zod_1.z.array(zod_1.z.string()),
    platform: zod_1.z.string().min(1, "Platform cannot be empty"),
    randomSeeds: zod_1.z.record(zod_1.z.string(), zod_1.z.number()).optional(),
});
/**
 * Zod schema for RehydrationConfig.
 */
exports.RehydrationConfigSchema = zod_1.z.object({
    mode: exports.RehydrationModeSchema,
    rehydrationCellSource: zod_1.z.array(zod_1.z.string()),
});
/**
 * Zod schema for CheckpointManifest.
 * Validates all fields including conditional requirements.
 */
exports.CheckpointManifestSchema = zod_1.z
    .object({
    // Identification Fields
    checkpointId: zod_1.z.string().min(1, "Checkpoint ID cannot be empty"),
    researchSessionID: zod_1.z.string().min(1, "Research session ID cannot be empty"),
    reportTitle: zod_1.z.string().min(1, "Report title cannot be empty"),
    runId: zod_1.z.string().min(1, "Run ID cannot be empty"),
    stageId: zod_1.z
        .string()
        .regex(/^S[0-9]{2}_[a-z]+_[a-z_]+$/, "Stage ID must follow format S{NN}_{verb}_{noun}"),
    // Timing Fields
    createdAt: zod_1.z.string().datetime({ message: "Invalid ISO 8601 datetime format" }),
    executionCount: zod_1.z.number().int().nonnegative("Execution count must be non-negative"),
    // Status Fields
    status: exports.CheckpointStatusSchema,
    reason: exports.EmergencyReasonSchema.optional(),
    trustLevel: exports.TrustLevelSchema.optional().default("local"),
    // Notebook Reference
    notebook: exports.NotebookReferenceSchema,
    // Python Environment
    pythonEnv: exports.PythonEnvMetadataSchema,
    // Artifacts
    artifacts: zod_1.z.array(exports.ArtifactEntrySchema),
    // Rehydration Config
    rehydration: exports.RehydrationConfigSchema,
    // Integrity
    manifestSha256: zod_1.z
        .string()
        .regex(/^[a-f0-9]{64}$/i, "Invalid manifest SHA256 hash format"),
})
    .refine((data) => {
    // Emergency checkpoints must have a reason
    if (data.status === "emergency" && !data.reason) {
        return false;
    }
    return true;
}, {
    message: "Emergency checkpoints must include a reason",
    path: ["reason"],
});
// =============================================================================
// VALIDATION HELPER FUNCTIONS
// =============================================================================
/**
 * Validate a checkpoint manifest object.
 *
 * @param manifest - The manifest object to validate
 * @returns Validation result with success/error information
 *
 * @example
 * ```typescript
 * const result = validateCheckpointManifest(manifestData);
 * if (result.success) {
 *   console.log("Valid manifest:", result.data);
 * } else {
 *   console.error("Validation errors:", result.error.issues);
 * }
 * ```
 */
function validateCheckpointManifest(manifest) {
    return exports.CheckpointManifestSchema.safeParse(manifest);
}
/**
 * Parse and validate a checkpoint manifest, throwing on error.
 *
 * @param manifest - The manifest object to validate
 * @returns The validated manifest
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * try {
 *   const validated = parseCheckpointManifest(manifestData);
 *   // validated is guaranteed to be valid
 * } catch (error) {
 *   console.error("Invalid manifest:", error);
 * }
 * ```
 */
function parseCheckpointManifest(manifest) {
    return exports.CheckpointManifestSchema.parse(manifest);
}
/**
 * Create a partial checkpoint manifest for building incrementally.
 * Useful when constructing a manifest step by step.
 *
 * @returns A Zod schema that allows partial fields
 */
function createPartialCheckpointManifestSchema() {
    return exports.CheckpointManifestSchema.partial();
}
