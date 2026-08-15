import { createOpencodeClient } from '@opencode-ai/sdk';

const client = createOpencodeClient({ baseUrl: 'http://localhost:4096' });
const dir = process.argv[2] ?? process.cwd();

const status = await client.session.status({ query: { directory: dir } }).catch((e) => {
  console.log('status error:', e?.message ?? e);
  return null;
});
const ids = Object.keys(status?.data ?? {});
console.log(`Found ${ids.length} sessions in ${dir}`);

let ok = 0;
let fail = 0;
for (const id of ids) {
  const res = await client.session.delete({ path: { id } }).catch((e) => e);
  if (res?.error) {
    fail += 1;
    console.log(`FAIL  ${id}: ${JSON.stringify(res.error).slice(0, 80)}`);
  } else {
    ok += 1;
  }
}
console.log(`DONE: deleted ${ok}, failed ${fail}`);
