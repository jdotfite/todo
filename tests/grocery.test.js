import test from 'node:test';
import assert from 'node:assert/strict';
import { resetForTests } from '../src/db.js';
import { createGroceryItem, listGroceryItems, updateGroceryItem, clearCheckedGroceryItems, quickAdd } from '../src/grocery.js';

test('grocery items can be created, listed, checked, and cleared', async () => {
  await resetForTests();
  const milk = await createGroceryItem({ title: 'milk', store: 'walmart', quantity: '2' });
  await createGroceryItem({ title: 'bananas', category: 'produce' });

  let items = await listGroceryItems();
  assert.equal(items.length, 2);
  const milkItem = items.find(i => i.title === 'milk');
  assert.ok(milkItem, 'milk item should exist');
  assert.equal(milkItem.store, 'walmart');
  assert.equal(milkItem.quantity, '2');
  assert.equal(milkItem.checked, false);

  const checked = await updateGroceryItem(milk.id, { checked: true });
  assert.equal(checked.checked, true);

  const cleared = await clearCheckedGroceryItems();
  assert.equal(cleared.removed, 1);
  items = await listGroceryItems();
  assert.deepEqual(items.map(i => i.title), ['bananas']);
});

test('quickAdd routes grocery and walmart text to grocery items', async () => {
  await resetForTests();

  const walmart = await quickAdd('walmart 2 paper towels');
  const grocery = await quickAdd('grocery bananas x2');
  const todo = await quickAdd('tomorrow call dentist');

  assert.equal(walmart.type, 'grocery');
  assert.equal(walmart.item.store, 'walmart');
  assert.equal(walmart.item.quantity, '2');
  assert.equal(walmart.item.title, 'paper towels');
  assert.equal(grocery.item.title, 'bananas');
  assert.equal(grocery.item.quantity, '2');
  assert.equal(todo.type, 'task');
  assert.equal(todo.task.title, 'call dentist');
  assert.ok(todo.task.dueDate);
});

test('recent checked grocery items can be listed and re-added', async () => {
  await resetForTests();

  const milk = await createGroceryItem({ title: 'milk', quantity: '2', category: 'dairy' });
  const bananas = await createGroceryItem({ title: 'bananas', category: 'produce' });
  await updateGroceryItem(milk.id, { checked: true });

  const { listRecentGroceryItems, readdGroceryItem } = await import('../src/grocery.js');
  let recent = await listRecentGroceryItems();
  assert.deepEqual(recent.map(i => i.title), ['milk']);

  const readded = await readdGroceryItem(milk.id);
  assert.equal(readded.title, 'milk');
  assert.equal(readded.quantity, '2');
  assert.equal(readded.category, 'dairy');
  assert.equal(readded.checked, false);

  recent = await listGroceryItems({ checked: 'false' });
  assert.deepEqual(recent.map(i => i.title), ['milk', 'bananas']);
});

test('checked grocery items can be removed from quick re-add history', async () => {
  await resetForTests();

  const mistaken = await createGroceryItem({ title: 'milk', quantity: '2', category: 'dairy' });
  const keep = await createGroceryItem({ title: 'bananas', category: 'produce' });
  await updateGroceryItem(mistaken.id, { checked: true });
  await updateGroceryItem(keep.id, { checked: true });

  const { deleteGroceryItem, listRecentGroceryItems } = await import('../src/grocery.js');
  const removed = await deleteGroceryItem(mistaken.id);
  assert.equal(removed.removed, 1);

  const recent = await listRecentGroceryItems();
  assert.deepEqual(recent.map(i => `${i.quantity ? i.quantity + ' ' : ''}${i.title}`), ['bananas']);
});
