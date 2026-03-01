import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const DATA_DIR = join(import.meta.dir, "..", "data");

// ---------------------------------------------------------------------------
// Progress tracking — makes the export idempotent / resumable
// ---------------------------------------------------------------------------

interface ExportProgress {
	nodesComplete: boolean;
	edgesComplete: boolean;
}

const PROGRESS_FILE = ".export-progress.json";

function emptyProgress(): ExportProgress {
	return { nodesComplete: false, edgesComplete: false };
}

async function loadProgress(dir: string): Promise<ExportProgress> {
	try {
		const raw = await readFile(join(dir, PROGRESS_FILE), "utf-8");
		return JSON.parse(raw) as ExportProgress;
	} catch {
		return emptyProgress();
	}
}

async function saveProgress(
	dir: string,
	progress: ExportProgress,
): Promise<void> {
	await writeFile(join(dir, PROGRESS_FILE), JSON.stringify(progress, null, 2));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Escape a string for use inside a DuckDB SQL single-quoted literal. */
function escapeSQL(s: string): string {
	return s.replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	// biome-ignore lint/style/noNonNullAssertion: checked by the script context
	const rawUrl = process.env.POSTGRES_URL!;

	// Strip query parameters that DuckDB's postgres scanner doesn't understand
	// (e.g. Supabase's custom `supa` parameter)
	const parsedUrl = new URL(rawUrl);
	const allowedParams = ["sslmode", "options", "application_name"];
	for (const key of [...parsedUrl.searchParams.keys()]) {
		if (!allowedParams.includes(key)) {
			parsedUrl.searchParams.delete(key);
		}
	}
	const pgUrl = parsedUrl.toString();

	console.log("Initialising DuckDB...");
	const instance = await DuckDBInstance.create(":memory:");
	const conn = await instance.connect();

	// Install and load the postgres scanner extension
	await conn.run("INSTALL postgres;");
	await conn.run("LOAD postgres;");

	// Attach the PostgreSQL database as a read-only source
	await conn.run(
		`ATTACH '${escapeSQL(pgUrl)}' AS pg (TYPE POSTGRES, READ_ONLY);`,
	);

	// Disable server-side statement timeout for large exports
	await conn.run(
		"CALL postgres_execute('pg', 'SET statement_timeout = 0');",
	);

	// Fetch knowledge graphs
	console.log("Fetching knowledge graphs...");
	const kgResult = await conn.runAndReadAll(
		"SELECT id, name, description FROM pg.knowledge_graph ORDER BY id;",
	);
	const graphs = kgResult.getRowObjectsJson() as {
		id: number;
		name: string;
		description: string;
	}[];
	console.log(`Found ${graphs.length} knowledge graph(s).`);

	for (const graph of graphs) {
		const slug = slugify(graph.name);
		if (!slug) {
			throw new Error(
				`Knowledge graph "${graph.name}" (id=${graph.id}) produced an empty slug.`,
			);
		}

		const dir = join(DATA_DIR, slug);
		await mkdir(dir, { recursive: true });

		const progress = await loadProgress(dir);

		if (progress.nodesComplete && progress.edgesComplete) {
			console.log(`\nSkipping "${graph.name}" (already exported)`);
			continue;
		}

		// Get counts for progress reporting
		const countResult = await conn.runAndReadAll(`
			SELECT
				(SELECT count(*)::INTEGER FROM pg.node WHERE "knowledgeGraphId" = ${graph.id}) AS node_count,
				(SELECT count(*)::INTEGER FROM pg.edge WHERE "knowledgeGraphId" = ${graph.id}) AS edge_count;
		`);
		const counts = countResult.getRowObjectsJson()[0] as {
			node_count: number;
			edge_count: number;
		};

		console.log(
			`\nExporting "${graph.name}" -> ${slug}/ (${counts.node_count} nodes, ${counts.edge_count} edges)`,
		);

		// 1. Write graph.json (always — cheap & idempotent)
		await writeFile(
			join(dir, "graph.json"),
			JSON.stringify(
				{ id: graph.id, name: graph.name, description: graph.description },
				null,
				2,
			),
		);
		console.log("  Wrote graph.json");

		// 2. Nodes
		if (progress.nodesComplete) {
			console.log("  Nodes already exported, skipping.");
		} else {
			const nodesPath = join(dir, "nodes.parquet");
			console.log("  Exporting nodes to parquet...");
			await conn.run(`
				COPY (
					SELECT id, name, type, properties
					FROM pg.node
					WHERE "knowledgeGraphId" = ${graph.id}
				) TO '${escapeSQL(nodesPath)}' (FORMAT PARQUET, COMPRESSION SNAPPY);
			`);
			console.log(`  Wrote nodes.parquet (${counts.node_count} rows)`);
			progress.nodesComplete = true;
			await saveProgress(dir, progress);
		}

		// 3. Edges
		if (progress.edgesComplete) {
			console.log("  Edges already exported, skipping.");
		} else {
			const edgesPath = join(dir, "edges.parquet");
			console.log("  Exporting edges to parquet...");
			await conn.run(`
				COPY (
					SELECT "from", "to", type, properties
					FROM pg.edge
					WHERE "knowledgeGraphId" = ${graph.id}
				) TO '${escapeSQL(edgesPath)}' (FORMAT PARQUET, COMPRESSION SNAPPY);
			`);
			console.log(`  Wrote edges.parquet (${counts.edge_count} rows)`);
			progress.edgesComplete = true;
			await saveProgress(dir, progress);
		}
	}

	conn.closeSync();
	instance.closeSync();
	console.log("\nExport complete.");
}

main().catch((err) => {
	console.error("Export failed:", err);
	process.exit(1);
});
