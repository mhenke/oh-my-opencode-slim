/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { generateLiteConfig, MODEL_MAPPINGS } from "./providers"

describe("providers", () => {
  test("generateLiteConfig generates antigravity config by default", () => {
    const config = generateLiteConfig({
      hasAntigravity: true,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: false,
    })

    expect(config.agents).toBeDefined()
    const agents = config.agents as any
    expect(agents.orchestrator.model).toBe(MODEL_MAPPINGS.antigravity.orchestrator)
    expect(agents.fixer.model).toBe(MODEL_MAPPINGS.antigravity.fixer)
  })

  test("generateLiteConfig overrides oracle with openai if available and antigravity is used", () => {
    const config = generateLiteConfig({
      hasAntigravity: true,
      hasOpenAI: true,
      hasOpencodeZen: false,
      hasTmux: false,
    })

    const agents = config.agents as any
    expect(agents.orchestrator.model).toBe(MODEL_MAPPINGS.antigravity.orchestrator)
    expect(agents.oracle.model).toBe(MODEL_MAPPINGS.openai.oracle)
  })

  test("generateLiteConfig uses openai if no antigravity", () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasOpenAI: true,
      hasOpencodeZen: false,
      hasTmux: false,
    })

    const agents = config.agents as any
    expect(agents.orchestrator.model).toBe(MODEL_MAPPINGS.openai.orchestrator)
  })

  test("generateLiteConfig uses opencode zen if no antigravity or openai", () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasOpenAI: false,
      hasOpencodeZen: true,
      hasTmux: false,
    })

    const agents = config.agents as any
    expect(agents.orchestrator.model).toBe(MODEL_MAPPINGS.opencode.orchestrator)
  })

  test("generateLiteConfig enables tmux when requested", () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: true,
    })

    expect(config.tmux).toBeDefined()
    expect((config.tmux as any).enabled).toBe(true)
  })

  test("generateLiteConfig includes default skills", () => {
    const config = generateLiteConfig({
      hasAntigravity: true,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: false,
    })

    const agents = config.agents as any
    expect(agents.orchestrator.skills).toContain("*")
    expect(agents.fixer.skills).toBeDefined()
  })
})
