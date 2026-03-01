import { createAnthropic } from "@ai-sdk/anthropic";
import {
	Agent,
	type ConfigInput,
	type HexColor,
	TerminalUI,
	type ToolComponentsMap,
} from "@ai-tui/core";
import { createEnv } from "@t3-oss/env-core";
import type { ChatTransport, ToolSet, UIMessage } from "ai";
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from "ai";
import { join } from "node:path";
import { z } from "zod";

import { GraphLoader, makeParquetGraphTools } from "./parquet-tools/index.ts";
import { graphAgentPrompt, regularPrompt } from "./prompts.ts";
import { GetNodeDetailsTool } from "./tool-renderers/index.ts";

export const env = createEnv({
	server: {
		ANTHROPIC_API_KEY: z.string().min(1),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});

// Discover graph metadata instantly; parquet data loads lazily per agent
const DATA_DIR = join(import.meta.dir, "..", "data");
const loader = new GraphLoader(DATA_DIR);

const anthropic = createAnthropic({
	apiKey: env.ANTHROPIC_API_KEY,
});

/**
 * Custom tool component renderers for graph agent tools.
 */
const graphToolComponents: ToolComponentsMap = {
	getNodeDetails: GetNodeDetailsTool,
};

/**
 * Creates an agent for a specific knowledge graph.
 */
const createGraphAgent = (
	id: string,
	name: string,
	knowledgeGraphId: number,
	color: HexColor,
) =>
	new Agent({
		id,
		name,
		model: { providerName: "Anthropic", name: "Claude Opus 4.5" },
		color,
		toolComponents: graphToolComponents,
		createTransport: async ({ transportOptions }) => {
			const graphTools = (await makeParquetGraphTools(
				[knowledgeGraphId],
				loader,
			)) as ToolSet;

			const agent = new ToolLoopAgent({
				model: anthropic("claude-opus-4-5"),
				tools: graphTools,
				instructions: `${regularPrompt}\n\n${graphAgentPrompt}`,
				stopWhen: stepCountIs(50),
			});

			return new DirectChatTransport({
				agent,
				...transportOptions,
			}) as ChatTransport<UIMessage>;
		},
	});

const configValue: ConfigInput = {
	id: "ark-agent-cli",
	agents: [
		createGraphAgent("primekg", "PrimeKG", 1, "#fab283"),
		createGraphAgent("afrimedkg", "AfriMedKG", 2, "#82aaff"),
		createGraphAgent("optimuskg", "OptimusKG", 3, "#c3e88d"),
	] as ConfigInput["agents"],
	appName: {
		sections: [
			{
				text: "ARK",
				style: "gradient" as const,
				gradient: ["#fcb69f", "#f8b878"],
			},
			{ text: "Agent" },
		],
	},
};

const tui = new TerminalUI(configValue);
await tui.run();
