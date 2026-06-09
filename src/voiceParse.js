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
