const cron = require('node-cron');
const db = require('../services/db');
const ai = require('../services/ai');
const email = require('../services/email');

const senderName = process.env.FROM_NAME || 'Alex';

async function runProspectFinder() {
  console.log('Running prospect finder...');
  const cities = (process.env.AUTO_SCAN_CITIES || 'Brisbane').split(',').map(c => c.trim());
  const niches = (process.env.AUTO_SCAN_NICHES || 'plumber').split(',').map(n => n.trim());
  for (const city of cities) {
    for (const niche of niches) {
      try {
        const prospects = await ai.generateProspects(city, niche, 10);
        for (const p of prospects) {
          p.city = city; p.niche = niche;
          db.addProspect(p);
        }
        console.log(`Found ${prospects.length} ${niche}s in ${city}`);
        await sleep(3000);
      } catch (e) {
        console.error(`Finder error (${niche}/${city}):`, e.message);
        db.addLog(`Finder error ${niche}/${city}: ${e.message}`, 'error');
      }
    }
  }
  db.addLog('Prospect scan completed', 'info');
}

async function runEmailOutreach() {
  console.log('Running email outreach...');
  const { canSend, remaining } = await email.checkDailyLimit();
  if (!canSend) { console.log('Daily limit reached'); return; }
  const dbData = db.get();
  const uncontacted = dbData.prospects
    .filter(p => p.status === 'prospect')
    .slice(0, Math.min(remaining, 15));
  for (const prospect of uncontacted) {
    try {
      const { subject, body } = await ai.writeColdEmail(prospect, senderName);
      await email.sendEmail({ to: prospect.email, toName: prospect.name, subject, body, prospectId: prospect.id });
      db.updateProspect(prospect.id, { status: 'emailed', emailedAt: new Date().toISOString() });
      console.log(`Emailed: ${prospect.name}`);
      await sleep(4000);
    } catch (e) {
      console.error(`Email error (${prospect.name}):`, e.message);
      db.addLog(`Email failed for ${prospect.name}: ${e.message}`, 'error');
    }
  }
  db.addLog('Outreach run complete', 'info');
}

async function runFollowUps() {
  console.log('Running follow-ups...');
  const dbData = db.get();
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const needsFollowUp = dbData.prospects.filter(p =>
    p.status === 'emailed' && !p.followedUp && new Date(p.emailedAt) < fiveDaysAgo
  ).slice(0, 10);
  for (const prospect of needsFollowUp) {
    try {
      const { subject, body } = await ai.writeFollowUp(prospect, senderName);
      await email.sendEmail({ to: prospect.email, toName: prospect.name, subject, body, prospectId: prospect.id });
      db.updateProspect(prospect.id, { followedUp: true, followedUpAt: new Date().toISOString() });
      console.log(`Follow-up sent: ${prospect.name}`);
      await sleep(4000);
    } catch (e) {
      console.error(`Follow-up error (${prospect.name}):`, e.message);
    }
  }
  if (needsFollowUp.length > 0) db.addLog(`Follow-ups sent: ${needsFollowUp.length}`, 'info');
}

async function runMonthlyContentGeneration() {
  console.log('Generating monthly content...');
  const dbData = db.get();
  const activeClients = dbData.clients.filter(c => c.status === 'active');
  for (const client of activeClients) {
    try {
      const postsPerMonth = { starter: 2, growth: 4, pro: 8 }[client.plan] || 2;
      const generatedPosts = [];
      for (let i = 0; i < postsPerMonth; i++) {
        const post = await ai.writeBlogPost(client);
        const saved = db.addPost({ ...post, clientId: client.id, client: client.name, suburb: client.suburb });
        generatedPosts.push(saved);
        await sleep(2000);
      }
      const reportBody = await ai.writeMonthlyReport(client, generatedPosts);
      await email.sendMonthlyReport({ to: client.email, toName: client.name, body: reportBody });
      db.addLog(`Monthly content delivered to ${client.name}`, 'success');
    } catch (e) {
      console.error(`Content error (${client.name}):`, e.message);
      db.addLog(`Content failed for ${client.name}: ${e.message}`, 'error');
    }
  }
}

function startScheduler() {
  console.log('Starting ContentBoost scheduler...');

  // Every 30 minutes 24/7 — find new prospects constantly
  cron.schedule('*/15 * * * *', () => {
    runProspectFinder().catch(e => console.error('Finder failed:', e));
  }, { timezone: 'Australia/Brisbane' });

  // Every 20 minutes 7am-8pm 7 days — send emails all day
  cron.schedule('*/10 6-21 * * *', () => {
    runEmailOutreach().catch(e => console.error('Outreach failed:', e));
  }, { timezone: 'Australia/Brisbane' });

  // Every 2 hours — follow-ups
  cron.schedule('0 */2 * * *', () => {
    runFollowUps().catch(e => console.error('Follow-up failed:', e));
  }, { timezone: 'Australia/Brisbane' });

  // 1st of month 7am — monthly content for all clients
  cron.schedule('0 7 1 * *', () => {
    runMonthlyContentGeneration().catch(e => console.error('Content failed:', e));
  }, { timezone: 'Australia/Brisbane' });

  // Run immediately on startup
  setTimeout(() => runProspectFinder().catch(console.error), 5000);
  setTimeout(() => runEmailOutreach().catch(console.error), 35000);

  console.log('Scheduler active:');
  console.log('  Every 30min 24/7     -> Find new prospects');
  console.log('  Every 20min 7am-8pm  -> Send cold emails');
  console.log('  Every 2 hours        -> Send follow-ups');
  console.log('  1st of month 7am     -> Deliver monthly content');
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

module.exports = { startScheduler, runProspectFinder, runEmailOutreach, runFollowUps, runMonthlyContentGeneration };
