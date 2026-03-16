import { join, resolve, relative } from 'path';

/**
 * ValidationError for path validation failures
 */
export class PathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathValidationError';
  }
}

/**
 * Sanitize and validate path components to prevent directory traversal attacks
 * This is for SINGLE path components (like collection names, document IDs)
 *
 * @param input - Path component to sanitize
 * @returns Sanitized path component
 * @throws PathValidationError if validation fails
 */
export function sanitizePathComponent(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new PathValidationError('Path component must be a non-empty string');
  }

  // Remove any path traversal sequences
  let sanitized = input.replace(/\.\./g, '');

  // Remove directory separators (single components cannot have slashes)
  sanitized = sanitized.replace(/[\/\\]/g, '_');

  // Only allow alphanumeric, underscore, hyphen, and dot
  if (!/^[a-zA-Z0-9_.-]+$/.test(sanitized)) {
    throw new PathValidationError(
      `Invalid characters in path component. Only alphanumeric, underscore, hyphen, and dot are allowed.`
    );
  }

  // Prevent excessively long names
  if (sanitized.length > 255) {
    throw new PathValidationError('Path component exceeds maximum length of 255 characters');
  }

  // Prevent hidden files (starting with .)
  if (sanitized.startsWith('.')) {
    throw new PathValidationError('Path component cannot start with a dot');
  }

  return sanitized;
}

/**
 * Validate that a target path is within the allowed base path
 * Prevents directory traversal attacks by ensuring the resolved path
 * doesn't escape the base directory
 *
 * @param basePath - Base directory path
 * @param targetPath - Target path to validate
 * @throws PathValidationError if path escapes base directory
 */
export function validatePathWithinBase(basePath: string, targetPath: string): void {
  const normalizedBase = resolve(basePath);
  const normalizedTarget = resolve(targetPath);

  const relativePath = relative(normalizedBase, normalizedTarget);

  // If relative path starts with '..', it's outside the base directory
  if (relativePath.startsWith('..') || resolve(normalizedBase, relativePath) !== normalizedTarget) {
    throw new PathValidationError('Path traversal detected: target path is outside base directory');
  }
}

/**
 * Safely join path components with validation
 * This is for joining SINGLE components (not full paths with slashes)
 *
 * @param basePath - Base directory path
 * @param components - Path components to join
 * @returns Validated full path
 * @throws PathValidationError if validation fails
 */
export function safePathJoin(basePath: string, ...components: string[]): string {
  // Sanitize each component
  const sanitizedComponents = components.map(sanitizePathComponent);

  // Join paths
  const fullPath = join(basePath, ...sanitizedComponents);

  // Validate the result doesn't escape base path
  validatePathWithinBase(basePath, fullPath);

  return fullPath;
}

/**
 * Safely join a key (which may contain slashes) with base path
 * Validates the result doesn't escape base directory
 *
 * @param basePath - Base directory path
 * @param key - Storage key (may contain path separators)
 * @returns Validated full path
 * @throws PathValidationError if validation fails
 */
export function safeKeyPath(basePath: string, key: string): string {
  if (!key || typeof key !== 'string') {
    throw new PathValidationError('Key must be a non-empty string');
  }

  // Check for path traversal patterns
  if (key.includes('..')) {
    throw new PathValidationError('Key contains path traversal sequence');
  }

  // Join and validate
  const fullPath = join(basePath, key);
  validatePathWithinBase(basePath, fullPath);

  return fullPath;
}
