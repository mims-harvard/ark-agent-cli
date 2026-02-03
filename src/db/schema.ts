import type { InferSelectModel } from "drizzle-orm";
import {
  bigint,
  bigserial,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  varchar,
} from "drizzle-orm/pg-core";

export const node = pgTable(
  "node",
  {
    knowledgeGraphId: bigint("knowledgeGraphId", { mode: "number" })
      .notNull()
      .references(() => knowledgeGraph.id),
    id: text("id").notNull(),
    name: text("name"),
    type: varchar("type", { length: 256 }),
    properties: text("properties"),
  },
  (table) => [primaryKey({ columns: [table.knowledgeGraphId, table.id] })],
);

export type Node = InferSelectModel<typeof node>;

export const edge = pgTable(
  "edge",
  {
    knowledgeGraphId: bigint("knowledgeGraphId", { mode: "number" })
      .notNull()
      .references(() => knowledgeGraph.id),
    from: text("from").notNull(),
    to: text("to").notNull(),
    type: varchar("type", { length: 256 }),
    properties: text("properties"),
  },
  (table) => [
    primaryKey({
      columns: [table.knowledgeGraphId, table.from, table.to, table.type],
    }),
    foreignKey({
      columns: [table.knowledgeGraphId, table.from],
      foreignColumns: [node.knowledgeGraphId, node.id],
    }),
    foreignKey({
      columns: [table.knowledgeGraphId, table.to],
      foreignColumns: [node.knowledgeGraphId, node.id],
    }),
  ],
);

export type Edge = InferSelectModel<typeof edge>;

export const knowledgeGraph = pgTable("knowledge_graph", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
});

export type KnowledgeGraph = InferSelectModel<typeof knowledgeGraph>;
