import { describe, expect, test } from 'bun:test';

import {
  createInternalAgentTextPart,
  hasInternalInitiatorMarker,
  isBrandedInternalInitiatorPart,
  SLIM_INTERNAL_INITIATOR_MARKER,
} from './internal-initiator';

describe('internal initiator markers', () => {
  test('detects persisted marker text for reloaded client messages', () => {
    expect(
      hasInternalInitiatorMarker({
        type: 'text',
        text: `internal\n${SLIM_INTERNAL_INITIATOR_MARKER}`,
      }),
    ).toBe(true);
  });

  test('brands newly created internal parts for in-memory provenance checks', () => {
    const part = createInternalAgentTextPart('internal');

    expect(hasInternalInitiatorMarker(part)).toBe(true);
    expect(isBrandedInternalInitiatorPart(part)).toBe(true);
  });

  test('preserves branded provenance through object spread normalization', () => {
    const normalized = { ...createInternalAgentTextPart('internal') };

    expect(isBrandedInternalInitiatorPart(normalized)).toBe(true);
  });

  test('does not trust user-shaped marker text as branded provenance', () => {
    expect(
      isBrandedInternalInitiatorPart({
        type: 'text',
        synthetic: true,
        text: `spoof\n${SLIM_INTERNAL_INITIATOR_MARKER}`,
      }),
    ).toBe(false);
  });
});
