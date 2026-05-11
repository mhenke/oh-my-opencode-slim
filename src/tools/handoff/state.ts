export interface HandoffState {
  markSession(sessionID: string, sourceSessionID: string): void;
  unmarkSession(sessionID: string): void;
  isHandoffSession(sessionID: string): boolean;
  sourceFor(sessionID: string): string | undefined;
}

export function createHandoffState(): HandoffState {
  const sourceBySession = new Map<string, string>();

  return {
    markSession(sessionID: string, sourceSessionID: string): void {
      sourceBySession.set(sessionID, sourceSessionID);
    },
    unmarkSession(sessionID: string): void {
      sourceBySession.delete(sessionID);
    },
    isHandoffSession(sessionID: string): boolean {
      return sourceBySession.has(sessionID);
    },
    sourceFor(sessionID: string): string | undefined {
      return sourceBySession.get(sessionID);
    },
  };
}
