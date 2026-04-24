export interface McpServerPlan {
  name: string;
  packageName?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  sponsor: string;
}

export const mcpServerPlans: McpServerPlan[] = [
  {
    name: 'tinyfish',
    url: 'https://agent.tinyfish.ai/mcp',
    sponsor: 'tinyfish',
  },
  {
    name: 'redis',
    packageName: '@modelcontextprotocol/server-redis',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-redis', 'redis://localhost:6379'],
    sponsor: 'redis',
  },
  {
    name: 'insforge',
    packageName: '@insforge/mcp',
    command: 'npx',
    args: ['-y', '@insforge/mcp@latest'],
    env: {
      API_BASE_URL: '${INSFORGE_API_URL}',
      API_KEY: '${INSFORGE_API_KEY}',
    },
    sponsor: 'insforge',
  },
  {
    name: 'akash',
    packageName: 'akash-mcp',
    command: 'npx',
    args: ['-y', 'akash-mcp', 'stdio'],
    env: {
      AKASH_MNEMONIC: '${AKASH_MNEMONIC}',
      AKASH_PRIVATE_KEY_HEX: '${AKASH_PRIVATE_KEY_HEX}',
    },
    sponsor: 'akash',
  },
  {
    name: 'playwright',
    packageName: '@playwright/mcp',
    command: 'npx',
    args: ['-y', '@playwright/mcp'],
    sponsor: 'playwright',
  },
];
