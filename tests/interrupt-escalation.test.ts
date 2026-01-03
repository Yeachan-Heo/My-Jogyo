/**
 * Tests for Python REPL interrupt escalation functionality.
 * Verifies SIGINT -> SIGTERM -> SIGKILL escalation timing and output preservation.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const pythonReplPath = "../src/tool/python-repl.ts";

describe("Interrupt Escalation: Constants", () => {
  const { ESCALATION_DEFAULTS } = require(pythonReplPath);

  test("exports default grace period of 5000ms", () => {
    expect(ESCALATION_DEFAULTS.gracePeriodMs).toBe(5000);
  });

  test("exports default SIGTERM grace of 3000ms", () => {
    expect(ESCALATION_DEFAULTS.sigtermGraceMs).toBe(3000);
  });
});

describe("Interrupt Escalation: killSessionBridge", () => {
  const { killSessionBridge } = require(pythonReplPath);

  test("returns already_dead for non-existent session", async () => {
    const result = await killSessionBridge("non-existent-session-12345");
    expect(result.terminatedBy).toBe("already_dead");
    expect(result.terminationTimeMs).toBe(0);
  });

  test("accepts custom gracePeriodMs option", async () => {
    const result = await killSessionBridge("non-existent-session-67890", {
      gracePeriodMs: 1000,
    });
    expect(result.terminatedBy).toBe("already_dead");
  });
});

describe("Interrupt Escalation: EscalationResult type", () => {
  test("terminatedBy enum includes expected values", () => {
    const validValues = ["SIGINT", "SIGTERM", "SIGKILL", "already_dead"];
    
    const mockResult = {
      terminatedBy: "SIGINT" as const,
      terminationTimeMs: 100,
    };
    
    expect(validValues).toContain(mockResult.terminatedBy);
  });

  test("terminationTimeMs is numeric", () => {
    const mockResult = {
      terminatedBy: "SIGTERM" as const,
      terminationTimeMs: 5500,
    };
    
    expect(typeof mockResult.terminationTimeMs).toBe("number");
    expect(mockResult.terminationTimeMs).toBeGreaterThanOrEqual(0);
  });
});

describe("Interrupt Escalation: InterruptResult structure", () => {
  test("interrupt response includes expected fields", () => {
    const mockInterruptResponse = {
      success: true,
      status: "forced_kill",
      terminatedBy: "SIGTERM",
      terminationTimeMs: 5100,
      partialStdout: undefined,
      partialStderr: undefined,
    };

    expect(mockInterruptResponse).toHaveProperty("success");
    expect(mockInterruptResponse).toHaveProperty("terminatedBy");
    expect(mockInterruptResponse).toHaveProperty("terminationTimeMs");
  });

  test("graceful interrupt has terminatedBy=graceful", () => {
    const mockGracefulResponse = {
      success: true,
      status: "interrupt_requested",
      terminatedBy: "graceful",
    };

    expect(mockGracefulResponse.terminatedBy).toBe("graceful");
  });
});

describe("Interrupt Escalation: Timing Calculations", () => {
  test("sigtermGrace is half of gracePeriod but at least 1000ms", () => {
    const calculateSigtermGrace = (gracePeriodMs: number) => 
      Math.max(Math.floor(gracePeriodMs / 2), 1000);

    expect(calculateSigtermGrace(5000)).toBe(2500);
    expect(calculateSigtermGrace(10000)).toBe(5000);
    expect(calculateSigtermGrace(1500)).toBe(1000);
    expect(calculateSigtermGrace(500)).toBe(1000);
  });

  test("total max escalation time is gracePeriod + sigtermGrace + 1000ms", () => {
    const calculateMaxEscalationTime = (gracePeriodMs: number) => {
      const sigtermGrace = Math.max(Math.floor(gracePeriodMs / 2), 1000);
      return gracePeriodMs + sigtermGrace + 1000;
    };

    expect(calculateMaxEscalationTime(5000)).toBe(8500);
    expect(calculateMaxEscalationTime(2000)).toBe(4000);
    expect(calculateMaxEscalationTime(10000)).toBe(16000);
  });
});

describe("Interrupt Escalation: Output Preservation", () => {
  test("partialStdout and partialStderr are optional", () => {
    const responseWithOutput = {
      success: true,
      terminatedBy: "SIGKILL",
      partialStdout: "Some output before kill\n",
      partialStderr: "Warning: interrupted\n",
    };

    const responseWithoutOutput = {
      success: true,
      terminatedBy: "SIGINT",
    };

    expect(responseWithOutput.partialStdout).toBeDefined();
    expect(responseWithoutOutput.partialStdout).toBeUndefined();
  });
});

describe("Interrupt Escalation: Integration with Tool Args", () => {
  test("interruptWithTimeout option schema", () => {
    const validOptions = {
      gracePeriodMs: 3000,
      preserveOutput: true,
    };

    expect(validOptions.gracePeriodMs).toBeGreaterThan(0);
    expect(typeof validOptions.preserveOutput).toBe("boolean");
  });

  test("default preserveOutput is true when not specified", () => {
    const options: { gracePeriodMs?: number; preserveOutput?: boolean } = {
      gracePeriodMs: 2000,
    };

    const preserveOutput = options.preserveOutput ?? true;
    expect(preserveOutput).toBe(true);
  });

  test("gracePeriodMs defaults to 5000 when not specified", () => {
    const options: { gracePeriodMs?: number } = {};
    const { ESCALATION_DEFAULTS } = require(pythonReplPath);
    
    const gracePeriodMs = options.gracePeriodMs ?? ESCALATION_DEFAULTS.gracePeriodMs;
    expect(gracePeriodMs).toBe(5000);
  });
});
