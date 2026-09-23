import { PrismaClient } from "../generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
export function createDatabase(url: string) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      statement_timeout: 5000,
    }),
  });
}
