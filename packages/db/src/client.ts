import { PrismaClient } from "../generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { config } from "dotenv"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { signallingAdapter } from "./write-signal"

const __dirname = dirname(fileURLToPath(import.meta.url))

config({ path: resolve(__dirname, "../.env"), override: false })
config({ override: false })

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error("DATABASE_URL is not set")
}

// Every committed write is noted for the scheduler (write-signal.ts), so it
// can tell when it may skip the database between its full runs.
const adapter = signallingAdapter(new PrismaPg({
  connectionString,
}))

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
