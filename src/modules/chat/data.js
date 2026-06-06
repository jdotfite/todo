import { nanoid } from 'nanoid';
import { nowIso, readStore, writeStore } from '../../db.js';

const VALID_PROFILE_IDS = new Set(['family', 'justin', 'kari', 'cohen', 'hudson']);
const PROFILE_ALIAS = { wife: 'kari' };

function normalizeThread(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: String(row.title || '').trim(),
    pinned: Boolean(row.pinned),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    threadId: row.threadId,
    profileId: VALID_PROFILE_IDS.has(row.profileId) ? row.profileId : 'family',
    body: String(row.body || '').trim(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeProfileId(profileId) {
  const id = PROFILE_ALIAS[profileId] || profileId;
  return VALID_PROFILE_IDS.has(id) ? id : 'family';
}

function readKey(threadId, profileId) {
  return `${threadId}:${normalizeProfileId(profileId)}`;
}

function normalizeRead(row) {
  if (!row || !row.threadId) return null;
  return {
    threadId: row.threadId,
    profileId: normalizeProfileId(row.profileId),
    lastReadAt: row.lastReadAt,
  };
}

function validateReadBoundary(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw apiError('Invalid read timestamp', 400);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw apiError('Invalid read timestamp', 400);
  if (value > nowIso()) throw apiError('Read timestamp cannot be in the future', 400);
  return value;
}

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// --- Threads ---

export async function listThreads(options = {}) {
  const profileId = normalizeProfileId(options.profileId);
  const store = await readStore();
  const threads = (store.chatThreads || []).map(normalizeThread).filter(Boolean);
  const messages = store.chatMessages || [];
  const reads = new Map(
    (store.chatReads || [])
      .map(normalizeRead)
      .filter(Boolean)
      .map(r => [readKey(r.threadId, r.profileId), r.lastReadAt])
  );

  return threads
    .map(t => {
      const threadMessages = messages
        .filter(m => m.threadId === t.id)
        .map(normalizeMessage)
        .filter(Boolean)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const lastMessage = threadMessages[0] || null;
      const lastReadAt = reads.get(readKey(t.id, profileId)) || null;
      const unreadCount = threadMessages.filter(m =>
        m.profileId !== profileId && (!lastReadAt || m.createdAt > lastReadAt)
      ).length;
      return {
        ...t,
        messageCount: threadMessages.length,
        lastMessageAt: lastMessage?.createdAt || t.createdAt,
        lastMessage: lastMessage ? {
          body: lastMessage.body,
          profileId: lastMessage.profileId,
          createdAt: lastMessage.createdAt,
        } : null,
        unreadCount,
        hasUnread: unreadCount > 0,
        lastReadAt,
      };
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    });
}

export async function createThread(input = {}) {
  const title = String(input.title || '').trim();
  if (!title) throw apiError('title is required', 400);
  if (title.length > 120) throw apiError('title must be 120 characters or fewer', 400);

  const timestamp = nowIso();
  const thread = normalizeThread({
    id: nanoid(12),
    title,
    pinned: Boolean(input.pinned),
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const store = await readStore();
  store.chatThreads = store.chatThreads || [];
  store.chatThreads.push(thread);
  await writeStore(store);
  return thread;
}

export async function updateThread(id, input = {}) {
  const store = await readStore();
  const index = (store.chatThreads || []).findIndex(t => t.id === id);
  if (index === -1) throw apiError('Thread not found', 404);

  const current = store.chatThreads[index];
  const title = input.title !== undefined ? String(input.title).trim() : current.title;
  if (!title) throw apiError('title is required', 400);
  if (title.length > 120) throw apiError('title must be 120 characters or fewer', 400);

  const updated = normalizeThread({
    ...current,
    title,
    pinned: input.pinned !== undefined ? Boolean(input.pinned) : current.pinned,
    updatedAt: nowIso(),
  });
  store.chatThreads[index] = updated;
  await writeStore(store);
  return updated;
}

export async function deleteThread(id) {
  const store = await readStore();
  const before = (store.chatThreads || []).length;
  store.chatThreads = (store.chatThreads || []).filter(t => t.id !== id);
  if (store.chatThreads.length === before) throw apiError('Thread not found', 404);
  store.chatMessages = (store.chatMessages || []).filter(m => m.threadId !== id);
  store.chatReads = (store.chatReads || []).filter(r => r.threadId !== id);
  await writeStore(store);
  return { removed: 1 };
}

// --- Messages ---

export async function listMessages(threadId) {
  const store = await readStore();
  const thread = (store.chatThreads || []).find(t => t.id === threadId);
  if (!thread) throw apiError('Thread not found', 404);

  return (store.chatMessages || [])
    .map(normalizeMessage)
    .filter(m => m && m.threadId === threadId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function postMessage(threadId, input = {}) {
  const store = await readStore();
  const thread = (store.chatThreads || []).find(t => t.id === threadId);
  if (!thread) throw apiError('Thread not found', 404);

  const body = String(input.body || '').trim();
  if (!body) throw apiError('body is required', 400);
  if (body.length > 2000) throw apiError('body must be 2000 characters or fewer', 400);

  const profileId = VALID_PROFILE_IDS.has(input.profileId) ? input.profileId : 'family';
  const timestamp = nowIso();
  const message = normalizeMessage({
    id: nanoid(12),
    threadId,
    profileId,
    body,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  store.chatMessages = store.chatMessages || [];
  store.chatMessages.push(message);
  store.chatThreads = (store.chatThreads || []).map(t =>
    t.id === threadId ? { ...t, updatedAt: timestamp } : t
  );
  await writeStore(store);
  return message;
}

export async function deleteMessage(threadId, messageId) {
  const store = await readStore();
  const thread = (store.chatThreads || []).find(t => t.id === threadId);
  if (!thread) throw apiError('Thread not found', 404);

  const before = (store.chatMessages || []).length;
  store.chatMessages = (store.chatMessages || []).filter(
    m => !(m.id === messageId && m.threadId === threadId)
  );
  if (store.chatMessages.length === before) throw apiError('Message not found', 404);
  await writeStore(store);
  return { removed: 1 };
}

export async function markThreadRead(threadId, profileId = 'family', options = {}) {
  const store = await readStore();
  const thread = (store.chatThreads || []).find(t => t.id === threadId);
  if (!thread) throw apiError('Thread not found', 404);

  const normalizedProfileId = normalizeProfileId(profileId);
  const key = readKey(threadId, normalizedProfileId);
  const existing = (store.chatReads || []).findIndex(r => readKey(r.threadId, r.profileId) === key);
  const existingRead = existing === -1 ? null : normalizeRead(store.chatReads[existing]);
  const requestedBoundary = validateReadBoundary(options.lastReadAt);
  const requestedLastReadAt = requestedBoundary || nowIso();
  const timestamp = existingRead?.lastReadAt && existingRead.lastReadAt > requestedLastReadAt
    ? existingRead.lastReadAt
    : requestedLastReadAt;
  const nextRead = { threadId, profileId: normalizedProfileId, lastReadAt: timestamp };
  store.chatReads = store.chatReads || [];
  if (existing === -1) store.chatReads.push(nextRead);
  else store.chatReads[existing] = nextRead;
  await writeStore(store);
  return nextRead;
}

export async function getRecentMessages(limit = 5) {
  const store = await readStore();
  const threadTitles = new Map((store.chatThreads || []).map(t => [t.id, String(t.title || '').trim()]));
  return (store.chatMessages || [])
    .map(m => normalizeMessage(m))
    .filter(m => m && threadTitles.has(m.threadId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map(m => ({ ...m, threadTitle: threadTitles.get(m.threadId) }));
}
