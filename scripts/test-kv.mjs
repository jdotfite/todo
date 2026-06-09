import { readFileSync } from 'node:fs';

// Load from .env
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const KV_URL = env.KV_REST_API_URL;
const KV_TOKEN = env.KV_REST_API_TOKEN;

if (!KV_URL || !KV_TOKEN) { console.error('Missing KV_REST_API_URL or KV_REST_API_TOKEN in .env'); process.exit(1); }

console.log('KV_URL length:', KV_URL.length, '| First char code:', KV_URL.charCodeAt(0), '(should be 104 for "h")');
console.log('KV_URL:', KV_URL);

async function kv(command, ...args) {
  const res = await fetch(KV_URL.trim(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([command.toUpperCase(), ...args]),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`KV ${command} ${res.status}: ${text}`);
  return JSON.parse(text);
}

try {
  console.log('\n--- Testing KV connection ---');
  const ping = await kv('ping');
  console.log('PING:', ping);

  const { result } = await kv('get', 'todo:store');
  if (!result) {
    console.log('\nKV store is EMPTY (no todo:store key)');
  } else {
    const store = typeof result === 'string' ? JSON.parse(result) : result;
    console.log('\nKV store contents:');
    console.log('  groceryItems:', store.groceryItems?.length ?? 0);
    console.log('  tasks:', store.tasks?.length ?? 0);
    console.log('  tipEntries:', store.tipEntries?.length ?? 0);
    console.log('  workEntries:', store.workEntries?.length ?? 0);
    if (store.groceryItems?.length) {
      console.log('\n  Grocery items:');
      store.groceryItems.forEach(i => console.log(`    [${i.checked ? 'x' : ' '}] ${i.quantity ? i.quantity + ' ' : ''}${i.title} (${i.category})`));
    }
  }
} catch (err) {
  console.error('\nKV ERROR:', err.message);
}
