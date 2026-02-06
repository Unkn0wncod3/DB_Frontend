export type VisibilityLevel = 'admin' | 'user';

export const DEFAULT_VISIBILITY_LEVEL: VisibilityLevel = 'user';

export function coerceVisibilityLevel(value: unknown): VisibilityLevel {
  if (value === 'admin' || value === 'user') {
    return value;
  }
  return DEFAULT_VISIBILITY_LEVEL;
}

