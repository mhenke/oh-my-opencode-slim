import { describe, expect, mock, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHandoffSessionTool, createReadSessionTool } from './tools';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omos-handoff-tool-'));
}

describe('handoff_session tool', () => {
  test('runs a worker child session and returns its handoff summary', async () => {
    const directory = makeTempDir();
    try {
      fs.mkdirSync(path.join(directory, 'src'));
      fs.writeFileSync(path.join(directory, 'src/index.ts'), 'export {}\n');

      const sessionCreate = mock(async () => ({ data: { id: 'ses_new' } }));
      const sessionPrompt = mock(async () => ({}));
      const sessionMessages = mock(async () => ({
        data: [
          {
            info: { role: 'assistant' },
            parts: [{ type: 'text', text: 'Summary from worker' }],
          },
        ],
      }));
      const sessionAbort = mock(async () => ({}));
      const tool = createHandoffSessionTool({
        directory,
        client: {
          session: {
            abort: sessionAbort,
            create: sessionCreate,
            messages: sessionMessages,
            prompt: sessionPrompt,
          },
        },
      } as any);

      const result = await tool.execute(
        { prompt: 'Continue implementation', files: ['src/index.ts'] },
        { sessionID: 'ses_old' } as any,
      );

      expect(result).toContain('task_id: ses_new');
      expect(result).toContain('<handoff_summary>');
      expect(result).toContain('Summary from worker');
      expect(sessionCreate).toHaveBeenCalledWith({
        responseStyle: 'data',
        throwOnError: true,
        query: { directory },
        body: {
          parentID: 'ses_old',
          title: 'Handoff worker from ses_old',
        },
      });
      expect(sessionPrompt).toHaveBeenCalledTimes(1);
      const promptCall = sessionPrompt.mock.calls[0]?.[0] as {
        path: { id: string };
        body: {
          agent: string;
          parts: Array<Record<string, unknown>>;
          tools?: Record<string, boolean>;
        };
      };
      expect(promptCall.path.id).toBe('ses_new');
      expect(promptCall.body.agent).toBe('orchestrator');
      expect(promptCall.body.tools).toBeUndefined();
      expect(promptCall.body.parts[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining(
          'Work on behalf of parent session ses_old',
        ),
      });
      expect(promptCall.body.parts).toContainEqual(
        expect.objectContaining({ synthetic: true, type: 'text' }),
      );
      expect(sessionMessages).toHaveBeenCalledWith({
        path: { id: 'ses_new' },
        query: { directory },
      });
      expect(sessionAbort).toHaveBeenCalledWith({
        path: { id: 'ses_new' },
        query: { directory },
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('blocks nested handoff calls from a handoff worker', async () => {
    const directory = makeTempDir();
    try {
      let nestedResult = '';
      const tool = createHandoffSessionTool({
        directory,
        client: {
          session: {
            abort: mock(async () => ({})),
            create: mock(async () => ({ data: { id: 'ses_handoff' } })),
            messages: mock(async () => ({
              data: [
                {
                  info: { role: 'assistant' },
                  parts: [{ type: 'text', text: 'done' }],
                },
              ],
            })),
            prompt: mock(async () => {
              nestedResult = String(
                await tool.execute({ prompt: 'nested handoff' }, {
                  sessionID: 'ses_handoff',
                } as any),
              );
            }),
          },
        },
      } as any);

      await tool.execute({ prompt: 'outer handoff' }, {
        sessionID: 'ses_old',
      } as any);

      expect(nestedResult).toContain('Nested handoff is disabled');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('read_session tool', () => {
  test('formats session transcripts', async () => {
    const messages = mock(async () => ({
      data: [
        { info: { role: 'user' }, parts: [{ type: 'text', text: 'Hi' }] },
        {
          info: { role: 'assistant' },
          parts: [
            { type: 'text', text: 'Hello' },
            {
              type: 'tool',
              tool: 'read',
              state: { status: 'completed', title: 'Read file' },
            },
          ],
        },
      ],
    }));
    const tool = createReadSessionTool({ session: { messages } } as any);

    const result = await tool.execute({ sessionID: 'ses_old' }, {} as any);

    expect(result).toContain('## User');
    expect(result).toContain('Hi');
    expect(result).toContain('## Assistant');
    expect(result).toContain('[Tool: read] Read file');
  });
});
