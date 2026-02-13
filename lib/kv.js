// ═══════════════════════════════════════════════════════════════════
//  KV wrapper — Uses Redis (ioredis) via KV_REDIS_URL
//  Drop-in replacement for @vercel/kv with get/set/del interface
// ═══════════════════════════════════════════════════════════════════

const Redis = require('ioredis');

let client = null;

function getClient() {
  if (!client) {
    const url = process.env.KV_REDIS_URL;
    if (!url) throw new Error('KV_REDIS_URL not set');
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      commandTimeout: 5000,
      lazyConnect: true,
    });
  }
  return client;
}

const kv = {
  async get(key) {
    const redis = getClient();
    const val = await redis.get(key);
    if (val === null) return null;
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  },

  async set(key, value, options) {
    const redis = getClient();
    if (options && options.ex) {
      await redis.set(key, JSON.stringify(value), 'EX', options.ex);
    } else {
      await redis.set(key, JSON.stringify(value));
    }
  },

  async del(key) {
    const redis = getClient();
    await redis.del(key);
  },
};

module.exports = { kv };
