export interface PendingTaskCall {
  callId: string;
  parentSessionId: string;
  agentType: string;
  label: string;
  resumedTaskId?: string;
}

const MAX_PENDING_TASK_CALLS = 100;

export interface PendingCallTracker {
  add(call: PendingTaskCall): void;
  take(callId?: string, parentSessionId?: string): PendingTaskCall | undefined;
  firstForParent(parentSessionId: string): string | undefined;
  clearSession(sessionId: string): void;
  pendingCallId(sessionID?: string, callID?: string): string;
}

export function createPendingCallTracker(): PendingCallTracker {
  const pendingCalls = new Map<string, PendingTaskCall>();
  const pendingCallOrder: string[] = [];
  let anonymousPendingCallId = 0;

  const firstForParent = (parentSessionId: string) => {
    return pendingCallOrder.find(
      (id) => pendingCalls.get(id)?.parentSessionId === parentSessionId,
    );
  };

  const take = (callId?: string, parentSessionId?: string) => {
    const resolvedCallId =
      callId ?? (parentSessionId ? firstForParent(parentSessionId) : undefined);
    if (!resolvedCallId) return undefined;
    const pending = pendingCalls.get(resolvedCallId);
    pendingCalls.delete(resolvedCallId);
    const orderIndex = pendingCallOrder.indexOf(resolvedCallId);
    if (orderIndex >= 0) {
      pendingCallOrder.splice(orderIndex, 1);
    }
    return pending;
  };

  const clearSession = (sessionId: string) => {
    const toRemove: string[] = [];
    for (const [callId, pending] of pendingCalls.entries()) {
      if (pending.parentSessionId === sessionId) {
        toRemove.push(callId);
      }
    }
    for (const id of toRemove) {
      take(id);
    }
  };

  return {
    add(call: PendingTaskCall) {
      const existingIndex = pendingCallOrder.indexOf(call.callId);
      if (existingIndex >= 0) {
        pendingCallOrder.splice(existingIndex, 1);
      }
      pendingCalls.set(call.callId, call);
      pendingCallOrder.push(call.callId);
      while (pendingCallOrder.length > MAX_PENDING_TASK_CALLS) {
        const evictedCallId = pendingCallOrder.shift();
        if (!evictedCallId) break;
        pendingCalls.delete(evictedCallId);
      }
    },

    take,

    firstForParent,

    clearSession,

    pendingCallId(sessionID?: string, callID?: string) {
      return (
        callID ??
        `${sessionID ?? 'unknown'}:anonymous-${++anonymousPendingCallId}`
      );
    },
  };
}
