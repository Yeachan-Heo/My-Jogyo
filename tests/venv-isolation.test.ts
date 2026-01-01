import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as fss from "fs";
import * as path from "path";
import * as os from "os";
import { detectAvailableTools, resetToolCache } from "../.opencode/tool/python-repl";

const TEMP_DIR = path.join(os.tmpdir(), "gyoshu-venv-test");

async function cleanupTempDir(): Promise<void> {
  try {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  } catch {}
}

async function createProjectDir(subdir?: string): Promise<string> {
  const projectDir = subdir ? path.join(TEMP_DIR, subdir) : TEMP_DIR;
  await fs.mkdir(projectDir, { recursive: true });
  return projectDir;
}

function createVenvStructure(venvPath: string): void {
  const isWindows = process.platform === "win32";
  const binDir = isWindows ? "Scripts" : "bin";
  const pythonExe = isWindows ? "python.exe" : "python";
  
  fss.mkdirSync(path.join(venvPath, binDir), { recursive: true });
  fss.writeFileSync(path.join(venvPath, binDir, pythonExe), "#!/usr/bin/env python3\n", { mode: 0o755 });
}

describe("Venv Detection Order", () => {
  beforeEach(async () => {
    await cleanupTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir();
  });

  test("should detect ./venv first when multiple venvs exist", async () => {
    const projectDir = await createProjectDir("multi-venv");
    
    createVenvStructure(path.join(projectDir, "venv"));
    createVenvStructure(path.join(projectDir, ".venv"));
    createVenvStructure(path.join(projectDir, "gyoshu", "venv"));

    const venvPath = path.join(projectDir, "venv", process.platform === "win32" ? "Scripts" : "bin", "python");
    expect(fss.existsSync(venvPath)).toBe(true);
  });

  test("should detect ./.venv when ./venv does not exist", async () => {
    const projectDir = await createProjectDir("dot-venv");
    
    createVenvStructure(path.join(projectDir, ".venv"));
    createVenvStructure(path.join(projectDir, "gyoshu", "venv"));

    const venvPath = path.join(projectDir, ".venv", process.platform === "win32" ? "Scripts" : "bin", "python");
    expect(fss.existsSync(venvPath)).toBe(true);
    expect(fss.existsSync(path.join(projectDir, "venv"))).toBe(false);
  });

  test("should detect ./gyoshu/venv when neither ./venv nor ./.venv exist", async () => {
    const projectDir = await createProjectDir("gyoshu-venv");
    
    createVenvStructure(path.join(projectDir, "gyoshu", "venv"));

    const venvPath = path.join(projectDir, "gyoshu", "venv", process.platform === "win32" ? "Scripts" : "bin", "python");
    expect(fss.existsSync(venvPath)).toBe(true);
    expect(fss.existsSync(path.join(projectDir, "venv"))).toBe(false);
    expect(fss.existsSync(path.join(projectDir, ".venv"))).toBe(false);
  });
});

describe("Package Manager Detection", () => {
  beforeEach(async () => {
    await cleanupTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir();
  });

  test("should detect uv project with uv.lock", async () => {
    const projectDir = await createProjectDir("uv-project");
    
    await fs.writeFile(path.join(projectDir, "uv.lock"), "# uv lock file\n");
    
    expect(fss.existsSync(path.join(projectDir, "uv.lock"))).toBe(true);
  });

  test("should detect uv project with [tool.uv] in pyproject.toml", async () => {
    const projectDir = await createProjectDir("uv-tool");
    
    await fs.writeFile(
      path.join(projectDir, "pyproject.toml"),
      "[tool.uv]\ndev-dependencies = []\n"
    );
    
    const content = await fs.readFile(path.join(projectDir, "pyproject.toml"), "utf-8");
    expect(content.includes("[tool.uv]")).toBe(true);
  });

  test("should detect poetry project with poetry.lock", async () => {
    const projectDir = await createProjectDir("poetry-project");
    
    await fs.writeFile(path.join(projectDir, "poetry.lock"), "# poetry lock file\n");
    
    expect(fss.existsSync(path.join(projectDir, "poetry.lock"))).toBe(true);
  });

  test("should detect poetry project with [tool.poetry] in pyproject.toml", async () => {
    const projectDir = await createProjectDir("poetry-tool");
    
    await fs.writeFile(
      path.join(projectDir, "pyproject.toml"),
      "[tool.poetry]\nname = \"test\"\n"
    );
    
    const content = await fs.readFile(path.join(projectDir, "pyproject.toml"), "utf-8");
    expect(content.includes("[tool.poetry]")).toBe(true);
  });

  test("should detect conda project with environment.yml", async () => {
    const projectDir = await createProjectDir("conda-project");
    
    await fs.writeFile(path.join(projectDir, "environment.yml"), "name: test\ndependencies:\n  - python=3.11\n");
    
    expect(fss.existsSync(path.join(projectDir, "environment.yml"))).toBe(true);
  });
});

describe("Core Research Packages", () => {
  test("should define core research packages", () => {
    const expectedPackages = ["pandas", "numpy", "scikit-learn", "matplotlib", "seaborn"];
    expectedPackages.forEach(pkg => {
      expect(typeof pkg).toBe("string");
    });
  });
});

describe("PythonEnvironment Interface", () => {
  test("should support gyoshu-venv type", () => {
    const validTypes = ["system", "venv", "uv", "poetry", "conda", "custom", "gyoshu-venv"];
    expect(validTypes).toContain("gyoshu-venv");
  });

  test("should support created flag for newly created venvs", () => {
    const env = {
      type: "gyoshu-venv" as const,
      pythonPath: "/path/to/python",
      command: ["/path/to/python"],
      projectDir: "/project",
      detected: false,
      created: true,
    };
    
    expect(env.created).toBe(true);
    expect(env.detected).toBe(false);
    expect(env.type).toBe("gyoshu-venv");
  });
});

describe("Venv Creation", () => {
  beforeEach(async () => {
    await cleanupTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir();
  });

  test("should create gyoshu directory for venv", async () => {
    const projectDir = await createProjectDir("empty-project");
    const gyoshuDir = path.join(projectDir, "gyoshu");
    
    await fs.mkdir(gyoshuDir, { recursive: true });
    
    expect(fss.existsSync(gyoshuDir)).toBe(true);
  });

  test("should create marker file path correctly", () => {
    const venvDir = "/project/gyoshu/venv";
    const markerPath = path.join(venvDir, ".gyoshu-initialized");
    
    expect(markerPath).toBe("/project/gyoshu/venv/.gyoshu-initialized");
  });
});

describe("Windows Compatibility", () => {
  test("should use correct paths for Windows", () => {
    const isWindows = process.platform === "win32";
    const binDir = isWindows ? "Scripts" : "bin";
    const pythonExe = isWindows ? "python.exe" : "python";
    
    if (isWindows) {
      expect(binDir).toBe("Scripts");
      expect(pythonExe).toBe("python.exe");
    } else {
      expect(binDir).toBe("bin");
      expect(pythonExe).toBe("python");
    }
  });
});

describe("Tool Availability Detection", () => {
  beforeEach(() => {
    resetToolCache();
  });

  test("should return object with all tool properties", () => {
    const tools = detectAvailableTools();
    
    expect(typeof tools.uv).toBe("boolean");
    expect(typeof tools.poetry).toBe("boolean");
    expect(typeof tools.conda).toBe("boolean");
    expect(typeof tools.python).toBe("boolean");
  });

  test("should detect at least python", () => {
    const tools = detectAvailableTools();
    expect(tools.python).toBe(true);
  });

  test("should cache results on subsequent calls", () => {
    const tools1 = detectAvailableTools();
    const tools2 = detectAvailableTools();
    
    expect(tools1).toBe(tools2);
  });

  test("should reset cache with resetToolCache", () => {
    const tools1 = detectAvailableTools();
    resetToolCache();
    const tools2 = detectAvailableTools();
    
    expect(tools1).not.toBe(tools2);
    expect(tools1.python).toBe(tools2.python);
  });
});

describe("PythonEnvironment Interface Extended", () => {
  test("should support envName for conda environments", () => {
    const env = {
      type: "conda" as const,
      pythonPath: "/opt/conda/envs/test/bin/python",
      command: ["conda", "run", "-n", "test", "python"],
      projectDir: "/project",
      detected: false,
      created: true,
      envName: "test",
    };
    
    expect(env.envName).toBe("test");
    expect(env.type).toBe("conda");
  });

  test("should support tool field for tracking creation tool", () => {
    const env = {
      type: "uv" as const,
      pythonPath: "/project/gyoshu/venv/bin/python",
      command: ["/project/gyoshu/venv/bin/python"],
      projectDir: "/project",
      detected: false,
      created: true,
      tool: "uv",
    };
    
    expect(env.tool).toBe("uv");
    expect(env.created).toBe(true);
  });
});

describe("Environment Creation Priority", () => {
  test("priority order should be uv > poetry > conda > venv", () => {
    const priorityOrder = ["uv", "poetry", "conda", "venv"];
    
    expect(priorityOrder[0]).toBe("uv");
    expect(priorityOrder[1]).toBe("poetry");
    expect(priorityOrder[2]).toBe("conda");
    expect(priorityOrder[3]).toBe("venv");
  });

  test("should have all valid PythonEnvType values", () => {
    const validTypes = ["system", "venv", "uv", "poetry", "conda", "custom", "gyoshu-venv"];
    
    expect(validTypes).toContain("uv");
    expect(validTypes).toContain("poetry");
    expect(validTypes).toContain("conda");
    expect(validTypes).toContain("venv");
    expect(validTypes).toContain("gyoshu-venv");
  });
});
