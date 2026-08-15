import { createOpencodeClient } from '@opencode-ai/sdk';

const client = createOpencodeClient({ baseUrl: 'http://localhost:4096' });
const dir = process.cwd();

const session = await client.session.create({
  body: { title: 'smoke-test' },
  query: { directory: dir },
});
const start = Date.now();
const timeout = new Promise((_, rej) =>
  setTimeout(() => rej(new Error('90s timeout')), 90000),
);
try {
  const res = await Promise.race([
    client.session.prompt({
      path: { id: session.data.id },
      body: {
        parts: [{ type: 'text', text: 'What is 2+2? Answer with just the number.' }],
      },
      query: { directory: dir },
    }),
    timeout,
  ]);
  console.log(`OK (${Date.now() - start}ms):`);
  console.log(JSON.stringify(res, null, 2).slice(0, 2000));
} catch (e) {
  console.log(`FAIL (${Date.now() - start}ms): ${(e as Error).message}`);
}
await client.session
  .delete({ path: { id: session.data.id } })
  .catch(() => {});
console.log('DONE');
