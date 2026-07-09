import { isRecord } from './guards';

export const SLIM_INTERNAL_INITIATOR_MARKER =
  '<!-- SLIM_INTERNAL_INITIATOR -->';

const INTERNAL_INITIATOR_BRAND = Symbol('slim.internalInitiatorPart');

export function createInternalAgentTextPart(text: string): {
  type: 'text';
  text: string;
  synthetic: true;
} {
  const part = {
    type: 'text',
    synthetic: true,
    text: `${text}\n${SLIM_INTERNAL_INITIATOR_MARKER}`,
  } as const;
  Object.defineProperty(part, INTERNAL_INITIATOR_BRAND, {
    enumerable: true,
    value: true,
  });
  return part;
}

export function hasInternalInitiatorMarker(part: unknown): boolean {
  if (!isRecord(part) || part.type !== 'text') {
    return false;
  }

  if (typeof part.text !== 'string') {
    return false;
  }

  return part.text.includes(SLIM_INTERNAL_INITIATOR_MARKER);
}

export function isBrandedInternalInitiatorPart(part: unknown): boolean {
  if (!isRecord(part) || part.type !== 'text') {
    return false;
  }

  return (
    (part as Record<PropertyKey, unknown>)[INTERNAL_INITIATOR_BRAND] === true
  );
}
