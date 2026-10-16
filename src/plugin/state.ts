import type {
  RegistryHostSnapshot,
  ResolvedAgentRegistry,
} from '../agents/registry';
import type { V2PermissionRule } from '../v2/types';

/**
 * Membership rule: a binding joins this holder only when read or written by
 * >= 2 extraction units; unit-local bindings stay unit-local.
 */
export interface PluginState {
  /** Set inside try; read by prompt hooks and post-catch wiring (:389). */
  readonly hostFlavor: { value: string | undefined };
  /** Dispose handler sets; hooks read via isDisposed (:390, :2567, :1149). */
  readonly instanceDisposed: { value: boolean };
  /** registryBridge.retire() sets (:1913); consumers gate on it. */
  readonly registryRetired: { value: boolean };
  /** config hook writes (:2235); built-in MCP pruning reads (:386). */
  readonly injectedMcps: { value: Record<string, unknown> };
  /** v2.setInterviewService writes (:2130); submit tool reads. */
  readonly interviewSubmitService: { value: unknown };
  /** Registry finalize/refresh write; delegation + v2 bridges read. */
  readonly resolvedAgentRegistry: { value: ResolvedAgentRegistry | undefined };
  readonly latestHostSnapshot: { value: RegistryHostSnapshot | undefined };
  readonly hostSnapshotProvenance: { value: 'unknown' | 'clean' };
  readonly latestNativePermissionsByAgent: {
    value: Readonly<Record<string, readonly V2PermissionRule[]>>;
  };
}

export function createPluginState(): PluginState {
  return {
    hostFlavor: { value: undefined },
    instanceDisposed: { value: false },
    registryRetired: { value: false },
    injectedMcps: { value: {} },
    interviewSubmitService: { value: undefined },
    resolvedAgentRegistry: { value: undefined },
    latestHostSnapshot: { value: undefined },
    hostSnapshotProvenance: { value: 'unknown' },
    latestNativePermissionsByAgent: { value: {} },
  };
}
