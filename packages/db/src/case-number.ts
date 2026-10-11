/** Prisma reports a violated unique index as error code P2002. */
export function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}
