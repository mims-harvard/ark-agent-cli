import { useState } from "react";

import { BlockTool, InlineTool, type ToolRendererProps } from "@ai-tui/core";

/** Icon for knowledge graph nodes */
const ICON_NODE = "\u25C8"; // ◈

/** Icon for nested property items */
const ICON_PROPERTY = "\u21B3"; // ↳

/**
 * Node details returned by the getNodeDetails tool.
 */
type NodeDetail = {
  type: string | null;
  name: string | null;
  id: string;
  knowledgeGraphId: number;
  properties: string | null;
};

/**
 * Knowledge graph ID to name mapping.
 */
const KNOWLEDGE_GRAPHS: Record<number, string> = {
  1: "PrimeKG",
  2: "AfriMedKG",
  3: "OptimusKG",
};

/**
 * Parse Python-style JSON strings to JavaScript objects.
 * Handles conversions: None -> null, True -> true, False -> false, NaN -> null
 */
function parsePythonJson(
  pythonJson: string | null
): Record<string, unknown> | null {
  if (!pythonJson) {
    return null;
  }

  try {
    const jsJson = pythonJson
      .replace(/\bNone\b/g, "null")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNaN\b/g, "null")
      .replace(/'/g, '"');

    return JSON.parse(jsJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Format a property value for display.
 * Truncates long strings and handles various types.
 */
function formatPropertyValue(value: unknown, maxLength = 50): string {
  if (value === null || value === undefined) {
    return "\u2014"; // em-dash
  }

  if (typeof value === "string") {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const preview = value.slice(0, 3).join(", ");
    return value.length > 3 ? `[${preview}, ...]` : `[${preview}]`;
  }

  if (typeof value === "object") {
    const str = JSON.stringify(value);
    return str.length > maxLength ? `${str.slice(0, maxLength)}...` : str;
  }

  return String(value);
}

/**
 * Get knowledge graph name from ID.
 */
function getKnowledgeGraphName(id: number): string {
  return KNOWLEDGE_GRAPHS[id] ?? `Graph #${id}`;
}

/** Number of properties to show before collapsing */
const PROPERTIES_COLLAPSE_THRESHOLD = 5;

/**
 * Tool renderer for the getNodeDetails graph agent tool.
 * Displays node information with structured details and collapsible properties.
 */
export function GetNodeDetailsTool({
  tool,
  isComplete,
  theme,
}: ToolRendererProps) {
  const [propertiesExpanded, setPropertiesExpanded] = useState(false);

  const { input, output, error } = tool.state;
  const nodeId = input?.nodeId as string | undefined;

  // Pending state
  if (!(isComplete || error)) {
    return (
      <InlineTool
        complete={false}
        icon={ICON_NODE}
        pending={`Fetching node details${nodeId ? ` for ${nodeId}` : ""}...`}
      >
        {nodeId ?? "node"}
      </InlineTool>
    );
  }

  // Error state
  if (error) {
    return (
      <BlockTool hasError title={`Node Details: ${nodeId ?? "unknown"}`}>
        <box paddingLeft={1}>
          <text fg={theme.error}>{error}</text>
        </box>
      </BlockTool>
    );
  }

  // Parse output
  let nodes: NodeDetail[] = [];
  if (output) {
    try {
      nodes = JSON.parse(output) as NodeDetail[];
    } catch {
      return (
        <BlockTool hasError title={`Node Details: ${nodeId ?? "unknown"}`}>
          <box paddingLeft={1}>
            <text fg={theme.error}>Failed to parse node details</text>
          </box>
        </BlockTool>
      );
    }
  }

  // Empty result
  if (nodes.length === 0) {
    return (
      <InlineTool complete hasError icon={"\u25C8"} pending="No nodes found">
        No node found with ID: {nodeId ?? "unknown"}
      </InlineTool>
    );
  }

  // Render node details
  const node = nodes[0] as NodeDetail;
  const title = node.name ? `Node: ${node.name}` : `Node: ${node.id}`;

  const properties = parsePythonJson(node.properties);
  const propertyEntries = properties ? Object.entries(properties) : [];
  const hasOverflow = propertyEntries.length > PROPERTIES_COLLAPSE_THRESHOLD;
  const visibleProperties = propertiesExpanded
    ? propertyEntries
    : propertyEntries.slice(0, PROPERTIES_COLLAPSE_THRESHOLD);
  const hiddenCount = propertyEntries.length - PROPERTIES_COLLAPSE_THRESHOLD;

  return (
    <BlockTool title={`${ICON_NODE} ${title}`}>
      {/* Type */}
      {node.type !== null && (
        <box paddingLeft={1}>
          <text fg={theme.textMuted}>
            Type: <span fg={theme.text}>{node.type}</span>
          </text>
        </box>
      )}
      {/* ID */}
      <box paddingLeft={1}>
        <text fg={theme.textMuted}>
          ID: <span fg={theme.text}>{node.id}</span>
        </text>
      </box>
      {/* Knowledge Graph */}
      <box paddingLeft={1}>
        <text fg={theme.textMuted}>
          Knowledge Graph:{" "}
          <span fg={theme.text}>
            {getKnowledgeGraphName(node.knowledgeGraphId)}
          </span>
        </text>
      </box>
      {/* Properties */}
      {propertyEntries.length > 0 && (
        <box paddingLeft={1}>
          <text fg={theme.textMuted}>Properties:</text>
          {visibleProperties.map(([key, value]) => (
            <box key={key} paddingLeft={2}>
              <text fg={theme.textMuted}>
                {ICON_PROPERTY} {key}:{" "}
                <span fg={theme.text}>{formatPropertyValue(value)}</span>
              </text>
            </box>
          ))}
          {hasOverflow && !propertiesExpanded && (
            /* biome-ignore lint/a11y/noStaticElementInteractions: TUI box */
            <box
              onMouseUp={(e: { stopPropagation: () => void }) => {
                e.stopPropagation();
                setPropertiesExpanded(true);
              }}
              paddingLeft={2}
            >
              <text fg={theme.accent}>
                + {hiddenCount} more properties (click to expand)
              </text>
            </box>
          )}
          {hasOverflow && propertiesExpanded && (
            /* biome-ignore lint/a11y/noStaticElementInteractions: TUI box */
            <box
              onMouseUp={(e: { stopPropagation: () => void }) => {
                e.stopPropagation();
                setPropertiesExpanded(false);
              }}
              paddingLeft={2}
            >
              <text fg={theme.accent}>- Click to collapse</text>
            </box>
          )}
        </box>
      )}
    </BlockTool>
  );
}
