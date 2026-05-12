const express = require('express');
const router = express.Router();
const db = require('../services/db');
const ai = require('../services/ai');
const email = require('../services/email');
const stripeService = require('../services/stripe');
const jobs = require('../jobs/scheduler');

router.get('/dashboard', (req, res) => {
  const data = db.get();
  const mrr = db.getMRR();
  res.json({
    stats: {
      prospects: data.prospects.length,
      emailsSent: data.emails.length,
      replies: data.replies.length,
      clients: data.clients.filter(c => c.status === 'active').length,
      posts: data.posts.length,
      mrr, arr: mrr * 12
    },
    recentLogs: data.logs.slice(0, 20),
    pipeline: {
      prospects: data.prospects.length,
      emailed: data.prospects.filter(p => p.status === 'emailed').length,
      replied: data.prospects.filter(p => p.status === 'replied').length,
      clients: data.clients.filter(c => c.status === 'active').length,
      posts: data.posts.length
    }
  });
});

router.get('/prospects', (req, res) => {
  const data = db.get();
  res.json(data.prospects.slice().reverse());
});

router.post('/prospects/scan', async (req, res) => {
  const { city, niche } = req.body;
  if (!city || !niche) return res.status(400).json({ error: 'city and niche required' });
  try {
    const prospects = await ai.generateProspects(city, niche, 5);
    const saved = prospects.map(p => { p.city = city; p.niche = niche; return db.addProspect(p); });
    db.addLog(`Manual scan: found ${saved.length} ${niche}s in ${city}`, 'info');
    res.json({ found: saved.length, prospects: saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/generate', async (req, res) => {
  const { prospectId } = req.body;
  const data = db.get();
  const prospect = data.prospects.find(p => p.id == prospectId);
  if (!prospect) return res.status(404).json({ error: 'Prospect not found' });
  try {
    const emailContent = await ai.writeColdEmail(prospect, process.env.FROM_NAME || 'Alex');
    res.json({ ...emailContent, to: prospect.email, toName: prospect.name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/send', async (req, res) => {
  const { prospectId, subject, body } = req.body;
  const data = db.get();
  const prospect = data.prospects.find(p => p.id == prospectId);
  if (!prospect) return res.status(404).json({ error: 'Prospect not found' });
  try {
    const { canSend } = await email.checkDailyLimit();
    if (!canSend) return res.status(429).json({ error: 'Daily email limit reached' });
    await email.sendEmail({ to: prospect.email, toName: prospect.name, subject, body, prospectId });
    db.updateProspect(prospectId, { status: 'emailed', emailedAt: new Date().toISOString() });
    res.json({ success: true, message: `Email sent to ${prospect.name}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/run-all', async (req, res) => {
  res.json({ message: 'Outreach pipeline started' });
  jobs.runEmailOutreach().catch(e => console.error('Outreach error:', e));
});

router.get('/replies', (req, res) => {
  const data = db.get();
  res.json(data.replies.slice().reverse());
});

router.post('/replies/generate', async (req, res) => {
  const { prospectId, replyText, scenario } = req.body;
  const data = db.get();
  const prospect = data.prospects.find(p => p.id == prospectId) || {};
  try {
    const response = await ai.writeReply(prospect, replyText, scenario, process.env.FROM_NAME || 'Alex');
    res.json({ response });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/replies/log', async (req, res) => {
  const { prospectId, replyText, scenario, response } = req.body;
  const saved = db.addReply({ prospectId, replyText, scenario, response });
  if (prospectId) db.updateProspect(prospectId, { status: 'replied' });
  res.json(saved);
});

router.post('/replies/send', async (req, res) => {
  const { prospectId, body } = req.body;
  const data = db.get();
  const prospect = data.prospects.find(p => p.id == prospectId);
  if (!prospect) return res.status(404).json({ error: 'Prospect not found' });
  try {
    await email.sendReply({ to: prospect.email, toName: prospect.name, body });
    db.updateProspect(prospectId, { status: 'replied' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/posts', (req, res) => {
  const data = db.get();
  res.json(data.posts.slice().reverse());
});

router.post('/posts/generate', async (req, res) => {
  const { clientId } = req.body;
  const data = db.get();
  const client = data.clients.find(c => c.id == clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  try {
    const post = await ai.writeBlogPost(client);
    const saved = db.addPost({ ...post, clientId: client.id, client: client.name, suburb: client.suburb });
    res.json(saved);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/posts/generate-all', async (req, res) => {
  res.json({ message: 'Monthly content generation started' });
  jobs.runMonthlyContentGeneration().catch(e => console.error('Content error:', e));
});

router.get('/clients', (req, res) => {
  const data = db.get();
  res.json(data.clients);
});

router.post('/clients', (req, res) => {
  const { name, suburb, niche, plan, email: clientEmail } = req.body;
  if (!name || !plan) return res.status(400).json({ error: 'name and plan required' });
  const plans = { starter: 497, growth: 797, pro: 1497 };
  const client = db.addClient({ name, suburb, niche, plan, planLabel: plan.charAt(0).toUpperCase() + plan.slice(1), email: clientEmail, monthlyRevenue: plans[plan] || 497 });
  db.addLog(`New client added: ${name} — ${plan} ($${plans[plan]}/mo)`, 'success');
  res.json(client);
});

router.post('/stripe/checkout', async (req, res) => {
  const { clientData, plan } = req.body;
  if (!clientData || !plan) return res.status(400).json({ error: 'clientData and plan required' });
  try {
    const url = await stripeService.createCheckoutLink(clientData, plan);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/run/prospect-finder', async (req, res) => {
  res.json({ message: 'Prospect finder started' });
  jobs.runProspectFinder().catch(e => console.error(e));
});

router.post('/run/follow-ups', async (req, res) => {
  res.json({ message: 'Follow-up run started' });
  jobs.runFollowUps().catch(e => console.error(e));
});

router.get('/email/limit', async (req, res) => {
  const limit = await email.checkDailyLimit();
  res.json(limit);
});

router.post('/test/email', async (req, res) => {
  try {
    const result = await email.sendEmail({
      to: process.env.FROM_EMAIL,
      toName: 'Test',
      subject: 'ContentBoost test email',
      body: 'This is a test email from ContentBoost. If you receive this the system is working.',
      prospectId: null
    });
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, details: e.response?.data || null });
  }
});

module.exports = router;
