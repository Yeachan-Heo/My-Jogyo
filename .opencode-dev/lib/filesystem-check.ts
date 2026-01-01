import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface FilesystemWarning {
  type: 'network' | 'cloud' | 'unknown';
  message: string;
}

const UNSUPPORTED_FS_TYPES = ['nfs', 'nfs4', 'cifs', 'smbfs', 'fuse'];
const CLOUD_INDICATORS = ['Dropbox', '.dropbox', 'iCloud', '.icloud', 'OneDrive', 'Google Drive', 'pCloud'];

export async function checkFilesystemSupport(sessionDir: string): Promise<FilesystemWarning[]> {
  const warnings: FilesystemWarning[] = [];

  if (process.platform === 'linux') {
    await checkLinuxFilesystem(sessionDir, warnings);
  }

  if (process.platform === 'darwin') {
    await checkDarwinFilesystem(sessionDir, warnings);
  }

  checkCloudSyncPaths(sessionDir, warnings);

  if (warnings.length > 0) {
    logWarnings(warnings);
  }

  return warnings;
}

async function checkLinuxFilesystem(sessionDir: string, warnings: FilesystemWarning[]): Promise<void> {
  try {
    const { stdout } = await execAsync(`df -T "${sessionDir}" | tail -1`);
    const fields = stdout.trim().split(/\s+/);
    const fsType = fields[1];

    if (UNSUPPORTED_FS_TYPES.some(t => fsType.includes(t))) {
      warnings.push({
        type: 'network',
        message: `Network filesystem detected (${fsType}). Lock and atomicity guarantees may not hold.`
      });
    }
  } catch {}
}

async function checkDarwinFilesystem(sessionDir: string, warnings: FilesystemWarning[]): Promise<void> {
  try {
    const { stdout } = await execAsync(`df "${sessionDir}" 2>/dev/null | tail -1`);
    const fields = stdout.trim().split(/\s+/);
    
    if (fields.some(f => UNSUPPORTED_FS_TYPES.some(t => f.toLowerCase().includes(t)))) {
      warnings.push({
        type: 'network',
        message: `Network filesystem detected. Lock and atomicity guarantees may not hold.`
      });
    }
  } catch {}
}

function checkCloudSyncPaths(sessionDir: string, warnings: FilesystemWarning[]): void {
  for (const indicator of CLOUD_INDICATORS) {
    if (sessionDir.toLowerCase().includes(indicator.toLowerCase())) {
      warnings.push({
        type: 'cloud',
        message: `Cloud-synced directory detected (${indicator}). Concurrent edits may cause conflicts.`
      });
      break;
    }
  }
}

function logWarnings(warnings: FilesystemWarning[]): void {
  console.warn('[Gyoshu] Filesystem Warnings:');
  warnings.forEach(w => console.warn(`  - ${w.message}`));
  console.warn('  Consider using a local directory for reliable operation.');
}

export function isLikelyRemoteFilesystem(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return CLOUD_INDICATORS.some(indicator => lowerPath.includes(indicator.toLowerCase()));
}
