# ARK Agent CLI

[![arXiv](https://img.shields.io/badge/arXiv-2601.13969-b31b1b.svg)](https://arxiv.org/abs/2601.13969)
[![Paper](https://img.shields.io/badge/Paper-Adaptive%20Retriever%20of%20Knowledge-blue)](https://arxiv.org/abs/2601.13969)
[![Main Code](https://img.shields.io/badge/Main%20Code-mims--harvard%2Fark-green)](https://github.com/mims-harvard/ark)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

A Terminal UI (TUI) application for interactive exploration of biomedical knowledge graphs using AI agents. This is the command-line interface for [ARK (Adaptive Retriever of Knowledge)](https://github.com/mims-harvard/ark).

<p align="center">
  <img src="static/ark-cli.png" alt="ARK Agent CLI Demo" width="800">
</p>

## Overview

ARK Agent CLI provides a conversational interface to explore biomedical knowledge graphs through specialized AI agents. Each agent has access to a curated knowledge graph and can traverse nodes, find relationships, and answer complex biomedical questions using Claude Opus 4.5.

### Key Features

- **Interactive Chat Interface**: Natural language conversations with AI agents
- **Multiple Specialized Agents**: Choose from agents specialized in different biomedical domains
- **Knowledge Graph Exploration**: Search nodes, traverse relationships, and discover paths
- **Rich Terminal UI**: Built with `@ai-tui/core` for a modern terminal experience
- **Custom Tool Renderers**: Visualize knowledge graph data directly in the terminal

## Knowledge Graphs

| Agent | Knowledge Graph | Description | Use Cases |
|-------|-----------------|-------------|-----------|
| **PrimeKG** | Precision Medicine KG | Holistic view of diseases with comprehensive drug, gene, and disease relationships | Drug repurposing, disease mechanisms, precision medicine research |
| **AfriMedKG** | Pan-African Medical KG | Built from AfriMed-QA multi-specialty medical Q&A benchmark | African medical knowledge, multi-specialty medical queries |
| **OptimusKG** | Multimodal Precision Medicine KG | Modern multimodal KG with rich metadata | Advanced precision medicine, multimodal biomedical queries |

## Installation

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- [Node.js](https://nodejs.org/) >= 18 (for pnpm)
- [pnpm](https://pnpm.io/) >= 10
- PostgreSQL database with knowledge graph data

### Setup

1. **Clone the repository**:

   ```bash
   git clone https://github.com/mims-harvard/ark-agent-cli.git
   cd ark-agent-cli
   ```

2. **Install dependencies**:

   ```bash
   pnpm install
   ```

3. **Configure environment variables**:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your credentials:

   ```env
   ANTHROPIC_API_KEY=your_anthropic_api_key
   POSTGRES_URL=postgresql://user:password@host:port/database
   ```

4. **Run the application**:

   ```bash
   pnpm cli
   ```

## Usage

### Starting a Session

Launch the CLI in development mode with hot reloading:

```bash
pnpm cli
```

Or build and run the compiled binary:

```bash
pnpm build
./build/ark-agent-cli
```

### Selecting an Agent

Upon startup, you'll see three specialized agents:

- **PrimeKG** (orange) - Precision medicine queries
- **AfriMedKG** (blue) - Pan-African medical knowledge
- **OptimusKG** (green) - Multimodal precision medicine

Use arrow keys or click to select an agent, then start typing your question.

### Example Queries

#### Finding Genes and Proteins

```
What are the neighbors of the A2M gene/protein?
```

#### Disease-Gene Relationships

```
What genes are associated with Alzheimer's disease?
```

#### Drug Interactions

```
What drugs interact with the BRCA1 gene?
```

#### Complex Multi-Hop Queries

```
What is the name of the gene or protein that promotes cellular aging, 
is associated with cutaneous T-cell lymphoma, and is involved in 
mRNA binding for gene silencing post-transcription?
```

#### Pathway Discovery

```
Find the relationship between metformin and breast cancer.
```

#### Regional Medical Knowledge (AfriMedKG)

```
What are the common symptoms of malaria according to African medical practice?
```

## Available Tools

The AI agents have access to the following knowledge graph exploration tools:

| Tool | Description | Parameters |
|------|-------------|------------|
| `listAvailableGraphs` | List all available knowledge graphs | None |
| `findNodesByName` | Search nodes by name (partial match) | `name: string` |
| `getNodeDetails` | Get detailed information about a node | `nodeId: string` |
| `getNeighborsByNodeId` | Get all neighbors of a node | `nodeId: string`, `edgeType?: string` |
| `searchInSurroundings` | Search within 1-2 hops with filters | `nodeId`, `query?`, `nodeType?`, `edgeType?`, `k?: "1"\|"2"` |
| `findPaths` | Find all length-2 paths between nodes | `sourceNodeId`, `destinationNodeId` |

## Architecture

```
ark-agent-cli/
├── src/
│   ├── index.tsx          # Main entry point, agent configuration
│   ├── prompts.ts         # Agent system prompts
│   ├── tools.ts           # Knowledge graph tool definitions
│   ├── db/
│   │   ├── db.ts          # Database connection
│   │   ├── schema.ts      # Drizzle ORM schema
│   │   └── queries.ts     # Database query functions
│   └── tool-renderers/
│       └── get-node-details-tool.tsx  # Custom tool visualization
├── build/                 # Compiled binary output
├── package.json
└── tsconfig.json
```

### Technology Stack

- **Runtime**: [Bun](https://bun.sh/) - Fast JavaScript runtime
- **Language**: TypeScript 5.x
- **UI Framework**: [React 19](https://react.dev/) with [@ai-tui/core](https://www.npmjs.com/package/@ai-tui/core)
- **LLM Integration**: [Vercel AI SDK](https://sdk.vercel.ai/) with Anthropic Claude Opus 4.5
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/)
- **Validation**: [Zod](https://zod.dev/)

## Development

### Scripts

| Script | Description |
|--------|-------------|
| `pnpm cli` | Run in development mode with hot reload |
| `pnpm build` | Compile to standalone binary |
| `pnpm check-types` | Run TypeScript type checking |
| `pnpm clean` | Remove build artifacts |

### Adding a New Knowledge Graph

1. Add the graph data to PostgreSQL using the schema in `src/db/schema.ts`
2. Create a new agent in `src/index.tsx`:

   ```typescript
   createGraphAgent("newkg", "NewKG", 4, "#hexcolor")
   ```

3. Update the `KNOWLEDGE_GRAPHS` constant in `src/tools.ts`

### Custom Tool Renderers

Tool renderers provide rich visualization of tool outputs. See `src/tool-renderers/get-node-details-tool.tsx` for an example implementation.

## Database Schema

The application uses three main tables:

```sql
-- Knowledge graphs metadata
CREATE TABLE knowledge_graph (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL
);

-- Nodes in the knowledge graphs
CREATE TABLE node (
  knowledgeGraphId BIGINT REFERENCES knowledge_graph(id),
  id TEXT NOT NULL,
  name TEXT,
  type VARCHAR(256),
  properties TEXT,
  PRIMARY KEY (knowledgeGraphId, id)
);

-- Edges connecting nodes
CREATE TABLE edge (
  knowledgeGraphId BIGINT REFERENCES knowledge_graph(id),
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  type VARCHAR(256),
  properties TEXT,
  PRIMARY KEY (knowledgeGraphId, "from", "to", type)
);
```

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

- [ARK (Main Repository)](https://github.com/mims-harvard/ark) - Core ARK implementation and benchmarks
- [PrimeKG](https://github.com/mims-harvard/PrimeKG) - Precision Medicine Knowledge Graph
- [Zitnik Lab](https://zitniklab.hms.harvard.edu/) - Harvard Medical School research group

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Made with ❤️ at <a href="https://zitniklab.hms.harvard.edu/">Zitnik Lab</a>, Harvard Medical School
</p>
