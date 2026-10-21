import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
// Provider calls are paid even in guest mode. Neither a new cookie nor a restart resets the budget.
export function createSearchBudget({ perHour = 12, perDay = 200, now = Date.now, file = null } = {}) {
  const clients = new Map();
  let day = -1, total = 0;
  let valid = true;
  if (file) {
    try {
      const state = JSON.parse(readFileSync(file, 'utf8'));
      if (!Number.isInteger(state.day) || !Number.isInteger(state.total) || state.total < 0 || !Array.isArray(state.clients) || state.clients.length > 2000) throw Error('Invalid budget');
      day = state.day; total = state.total;
      for (const [key, record] of state.clients) {
        if (!/^[a-f0-9]{64}$/.test(key) || !Number.isFinite(record.start) || !Number.isInteger(record.count) || record.count < 0) throw Error('Invalid budget record');
        clients.set(key, record);
      }
    } catch (error) { if (error.code !== 'ENOENT') valid = false; }
  }
  return client => {
    if (!valid) return false;
    client = createHash('sha256').update(client).digest('hex');
    const time = now(), currentDay = Math.floor(time / 86400000);
    if (day !== currentDay) { day = currentDay; total = 0; }
    for (const [key, record] of clients) if (time - record.start >= 3600000) clients.delete(key);
    const record = clients.get(client) || { start: time, count: 0 };
    if (total >= perDay || record.count >= perHour || (!clients.has(client) && clients.size >= 2000)) return false;
    record.count++; total++; clients.set(client, record);
    if (file) {
      try {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        const temporary = file + '.tmp';
        writeFileSync(temporary, JSON.stringify({ day, total, clients: [...clients] }), { mode: 0o600 });
        renameSync(temporary, file);
      } catch { valid = false; return false; }
    }
    return true;
  };
}
