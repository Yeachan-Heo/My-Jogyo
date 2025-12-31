# VibeSci OpenCode Extension Implementation Plan (v7 - Ship Ready)

**Goal**: Build VibeSci as an OpenCode extension for scientific research workflows

**Target Platform**: Linux (primary), macOS (secondary), Windows (best-effort)

**Filesystem Support**: Local disk only. NFS/SMB not officially supported (warning emitted).

---

## Key Architectural Decisions (v6 - Production Hardened)

### 1. TOCTOU-Resistant Path Handling

**Problem**: Pre-checking paths for symlinks/traversal can race with attacker who swaps path between check and open.

**Solution**: Validate at open time, not pre-check.

```typescript
// TOCTOU-resistant artifact write
async function safeWriteArtifact(
  artifactRoot: string,
  relativePath: string,
  data: Buffer
): Promise<string> {
  // 1. Normalize and validate path components (pre-check for fast-fail)
  const normalizedPath = normalizePath(relativePath);
  validatePathComponents(normalizedPath);  // Reject ../, absolute, etc.
  
  const targetPath = path.join(artifactRoot, normalizedPath);
  
  // 2. Create directories safely (no symlink following)
  await mkdirSafe(path.dirname(targetPath), artifactRoot);
  
  // 3. Open with O_NOFOLLOW (POSIX) or equivalent
  const fd = await openNoFollow(targetPath, 'wx');  // Create exclusively
  
  try {
    // 4. Re-validate: check that opened file is under artifact root
    const realPath = await fs.realpath(targetPath);
    if (!realPath.startsWith(path.resolve(artifactRoot) + path.sep)) {
      throw new Error('TOCTOU attack detected: file escaped artifact root');
    }
    
    // 5. Write data
    await fs.write(fd, data);
    await fs.fsync(fd);
  } finally {
    await fs.close(fd);
  }
  
  return targetPath;
}

// POSIX: Open without following symlinks
async function openNoFollow(filePath: string, flags: string): Promise<number> {
  if (process.platform === 'win32') {
    // Windows: Use FILE_FLAG_OPEN_REPARSE_POINT equivalent
    // Or fall back to checking after open
    return await openWindowsSafe(filePath, flags);
  }
  
  // POSIX: O_NOFOLLOW prevents following symlinks
  const fd = await fs.open(filePath, flags | fs.constants.O_NOFOLLOW);
  
  // Additional check: ensure it's a regular file
  const stat = await fs.fstat(fd);
  if (!stat.isFile()) {
    await fs.close(fd);
    throw new Error(`Not a regular file: ${filePath}`);
  }
  
  return fd;
}

// Safe mkdir that doesn't follow symlinks
async function mkdirSafe(dirPath: string, root: string): Promise<void> {
  const parts = path.relative(root, dirPath).split(path.sep);
  let current = root;
  
  for (const part of parts) {
    current = path.join(current, part);
    
    // Check if exists
    try {
      const stat = await fs.lstat(current);  // lstat doesn't follow symlinks
      if (stat.isSymbolicLink()) {
        throw new Error(`Symlink in path: ${current}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Not a directory: ${current}`);
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        await fs.mkdir(current);
      } else {
        throw e;
      }
    }
  }
}
```

### 2. Windows Atomic Replace

**Windows-specific atomic replacement:**

```typescript
async function atomicReplaceWindows(tempPath: string, targetPath: string): Promise<void> {
  // Windows: Use MoveFileEx with MOVEFILE_REPLACE_EXISTING
  // Node.js fs.rename doesn't guarantee atomicity on Windows
  
  if (process.platform !== 'win32') {
    return fs.rename(tempPath, targetPath);
  }
  
  // Use native binding or shell fallback
  try {
    // Option 1: Native binding (if available)
    const { moveFileEx } = require('windows-native-fs');
    await moveFileEx(tempPath, targetPath, { replaceExisting: true });
  } catch {
    // Option 2: PowerShell fallback
    const { execSync } = require('child_process');
    execSync(`Move-Item -Force -Path "${tempPath}" -Destination "${targetPath}"`, {
      shell: 'powershell.exe'
    });
  }
}
```

### 3. Filesystem Support Boundary

**Supported:**
- Local disk (ext4, APFS, NTFS)
- RAM disk / tmpfs

**Not Supported (warning emitted):**
- NFS, SMB/CIFS, network shares
- FUSE filesystems (case-by-case)
- Cloud-synced directories (Dropbox, OneDrive, iCloud)

**Detection and warning:**

```typescript
async function checkFilesystemSupport(sessionDir: string): Promise<void> {
  const warnings: string[] = [];
  
  // Linux: Check mount type
  if (process.platform === 'linux') {
    try {
      const { stdout } = await execAsync(`df -T "${sessionDir}" | tail -1`);
      const fsType = stdout.split(/\s+/)[1];
      
      const unsupportedTypes = ['nfs', 'nfs4', 'cifs', 'smbfs', 'fuse'];
      if (unsupportedTypes.some(t => fsType.includes(t))) {
        warnings.push(`Network filesystem detected (${fsType}). Lock and atomicity guarantees may not hold.`);
      }
    } catch { /* ignore */ }
  }
  
  // Check for cloud sync directories
  const cloudIndicators = ['.dropbox', '.icloud', 'OneDrive'];
  for (const indicator of cloudIndicators) {
    if (sessionDir.includes(indicator)) {
      warnings.push(`Cloud-synced directory detected. Concurrent edits may cause conflicts.`);
      break;
    }
  }
  
  if (warnings.length > 0) {
    console.warn('⚠️ VibeSci Filesystem Warnings:');
    warnings.forEach(w => console.warn(`  - ${w}`));
    console.warn('  Consider using a local directory for reliable operation.');
  }
}
```

### 4. Enhanced Privacy Redaction

**Pattern-based + format-based redaction:**

```typescript
// Name patterns (existing)
const SENSITIVE_NAME_PATTERNS = [
  /password/i, /secret/i, /key/i, /token/i, /credential/i,
  /api_key/i, /apikey/i, /auth/i, /private/i, /passwd/i
];

// Value patterns (NEW)
const SENSITIVE_VALUE_PATTERNS = [
  // URLs with credentials: user:pass@host
  /[a-zA-Z]+:\/\/[^:]+:[^@]+@/,
  
  // Authorization headers: Bearer xxx, Basic xxx
  /^(Bearer|Basic|Digest)\s+[A-Za-z0-9+/=._-]+$/i,
  
  // JWT tokens: xxxxx.yyyyy.zzzzz
  /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  
  // AWS keys: AKIA...
  /^AKIA[A-Z0-9]{16}$/,
  
  // Generic long secrets (40+ hex/base64 chars)
  /^[A-Fa-f0-9]{40,}$/,
  /^[A-Za-z0-9+/=]{40,}$/,
  
  // GitHub tokens: ghp_, gho_, ghu_, ghs_, ghr_
  /^gh[pousr]_[A-Za-z0-9_]+$/,
];

function redactSensitiveValue(key: string, value: string): string {
  // Check key name
  if (SENSITIVE_NAME_PATTERNS.some(p => p.test(key))) {
    return '[REDACTED:name_match]';
  }
  
  // Check value format
  if (SENSITIVE_VALUE_PATTERNS.some(p => p.test(value))) {
    return '[REDACTED:value_match]';
  }
  
  // Check for embedded credentials in URLs
  if (value.includes('://') && value.includes('@')) {
    return redactUrlCredentials(value);
  }
  
  return value;
}

function redactUrlCredentials(url: string): string {
  // Replace user:pass in URLs
  return url.replace(
    /(:\/\/)([^:]+):([^@]+)@/g,
    '$1[REDACTED]:[REDACTED]@'
  );
}

function captureEnvironment(privacyMode: PrivacyMode): EnvironmentMetadata {
  const env: EnvironmentMetadata = {
    pythonVersion: getPythonVersion(),
    platform: process.platform,
    packages: getPackageVersions(),
    randomSeeds: getRandomSeeds(),
  };
  
  if (privacyMode === 'full') {
    // Redact sensitive values even in full mode
    env.cwd = redactUrlCredentials(process.cwd());
    env.sysPath = getSysPath().map(p => redactUrlCredentials(p));
    env.envVars = {};
    
    for (const [key, value] of Object.entries(process.env)) {
      if (value) {
        env.envVars[key] = redactSensitiveValue(key, value);
      }
    }
  }
  
  return env;
}
```

### 5. Manual Unlock Safety

**Prevent abuse of unlock command:**

```typescript
async function unlockSession(researchSessionID: string, force: boolean = false): Promise<void> {
  const sessionDir = getSessionDir(researchSessionID);
  const lockPath = path.join(sessionDir, 'session.lock');
  
  // 1. Validate session exists
  if (!await fs.exists(sessionDir)) {
    throw new Error(`Session not found: ${researchSessionID}`);
  }
  
  // 2. Read lock info
  const lockInfo = await readLockInfo(lockPath);
  if (!lockInfo) {
    console.log('Session is not locked.');
    return;
  }
  
  // 3. Safety checks
  // a) Verify same user owns the session directory
  const sessionStat = await fs.stat(sessionDir);
  if (sessionStat.uid !== process.getuid()) {
    throw new Error('Cannot unlock session owned by another user');
  }
  
  // b) Check if lock holder is still alive (without force)
  if (!force) {
    const isAlive = await isProcessAlive(lockInfo);
    if (isAlive) {
      throw new Error(
        `Lock held by active process (PID ${lockInfo.pid}). ` +
        `Use --force to override (may cause data corruption).`
      );
    }
  }
  
  // 4. Remove lock
  await fs.unlink(lockPath);
  console.log(`Session ${researchSessionID} unlocked.`);
  
  if (force) {
    console.warn('⚠️ Force unlock used. If process was active, data may be corrupted.');
  }
}
```

---

## Extension Structure

```
.opencode/
├── agent/
│   ├── vibesci.md
│   └── vibesci-planner.md
├── command/
│   ├── vibesci-plan.md
│   ├── vibesci-run.md
│   ├── vibesci-continue.md
│   ├── vibesci-report.md
│   ├── vibesci-replay.md
│   └── vibesci-unlock.md
├── skill/
│   ├── scientific-method/SKILL.md
│   ├── data-analysis/SKILL.md
│   └── experiment-design/SKILL.md
├── tool/
│   ├── python-repl.ts
│   ├── notebook-writer.ts
│   └── session-manager.ts
├── plugin/
│   └── vibesci-hooks.ts
├── bridge/
│   └── vibesci_bridge.py
└── lib/
    ├── atomic-write.ts          # With Windows support
    ├── session-lock.ts          # Cross-platform
    ├── cell-identity.ts
    ├── artifact-security.ts     # TOCTOU-resistant
    ├── environment-capture.ts   # Enhanced redaction
    ├── marker-parser.ts
    └── filesystem-check.ts      # NFS/cloud detection
```

---

## Phase 1: Core Extension (MVP)

### 1. Foundation Libraries
- [ ] 1.1 Create atomic-write.ts (same-dir, fsync, Windows MoveFileEx)
- [ ] 1.2 Create session-lock.ts (cross-platform, safe unlock)
- [x] 1.3 Create cell-identity.ts (deterministic backfill)
- [ ] 1.4 Create artifact-security.ts (TOCTOU-resistant, O_NOFOLLOW)
- [ ] 1.5 Create environment-capture.ts (value-based redaction)
- [ ] 1.6 Create filesystem-check.ts (NFS/cloud detection)
- [ ] 1.7 Create marker-parser.ts

### 2. Python Bridge
- [x] 2.1 Create vibesci_bridge.py

### 3. Tools
- [x] 3.1 Create session-manager.ts
- [ ] 3.2 Create python-repl.ts
- [x] 3.3 Create notebook-writer.ts

### 4. Agents
- [ ] 4.1 Create vibesci.md
- [ ] 4.2 Create vibesci-planner.md

### 5. Commands
- [ ] 5.1-5.6 Create all commands

### 6. Skills
- [ ] 6.1-6.3 Create all skills

### 7. Plugin
- [ ] 7.1 Create vibesci-hooks.ts

---

## Definition of Done (v6 - Final)

### Security & Reliability
- [ ] TOCTOU-resistant artifact writes (validate at open time)
- [ ] O_NOFOLLOW / equivalent for symlink protection
- [ ] Windows atomic replace via MoveFileEx
- [ ] NFS/SMB detection with warning
- [ ] Cloud-sync directory detection with warning
- [ ] Value-based credential redaction (URL creds, JWT, API keys)
- [ ] Safe unlock command (same-user, force flag)

### Core Requirements (from v5)
- [x] Protocol on duplicated FD
- [ ] Cross-platform locks
- [ ] Same-directory atomic writes
- [ ] Cell ID backfill
- [ ] Privacy mode default redacted

### Testing Checklist
- [ ] Symlink attack prevented (create symlink, write, verify rejection)
- [ ] TOCTOU race condition handled
- [ ] Windows atomic replace works
- [ ] NFS mount detected and warned
- [ ] JWT in env var redacted
- [ ] URL credentials redacted
- [ ] Unlock requires same user
- [ ] Force unlock warns about corruption

---

## File Summary (24 files)

### Libraries (7):
1. `.opencode/lib/atomic-write.ts`
2. `.opencode/lib/session-lock.ts`
3. `.opencode/lib/cell-identity.ts`
4. `.opencode/lib/artifact-security.ts`
5. `.opencode/lib/environment-capture.ts`
6. `.opencode/lib/filesystem-check.ts`
7. `.opencode/lib/marker-parser.ts`

### Tools (3):
8. `.opencode/tool/session-manager.ts`
9. `.opencode/tool/python-repl.ts`
10. `.opencode/tool/notebook-writer.ts`

### Bridge (1):
11. `.opencode/bridge/vibesci_bridge.py`

### Agents (2):
12. `.opencode/agent/vibesci.md`
13. `.opencode/agent/vibesci-planner.md`

### Commands (6):
14-19. `.opencode/command/vibesci-{plan,run,continue,report,replay,unlock}.md`

### Skills (3):
20-22. `.opencode/skill/*/SKILL.md`

### Plugin (1):
23. `.opencode/plugin/vibesci-hooks.ts`

### Documentation (1):
24. `README.md`

---

## Summary of Changes (v5 → v6)

| Issue | Fix |
|-------|-----|
| TOCTOU race | Validate at open time with O_NOFOLLOW |
| Windows atomicity | MoveFileEx with MOVEFILE_REPLACE_EXISTING |
| NFS/cloud support | Explicit boundary + detection + warning |
| Credential formats | JWT, URL creds, AWS keys, GitHub tokens |
| Unlock abuse | Same-user check, force flag warning |
