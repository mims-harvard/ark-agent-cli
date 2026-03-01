/**
 * Smoke test for the parquet-tools module.
 * Creates a DuckDB connection and exercises every query function
 * against parquet files in data/.
 *
 * Usage: bun run scripts/smoke-test-parquet.ts
 */
import { join } from "node:path";
import { GraphLoader } from "../src/parquet-tools/index.ts";
import { createQueries } from "../src/parquet-tools/queries.ts";

const DATA_DIR = join(import.meta.dir, "..", "data");

console.log("=== Discovering graphs from data/ ===\n");
const loader = new GraphLoader(DATA_DIR);
const { graphsMeta } = loader;

console.log(
	"Graphs found:",
	graphsMeta.map((g) => `${g.name} (id=${g.id})`),
);

// Prefer PrimeKG (id=1) for testing. Fall back to whatever is available.
const testKgId = graphsMeta.find((g) => g.id === 1)?.id ?? graphsMeta[0]?.id;
if (testKgId === undefined) {
	console.error("No graphs loaded — nothing to test.");
	process.exit(1);
}
console.log(`\nTesting with knowledge graph id=${testKgId}\n`);

console.log("Initialising DuckDB...");
const start = performance.now();
const instance = await loader.getInstance();
const conn = await instance.connect();
const queries = createQueries(conn, loader.files);
const initTime = (performance.now() - start).toFixed(0);
console.log(`DuckDB ready in ${initTime}ms\n`);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
	try {
		await fn();
		console.log(`  PASS: ${name}`);
		passed++;
	} catch (err) {
		console.error(`  FAIL: ${name}`);
		console.error(`        ${err}`);
		failed++;
	}
}

function assert(condition: boolean, msg: string) {
	if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// --- 1. searchNodesByName ---
await test("searchNodesByName returns results", async () => {
	const nodes = await queries.searchNodesByName("diabetes", [testKgId], 5);
	assert(nodes.length > 0, "Expected at least 1 node matching 'diabetes'");
	assert(nodes.length <= 5, `Expected at most 5, got ${nodes.length}`);
	console.log(
		`        Found ${nodes.length} nodes. First: id="${nodes[0].id}", name="${nodes[0].name}"`,
	);
});

await test("searchNodesByName respects limit", async () => {
	const nodes = await queries.searchNodesByName("a", [testKgId], 3);
	assert(nodes.length <= 3, `Expected at most 3, got ${nodes.length}`);
});

// --- 2. getNodesByIds ---
let sampleNodeId: string | undefined;
await test("getNodesByIds returns correct node", async () => {
	// First get a node to look up
	const searchResults = await queries.searchNodesByName(
		"cancer",
		[testKgId],
		1,
	);
	assert(searchResults.length > 0, "Need at least 1 node to test getNodesByIds");
	sampleNodeId = searchResults[0].id;

	const nodes = await queries.getNodesByIds([testKgId], [sampleNodeId]);
	assert(nodes.length === 1, `Expected 1 node, got ${nodes.length}`);
	assert(
		nodes[0].id === sampleNodeId,
		`ID mismatch: ${nodes[0].id} !== ${sampleNodeId}`,
	);
	console.log(
		`        Node: id="${nodes[0].id}", name="${nodes[0].name}", type="${nodes[0].type}"`,
	);
});

await test("getNodesByIds with empty array returns empty", async () => {
	const nodes = await queries.getNodesByIds([testKgId], []);
	assert(nodes.length === 0, `Expected 0 nodes, got ${nodes.length}`);
});

// --- 3. getNeighbors ---
let neighborIds: string[] = [];
await test("getNeighbors returns neighbor IDs", async () => {
	assert(sampleNodeId !== undefined, "Need sampleNodeId from previous test");
	neighborIds = await queries.getNeighbors([testKgId], sampleNodeId!);
	assert(neighborIds.length > 0, "Expected at least 1 neighbor");
	console.log(
		`        Node "${sampleNodeId}" has ${neighborIds.length} neighbors`,
	);
});

// --- 4. getEdgesBetweenNodes ---
await test("getEdgesBetweenNodes finds edges", async () => {
	assert(
		sampleNodeId !== undefined && neighborIds.length > 0,
		"Need sample data",
	);
	const edges = await queries.getEdgesBetweenNodes(
		[testKgId],
		sampleNodeId!,
		neighborIds[0],
	);
	assert(
		edges.length > 0,
		"Expected at least 1 edge between node and its neighbor",
	);
	console.log(
		`        Found ${edges.length} edge(s) between "${sampleNodeId}" and "${neighborIds[0]}". Type: "${edges[0].type}"`,
	);
});

// --- 5. getKHopNeighborIds k=1 ---
await test("getKHopNeighborIds k=1 matches getNeighbors", async () => {
	assert(sampleNodeId !== undefined, "Need sampleNodeId");
	const kHopIds = await queries.getKHopNeighborIds(
		[testKgId],
		sampleNodeId!,
		1,
	);
	assert(
		kHopIds.length === neighborIds.length,
		`k=1 returned ${kHopIds.length}, getNeighbors returned ${neighborIds.length}`,
	);
});

// --- 6. getKHopNeighborIds k=2 ---
await test(
	"getKHopNeighborIds k=2 returns superset of k=1",
	async () => {
		assert(sampleNodeId !== undefined, "Need sampleNodeId");
		const kHop2Ids = await queries.getKHopNeighborIds(
			[testKgId],
			sampleNodeId!,
			2,
		);
		assert(
			kHop2Ids.length >= neighborIds.length,
			`k=2 (${kHop2Ids.length}) should be >= k=1 (${neighborIds.length})`,
		);
		console.log(
			`        k=1: ${neighborIds.length} neighbors, k=2: ${kHop2Ids.length} neighbors`,
		);
	},
);

await test(
	"getKHopNeighborIds k=2 with edgeType returns empty",
	async () => {
		assert(sampleNodeId !== undefined, "Need sampleNodeId");
		const result = await queries.getKHopNeighborIds(
			[testKgId],
			sampleNodeId!,
			2,
			"some_type",
		);
		assert(result.length === 0, `Expected empty array, got ${result.length}`);
	},
);

// --- 7. findPaths ---
await test(
	"findPaths finds 2-leg paths between connected nodes",
	async () => {
		// Pick two nodes that are 2 hops apart: sampleNode → neighbor → neighbor-of-neighbor
		assert(
			sampleNodeId !== undefined && neighborIds.length > 0,
			"Need sample data",
		);
		const neighbor = neighborIds[0];
		const neighborsOfNeighbor = await queries.getNeighbors(
			[testKgId],
			neighbor,
		);
		// Find a 2-hop-away node (not the original node, not a direct neighbor)
		const neighborSet = new Set(neighborIds);
		const twoHopNode = neighborsOfNeighbor.find(
			(id) => id !== sampleNodeId && !neighborSet.has(id),
		);
		if (!twoHopNode) {
			console.log("        Skipped — couldn't find a suitable 2-hop node");
			return;
		}
		const paths = await queries.findPaths(
			[testKgId],
			sampleNodeId!,
			twoHopNode,
		);
		assert(paths.length > 0, "Expected at least 1 path");
		console.log(
			`        Found ${paths.length} path(s) between "${sampleNodeId}" and "${twoHopNode}"`,
		);
		const first = paths[0];
		console.log(
			`        First path: ${first.legs.map((l) => `${l.tailNode.id} -[${l.edgeType}]-> ${l.headNode.id}`).join(" | ")}`,
		);
	},
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
