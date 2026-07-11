import { describe, expect, test } from 'bun:test';
import { applyOrchestratorModelConfig } from './strip-orchestrator-model';

describe('applyOrchestratorModelConfig', () => {
  test('preserves a runtime /model selection by removing configured model and variant', () => {
    const agents = {
      orchestrator: { model: 'openai/gpt-5', variant: 'high' },
    };

    applyOrchestratorModelConfig({
      agents,
      enabled: true,
      presets: undefined,
      configPreset: undefined,
      runtimePreset: null,
    });

    expect(agents.orchestrator).toEqual({});
  });

  test('retains model and variant when disabled or a selected preset sets a model', () => {
    const disabled = {
      orchestrator: { model: 'openai/gpt-5', variant: 'high' },
    };
    const presetOverride = {
      orchestrator: { model: 'openai/gpt-5', variant: 'high' },
    };

    applyOrchestratorModelConfig({
      agents: disabled,
      enabled: false,
      presets: undefined,
      configPreset: undefined,
      runtimePreset: null,
    });
    applyOrchestratorModelConfig({
      agents: presetOverride,
      enabled: true,
      presets: {
        file: { orchestrator: { model: 'anthropic/claude-sonnet-4' } },
      },
      configPreset: 'file',
      runtimePreset: null,
    });

    expect(disabled.orchestrator).toEqual({
      model: 'openai/gpt-5',
      variant: 'high',
    });
    expect(presetOverride.orchestrator).toEqual({
      model: 'openai/gpt-5',
      variant: 'high',
    });
  });

  test('uses the runtime preset before the file preset after /preset changes', () => {
    const agents = {
      orchestrator: { model: 'openai/gpt-5', variant: 'high' },
    };

    applyOrchestratorModelConfig({
      agents,
      enabled: true,
      presets: {
        file: { orchestrator: { model: 'anthropic/claude-sonnet-4' } },
        runtime: { explorer: { model: 'openai/gpt-5-mini' } },
      },
      configPreset: 'file',
      runtimePreset: 'runtime',
    });

    expect(agents.orchestrator).toEqual({});
  });

  test('retains an explicit runtime preset model over the file preset', () => {
    const agents = {
      orchestrator: { model: 'openai/gpt-5', variant: 'high' },
    };

    applyOrchestratorModelConfig({
      agents,
      enabled: true,
      presets: {
        file: { explorer: { model: 'openai/gpt-5-mini' } },
        runtime: { orchestrator: { model: 'anthropic/claude-sonnet-4' } },
      },
      configPreset: 'file',
      runtimePreset: 'runtime',
    });

    expect(agents.orchestrator).toEqual({
      model: 'openai/gpt-5',
      variant: 'high',
    });
  });

  test('allows TUI state to capture the configured model and variant before stripping', () => {
    const agents = {
      orchestrator: { model: 'openai/gpt-5', variant: 'high' },
    };
    const tuiState = { ...agents.orchestrator };

    applyOrchestratorModelConfig({
      agents,
      enabled: true,
      presets: undefined,
      configPreset: undefined,
      runtimePreset: null,
    });

    expect(tuiState).toEqual({ model: 'openai/gpt-5', variant: 'high' });
    expect(agents.orchestrator).toEqual({});
  });
});
