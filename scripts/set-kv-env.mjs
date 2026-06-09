// Sets KV_REST_API_URL and KV_REST_API_TOKEN on the todo Vercel project via REST API
const VERCEL_TOKEN = 'vca_6bQt7wzUQ5oQZEsdLWw6evg9UJEtJbra3xrZgzhsGcitf2qGNF058kWl';
const TEAM_ID = 'team_zYz1YPwLK5hLBjsfy82A8vSs';
const PROJECT_NAME = 'todo';

const KV_URL = 'https://noted-opossum-143465.upstash.io';
const KV_TOKEN = 'gQAAAAAAAjBpAAIgcDE3OGEyM2RlMjRjODM0ZTQ5YmRlYjdlNGM1NzdmMGRkMg';

// Sanity check — no BOM
if (KV_URL.charCodeAt(0) !== 104) { console.error('BOM detected in KV_URL!'); process.exit(1); }
console.log('KV_URL first char code:', KV_URL.charCodeAt(0), '(104 = h ✓)');

async function getProjectId() {
  const r = await fetch(`https://api.vercel.com/v9/projects/${PROJECT_NAME}?teamId=${TEAM_ID}`, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  });
  if (!r.ok) throw new Error(`Get project failed: ${r.status} ${await r.text()}`);
  const { id } = await r.json();
  console.log('Project ID:', id);
  return id;
}

async function upsertEnvVar(projectId, name, value) {
  // First try to list existing to get the env var ID
  const listRes = await fetch(
    `https://api.vercel.com/v9/projects/${projectId}/env?teamId=${TEAM_ID}&target=production`,
    { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
  );
  const { envs } = await listRes.json();
  const existing = envs?.find(e => e.key === name && e.target?.includes('production'));

  if (existing) {
    // Update existing
    const r = await fetch(
      `https://api.vercel.com/v9/projects/${projectId}/env/${existing.id}?teamId=${TEAM_ID}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, target: ['production'] }),
      }
    );
    if (!r.ok) throw new Error(`Update ${name} failed: ${r.status} ${await r.text()}`);
    console.log(`Updated ${name} ✓`);
  } else {
    // Create new
    const r = await fetch(
      `https://api.vercel.com/v9/projects/${projectId}/env?teamId=${TEAM_ID}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: name, value, type: 'encrypted', target: ['production'] }),
      }
    );
    if (!r.ok) throw new Error(`Create ${name} failed: ${r.status} ${await r.text()}`);
    console.log(`Created ${name} ✓`);
  }
}

const projectId = await getProjectId();
await upsertEnvVar(projectId, 'KV_REST_API_URL', KV_URL);
await upsertEnvVar(projectId, 'KV_REST_API_TOKEN', KV_TOKEN);

console.log('\nDone. Trigger a new deployment for changes to take effect.');
