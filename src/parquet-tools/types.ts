/**
 * Core types for knowledge graph nodes, edges, and metadata.
 */

/** A node in the knowledge graph. */
export type Node = {
	knowledgeGraphId: number;
	id: string;
	name: string | null;
	type: string | null;
	properties: string | null;
};

/** An edge in the knowledge graph. */
export type Edge = {
	knowledgeGraphId: number;
	from: string;
	to: string;
	type: string | null;
	properties: string | null;
};

/** Metadata loaded from graph.json for a knowledge graph. */
export type KnowledgeGraphMeta = {
	id: number;
	name: string;
	description: string;
	category?: string;
	shortDescription?: string;
	/** Directory name used as the agent identifier (derived at runtime, not stored in graph.json). */
	slug: string;
	/** Hex color for the agent UI (e.g. "#fab283"). */
	color: string;
	/** Display order in the UI. */
	order: number;
};
