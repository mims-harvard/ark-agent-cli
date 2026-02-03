import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace import for schema
import * as schema from "./schema.ts";

// biome-ignore lint/style/noNonNullAssertion: It's okay because it's checked at the env level. Remove after switching to t3 env.
const client = postgres(process.env.POSTGRES_URL!);
export const db = drizzle({ client, schema });
