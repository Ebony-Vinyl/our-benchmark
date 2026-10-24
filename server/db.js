// 轻量 JSON 文件存储：内存 Map + 防抖落盘（原子写）。适合本应用的低写入量场景。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'server-data');
fs.mkdirSync(DATA_DIR, { recursive: true });

class Table {
  constructor(name) {
    this.file = path.join(DATA_DIR, name + '.json');
    this.rows = new Map();
    this._seq = 0;
    this._flushTimer = null;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      this._seq = data.seq || 0;
      for (const r of data.rows || []) this.rows.set(String(r.id), r);
    } catch { /* 首次运行 */ }
  }
  nextId() { return ++this._seq; }
  insert(row) {
    const id = String(this.nextId());
    row.id = id;
    row.createdAt = row.createdAt || new Date().toISOString();
    this.rows.set(id, row);
    this.flushSoon();
    return row;
  }
  get(id) { return this.rows.get(String(id)) || null; }
  all() { return [...this.rows.values()]; }
  update(id, patch) {
    const row = this.rows.get(String(id));
    if (!row) return null;
    Object.assign(row, patch);
    this.flushSoon();
    return row;
  }
  flushSoon() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => { this._flushTimer = null; this.flush(); }, 400);
  }
  flush() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ seq: this._seq, rows: this.all() }));
    fs.renameSync(tmp, this.file);
  }
}

const tables = {
  users: new Table('users'),
  scores: new Table('scores'),
  threads: new Table('threads'),
  posts: new Table('posts'),
};

// 服务器密钥（持久化，用于 token 签名）
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
function serverSecret() {
  try { return fs.readFileSync(SECRET_FILE, 'utf-8').trim(); }
  catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, s);
    return s;
  }
}

process.on('exit', () => { for (const t of Object.values(tables)) t.flush(); });
process.on('SIGINT', () => { for (const t of Object.values(tables)) t.flush(); process.exit(0); });
process.on('SIGTERM', () => { for (const t of Object.values(tables)) t.flush(); process.exit(0); });

module.exports = { tables, serverSecret, DATA_DIR };
