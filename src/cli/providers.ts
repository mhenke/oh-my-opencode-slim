import type { InstallConfig } from "./types"
import { DEFAULT_AGENT_SKILLS } from "../tools/skill/builtin"

/**
 * Provider configurations for Google models (via Antigravity auth plugin)
 */
export const GOOGLE_PROVIDER_CONFIG = {
  google: {
    name: "Google",
    models: {
      "gemini-3-pro-high": {
        name: "Gemini 3 Pro High",
        thinking: true,
        attachment: true,
        limit: { context: 1048576, output: 65535 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      "gemini-3-flash": {
        name: "Gemini 3 Flash",
        attachment: true,
        limit: { context: 1048576, output: 65536 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      "claude-opus-4-5-thinking": {
        name: "Claude Opus 4.5 Thinking",
        attachment: true,
        limit: { context: 200000, output: 32000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      "claude-sonnet-4-5-thinking": {
        name: "Claude Sonnet 4.5 Thinking",
        attachment: true,
        limit: { context: 200000, output: 32000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
    },
  },
}

// Model mappings by provider priority
export const MODEL_MAPPINGS = {
  antigravity: {
    orchestrator: "google/claude-opus-4-5-thinking",
    oracle: "google/claude-opus-4-5-thinking",
    librarian: "google/gemini-3-flash",
    explorer: "google/gemini-3-flash",
    designer: "google/gemini-3-flash",
    fixer: "google/gemini-3-flash",
  },
  openai: {
    orchestrator: "openai/gpt-5.2-codex",
    oracle: "openai/gpt-5.2-codex",
    librarian: "openai/gpt-5.1-codex-mini",
    explorer: "openai/gpt-5.1-codex-mini",
    designer: "openai/gpt-5.1-codex-mini",
    fixer: "openai/gpt-5.1-codex-mini",
  },
  opencode: {
    orchestrator: "opencode/glm-4.7-free",
    oracle: "opencode/glm-4.7-free",
    librarian: "opencode/glm-4.7-free",
    explorer: "opencode/glm-4.7-free",
    designer: "opencode/glm-4.7-free",
    fixer: "opencode/glm-4.7-free",
  },
} as const;

export function generateLiteConfig(installConfig: InstallConfig): Record<string, unknown> {
  // Priority: antigravity > openai > opencode (Zen free models)
  const baseProvider = installConfig.hasAntigravity
    ? "antigravity"
    : installConfig.hasOpenAI
      ? "openai"
      : installConfig.hasOpencodeZen
        ? "opencode"
        : "opencode"; // Default to Zen free models

  const config: Record<string, unknown> = { agents: {} };

  if (baseProvider) {
    // Start with base provider models and include default skills
    const agents: Record<string, { model: string; skills: string[] }> = Object.fromEntries(
      Object.entries(MODEL_MAPPINGS[baseProvider]).map(([k, v]) => [
        k,
        { model: v, skills: DEFAULT_AGENT_SKILLS[k as keyof typeof DEFAULT_AGENT_SKILLS] ?? [] },
      ])
    );

    // Apply provider-specific overrides for mixed configurations
    if (installConfig.hasAntigravity) {
      if (installConfig.hasOpenAI) {
        agents["oracle"] = { model: "openai/gpt-5.2-codex", skills: DEFAULT_AGENT_SKILLS["oracle"] ?? [] };
      }
    }
    config.agents = agents;
  }

  if (installConfig.hasTmux) {
    config.tmux = {
      enabled: true,
      layout: "main-vertical",
      main_pane_size: 60,
    };
  }

  return config;
}
