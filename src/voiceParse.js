import OpenAI from 'openai';

let client;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const SYSTEM_PROMPTS = {
  work: `Extract work entry data from a voice transcript for a beauty services log.
Return JSON with only the fields you can find (omit the rest):
{"clientName":"string","serviceName":"string","revenue":0,"tipAmount":0,"tipType":""}
serviceName examples: IPL, Peel, Facial, Wax, Lash, Product, Other.
tipType must be one of: Cash, Tippy, Venmo, Other — or empty string.
revenue and tipAmount are plain numbers with no dollar sign.`,

  grocery: `Extract grocery items from a voice transcript.
Return JSON: {"items":[{"title":"string","quantity":"string","store":"walmart","category":"string"}]}
title is the item name only — no quantity prefix.
quantity is a short string like "2", "1 lb", "dozen" or empty string.
store is "walmart" (default) or "household".
category must be one of: produce, bakery, dairy, meat, frozen, pantry, beverages, household, personal care, pets, uncategorized.
bakery = bread, wraps, tortillas, rolls, bagels. pantry = canned goods, pasta, rice, condiments, snacks, chips.`,
};

const NORMALIZE_SYSTEM = `Convert grocery item titles to clean, concise generic names.
Rules:
- Remove brand names (bettergoods, Marketside, Great Value, Kirkland, store brands, etc.)
- Remove package size/count (Half Gallon, 12oz, 6 Count, 32oz, Pack, etc.)
- Remove leading/trailing commas or filler words
- Keep flavor and variety descriptors (Vanilla, Unsweetened, Low-Fat, Sharp, etc.)
- Short simple titles 3 words or fewer → keep as-is, just title-case them
- Use natural English order

Also assign category — one of: produce, bakery, dairy, meat, frozen, pantry, beverages, household, personal care, pets, uncategorized
(bakery = bread/wraps/tortillas/rolls/buns; pantry = canned goods/dry goods/condiments/snacks/chips)

Return JSON: {"items":[{"normalized":"...","category":"..."}]}
One entry per numbered input line, in the same order.`;

export async function normalizeGroceryItemsBatch(titles) {
  if (!titles.length) return [];
  const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const result = await getClient().chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: NORMALIZE_SYSTEM },
      { role: 'user', content: numbered },
    ],
  });
  let items = [];
  try {
    const parsed = JSON.parse(result.choices[0].message.content);
    const candidate = parsed.items ?? parsed.results ?? Object.values(parsed).find(v => Array.isArray(v));
    if (Array.isArray(candidate)) items = candidate;
  } catch { /* fall through — items stays [] and we return originals */ }
  return titles.map((t, i) => ({
    normalized: String(items[i]?.normalized || t).trim() || t,
    category: String(items[i]?.category || 'uncategorized').trim().toLowerCase(),
  }));
}

export async function normalizeGroceryItem(title) {
  const [result] = await normalizeGroceryItemsBatch([title]);
  return result;
}

export async function voiceParse(transcript, schema) {
  const system = SYSTEM_PROMPTS[schema];
  if (!system) throw Object.assign(new Error('Unknown schema'), { status: 400 });

  const result = await getClient().chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: transcript },
    ],
    max_tokens: 256,
  });

  return JSON.parse(result.choices[0].message.content);
}
