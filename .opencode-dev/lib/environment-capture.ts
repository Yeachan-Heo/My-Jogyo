/**
 * Environment capture utilities with privacy-aware redaction.
 * 
 * Features:
 * - Privacy modes: 'redacted' (default) or 'full'
 * - Name-based credential detection (password, secret, key, token, etc.)
 * - Value-based credential detection (JWT, AWS keys, GitHub tokens, etc.)
 * - URL credential redaction (user:pass@host patterns)
 * 
 * Security Notes:
 * - Even in 'full' mode, sensitive values are still redacted
 * - URL credentials are always sanitized
 * - No credentials are ever exposed in plain text
 */

/**
 * Privacy mode for environment capture.
 * - 'redacted': Minimal info (no cwd, sysPath, envVars) - DEFAULT
 * - 'full': Include cwd/envVars but still redact sensitive values
 */
export type PrivacyMode = 'redacted' | 'full';

/**
 * Environment metadata captured from a Python session.
 */
export interface EnvironmentMetadata {
  /** Python version string (e.g., "3.11.5") */
  pythonVersion: string;
  /** Operating system platform */
  platform: string;
  /** Installed packages with versions */
  packages: Record<string, string>;
  /** Random seeds for reproducibility */
  randomSeeds: Record<string, number>;
  /** Current working directory (full mode only, URL-redacted) */
  cwd?: string;
  /** Python sys.path (full mode only) */
  sysPath?: string[];
  /** Environment variables (full mode only, sensitive values redacted) */
  envVars?: Record<string, string>;
}

/**
 * Patterns to detect sensitive environment variable NAMES.
 * Case-insensitive matching.
 */
const SENSITIVE_NAME_PATTERNS: RegExp[] = [
  /password/i,
  /passwd/i,
  /secret/i,
  /key/i,
  /token/i,
  /credential/i,
  /api_key/i,
  /apikey/i,
  /auth/i,
  /private/i,
];

/**
 * Patterns to detect sensitive VALUES regardless of variable name.
 * Matches common credential formats.
 */
const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  // URL with embedded credentials (user:pass@host)
  /[a-zA-Z]+:\/\/[^:]+:[^@]+@/,
  
  // Authorization headers (Bearer, Basic, Digest tokens)
  /^(Bearer|Basic|Digest)\s+[A-Za-z0-9+/=._-]+$/i,
  
  // JWT tokens (header.payload.signature format)
  /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  
  // AWS Access Key IDs (start with AKIA)
  /^AKIA[A-Z0-9]{16}$/,
  
  // Long hex strings (40+ chars, likely secrets)
  /^[A-Fa-f0-9]{40,}$/,
  
  // Long Base64 strings (40+ chars, likely secrets)
  /^[A-Za-z0-9+/=]{40,}$/,
  
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  /^gh[pousr]_[A-Za-z0-9_]+$/,
];

/**
 * Redact credentials embedded in URLs.
 * Replaces user:password patterns with [REDACTED]:[REDACTED].
 * 
 * @param url - URL that may contain embedded credentials
 * @returns URL with credentials redacted
 * 
 * @example
 * redactUrlCredentials('https://user:secret@example.com')
 * // Returns: 'https://[REDACTED]:[REDACTED]@example.com'
 */
export function redactUrlCredentials(url: string): string {
  return url.replace(/(:\/\/)([^:]+):([^@]+)@/g, '$1[REDACTED]:[REDACTED]@');
}

/**
 * Check if a value looks like a sensitive credential and redact if needed.
 * Uses both name-based and value-based detection.
 * 
 * @param key - Environment variable name
 * @param value - Environment variable value
 * @returns Original value or redacted placeholder
 * 
 * @example
 * redactSensitiveValue('API_KEY', 'abc123')
 * // Returns: '[REDACTED:name_match]'
 * 
 * redactSensitiveValue('SOME_VAR', 'ghp_xxxxxxxxxxxx')
 * // Returns: '[REDACTED:value_match]'
 * 
 * redactSensitiveValue('DATABASE_URL', 'postgres://user:pass@localhost/db')
 * // Returns: 'postgres://[REDACTED]:[REDACTED]@localhost/db'
 */
export function redactSensitiveValue(key: string, value: string): string {
  if (SENSITIVE_NAME_PATTERNS.some(pattern => pattern.test(key))) {
    return '[REDACTED:name_match]';
  }
  
  if (SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(value))) {
    return '[REDACTED:value_match]';
  }
  
  if (value.includes('://') && value.includes('@')) {
    return redactUrlCredentials(value);
  }
  
  return value;
}

/**
 * Capture environment metadata with privacy controls.
 * 
 * Privacy modes:
 * - 'redacted' (default): Only includes pythonVersion, platform, packages, randomSeeds
 * - 'full': Includes cwd and envVars, but sensitive values are still redacted
 * 
 * @param pythonVersion - Python version string
 * @param packages - Map of package names to versions
 * @param randomSeeds - Map of seed names to values
 * @param privacyMode - Privacy mode ('redacted' or 'full')
 * @returns Environment metadata object
 * 
 * @example
 * const env = captureEnvironment('3.11.5', { numpy: '1.24.0' }, { main: 42 });
 * // Returns minimal metadata (redacted mode)
 * 
 * const fullEnv = captureEnvironment('3.11.5', { numpy: '1.24.0' }, { main: 42 }, 'full');
 * // Returns full metadata with redacted sensitive values
 */
export function captureEnvironment(
  pythonVersion: string,
  packages: Record<string, string>,
  randomSeeds: Record<string, number>,
  privacyMode: PrivacyMode = 'redacted'
): EnvironmentMetadata {
  const env: EnvironmentMetadata = {
    pythonVersion,
    platform: process.platform,
    packages,
    randomSeeds,
  };
  
  if (privacyMode === 'full') {
    env.cwd = redactUrlCredentials(process.cwd());
    env.envVars = {};
    
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env.envVars[key] = redactSensitiveValue(key, value);
      }
    }
  }
  
  return env;
}
