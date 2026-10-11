import { PrismaClient } from "@prisma/client";

// A single client is reused across hot reloads in development, otherwise every
// edit opens another pool against the same SQLite file.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";

export { isUniqueConflict } from "./case-number.js";
export { createInfraction } from "./infractions.js";
