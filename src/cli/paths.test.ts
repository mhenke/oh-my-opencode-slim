/// <reference types="bun-types" />

import { describe, expect, test, afterEach } from "bun:test"
import {
  getConfigDir,
  getOpenCodeConfigPaths,
  getConfigJson,
  getConfigJsonc,
  getLiteConfig,
  getExistingConfigPath,
  ensureConfigDir,
} from "./paths"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, rmSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"

describe("paths", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test("getConfigDir() uses XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-config"
    expect(getConfigDir()).toBe("/tmp/xdg-config/opencode")
  })

  test("getConfigDir() falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
    delete process.env.XDG_CONFIG_HOME
    const expected = join(homedir(), ".config", "opencode")
    expect(getConfigDir()).toBe(expected)
  })

  test("getOpenCodeConfigPaths() returns both json and jsonc paths", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-config"
    expect(getOpenCodeConfigPaths()).toEqual([
      "/tmp/xdg-config/opencode/opencode.json",
      "/tmp/xdg-config/opencode/opencode.jsonc",
    ])
  })

  test("getConfigJson() returns correct path", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-config"
    expect(getConfigJson()).toBe("/tmp/xdg-config/opencode/opencode.json")
  })

  test("getConfigJsonc() returns correct path", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-config"
    expect(getConfigJsonc()).toBe("/tmp/xdg-config/opencode/opencode.jsonc")
  })

  test("getLiteConfig() returns correct path", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-config"
    expect(getLiteConfig()).toBe("/tmp/xdg-config/opencode/oh-my-opencode-slim.json")
  })

  describe("getExistingConfigPath()", () => {
    let tmpDir: string

    afterEach(() => {
      if (tmpDir && existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    test("returns .json if it exists", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "opencode-test-"))
      process.env.XDG_CONFIG_HOME = tmpDir
      
      const configDir = join(tmpDir, "opencode")
      ensureConfigDir()
      
      const jsonPath = join(configDir, "opencode.json")
      writeFileSync(jsonPath, "{}")
      
      expect(getExistingConfigPath()).toBe(jsonPath)
    })

    test("returns .jsonc if .json doesn't exist but .jsonc does", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "opencode-test-"))
      process.env.XDG_CONFIG_HOME = tmpDir
      
      const configDir = join(tmpDir, "opencode")
      ensureConfigDir()
      
      const jsoncPath = join(configDir, "opencode.jsonc")
      writeFileSync(jsoncPath, "{}")
      
      expect(getExistingConfigPath()).toBe(jsoncPath)
    })

    test("returns default .json if neither exists", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "opencode-test-"))
      process.env.XDG_CONFIG_HOME = tmpDir
      
      const jsonPath = join(tmpDir, "opencode", "opencode.json")
      expect(getExistingConfigPath()).toBe(jsonPath)
    })
  })

  test("ensureConfigDir() creates directory if it doesn't exist", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "opencode-test-"))
    process.env.XDG_CONFIG_HOME = tmpDir
    const configDir = join(tmpDir, "opencode")
    
    expect(existsSync(configDir)).toBe(false)
    ensureConfigDir()
    expect(existsSync(configDir)).toBe(true)
    
    rmSync(tmpDir, { recursive: true, force: true })
  })
})
