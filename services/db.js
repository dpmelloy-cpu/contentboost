const fs = require('fs-extra');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/db.json');

const DEFAULT_DB = {
  prospects: [], clients: [], emails: [], replies: [], posts: [], logs: [],
  stats: { totalProspectsFound: 0, totalEmailsSent: 0, totalReplies: 0, totalPostsPublished: 0 }
};

function load() {
  try {
    fs.ensureDirSync(path.dirname(DB_PATH));
    if (!fs.existsSync(DB_PATH)) fs.writeJsonSync(DB_PATH, DEFAULT_DB, { spaces: 2 });
    return fs.readJsonSync(DB_PATH);
  } catch (e) { return { ...DEFAULT_DB }; }
}

function save(data) {
  try { fs.ensureDirSync(path.dirname(DB_PATH)); fs.writeJsonSync(DB_PATH, data, { spaces: 2 }); }
  catch (e) { console.error('DB save error:', e.message); }
}

function get() { return load(); }

function addProspect(prospect) {
  const db = load();
  prospect.id = Date.now() + Math.random();
  prospect.createdAt = new Date().toISOString();
  prospect.status = 'prospect';
  db.prospects.push(prospect);
  db.stats.totalProspectsFound++;
  save(db); return prospect;
}

function updateProspect(id, updates) {
  const db = load();
  const idx = db.prospects.findIndex(p => p.id == id);
  if (idx !== -1) { db.prospects[idx] = { ...db.prospects[idx], ...updates }; save(db); }
  return db.prospects[idx];
}

function addClient(client) {
  const db = load();
  client.id = Date.now() + Math.random();
  client.since = new Date().toISOString();
  client.status = 'active';
  db.clients.push(client);
  save(db); return client;
}

function addEmail(email) {
  const db = load();
  email.id = Date.now() + Math.random();
  email.sentAt = new Date().toISOString();
  db.emails.push(email);
  db.stats.totalEmailsSent++;
  save(db); return email;
}

function addReply(reply) {
  const db = load();
  reply.id = Date.now() + Math.random();
  reply.receivedAt = new Date().toISOString();
  db.replies.push(reply);
  db.stats.totalReplies++;
  save(db); return reply;
}

function addPost(post) {
  const db = load();
  post.id = Date.now() + Math.random();
  post.publishedAt = new Date().toISOString();
  db.posts.push(post);
  db.stats.totalPostsPublished++;
  save(db); return post;
}

function addLog(message, type = 'info') {
  const db = load();
  db.logs.unshift({ message, type, timestamp: new Date().toISOString() });
  if (db.logs.length > 200) db.logs = db.logs.slice(0, 200);
  save(db);
}

function getMRR() {
  const db = load();
  const plans = { starter: 497, growth: 797, pro: 1497 };
  return db.clients.filter(c => c.status === 'active').reduce((sum, c) => sum + (plans[c.plan] || 0), 0);
}

module.exports = { get, addProspect, updateProspect, addClient, addEmail, addReply, addPost, addLog, getMRR };
