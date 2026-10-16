import { describe, expect, test } from 'bun:test';
import type { PluginInput } from '@opencode-ai/plugin';
import type { AgentDefinition } from '../../agents/orchestrator';
import type { RuntimeConfig } from '../../config/runtime';
import {
  buildChainGeneration,
  type ModelChainEntry,
  selectDelegatedModel,
} from './chain-generation';
import { ForegroundFallbackManager } from './index';

// buildChainGeneration reads only `rt.modelArrays`; the tests stub the rest.
const asRuntimeConfig = (modelArrays: Record<string, ModelChainEntry[]>) =>
  ({ modelArrays }) as RuntimeConfig;
// selectDelegatedModel/buildChainGeneration read only name/_modelArray.
const asAgentDefinition = (name: string, modelArray?: ModelChainEntry[]) =>
  ({ name, _modelArray: modelArray }) as AgentDefinition;

const chain = (...ids: string[]): ModelChainEntry[] =>
  ids.map((id) => ({ id }));

describe('buildChainGeneration', () => {
  test('configured modelArrays win and entries are copied with variants', () => {
    const table = buildChainGeneration(
      asRuntimeConfig({
        orch: [{ id: 'a/one' }, { id: 'a/two', variant: 'x' }],
      }),
      [],
      undefined,
    );
    expect(table.orch).toEqual([
      { id: 'a/one' },
      { id: 'a/two', variant: 'x' },
    ]);
    expect(table.orch).not.toBe([]);
  });

  test('empty configured chains are omitted', () => {
    const table = buildChainGeneration(
      asRuntimeConfig({ orch: [] }),
      [],
      undefined,
    );
    expect(table.orch).toBeUndefined();
  });

  test('definition _modelArray fills names missing from modelArrays only when it has backups', () => {
    const defs = [
      asAgentDefinition('explorer', chain('b/one', 'b/two')),
      asAgentDefinition('solo', chain('b/only')),
      asAgentDefinition('empty', []),
    ];
    const table = buildChainGeneration(
      asRuntimeConfig({ orch: chain('a/one') }),
      defs,
      undefined,
    );
    expect(table.explorer).toEqual([{ id: 'b/one' }, { id: 'b/two' }]);
    expect(table.solo).toBeUndefined();
    expect(table.empty).toBeUndefined();
  });

  test('candidates fill remaining names outside the definition set only when they have backups', () => {
    const defs = [asAgentDefinition('orch', chain('a/one', 'a/two'))];
    const table = buildChainGeneration(
      asRuntimeConfig({ orch: chain('a/one', 'a/two') }),
      defs,
      {
        orch: chain('a/override'),
        marketplace: chain('c/one', 'c/two'),
        alias: chain('c/solo'),
      },
    );
    expect(table.orch).toEqual([{ id: 'a/one' }, { id: 'a/two' }]);
    expect(table.marketplace).toEqual([{ id: 'c/one' }, { id: 'c/two' }]);
    expect(table.alias).toBeUndefined();
  });
});

describe('selectDelegatedModel', () => {
  const down = (...providers: string[]) => ({
    model: 'x/current',
    downProviders: new Set(providers),
  });

  test('no parent model → undefined', () => {
    expect(
      selectDelegatedModel({
        agentName: 'explorer',
        childChain: chain('a/one', 'b/two'),
        followsParent: false,
        parentModel: undefined,
        activeFallback: down('a'),
      }),
    ).toBeUndefined();
  });

  test('independent child without active fallback → undefined', () => {
    expect(
      selectDelegatedModel({
        agentName: 'explorer',
        childChain: chain('a/one', 'b/two'),
        followsParent: false,
        parentModel: 'a/one',
        activeFallback: undefined,
      }),
    ).toBeUndefined();
  });

  test('empty child chain → undefined', () => {
    expect(
      selectDelegatedModel({
        agentName: 'explorer',
        childChain: [],
        followsParent: false,
        parentModel: 'a/one',
        activeFallback: down('a'),
      }),
    ).toBeUndefined();
  });

  test('inherited child follows the parent live model', () => {
    expect(
      selectDelegatedModel({
        agentName: 'explorer',
        childChain: chain('b/nine'),
        followsParent: true,
        parentModel: 'a/one',
        activeFallback: undefined,
      }),
    ).toEqual({
      agentName: 'explorer',
      entry: { id: 'a/one' },
      inherited: true,
    });
  });

  test('inherited child matches the parent model when present in its chain', () => {
    expect(
      selectDelegatedModel({
        agentName: 'explorer',
        childChain: chain('a/one', 'a/two'),
        followsParent: true,
        parentModel: 'a/two',
        activeFallback: undefined,
      }),
    ).toEqual({
      agentName: 'explorer',
      entry: { id: 'a/two' },
      inherited: true,
    });
  });

  test('independent child skips the down primary provider', () => {
    expect(
      selectDelegatedModel({
        agentName: 'explorer',
        childChain: chain('a/one', 'b/two', 'c/three'),
        followsParent: false,
        parentModel: 'a/one',
        activeFallback: down('a'),
      }),
    ).toEqual({ agentName: 'explorer', entry: { id: 'b/two' } });
  });

  test('independent child with every provider down → undefined', () => {
    expect(
      selectDelegatedModel({
        agentName: 'explorer',
        childChain: chain('a/one', 'a/two'),
        followsParent: false,
        parentModel: 'a/one',
        activeFallback: down('a'),
      }),
    ).toBeUndefined();
  });
});

describe('publishChainGeneration (manager)', () => {
  test('swaps contents in place, deletes retired keys, disables switched agents without an inheritance source', () => {
    const table: Record<string, ModelChainEntry[]> = {
      orch: [{ id: 'a/one' }],
      gone: [{ id: 'a/two' }],
    };
    const manager = new ForegroundFallbackManager(
      table,
      false,
      // Test stub: publish/disable paths touch only ctx.directory via logging.
      { directory: '/test' } as unknown as PluginInput,
      0,
    );
    manager.publishChainGeneration(
      { orch: [{ id: 'a/nine' }], fresh: [{ id: 'b/one', variant: 'v' }] },
      (name) => (name === 'orch' ? 'inheritance-source' : undefined),
      (name) => name === 'fresh',
    );
    expect(table.orch).toEqual([{ id: 'a/nine' }]);
    expect(table.gone).toBeUndefined();
    // Switched + no inheritance source → disableChain empties the chain.
    expect(table.fresh).toEqual([]);
  });

  test('keeps switched agents that still have an inheritance source', () => {
    const table: Record<string, ModelChainEntry[]> = {
      orch: [{ id: 'a/one' }],
    };
    const manager = new ForegroundFallbackManager(
      table,
      false,
      // Test stub: publish/disable paths touch only ctx.directory via logging.
      { directory: '/test' } as unknown as PluginInput,
      0,
    );
    manager.publishChainGeneration(
      { orch: [{ id: 'a/nine' }] },
      (name) => (name === 'orch' ? 'parent-model' : undefined),
      () => true,
    );
    expect(table.orch).toEqual([{ id: 'a/nine' }]);
  });
});
