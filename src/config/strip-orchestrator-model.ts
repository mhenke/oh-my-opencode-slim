import type { PluginConfig, Preset } from './schema';

export function stripOrchestratorModel(
  agents: Record<string, unknown>,
  enabled: boolean | undefined,
  preset: Preset | undefined,
): void {
  if (enabled !== true || preset?.orchestrator?.model !== undefined) return;

  const orchestrator = agents.orchestrator as
    | Record<string, unknown>
    | undefined;
  if (!orchestrator) return;

  delete orchestrator.model;
  delete orchestrator.variant;
}

export function applyOrchestratorModelConfig(input: {
  agents: Record<string, unknown>;
  enabled: boolean | undefined;
  presets: PluginConfig['presets'];
  configPreset: string | undefined;
  runtimePreset: string | null;
}): void {
  const presetName = input.runtimePreset ?? input.configPreset;
  stripOrchestratorModel(
    input.agents,
    input.enabled,
    presetName ? input.presets?.[presetName] : undefined,
  );
}
