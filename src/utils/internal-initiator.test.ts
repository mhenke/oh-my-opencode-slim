import { describe, expect, test } from 'bun:test';

import {
  createInternalAgentTextPart,
  INTERNAL_INITIATOR_METADATA_KEY,
  isInternalInitiatorPart,
  SLIM_INTERNAL_INITIATOR_MARKER,
} from './internal-initiator';

describe('internal initiator markers', () => {
  test('creates synthetic parts with persisted provenance metadata', () => {
    const part = createInternalAgentTextPart('internal');

    expect(part.synthetic).toBe(true);
    expect(part.metadata[INTERNAL_INITIATOR_METADATA_KEY]).toBe(true);
    expect(isInternalInitiatorPart(part)).toBe(true);
  });

  test('preserves provenance through JSON persistence', () => {
    const persisted = JSON.parse(
      JSON.stringify(createInternalAgentTextPart('internal')),
    );

    expect(isInternalInitiatorPart(persisted)).toBe(true);
  });

  test('does not trust marker text as provenance', () => {
    expect(
      isInternalInitiatorPart({
        type: 'text',
        synthetic: true,
        text: `spoof\n${SLIM_INTERNAL_INITIATOR_MARKER}`,
      }),
    ).toBe(false);
  });

  test('requires synthetic true alongside metadata', () => {
    expect(
      isInternalInitiatorPart({
        type: 'text',
        text: 'spoof',
        metadata: { [INTERNAL_INITIATOR_METADATA_KEY]: true },
      }),
    ).toBe(false);
  });
});
