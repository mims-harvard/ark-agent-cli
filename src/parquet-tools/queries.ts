import type { DuckDBConnection } from "@duckdb/node-api";

import type { Edge, Node } from "./types.ts";

/** A path between two nodes, consisting of one or more legs. */
export type Path = {
	legs: {
		tailNode: Node;
		edgeType: string;
		headNode: Node;
	}[];
};

/** File paths for a single knowledge graph's parquet data */
export type GraphFiles = {
	knowledgeGraphId: number;
	nodesPath: string;
	edgesPath: string;
};

/**
 * Run a parameterized DuckDB query and return rows as typed objects.
 */
async function query<T>(
	conn: DuckDBConnection,
	sql: string,
): Promise<T[]> {
	const reader = await conn.runAndReadAll(sql);
	return reader.getRowObjects() as T[];
}

/**
 * Creates query functions that run SQL directly against parquet files via DuckDB.
 * Each call reads only the data needed — no in-memory store.
 *
 * @param conn   Shared DuckDB connection
 * @param files  Map of knowledgeGraphId → parquet file paths
 */
export function createQueries(
	conn: DuckDBConnection,
	files: Map<number, GraphFiles>,
) {
	/**
	 * Build a SQL expression for the nodes parquet path(s) matching the given IDs.
	 * If single graph, returns: read_parquet('/path/nodes.parquet')
	 * If multiple, returns a UNION ALL across them with knowledgeGraphId injected.
	 */
	function nodesSource(knowledgeGraphIds: number[]): string {
		if (knowledgeGraphIds.length === 1) {
			const f = files.get(knowledgeGraphIds[0]);
			if (!f) throw new Error(`Unknown graph id=${knowledgeGraphIds[0]}`);
			return `(SELECT ${f.knowledgeGraphId} AS "knowledgeGraphId", * FROM read_parquet('${f.nodesPath}'))`;
		}
		const parts = knowledgeGraphIds
			.map((id) => {
				const f = files.get(id);
				if (!f) throw new Error(`Unknown graph id=${id}`);
				return `SELECT ${f.knowledgeGraphId} AS "knowledgeGraphId", * FROM read_parquet('${f.nodesPath}')`;
			})
			.join(" UNION ALL ");
		return `(${parts})`;
	}

	function edgesSource(knowledgeGraphIds: number[]): string {
		if (knowledgeGraphIds.length === 1) {
			const f = files.get(knowledgeGraphIds[0]);
			if (!f) throw new Error(`Unknown graph id=${knowledgeGraphIds[0]}`);
			return `(SELECT ${f.knowledgeGraphId} AS "knowledgeGraphId", * FROM read_parquet('${f.edgesPath}'))`;
		}
		const parts = knowledgeGraphIds
			.map((id) => {
				const f = files.get(id);
				if (!f) throw new Error(`Unknown graph id=${id}`);
				return `SELECT ${f.knowledgeGraphId} AS "knowledgeGraphId", * FROM read_parquet('${f.edgesPath}')`;
			})
			.join(" UNION ALL ");
		return `(${parts})`;
	}

	/** Escape a string for use in SQL single quotes */
	function esc(s: string): string {
		return s.replace(/'/g, "''");
	}

	async function searchNodesByName(
		name: string,
		knowledgeGraphIds?: number[],
		limit = 10,
	): Promise<Node[]> {
		const kgIds = knowledgeGraphIds ?? [...files.keys()];
		if (kgIds.length === 0) return [];
		const src = nodesSource(kgIds);
		const sql = `SELECT * FROM ${src} AS n WHERE n.name ILIKE '%${esc(name)}%' LIMIT ${limit}`;
		return query<Node>(conn, sql);
	}

	async function getNodesByIds(
		knowledgeGraphIds: number[],
		nodeIds: string[],
	): Promise<Node[]> {
		if (nodeIds.length === 0) return [];
		const src = nodesSource(knowledgeGraphIds);
		const inList = nodeIds.map((id) => `'${esc(id)}'`).join(", ");
		const sql = `SELECT * FROM ${src} AS n WHERE n.id IN (${inList})`;
		return query<Node>(conn, sql);
	}

	async function getEdgesBetweenNodes(
		knowledgeGraphIds: number[],
		node1Id: string,
		node2Id: string,
	): Promise<Edge[]> {
		const src = edgesSource(knowledgeGraphIds);
		const n1 = esc(node1Id);
		const n2 = esc(node2Id);
		const sql = `
			SELECT * FROM ${src} AS e
			WHERE (e."from" = '${n1}' AND e."to" = '${n2}')
			   OR (e."from" = '${n2}' AND e."to" = '${n1}')
		`;
		return query<Edge>(conn, sql);
	}

	async function getNeighbors(
		knowledgeGraphIds: number[],
		nodeId: string,
		edgeType?: string,
	): Promise<string[]> {
		const src = edgesSource(knowledgeGraphIds);
		const nid = esc(nodeId);
		const typeFilter = edgeType
			? `AND e.type = '${esc(edgeType)}'`
			: "";
		const sql = `
			SELECT DISTINCT
				CASE WHEN e."from" = '${nid}' THEN e."to" ELSE e."from" END AS neighbor
			FROM ${src} AS e
			WHERE (e."from" = '${nid}' OR e."to" = '${nid}')
			${typeFilter}
		`;
		const rows = await query<{ neighbor: string }>(conn, sql);
		return rows.map((r) => r.neighbor);
	}

	async function getKHopNeighborIds(
		knowledgeGraphIds: number[],
		nodeId: string,
		k: 1 | 2,
		edgeType?: string,
	): Promise<string[]> {
		if (k === 1) {
			return getNeighbors(knowledgeGraphIds, nodeId, edgeType);
		}

		// k === 2: edge type filtering not supported (matches DB version)
		if (edgeType) return [];

		const oneHopNeighbors = await getNeighbors(knowledgeGraphIds, nodeId);
		const twoHopNeighbors = new Set<string>();

		for (const neighborId of oneHopNeighbors) {
			const neighborsOfNeighbor = await getNeighbors(
				knowledgeGraphIds,
				neighborId,
			);
			for (const twoHopNeighborId of neighborsOfNeighbor) {
				if (
					twoHopNeighborId !== nodeId &&
					!oneHopNeighbors.includes(twoHopNeighborId)
				) {
					twoHopNeighbors.add(twoHopNeighborId);
				}
			}
		}

		return [...oneHopNeighbors, ...Array.from(twoHopNeighbors)];
	}

	async function findPaths(
		knowledgeGraphIds: number[],
		sourceNodeId: string,
		destinationNodeId: string,
	): Promise<Path[]> {
		const edgeSrc = edgesSource(knowledgeGraphIds);
		const nodeSrc = nodesSource(knowledgeGraphIds);
		const src = esc(sourceNodeId);
		const dst = esc(destinationNodeId);

		// Find intermediate nodes and edge types using a single SQL CTE,
		// matching the original PostgreSQL query structure
		const sql = `
			WITH source_neighbors AS (
				SELECT
					CASE WHEN e."from" = '${src}' THEN e."to" ELSE e."from" END AS "neighborId",
					e.type AS "edgeType"
				FROM ${edgeSrc} AS e
				WHERE e."from" = '${src}' OR e."to" = '${src}'
			),
			destination_neighbors AS (
				SELECT
					CASE WHEN e."from" = '${dst}' THEN e."to" ELSE e."from" END AS "neighborId",
					e.type AS "edgeType"
				FROM ${edgeSrc} AS e
				WHERE e."from" = '${dst}' OR e."to" = '${dst}'
			)
			SELECT
				s."neighborId" AS "intermediateNodeId",
				s."edgeType" AS "sourceEdgeType",
				d."edgeType" AS "destinationEdgeType"
			FROM source_neighbors s
			INNER JOIN destination_neighbors d
				ON s."neighborId" = d."neighborId"
		`;

		const intermediateNodesInfo = await query<{
			intermediateNodeId: string;
			sourceEdgeType: string | null;
			destinationEdgeType: string | null;
		}>(conn, sql);

		if (intermediateNodesInfo.length === 0) return [];

		// Fetch all node details
		const intermediateNodeIds = intermediateNodesInfo.map(
			(info) => info.intermediateNodeId,
		);
		const allNodeIds = [
			...new Set([sourceNodeId, destinationNodeId, ...intermediateNodeIds]),
		];
		const nodesInfo = await getNodesByIds(knowledgeGraphIds, allNodeIds);
		const nodesMap = new Map(nodesInfo.map((n) => [n.id, n]));

		const sourceNode = nodesMap.get(sourceNodeId);
		const destinationNode = nodesMap.get(destinationNodeId);
		if (!sourceNode || !destinationNode) return [];

		return intermediateNodesInfo
			.map(
				({
					intermediateNodeId,
					sourceEdgeType,
					destinationEdgeType,
				}) => {
					const intermediateNode = nodesMap.get(intermediateNodeId);
					if (
						!intermediateNode ||
						!sourceEdgeType ||
						!destinationEdgeType
					) {
						return null;
					}
					return {
						legs: [
							{
								tailNode: sourceNode,
								edgeType: sourceEdgeType,
								headNode: intermediateNode,
							},
							{
								tailNode: intermediateNode,
								edgeType: destinationEdgeType,
								headNode: destinationNode,
							},
						],
					};
				},
			)
			.filter((path): path is Path => path !== null);
	}

	return {
		searchNodesByName,
		getNodesByIds,
		getEdgesBetweenNodes,
		getNeighbors,
		getKHopNeighborIds,
		findPaths,
	};
}
