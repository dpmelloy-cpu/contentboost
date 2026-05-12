const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create all tables on startup if they don't exist
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prospects (
      id BIGSERIAL PRIMARY KEY,
      name TEXT, email TEXT UNIQUE, suburb TEXT, city TEXT, niche TEXT,
      phone TEXT, website TEXT, domain TEXT, seo_score INTEGER,
      issue TEXT, status TEXT DEFAULT 'prospect',
      emailed_at TIMESTAMP, followed_up BOOLEAN DEFAULT FALSE,
      followed_up_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS clients (
      id BIGSERIAL PRIMARY KEY,
      name TEXT, email TEXT, suburb TEXT, city TEXT, niche TEXT,
      plan TEXT, plan_label TEXT, monthly_revenue INTEGER,
      stripe_customer_id TEXT, stripe_subscription_id TEXT,
      status TEXT DEFAULT 'active', since TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS emails (
      id BIGSERIAL PRIMARY KEY,
      to_email TEXT, to_name TEXT, subject TEXT,
      prospect_id BIGINT, message_id TEXT, sent_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS replies (
      id BIGSERIAL PRIMARY KEY,
      prospect_id BIGINT, reply_text TEXT, scenario TEXT,
      response TEXT, received_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT, client TEXT, suburb TEXT,
      title TEXT, meta_description TEXT, body TEXT,
      keywords TEXT[], published_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS logs (
      id BIGSERIAL PRIMARY KEY,
      message TEXT, type TEXT, timestamp TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('Database tables ready');
}

function get() {
  return {
    prospects: [], clients: [], emails: [],
    replies: [], posts: [], logs: [],
    stats: { totalProspectsFound: 0, totalEmailsSent: 0, totalReplies: 0, totalPostsPublished: 0 }
  };
}

async function alreadyContacted(email, businessName) {
  try {
    const emailCheck = await pool.query(
      'SELECT id FROM prospects WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email || '']
    );
    if (emailCheck.rows.length > 0) return true;
    const nameCheck = await pool.query(
      'SELECT id FROM prospects WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [businessName || '']
    );
    if (nameCheck.rows.length > 0) return true;
    const clientCheck = await pool.query(
      'SELECT id FROM clients WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email || '']
    );
    return clientCheck.rows.length > 0;
  } catch (e) {
    console.error('alreadyContacted error:', e.message);
    return false;
  }
}

async function addProspect(prospect) {
  try {
    const already = await alreadyContacted(prospect.email, prospect.name);
    if (already) {
      console.log(`Skipping duplicate: ${prospect.name} (${prospect.email})`);
      return null;
    }
    const result = await pool.query(
      `INSERT INTO prospects (name, email, suburb, city, niche, phone, website, domain, seo_score, issue, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'prospect') RETURNING *`,
      [prospect.name, prospect.email, prospect.suburb, prospect.city, prospect.niche,
       prospect.phone, prospect.website, prospect.domain, prospect.seoScore, prospect.issue]
    );
    console.log(`Added prospect: ${prospect.name}`);
    return result.rows[0];
  } catch (e) {
    console.error('addProspect error:', e.message);
    return null;
  }
}

async function updateProspect(id, updates) {
  try {
    const fields = [];
    const values = [];
    let i = 1;
    if (updates.status) { fields.push(`status=$${i++}`); values.push(updates.status); }
    if (updates.emailedAt) { fields.push(`emailed_at=$${i++}`); values.push(updates.emailedAt); }
    if (updates.followedUp !== undefined) { fields.push(`followed_up=$${i++}`); values.push(updates.followedUp); }
    if (updates.followedUpAt) { fields.push(`followed_up_at=$${i++}`); values.push(updates.followedUpAt); }
    if (fields.length === 0) return;
    values.push(id);
    await pool.query(`UPDATE prospects SET ${fields.join(',')} WHERE id=$${i}`, values);
  } catch (e) {
    console.error('updateProspect error:', e.message);
  }
}

async function addClient(client) {
  try {
    const result = await pool.query(
      `INSERT INTO clients (name, email, suburb, city, niche, plan, plan_label, monthly_revenue, stripe_customer_id, stripe_subscription_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active') RETURNING *`,
      [client.name, client.email, client.suburb, client.city, client.niche,
       client.plan, client.planLabel, client.monthlyRevenue,
       client.stripeCustomerId, client.stripeSubscriptionId]
    );
    return result.rows[0];
  } catch (e) {
    console.error('addClient error:', e.message);
    return null;
  }
}

async function addEmail(email) {
  try {
    const result = await pool.query(
      `INSERT INTO emails (to_email, to_name, subject, prospect_id, message_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [email.to, email.toName, email.subject, email.prospectId, email.messageId]
    );
    return result.rows[0];
  } catch (e) {
    console.error('addEmail error:', e.message);
    return null;
  }
}

async function addReply(reply) {
  try {
    const result = await pool.query(
      `INSERT INTO replies (prospect_id, reply_text, scenario, response)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [reply.prospectId, reply.replyText, reply.scenario, reply.response]
    );
    return result.rows[0];
  } catch (e) {
    console.error('addReply error:', e.message);
    return null;
  }
}

async function addPost(post) {
  try {
    const result = await pool.query(
      `INSERT INTO posts (client_id, client, suburb, title, meta_description, body, keywords)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [post.clientId, post.client, post.suburb, post.title,
       post.metaDescription, post.body, post.keywords || []]
    );
    return result.rows[0];
  } catch (e) {
    console.error('addPost error:', e.message);
    return null;
  }
}

async function addLog(message, type) {
  try {
    await pool.query(
      'INSERT INTO logs (message, type) VALUES ($1,$2)',
      [message, type || 'info']
    );
  } catch (e) {
    console.error('addLog error:', e.message);
  }
}

async function getMRR() {
  try {
    const result = await pool.query(
      `SELECT SUM(monthly_revenue) as mrr FROM clients WHERE status='active'`
    );
    return parseInt(result.rows[0].mrr) || 0;
  } catch (e) {
    return 0;
  }
}

async function getStats() {
  try {
    const prospects = await pool.query('SELECT COUNT(*) FROM prospects');
    const emails = await pool.query('SELECT COUNT(*) FROM emails');
    const replies = await pool.query('SELECT COUNT(*) FROM replies');
    const clients = await pool.query(`SELECT COUNT(*) FROM clients WHERE status='active'`);
    const posts = await pool.query('SELECT COUNT(*) FROM posts');
    const mrr = await getMRR();
    return {
      prospects: parseInt(prospects.rows[0].count),
      emailsSent: parseInt(emails.rows[0].count),
      replies: parseInt(replies.rows[0].count),
      clients: parseInt(clients.rows[0].count),
      posts: parseInt(posts.rows[0].count),
      mrr,
      arr: mrr * 12
    };
  } catch (e) {
    console.error('getStats error:', e.message);
    return { prospects:0, emailsSent:0, replies:0, clients:0, posts:0, mrr:0, arr:0 };
  }
}

async function getProspects() {
  try {
    const result = await pool.query('SELECT * FROM prospects ORDER BY created_at DESC LIMIT 500');
    return result.rows;
  } catch (e) { return []; }
}

async function getClients() {
  try {
    const result = await pool.query(`SELECT * FROM clients WHERE status='active' ORDER BY since DESC`);
    return result.rows;
  } catch (e) { return []; }
}

async function getUncontactedProspects(limit) {
  try {
    const result = await pool.query(
      `SELECT * FROM prospects WHERE status='prospect' ORDER BY created_at ASC LIMIT $1`,
      [limit || 15]
    );
    return result.rows;
  } catch (e) { return []; }
}

async function getProspectsNeedingFollowUp() {
  try {
    const result = await pool.query(
      `SELECT * FROM prospects 
       WHERE status='emailed' 
       AND followed_up=FALSE 
       AND emailed_at < NOW() - INTERVAL '5 days'
       LIMIT 10`
    );
    return result.rows;
  } catch (e) { return []; }
}

async function getRecentLogs(limit) {
  try {
    const result = await pool.query(
      'SELECT * FROM logs ORDER BY timestamp DESC LIMIT $1',
      [limit || 20]
    );
    return result.rows;
  } catch (e) { return []; }
}

async function getDailyEmailCount() {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM emails WHERE sent_at > NOW() - INTERVAL '24 hours'`
    );
    return parseInt(result.rows[0].count) || 0;
  } catch (e) { return 0; }
}

async function scheduleNextDelivery(clientId) {
  try {
    const nextDelivery = new Date();
    nextDelivery.setMonth(nextDelivery.getMonth() + 1);
    await pool.query(
      'UPDATE clients SET next_delivery=$1 WHERE id=$2',
      [nextDelivery.toISOString(), clientId]
    );
  } catch (e) {
    console.error('scheduleNextDelivery error:', e.message);
  }
}

async function getClientsDueForContent() {
  try {
    const result = await pool.query(
      `SELECT * FROM clients 
       WHERE status='active' 
       AND (next_delivery IS NULL OR next_delivery <= NOW())
       ORDER BY since ASC`
    );
    return result.rows;
  } catch (e) {
    console.error('getClientsDueForContent error:', e.message);
    return [];
  }
}

module.exports = {
  initDB, get, alreadyContacted, addProspect, updateProspect,
  addClient, addEmail, addReply, addPost, addLog,
  getMRR, getStats, getProspects, getClients,
  getUncontactedProspects, getProspectsNeedingFollowUp,
  getRecentLogs, getDailyEmailCount,
  scheduleNextDelivery, getClientsDueForContent
};
