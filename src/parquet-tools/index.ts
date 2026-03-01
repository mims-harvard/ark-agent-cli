import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";

import { type GraphFiles, createQueries } from "./queries.ts";
import { makeGraphTools } from "./tools.ts";
import type { KnowledgeGraphMeta } from "./types.ts";

export type { Edge, KnowledgeGraphMeta, Node } from "./types.ts";

/** Load graph metadata from graph.json, injecting the directory slug. */
function loadGraphMeta(filePath: string, slug: string): KnowledgeGraphMeta {
	const content = readFileSync(filePath, "utf-8");
	const raw = JSON.parse(content) as Omit<KnowledgeGraphMeta, "slug">;
	return { ...raw, slug };
}

/**
 * Manages discovery of graph data directories and a shared DuckDB connection.
 * Startup is instant (reads only graph.json files).
 * All parquet data is queried on-demand via DuckDB SQL — nothing loaded into memory.
 */
export class GraphLoader {
	/** Metadata for all discovered graphs (available immediately) */
	readonly graphsMeta: KnowledgeGraphMeta[];

	/** Parquet file paths keyed by knowledge graph ID */
	readonly files: Map<number, GraphFiles>;

	/** Shared DuckDB instance (created lazily) */
	private instance: DuckDBInstance | null = null;

	constructor(dataDir: string) {
		this.files = new Map();
		const metas: KnowledgeGraphMeta[] = [];

		const entries = readdirSync(dataDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const graphDir = join(dataDir, entry.name);
			const graphJsonPath = join(graphDir, "graph.json");
			const nodesPath = join(graphDir, "nodes.parquet");
			const edgesPath = join(graphDir, "edges.parquet");

			if (
				!existsSync(graphJsonPath) ||
				!existsSync(nodesPath) ||
				!existsSync(edgesPath)
			) {
				continue;
			}

			const meta = loadGraphMeta(graphJsonPath, entry.name);
			metas.push(meta);
			this.files.set(meta.id, {
				knowledgeGraphId: meta.id,
				nodesPath,
				edgesPath,
			});
		}

		this.graphsMeta = metas.sort((a, b) => a.order - b.order);
	}

	/**
	 * Get or create the shared DuckDB instance.
	 * Created lazily on first query.
	 */
	async getInstance(): Promise<DuckDBInstance> {
		if (!this.instance) {
			this.instance = await DuckDBInstance.create();
		}
		return this.instance;
	}
}

/**
 * Create graph tools for specific knowledge graph IDs.
 * Parquet data is queried on-demand via DuckDB — nothing loaded upfront.
 */
export async function makeParquetGraphTools(
	knowledgeGraphIds: number[],
	loader: GraphLoader,
) {
	const instance = await loader.getInstance();
	const conn = await instance.connect();
	const queries = createQueries(conn, loader.files);
	return makeGraphTools(knowledgeGraphIds, queries, loader.graphsMeta);
}
