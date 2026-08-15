import { createOpencodeClient } from '@opencode-ai/sdk';

const client = createOpencodeClient({ baseUrl: 'http://localhost:4096' });
const dir = process.cwd();

const candidates = [
  { providerID: 'opencode', modelID: 'laguna-s-2.1-free' },
  { providerID: 'nvidia', modelID: 'minimax-m3' },
  { providerID: 'opencode-go', modelID: 'minimax-m3' },
  { providerID: 'opencode', modelID: 'deepseek-v4-flash-free' },
];

for (const m of candidates) {
  const session = await client.session.create({
    body: { title: 'model-test' },
    query: { directory: dir },
  });
  const timeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('60s timeout')), 60000),
  );
  const start = Date.now();
  try {
    const res = await Promise.race([
      client.session.prompt({
        path: { id: session.data.id },
        body: {
          parts: [
            { type: 'text', text: 'What is 2+2? Answer with just the number.' },
          ],
          model: m,
        },
        query: { directory: dir },
      }),
      timeout,
    ]);
    const txt =
      JSON.stringify(res).match(/"text":"([^"]*)"/)?.[1] ??
      JSON.stringify(res).slice(0, 120);
    console.log(
      `OK    ${m.providerID}/${m.modelID} (${Date.now() - start}ms): ${txt}`,
    );
  } catch (e) {
    console.log(
      `FAIL  ${m.providerID}/${m.modelID} (${Date.now() - start}ms): ${(e as Error).message}`,
    );
  }
  await client.session.delete({ path: { id: session.data.id } }).catch(() => {});
}
console.log('DONE');
