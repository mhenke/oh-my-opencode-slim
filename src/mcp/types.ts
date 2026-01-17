// MCP types - McpName is defined in config/schema.ts to avoid duplication

export type RemoteMcpConfig = {
  type: "remote";
  url: string;
  headers?: Record<string, string>;
  oauth?: false;
};
