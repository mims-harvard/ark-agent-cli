import { tool } from "ai";
import { z } from "zod";

import {
	findPaths as findPathsQuery,
	getEdgesBetweenNodes,
	getKHopNeighborIds,
	getNeighbors,
	getNodesByIds,
	searchNodesByName,
} from "./db/queries.ts";
import type { KnowledgeGraph, Node } from "./db/schema.ts";

export type SearchSurroundingsNeighbor = {
	id: string;
	knowledgeGraph: number;
	type: string;
	name: string;
	properties: string;
	edgesToCandidate?: (string | null)[];
	edgesFromCandidate?: (string | null)[];
	matchExplanation?: string;
};

export type MainNode = {
	id: string;
	knowledgeGraph: number;
	name: string;
	type: string;
	properties: string;
};

export type SearchSurroundingsResponse = {
	mainNode: MainNode;
	neighbors: SearchSurroundingsNeighbor[];
};

export type PathNode = {
	id: string;
	name: string | null;
	type: string | null;
};

export type PathLeg = {
	tailNode: PathNode;
	edgeType: string;
	headNode: PathNode;
};

export type FindPathsResponse = {
	sourceNode: PathNode;
	destinationNode: PathNode;
	pathCount: number;
	paths: Array<{
		legs: PathLeg[];
	}>;
};

export const makeSearchInSurroundingsTool = (
	knowledgeGraphIds: KnowledgeGraph["id"][],
) => {
	const STOPWORDS = [
		"the",
		"a",
		"an",
		"and",
		"or",
		"but",
		"in",
		"on",
		"at",
		"to",
		"for",
		"of",
		"with",
		"by",
		"is",
		"are",
		"was",
		"were",
		"be",
		"been",
		"have",
		"has",
		"had",
		"do",
		"does",
		"did",
		"will",
		"would",
		"could",
		"should",
		"may",
		"might",
		"can",
		"must",
		"shall",
		"this",
		"that",
		"these",
		"those",
		"i",
		"you",
		"he",
		"she",
		"it",
		"we",
		"they",
		"me",
		"him",
		"her",
		"us",
		"them",
	];

	return tool({
		description:
			"Search in surroundings (1 or 2 hop) for a specific keyword, in nodes with a specific type, optionally filtering by edge type. Shows relation types between reference node and neighbors.",
		inputSchema: z.object({
			nodeId: z.string().describe("The ID of the node to search around."),
			query: z
				.string()
				.optional()
				.describe(
					"The keyword to search for. You can also leave this empty and get all nodes of the specified type",
				),
			nodeType: z
				.string()
				.optional()
				.describe("The type of nodes to search in"),
			edgeType: z
				.string()
				.optional()
				.describe("The type of edges to traverse when finding neighbors"),
			k: z
				.enum(["1", "2"])
				.optional()
				.describe("The number of hops (1 or 2) to search within"),
		}),
		execute: async ({ nodeId, query, nodeType, edgeType, k }) => {
			const hops = k ? (Number.parseInt(k, 10) as 1 | 2) : 1;
			if (hops !== 1 && hops !== 2) {
				throw new Error("k must be 1 or 2");
			}
			if (hops === 2 && edgeType) {
				throw new Error("Filtering by edge type is not supported when k=2");
			}

			const mainNodes = await getNodesByIds(knowledgeGraphIds, [nodeId]);
			if (!mainNodes || mainNodes.length === 0) {
				throw new Error(`Node with id ${nodeId} not found.`);
			}
			const mainNode = mainNodes[0];
			if (!mainNode) {
				throw new Error(`Node with id ${nodeId} not found.`);
			}

			const neighborIds = await getKHopNeighborIds(
				knowledgeGraphIds,
				nodeId,
				hops,
				edgeType,
			);
			let candidates = await getNodesByIds(knowledgeGraphIds, neighborIds);

			if (nodeType) {
				candidates = candidates.filter((c) => c.type === nodeType);
			}

			let candidatesWithQuery: ((typeof candidates)[0] & {
				matchExplanation?: string;
			})[] = candidates;

			if (query) {
				const queryWords = query
					.replace("-", " ")
					.split(" ")
					.map((w) => w.toLowerCase())
					.filter((w) => !STOPWORDS.includes(w));

				const candidatesInName = candidatesWithQuery.filter((c) =>
					c.name?.toLowerCase().includes(query.toLowerCase()),
				);

				const candidatesInProperties = candidatesWithQuery
					.filter(
						(c) =>
							!candidatesInName.some((cin) => cin.id === c.id) && c.properties,
					)
					.map((c) => {
						const appearingWords = queryWords.filter((qw) =>
							c.properties?.toLowerCase().includes(qw),
						);
						return {
							...c,
							relevance: appearingWords.length,
							appearingWords,
						};
					})
					.filter((c) => c.relevance > 0)
					.sort((a, b) => b.relevance - a.relevance)
					.map((c) => {
						const matchExplanation = `${c.relevance} match${
							c.relevance === 1 ? "" : "es"
						}: ${c.appearingWords.join(", ")}`;
						return { ...c, matchExplanation };
					});
				candidatesWithQuery = [...candidatesInName, ...candidatesInProperties];
			}

			if (hops === 1) {
				const candidatesWithEdges = await Promise.all(
					candidatesWithQuery.map(async (candidate) => {
						const edges = await getEdgesBetweenNodes(
							knowledgeGraphIds,
							nodeId,
							candidate.id,
						);
						const edgesToCandidate = edges
							.filter((e) => e.from === nodeId)
							.map((e) => e.type);
						const edgesFromCandidate = edges
							.filter((e) => e.to === nodeId)
							.map((e) => e.type);
						return {
							...candidate,
							edgesToCandidate,
							edgesFromCandidate,
						};
					}),
				);

				return {
					mainNode,
					neighbors: candidatesWithEdges,
				};
			}

			return {
				mainNode,
				neighbors: candidatesWithQuery.map(
					({ type, name, id, knowledgeGraphId, properties }) => ({
						type,
						name,
						id,
						knowledgeGraphId,
						properties,
					}),
				),
			};
		},
	});
};

export const makeFindNodesByNameTool = (
	knowledgeGraphIds: KnowledgeGraph["id"][],
) =>
	tool({
		description: "Find nodes in the knowledge graph by their name.",
		inputSchema: z.object({
			name: z.string().describe("The name of the node to search for."),
		}),
		execute: async ({ name }) => {
			const nodes = await searchNodesByName(name, knowledgeGraphIds);
			return nodes.map(
				({ type, name: nodeName, id, knowledgeGraphId, properties }) => ({
					type,
					name: nodeName,
					id,
					knowledgeGraphId,
					properties,
				}),
			);
		},
	});

export const makeGetNodeDetailsTool = (
	knowledgeGraphIds: KnowledgeGraph["id"][],
) =>
	tool({
		description: "Get the details of a specific node by its ID.",
		inputSchema: z.object({
			nodeId: z.string().describe("The ID of the node to get details for."),
		}),
		execute: async ({ nodeId }) => {
			const nodes = await getNodesByIds(knowledgeGraphIds, [nodeId]);
			return nodes.map((node) => ({
				type: node.type,
				name: node.name,
				id: node.id,
				knowledgeGraphId: node.knowledgeGraphId,
				properties: node.properties,
			}));
		},
	});

export const makeGetNeighborsByNodeIdTool = (
	knowledgeGraphIds: KnowledgeGraph["id"][],
) =>
	tool({
		description: "Get the neighbors of a specific node by its ID.",
		inputSchema: z.object({
			nodeId: z.string().describe("The ID of the node to get neighbors for."),
			edgeType: z.string().optional().describe("Optional filter by edge type."),
		}),
		execute: async ({ nodeId, edgeType }) => {
			const neighbors = await getNeighbors(knowledgeGraphIds, nodeId, edgeType);
			return neighbors;
		},
	});

export const makeListAvailableGraphs = (
	knowledgeGraphIds: KnowledgeGraph["id"][],
) =>
	tool({
		description: "List all available knowledge graphs for querying.",
		inputSchema: z.object({}),
		execute: () => {
			// TODO:(iarango -> lvvittor) Replace with a database request
			const KNOWLEDGE_GRAPHS = [
				{
					id: "1",
					name: "PrimeKG",
					category: "Biomedical",
					shortDescription: "Holistic precision medicine.",
					description:
						"A precision medicine-oriented knowledge graph that provides a holistic view of diseases.",
				},
				{
					id: "3",
					name: "OptimusKG",
					category: "Biomedical",
					shortDescription: "Multimodal precision medicine.",
					description:
						"OptimusKG is a modern multimodal knowledge graph for precision medicine.",
				},
				{
					id: "2",
					name: "AfriMedKG",
					category: "Regional",
					shortDescription: "Pan-african knowledge.",
					description:
						"A knowledge graph constructed based on the multiple-choice questions of AfriMed-QA. AfriMed-QA is a pan-african, multi-specialty, medical question-answering benchmark dataset.",
				},
			] as const;

			// TODO:(iarango -> lvvittor) Also include node and edge types

			const availableGraphs = knowledgeGraphIds.map((id) =>
				KNOWLEDGE_GRAPHS.find((graph) => graph.id === String(id)),
			);

			return availableGraphs;
		},
	});

export const makeGraphTools = (knowledgeGraphIds: KnowledgeGraph["id"][]) => {
	const listAvailableGraphs = makeListAvailableGraphs(knowledgeGraphIds);
	const queryingTools =
		knowledgeGraphIds.length === 0
			? {}
			: {
					findNodesByName: makeFindNodesByNameTool(knowledgeGraphIds),
					getNodeDetails: makeGetNodeDetailsTool(knowledgeGraphIds),
					getNeighborsByNodeId: makeGetNeighborsByNodeIdTool(knowledgeGraphIds),
					searchInSurroundings: makeSearchInSurroundingsTool(knowledgeGraphIds),
				};
	return {
		listAvailableGraphs,
		...queryingTools,
	};
};
