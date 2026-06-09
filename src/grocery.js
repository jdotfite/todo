import { nanoid } from 'nanoid';
import { nowIso, readStore, todayIsoDate, writeStore } from './db.js';
import { createTask } from './tasks.js';

function normalizeItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    title: item.title,
    quantity: item.quantity || '',
    store: item.store || 'walmart',
    category: item.category || 'uncategorized',
    checked: Boolean(item.checked),
    addedBy: item.addedBy || '',
    source: item.source || 'app',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    checkedAt: item.checkedAt || null,
  };
}

function ensureGrocery(store) {
  if (!Array.isArray(store.groceryItems)) store.groceryItems = [];
  return store.groceryItems;
}

function parseQuantity(title) {
  const raw = String(title).trim();
  const suffix = raw.match(/^(.+?)\s+(?:x\s*)?(\d+(?:\.\d+)?)$/i);
  if (suffix) return { quantity: suffix[2], title: suffix[1].trim() };
  const match = raw.match(/^(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+)$/i);
  if (!match) return { quantity: '', title: raw };
  const words = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
  return { quantity: words[match[1].toLowerCase()] || match[1], title: match[2].trim() };
}

function guessCategory(title) {
  const s = title.toLowerCase();
  if (/banana|apple|lettuce|tomato|onion|potato|berry|berries|produce|carrot|spinach|broccoli|pepper|mushroom|avocado|orange|grape|lemon|lime|celery|cucumber|zucchini|garlic|kale|corn|peas?$/.test(s)) return 'produce';
  if (/wrap|tortilla|bread|pita|naan|biscuit|bagel|croissant|\broll\b|\bbun\b|flatbread/.test(s)) return 'bakery';
  if (/milk|cheese|yogurt|butter|cream|egg/.test(s)) return 'dairy';
  if (/chicken|beef|pork|turkey|salmon|tuna|shrimp|steak|ground |sausage|bacon|\bham\b|lamb|tilapia|cod|deli|lunch meat|hot dog/.test(s)) return 'meat';
  if (/pasta|rice|noodle|oatmeal|\boat\b|cereal|flour|sugar|\bsalt\b|\boil\b|vinegar|sauce|ketchup|mustard|mayo|salsa|dressing|broth|canned|lentil|quinoa|chip|cracker|cookie|popcorn|pretzel|granola|candy|chocolate/.test(s)) return 'pantry';
  if (/water|juice|soda|coffee|\btea\b|lemonade|gatorade|energy drink|wine|beer|kombucha/.test(s)) return 'beverages';
  if (/nugget|pizza|frozen|ice cream|waffle|burrito|tater tot/.test(s)) return 'frozen';
  if (/towel|toilet|soap|detergent|trash bag|garbage bag|foil|sponge|bleach|lysol|laundry|dishwasher/.test(s)) return 'household';
  if (/shampoo|toothpaste|toothbrush|deodorant|razor|lotion|sunscreen|vitamin|bandage|tampon|feminine/.test(s)) return 'personal care';
  if (/dog|cat|pet|kibble|litter/.test(s)) return 'pets';
  return 'uncategorized';
}

export async function createGroceryItem(input) {
  const parsed = parseQuantity(input.title || '');
  const title = String(parsed.title || '').trim();
  if (!title) throw Object.assign(new Error('Grocery item title is required'), { status: 400 });
  const timestamp = nowIso();
  const item = {
    id: nanoid(12),
    title,
    quantity: String(input.quantity || parsed.quantity || '').trim(),
    store: String(input.store || 'walmart').trim().toLowerCase() || 'walmart',
    category: String(input.category || guessCategory(title)).trim().toLowerCase() || 'uncategorized',
    checked: Boolean(input.checked),
    addedBy: String(input.addedBy || '').trim(),
    source: String(input.source || 'app').trim().toLowerCase() || 'app',
    createdAt: timestamp,
    updatedAt: timestamp,
    checkedAt: input.checked ? timestamp : null,
  };
  const store = await readStore();
  ensureGrocery(store).push(item);
  await writeStore(store);
  return normalizeItem(item);
}

export async function listGroceryItems(filters = {}) {
  let items = ensureGrocery(await readStore()).map(normalizeItem);
  if (filters.checked !== undefined) items = items.filter(i => i.checked === (filters.checked === true || filters.checked === 'true'));
  if (filters.store) items = items.filter(i => i.store === String(filters.store).toLowerCase());
  if (filters.category) items = items.filter(i => i.category === String(filters.category).toLowerCase());
  return items.sort((a, b) => Number(a.checked) - Number(b.checked) || a.category.localeCompare(b.category) || a.createdAt.localeCompare(b.createdAt));
}

export async function listRecentGroceryItems(limit = 8) {
  const seen = new Set();
  return ensureGrocery(await readStore())
    .map(normalizeItem)
    .filter(item => item.checked)
    .sort((a, b) => String(b.checkedAt || b.updatedAt || '').localeCompare(String(a.checkedAt || a.updatedAt || '')))
    .filter(item => {
      const key = `${item.store}|${item.category}|${item.quantity}|${item.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Number(limit) || 8);
}

export async function readdGroceryItem(id) {
  const original = ensureGrocery(await readStore()).map(normalizeItem).find(item => item.id === id);
  if (!original) throw Object.assign(new Error('Grocery item not found'), { status: 404 });
  return createGroceryItem({
    title: original.title,
    quantity: original.quantity,
    store: original.store,
    category: original.category,
    addedBy: original.addedBy,
    source: 'readd',
  });
}

export async function updateGroceryItem(id, patch) {
  const store = await readStore();
  const items = ensureGrocery(store);
  const item = items.find(i => i.id === id);
  if (!item) throw Object.assign(new Error('Grocery item not found'), { status: 404 });
  for (const key of ['title', 'quantity', 'store', 'category', 'addedBy', 'source']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) item[key] = String(patch[key] || '').trim().toLowerCase();
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'title')) item.title = String(patch.title || '').trim();
  if (Object.prototype.hasOwnProperty.call(patch, 'checked')) {
    item.checked = Boolean(patch.checked);
    item.checkedAt = item.checked ? nowIso() : null;
  }
  item.updatedAt = nowIso();
  await writeStore(store);
  return normalizeItem(item);
}

export async function clearCheckedGroceryItems() {
  const store = await readStore();
  const before = ensureGrocery(store).length;
  store.groceryItems = store.groceryItems.filter(i => !i.checked);
  await writeStore(store);
  return { removed: before - store.groceryItems.length };
}

export async function deleteGroceryItem(id) {
  const store = await readStore();
  const before = ensureGrocery(store).length;
  store.groceryItems = store.groceryItems.filter(i => i.id !== id);
  if (store.groceryItems.length === before) throw Object.assign(new Error('Grocery item not found'), { status: 404 });
  await writeStore(store);
  return { removed: before - store.groceryItems.length };
}

function tomorrow() {
  const d = new Date(`${todayIsoDate()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function quickAdd(text, options = {}) {
  let raw = String(text || '').trim();
  if (!raw) throw Object.assign(new Error('Text is required'), { status: 400 });
  const lower = raw.toLowerCase();
  if (lower.startsWith('walmart ') || lower.startsWith('grocery ')) {
    const store = lower.startsWith('walmart ') ? 'walmart' : (options.store || 'walmart');
    raw = raw.replace(/^(walmart|grocery)\s+/i, '');
    return { type: 'grocery', item: await createGroceryItem({ title: raw, store, source: options.source || 'quick-add', addedBy: options.addedBy || '' }) };
  }
  let dueDate = null;
  if (lower.startsWith('tomorrow ')) {
    raw = raw.replace(/^tomorrow\s+/i, '');
    dueDate = tomorrow();
  }
  return { type: 'task', task: await createTask({ title: raw, dueDate, project: options.project || 'inbox' }) };
}
