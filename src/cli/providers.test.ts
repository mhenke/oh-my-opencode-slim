/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { generateLiteConfig, MODEL_MAPPINGS } from './providers';

describe('providers', () => {
  test('generateLiteConfig generates antigravity config by default', () => {
    const config = generateLiteConfig({
      hasAntigravity: true,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: false,
    });

    expect(config.preset).toBe('antigravity');
    const agents = (config.presets as any).antigravity;
    expect(agents.orchestrator.model).toBe(
      MODEL_MAPPINGS.antigravity.orchestrator.model,
    );
    expect(agents.orchestrator.variant).toBeUndefined();
    expect(agents.fixer.model).toBe(MODEL_MAPPINGS.antigravity.fixer.model);
    expect(agents.fixer.variant).toBe(MODEL_MAPPINGS.antigravity.fixer.variant);
  });

  test('generateLiteConfig always includes antigravity-openai preset', () => {
    const config = generateLiteConfig({
      hasAntigravity: true,
      hasOpenAI: true,
      hasOpencodeZen: false,
      hasTmux: false,
    });

    expect(config.preset).toBe('antigravity-openai');
    const agents = (config.presets as any)['antigravity-openai'];
    expect(agents.orchestrator.model).toBe(
      MODEL_MAPPINGS.antigravity.orchestrator.model,
    );
    expect(agents.orchestrator.variant).toBeUndefined();
    expect(agents.oracle.model).toBe('openai/gpt-5.2-codex');
    expect(agents.oracle.variant).toBe('high');
  });

  test('generateLiteConfig includes antigravity-openai preset even with only antigravity', () => {
    const config = generateLiteConfig({
      hasAntigravity: true,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: false,
    });

    expect(config.preset).toBe('antigravity');
    const agents = (config.presets as any)['antigravity-openai'];
    expect(agents).toBeDefined();
    expect(agents.oracle.model).toBe('openai/gpt-5.2-codex');
  });

  test('generateLiteConfig uses openai if no antigravity', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasOpenAI: true,
      hasOpencodeZen: false,
      hasTmux: false,
    });

    expect(config.preset).toBe('openai');
    const agents = (config.presets as any).openai;
    expect(agents.orchestrator.model).toBe(
      MODEL_MAPPINGS.openai.orchestrator.model,
    );
    expect(agents.orchestrator.variant).toBeUndefined();
  });

  test('generateLiteConfig uses zen-free if no antigravity or openai', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasOpenAI: false,
      hasOpencodeZen: true,
      hasTmux: false,
    });

    expect(config.preset).toBe('zen-free');
    const agents = (config.presets as any)['zen-free'];
    expect(agents.orchestrator.model).toBe(
      MODEL_MAPPINGS['zen-free'].orchestrator.model,
    );
    expect(agents.orchestrator.variant).toBeUndefined();
  });

  test('generateLiteConfig enables tmux when requested', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: true,
    });

    expect(config.tmux).toBeDefined();
    expect((config.tmux as any).enabled).toBe(true);
  });

  test('generateLiteConfig includes default skills', () => {
    const config = generateLiteConfig({
      hasAntigravity: true,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: false,
    });

    const agents = (config.presets as any).antigravity;
    expect(agents.orchestrator.skills).toContain('*');
    expect(agents.fixer.skills).toBeDefined();
  });
});
