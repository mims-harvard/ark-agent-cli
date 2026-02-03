import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { db } from "./db.ts";
import {
  type Edge,
  type KnowledgeGraph,
  type Node,
  edge,
  node,
} from "./schema.ts";

export async function searchNodesByName(
  name: string,
  knowledgeGraphIds?: KnowledgeGraph["id"][],
  limit = 10,
): Promise<Node[]> {
  try {
    return await db
      .select()
      .from(node)
      .where(
        and(
          name ? ilike(node.name, `%${name}%`) : undefined,
          knowledgeGraphIds !== undefined && knowledgeGraphIds.length > 0
            ? inArray(node.knowledgeGraphId, knowledgeGraphIds)
            : undefined,
        ),
      )
      .limit(limit);
  } catch (_error) {
    throw new Error("Failed to search nodes by name");
  }
}

export async function getNodesByIds(
  knowledgeGraphIds: KnowledgeGraph["id"][],
  nodeIds: string[],
): Promise<Node[]> {
  try {
    if (nodeIds.length === 0) {
      return [];
    }
    return await db
      .select()
      .from(node)
      .where(
        and(
          inArray(node.knowledgeGraphId, knowledgeGraphIds),
          inArray(node.id, nodeIds),
        ),
      );
  } catch (_error) {
    throw new Error("Failed to get nodes by ids");
  }
}

export async function getEdgesBetweenNodes(
  knowledgeGraphIds: KnowledgeGraph["id"][],
  node1Id: string,
  node2Id: string,
): Promise<Edge[]> {
  try {
    return await db
      .select()
      .from(edge)
      .where(
        and(
          inArray(edge.knowledgeGraphId, knowledgeGraphIds),
          or(
            and(eq(edge.from, node1Id), eq(edge.to, node2Id)),
            and(eq(edge.from, node2Id), eq(edge.to, node1Id)),
          ),
        ),
      );
  } catch (_error) {
    throw new Error("Failed to get edges between nodes");
  }
}

export async function getKHopNeighborIds(
  knowledgeGraphIds: KnowledgeGraph["id"][],
  nodeId: string,
  k: 1 | 2,
  edgeType?: string,
): Promise<Node["id"][]> {
  if (k === 1) {
    return getNeighbors(knowledgeGraphIds, nodeId, edgeType);
  }

  // k === 2
  if (edgeType) {
    // Edge type filtering for k=2 is not supported in this implementation
    // to match Python version behavior.
    return [];
  }

  const oneHopNeighbors = await getNeighbors(knowledgeGraphIds, nodeId);
  const twoHopNeighbors = new Set<Node["id"]>();

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

export async function getNeighbors(
  knowledgeGraphIds: KnowledgeGraph["id"][],
  nodeId: string,
  edgeType?: string,
): Promise<Node["id"][]> {
  try {
    const results = await db
      .selectDistinct({
        from: edge.from,
        to: edge.to,
      })
      .from(edge)
      .where(
        and(
          inArray(edge.knowledgeGraphId, knowledgeGraphIds),
          or(eq(edge.from, nodeId), eq(edge.to, nodeId)),
          edgeType ? eq(edge.type, edgeType) : undefined,
        ),
      );

    const neighborIdsSet = new Set(
      results.map((row) => (row.from === nodeId ? row.to : row.from)),
    );

    return [...neighborIdsSet];
  } catch (_error) {
    throw new Error("Failed to get neighbors");
  }
}

export type Path = {
  legs: {
    tailNode: Node;
    edgeType: string;
    headNode: Node;
  }[];
};

export async function findPaths(
  knowledgeGraphIds: KnowledgeGraph["id"][],
  sourceNodeId: string,
  destinationNodeId: string,
): Promise<Path[]> {
  try {
    const sourceNeighbors = db
      .select({
        neighborId:
          sql<string>`case when ${edge.from} = ${sourceNodeId} then ${edge.to} else ${edge.from} end`.as(
            "neighborId",
          ),
        edgeType: edge.type,
      })
      .from(edge)
      .where(
        and(
          inArray(edge.knowledgeGraphId, knowledgeGraphIds),
          or(eq(edge.from, sourceNodeId), eq(edge.to, sourceNodeId)),
        ),
      )
      .as("source_neighbors");

    const destinationNeighbors = db
      .select({
        neighborId:
          sql<string>`case when ${edge.from} = ${destinationNodeId} then ${edge.to} else ${edge.from} end`.as(
            "neighborId",
          ),
        edgeType: edge.type,
      })
      .from(edge)
      .where(
        and(
          inArray(edge.knowledgeGraphId, knowledgeGraphIds),
          or(eq(edge.from, destinationNodeId), eq(edge.to, destinationNodeId)),
        ),
      )
      .as("destination_neighbors");

    const intermediateNodesInfo = await db
      .with(sourceNeighbors, destinationNeighbors)
      .select({
        intermediateNodeId: sourceNeighbors.neighborId,
        sourceEdgeType: sourceNeighbors.edgeType,
        destinationEdgeType: destinationNeighbors.edgeType,
      })
      .from(sourceNeighbors)
      .innerJoin(
        destinationNeighbors,
        eq(sourceNeighbors.neighborId, destinationNeighbors.neighborId),
      );

    if (intermediateNodesInfo.length === 0) {
      return [];
    }

    const intermediateNodeIds = intermediateNodesInfo.map(
      (info) => info.intermediateNodeId,
    );
    const nodeIdsToFetch = Array.from(
      new Set([sourceNodeId, destinationNodeId, ...intermediateNodeIds]),
    );

    const nodesInfo = await db
      .select()
      .from(node)
      .where(
        and(
          inArray(node.knowledgeGraphId, knowledgeGraphIds),
          inArray(node.id, nodeIdsToFetch),
        ),
      );
    const nodesInfoMap = new Map(nodesInfo.map((n) => [n.id, n]));

    const sourceNode = nodesInfoMap.get(sourceNodeId);
    const destinationNode = nodesInfoMap.get(destinationNodeId);

    if (!sourceNode || !destinationNode) {
      return [];
    }

    return intermediateNodesInfo
      .map(({ intermediateNodeId, sourceEdgeType, destinationEdgeType }) => {
        const intermediateNode = nodesInfoMap.get(intermediateNodeId);
        // This should not happen with an inner join, but as a safeguard:
        if (!intermediateNode || !sourceEdgeType || !destinationEdgeType) {
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
      })
      .filter((path): path is Path => path !== null);
  } catch (_error) {
    throw new Error("Failed to find paths");
  }
}
