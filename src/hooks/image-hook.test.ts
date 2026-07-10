import { describe, expect, it } from 'bun:test';
import { processImageAttachments } from './image-hook';
import type { MessageWithParts } from './types';

function makeUserMsg(parts: MessageWithParts['parts']): MessageWithParts {
  return { info: { role: 'user', sessionID: 's1' }, parts };
}

const IMG = { type: 'image', url: 'data:image/png;base64,AAAA' };

describe('processImageAttachments', () => {
  it('direct mode leaves image parts untouched', () => {
    const msg = makeUserMsg([IMG]);
    processImageAttachments({
      messages: [msg],
      workDir: '/tmp/omos-image-hook-test',
      imageRouting: 'direct',
      disabledAgents: new Set<string>(),
      log: () => {},
    });
    expect(msg.parts.filter((p: any) => p.type === 'image')).toHaveLength(1);
  });

  it('auto mode strips image parts and adds an @observer nudge', () => {
    const msg = makeUserMsg([IMG]);
    processImageAttachments({
      messages: [msg],
      workDir: '/tmp/omos-image-hook-test',
      imageRouting: 'auto',
      disabledAgents: new Set<string>(),
      log: () => {},
    });
    expect(msg.parts.filter((p: any) => p.type === 'image')).toHaveLength(0);
    const textParts = msg.parts.filter((p: any) => p.type === 'text');
    expect(textParts.length).toBeGreaterThan(0);
    expect(textParts[0].text).toContain('@observer');
  });

  it('auto mode with observer disabled does not strip (defense in depth)', () => {
    const msg = makeUserMsg([IMG]);
    processImageAttachments({
      messages: [msg],
      workDir: '/tmp/omos-image-hook-test',
      imageRouting: 'auto',
      disabledAgents: new Set(['observer']),
      log: () => {},
    });
    expect(msg.parts.filter((p: any) => p.type === 'image')).toHaveLength(1);
  });

  it('direct mode with observer disabled leaves images untouched (default config, no regression)', () => {
    const msg = makeUserMsg([IMG]);
    processImageAttachments({
      messages: [msg],
      workDir: '/tmp/omos-image-hook-test',
      imageRouting: 'direct',
      disabledAgents: new Set(['observer']),
      log: () => {},
    });
    expect(msg.parts.filter((p: any) => p.type === 'image')).toHaveLength(1);
  });

  it('ignores non-user and non-image messages', () => {
    const userText = makeUserMsg([{ type: 'text', text: 'hello' }]);
    const assistant = {
      info: { role: 'assistant', sessionID: 's1' },
      parts: [{ type: 'text', text: 'hi' }],
    } as unknown as MessageWithParts;
    processImageAttachments({
      messages: [userText, assistant],
      workDir: '/tmp/omos-image-hook-test',
      imageRouting: 'auto',
      disabledAgents: new Set<string>(),
      log: () => {},
    });
    expect(userText.parts).toHaveLength(1);
    expect(assistant.parts).toHaveLength(1);
  });
});
