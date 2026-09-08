/**
 * Mirrors the path format packages/core/src/schema.ts builds while parsing
 * an object or array field, so a parse error keyed by that path finds the
 * same field here.
 */

export function objectChildPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

export function arrayItemPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}
