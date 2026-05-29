import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('alexa interaction model includes todo and grocery intents', () => {
  assert.ok(existsSync('docs/alexa/interaction-model.json'));
  const model = JSON.parse(readFileSync('docs/alexa/interaction-model.json', 'utf8'));
  const intents = model.interactionModel.languageModel.intents.map(intent => intent.name);
  assert.ok(intents.includes('AddGroceryItemIntent'));
  assert.ok(intents.includes('AddTodoIntent'));
  assert.ok(intents.includes('ListGroceryIntent'));
  assert.ok(intents.includes('ListTodosIntent'));
  const groceryIntent = model.interactionModel.languageModel.intents.find(intent => intent.name === 'AddGroceryItemIntent');
  assert.ok(groceryIntent.samples.some(sample => sample.includes('{Item}')));
});

test('deployment guide documents vercel kv and alexa token setup', () => {
  assert.ok(existsSync('docs/deploy.md'));
  const guide = readFileSync('docs/deploy.md', 'utf8');
  assert.match(guide, /KV_REST_API_URL/);
  assert.match(guide, /KV_REST_API_TOKEN/);
  assert.match(guide, /ALEXA_API_TOKEN/);
  assert.match(guide, /\/api\/alexa/);
});
