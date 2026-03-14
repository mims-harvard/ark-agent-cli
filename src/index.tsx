import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
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

const providerSchema = z.enum(["anthropic", "azure"]);

const rawEnv = createEnv({
	server: {
		LLM_PROVIDER: z
			.string()
			.optional()
			.transform((v) => (v ? providerSchema.parse(v) : "anthropic")),
		ANTHROPIC_API_KEY: z.string().optional(),
		AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
		AZURE_OPENAI_API_KEY: z.string().optional(),
		AZURE_OPENAI_API_VERSION: z
			.string()
			.optional()
			.default("2024-05-01-preview"),
		AZURE_OPENAI_DEPLOYMENT: z.string().optional().default("gpt-4o-1120"),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});

function validateEnv() {
	const provider = rawEnv.LLM_PROVIDER;
	if (provider === "anthropic") {
		if (!rawEnv.ANTHROPIC_API_KEY?.trim()) {
			throw new Error(
				"ANTHROPIC_API_KEY is required when LLM_PROVIDER is anthropic (or unset). Set it in .env",
			);
		}
		return {
			...rawEnv,
			ANTHROPIC_API_KEY: rawEnv.ANTHROPIC_API_KEY!,
		};
	}
	// provider === "azure"
	if (!rawEnv.AZURE_OPENAI_ENDPOINT?.trim() || !rawEnv.AZURE_OPENAI_API_KEY?.trim()) {
		throw new Error(
			"AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are required when LLM_PROVIDER=azure. Set them in .env",
		);
	}
	return {
		...rawEnv,
		AZURE_OPENAI_ENDPOINT: rawEnv.AZURE_OPENAI_ENDPOINT!,
		AZURE_OPENAI_API_KEY: rawEnv.AZURE_OPENAI_API_KEY!,
	};
}

export const env = validateEnv();

// Discover graph metadata instantly; parquet data loads lazily per agent
const DATA_DIR = join(import.meta.dir, "..", "data");
const loader = new GraphLoader(DATA_DIR);

const anthropic =
	env.LLM_PROVIDER === "anthropic"
		? createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })
		: null;

const azure =
	env.LLM_PROVIDER === "azure"
		? createAzure({
				baseURL: env.AZURE_OPENAI_ENDPOINT,
				apiKey: env.AZURE_OPENAI_API_KEY,
				apiVersion: env.AZURE_OPENAI_API_VERSION,
		  })
		: null;

const currentModelDisplay =
	env.LLM_PROVIDER === "azure"
		? { providerName: "OpenAI", name: `Azure (${env.AZURE_OPENAI_DEPLOYMENT})` }
		: { providerName: "Anthropic", name: "Claude Opus 4.5" };

/**
 * Custom tool component renderers for graph agent tools.
 */
const graphToolComponents: ToolComponentsMap = {
	getNodeDetails: GetNodeDetailsTool,
};

const configValue: ConfigInput = {
	id: "ark-agent-cli",
	agents: loader.graphsMeta.map(
		(meta) =>
			new Agent({
				id: meta.slug,
				name: meta.name,
				model: currentModelDisplay,
				color: meta.color as HexColor,
				toolComponents: graphToolComponents,
				createTransport: async ({ transportOptions }) => {
					const graphTools = (await makeParquetGraphTools(
						[meta.id],
						loader,
					)) as ToolSet;

					const model =
						env.LLM_PROVIDER === "azure" && azure
							? azure(env.AZURE_OPENAI_DEPLOYMENT)
							: anthropic!("claude-opus-4-5");

					const agent = new ToolLoopAgent({
						model,
						tools: graphTools,
						instructions: `${regularPrompt}\n\n${graphAgentPrompt}`,
						stopWhen: stepCountIs(50),
					});

					return new DirectChatTransport({
						agent,
						...transportOptions,
					}) as ChatTransport<UIMessage>;
				},
			}),
	) as ConfigInput["agents"],
	commands: [{ name: "/models", hint: "Switch LLM model (set LLM_PROVIDER and restart)" }],
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
