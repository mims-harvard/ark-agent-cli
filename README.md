# ARK Agent CLI

[![arXiv](https://img.shields.io/badge/arXiv-2601.13969-b31b1b.svg)](https://arxiv.org/abs/2601.13969)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A terminal-based chat application for exploring knowledge graphs through AI agents. Part of the [ARK (Adaptive Retriever of Knowledge)](https://github.com/mims-harvard/ark) project.

<p align="center">
  <img src="static/ark-cli.png" alt="ARK Agent CLI Demo" width="800">
</p>

## What's Included

ARK Agent CLI automatically discovers any knowledge graph placed in the `data/` directory and creates a dedicated AI agent for it. Out of the box, it ships with three biomedical knowledge graphs:

| Graph | Description |
|-------|-------------|
| **PrimeKG** | A precision medicine-oriented knowledge graph that provides a holistic view of diseases, drugs, genes, and their relationships. |
| **AfriMedKG** | A knowledge graph built from the AfriMed-QA pan-African, multi-specialty medical Q&A benchmark. |
| **OptimusKG** | A modern multimodal knowledge graph for precision medicine with rich metadata. |

You can add your own graphs, biomedical or otherwise, without changing any code. See [Adding Your Own Knowledge Graph](#adding-your-own-knowledge-graph) below.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 10

### Installation

1. **Clone the repository**:

   ```bash
   git clone https://github.com/mims-harvard/ark-agent-cli.git
   cd ark-agent-cli
   ```

2. **Install dependencies**:

   ```bash
   pnpm install
   ```

3. **Configure your API key**:

   ```bash
   cp .env.example .env
   ```

   Open `.env` and add your API key. The CLI currently uses [Anthropic](https://www.anthropic.com/) as its LLM provider:

   ```env
   ANTHROPIC_API_KEY=your_key_here
   ```

4. **Start the CLI**:

   ```bash
   pnpm cli
   ```

   You can also compile it into a standalone binary:

   ```bash
   pnpm build
   ./build/ark-agent-cli
   ```

### Quick Example

Once the CLI is running, select an agent and ask a question in plain language:

```
What genes are associated with Alzheimer's disease?
```

```
Find the relationship between metformin and breast cancer.
```

The agent will search the knowledge graph, traverse relationships, and synthesize an answer while citing the specific nodes and edges it used.

## Adding Your Own Knowledge Graph

Adding a new graph takes four steps and requires **no code changes**.

### Step 1: Create a folder

Create a new directory inside `data/` with a short, lowercase name (this becomes the agent's internal ID):

```
data/mykg/
```

### Step 2: Write `graph.json`

Create a `graph.json` file inside your folder with the following fields:

```json
{
  "id": 4,
  "name": "MyGraph",
  "description": "A custom knowledge graph for my research domain.",
  "color": "#e06c75",
  "order": 4
}
```

Here's what each field does:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `number` | Yes | A unique numeric identifier. Pick any number not already used by another graph. |
| `name` | `string` | Yes | The display name shown in the UI when selecting an agent. |
| `description` | `string` | Yes | A short description of the graph. The AI agent uses this to understand when the graph is relevant. |
| `color` | `string` | Yes | A hex color for the agent in the UI (e.g. `"#e06c75"`). |
| `order` | `number` | Yes | Controls display order in the agent list. Lower numbers appear first. |

### Step 3: Prepare your parquet files

Place two [Apache Parquet](https://parquet.apache.org/) files in the same folder:

**`nodes.parquet`** (one row per node):

| Column | Type | Description |
|--------|------|-------------|
| `id` | VARCHAR | Unique node identifier |
| `name` | VARCHAR | Human-readable name |
| `type` | VARCHAR | Node type or category (e.g. `"gene"`, `"disease"`, `"drug"`) |
| `properties` | VARCHAR | A JSON string with any additional properties |

**`edges.parquet`** (one row per edge):

| Column | Type | Description |
|--------|------|-------------|
| `from` | VARCHAR | Source node ID |
| `to` | VARCHAR | Target node ID |
| `type` | VARCHAR | Relationship type (e.g. `"interacts_with"`, `"treats"`) |
| `properties` | VARCHAR | A JSON string with any additional properties |

### Step 4: Run the CLI

That's it. Start (or restart) the CLI and your new agent will appear automatically:

```bash
pnpm cli
```

## Available Tools

Each AI agent has access to the following tools for exploring its knowledge graph. You don't call these directly. The agent decides which tools to use based on your question.

| Tool | Description | Parameters |
|------|-------------|------------|
| `listAvailableGraphs` | List all available knowledge graphs | None |
| `findNodesByName` | Search for nodes by name (partial match) | `name: string` |
| `getNodeDetails` | Get detailed information about a specific node | `nodeId: string` |
| `getNeighborsByNodeId` | Get all neighbors of a node, optionally filtered by edge type | `nodeId: string`, `edgeType?: string` |
| `searchInSurroundings` | Search within 1 or 2 hops of a node with optional filters | `nodeId`, `query?`, `nodeType?`, `edgeType?`, `k?: "1"\|"2"` |
| `findPaths` | Find all length-2 paths between two nodes | `sourceNodeId`, `destinationNodeId` |

## Development

### Scripts

| Script | Description |
|--------|-------------|
| `pnpm cli` | Run in development mode with hot reload |
| `pnpm build` | Compile to a standalone binary |
| `pnpm check-types` | Run TypeScript type checking |
| `pnpm clean` | Remove build artifacts |

### Custom Tool Renderers

Tool renderers provide rich visualization of tool outputs in the terminal. See `src/tool-renderers/get-node-details-tool.tsx` for an example of how to build a custom renderer for a graph tool.

### Technology Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Language**: TypeScript
- **UI**: [React 19](https://react.dev/) with [@ai-tui/core](https://www.npmjs.com/package/@ai-tui/core)
- **LLM**: [Vercel AI SDK](https://sdk.vercel.ai/) (currently configured for Anthropic Claude)
- **Data**: Local parquet files queried via [DuckDB](https://duckdb.org/)
- **Validation**: [Zod](https://zod.dev/)

## Citation

If you use ARK in your research, please cite our paper:

```bibtex
@misc{polonuer2026autonomousknowledgegraphexploration,
      title={Autonomous Knowledge Graph Exploration with Adaptive Breadth-Depth Retrieval}, 
      author={Joaquín Polonuer and Lucas Vittor and Iñaki Arango and Ayush Noori and David A. Clifton and Luciano Del Corro and Marinka Zitnik},
      year={2026},
      eprint={2601.13969},
      archivePrefix={arXiv},
      primaryClass={cs.AI},
      url={https://arxiv.org/abs/2601.13969}, 
}
```

## Related Projects

- [ARK (Main Repository)](https://github.com/mims-harvard/ark) — Core ARK implementation and benchmarks
- [PrimeKG](https://github.com/mims-harvard/PrimeKG) — Precision Medicine Knowledge Graph
- [Zitnik Lab](https://zitniklab.hms.harvard.edu/) — Harvard Medical School research group

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Made with ❤️ at <a href="https://zitniklab.hms.harvard.edu/">Zitnik Lab</a>, Harvard Medical School
</p>
