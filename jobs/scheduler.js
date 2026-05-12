const cron = require('node-cron');
const db = require('../services/db');
const ai = require('../services/ai');
const email = require('../services/email');

const senderName = process.env.FROM_NAME || 'Alex';

async function runProspectFinder() {
  console.log('Running prospect finder...');
  const citiesRaw = process.env.AUTO_SCAN_CITIES || 'Brisbane';
  const nichesRaw = process.env.AUTO_SCAN_NICHES || 'plumber';
  const cities = citiesRaw.split(',').map(c => c.trim()).filter(Boolean);
  const niches = nichesRaw.split(',').map(n => n.trim()).filter(Boolean);
  console.log(`Scanning ${cities.length} cities x ${niches.length} niches`);
  for (const city of cities) {
    for (const niche of niches) {
      try {
        const prospects = await ai.generateProspects(city, niche, 10);
        let added = 0;
        for (const p of prospects) {
          p.city = city; p.niche = niche;
          const saved = await db.addProspect(p);
          if (saved) added++;
        }
        console.log(`${city} ${niche}: ${added} new prospects added`);
        await sleep(2000);
      } catch (e) {
        console.error(`Finder error (${niche}/${city}):`, e.message);
        await db.addLog(`Finder error ${niche}/${city}: ${e.message}`, 'error');
      }
    }
  }
  await db.addLog('Prospect scan completed', 'info');
}

async function runEmailOutreach() {
  console.log('Running email outreach...');
  const sentToday = await db.getDailyEmailCount();
  const limit = parseInt(process.env.DAILY_EMAIL_LIMIT) || 280;
  const remaining = Math.max(0, limit - sentToday);
  if (remaining === 0) { console.log('Daily limit reached'); return; }
  const uncontacted = await db.getUncontactedProspects(Math.min(remaining, 15));
  console.log(`Sending to ${uncontacted.length} prospects...`);
  for (const prospect of uncontacted) {
    try {
      const { subject, body } = await ai.writeColdEmail(prospect, senderName);
      await email.sendEmail({
        to: prospect.email,
        toName: prospect.name,
        subject, body,
        prospectId: prospect.id
      });
      await db.updateProspect(prospect.id, {
        status: 'emailed',
        emailedAt: new Date().toISOString()
      });
      console.log(`Emailed: ${prospect.name}`);
      await sleep(4000);
    } catch (e) {
      console.error(`Email error (${prospect.name}):`, e.message);
      await db.addLog(`Email failed for ${prospect.name}: ${e.message}`, 'error');
    }
  }
  await db.addLog(`Outreach run complete`, 'info');
}

async function runFollowUps() {
  console.log('Running follow-ups...');
  const needsFollowUp = await db.getProspectsNeedingFollowUp();
  for (const prospect of needsFollowUp) {
    try {
      const { subject, body } = await ai.writeFollowUp(prospect, senderName);
      await email.sendEmail({
        to: prospect.email,
        toName: prospect.name,
        subject, body,
        prospectId: prospect.id
      });
      await db.updateProspect(prospect.id, {
        followedUp: true,
        followedUpAt: new Date().toISOString()
      });
      console.log(`Follow-up sent: ${prospect.name}`);
      await sleep(4000);
    } catch (e) {
      console.error(`Follow-up error (${prospect.name}):`, e.message);
    }
  }
  if (needsFollowUp.length > 0) {
    await db.addLog(`Follow-ups sent: ${needsFollowUp.length}`, 'info');
  }
}

// Deliver content for a single client immediately
async function deliverContentForClient(client) {
  try {
    const postsPerMonth = { starter: 2, growth: 4, pro: 8 }[client.plan] || 2;
    console.log(`Generating ${postsPerMonth} posts for ${client.name}...`);
    const generatedPosts = [];
    for (let i = 0; i < postsPerMonth; i++) {
      const post = await ai.writeBlogPost(client);
      const saved = await db.addPost({
        ...post,
        clientId: client.id,
        client: client.name,
        suburb: client.suburb
      });
      generatedPosts.push(saved);
      await sleep(2000);
    }
    const reportBody = await ai.writeMonthlyReport(client, generatedPosts);
    await email.sendMonthlyReport({
      to: client.email,
      toName: client.name,
      body: reportBody
    });
    await db.addLog(`Content delivered to ${client.name} — ${postsPerMonth} posts`, 'success');
    console.log(`Content delivered to ${client.name}`);

    // Schedule next delivery exactly 1 month from now
    await db.scheduleNextDelivery(client.id);

  } catch (e) {
    console.error(`Content error (${client.name}):`, e.message);
    await db.addLog(`Content failed for ${client.name}: ${e.message}`, 'error');
  }
}

// Run monthly content for all clients whose delivery date is today
async function runMonthlyContentGeneration() {
  console.log('Checking monthly content deliveries...');
  const clientsDue = await db.getClientsDueForContent();
  console.log(`${clientsDue.length} clients due for content today`);
  for (const client of clientsDue) {
    await deliverContentForClient(client);
  }
}

function startScheduler() {
  console.log('Starting ContentBoost scheduler...');

  // Every 15 minutes 24/7 — find new prospects constantly
  cron.schedule('*/15 * * * *', () => {
    runProspectFinder().catch(e => console.error('Finder failed:', e));
  }, { timezone: 'Australia/Brisbane' });

  // Every 10 minutes 6am-9pm 7 days — send emails all day
  cron.schedule('*/10 6-21 * * *', () => {
    runEmailOutreach().catch(e => console.error('Outreach failed:', e));
  }, { timezone: 'Australia/Brisbane' });

  // Every 2 hours — follow-ups
  cron.schedule('0 */2 * * *', () => {
    runFollowUps().catch(e => console.error('Follow-up failed:', e));
  }, { timezone: 'Australia/Brisbane' });

  // Every day at 7am — check which clients are due for their monthly content
  cron.schedule('0 7 * * *', () => {
    runMonthlyContentGeneration().catch(e => console.error('Content failed:', e));
  }, { timezone: 'Australia/Brisbane' });

  // Run immediately on startup
  setTimeout(() => runProspectFinder().catch(console.error), 5000);
  setTimeout(() => runEmailOutreach().catch(console.error), 35000);

  console.log('Scheduler active:');
  console.log('  Every 15min 24/7      -> Find new prospects');
  console.log('  Every 10min 6am-9pm   -> Send cold emails');
  console.log('  Every 2 hours         -> Send follow-ups');
  console.log('  Daily 7am             -> Deliver content to clients due today');
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

module.exports = {
  startScheduler, runProspectFinder, runEmailOutreach,
  runFollowUps, runMonthlyContentGeneration, deliverContentForClient
};
