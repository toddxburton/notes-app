/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface WebMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

interface DocumentModelContext {
  registerTool: (tool: WebMcpToolDefinition) => Promise<void>;
}

interface Document {
  modelContext?: DocumentModelContext;
  __marginToolsRegistered?: boolean;
}
