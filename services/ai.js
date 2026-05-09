const axios = require('axios');

async function callClaude(prompt, maxTokens) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-opus-4-5',
      max_tokens: maxTokens || 1000,
      messages: [{ role: 'user', content: prompt }]
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'messages-2023-12-15'
      }
    }
  );
  const text = response.data.content.map(b => b.text || '').join('');
  return text.replace(/```json|```/g, '').trim();
}

async function generateProspects(city, niche, count) {
  const prompt = `Generate ${count || 5} realistic local ${niche} businesses in ${city}, Australia with weak SEO and no blog content. Return ONLY a JSON array, no markdown. Each object: name, suburb, phone (Australian 04xx mobile), email (realistic), seoScore (integer 10-38), issue (one sentence SEO weakness).`;
  const text = await callClaude(prompt, 1200);
  return JSON.parse(text);
}

async function writeColdEmail(prospect, senderName) {
  const prompt = `Write a short genuine cold email to the owner of "${prospect.name}", a ${prospect.niche || 'local business'} in ${prospect.suburb}, Australia. You are ${senderName} from ContentBoost, a monthly SEO blog content service. Their SEO issue: ${prospect.issue}. Max 110 words. Conversational, not salesy. Mention a free sample post. Service from $497/month. Sign as: ${senderName} | ContentBoost. Return ONLY JSON: {"subject":"...","body":"..."}`;
  const text = await callClaude(prompt, 600);
  return JSON.parse(text);
}

async function writeFollowUp(prospect, senderName) {
  const prompt = `Write a very short follow-up cold email to "${prospect.name}" in ${prospect.suburb}, Australia. They did not reply to a previous email about monthly SEO blog content. Offer a completely free sample blog post, no obligation. Under 70 words. Casual. Sign as: ${senderName} | ContentBoost. Return ONLY JSON: {"subject":"...","body":"..."}`;
  const text = await callClaude(prompt, 400);
  return JSON.parse(text);
}

async function writeReply(prospect, replyText, scenario, senderName) {
  const scenarios = {
    interested: 'They replied saying they are interested. Goal: get them to sign up. Mention Growth plan at $797/month.',
    pricing: 'They are asking about pricing. Explain: Starter $497/mo (2 posts), Growth $797/mo (4 posts), Pro $1497/mo (8 posts). Recommend Growth.',
    objection_time: 'They said they are too busy. Reframe: they do nothing, you handle everything.',
    objection_money: 'They think it is too expensive. Reframe value: one new customer pays for months. Mention Starter at $497.',
    objection_diy: 'They said they write their own content. Ask: is it ranking? Offer a free sample post to compare.',
    sample: 'They want to see a sample. Tell them you will write a FREE custom post for their business. Ask for their preferred topic.',
    not_interested: 'They said not interested. Be gracious and brief. Leave the door open.',
    referral: 'They referred someone else. Thank them. Mention referrer gets a free month if their referral signs up.',
    closing: 'They are ready to sign up. Confirm their plan, tell them you will send a Stripe payment link, first post within 5 business days.'
  };
  const prompt = `Write a reply email to the owner of "${prospect.name || 'a local business'}" in ${prospect.suburb || 'Australia'}. Scenario: ${scenarios[scenario] || scenarios.interested}. ${replyText ? `Their message: "${replyText}"` : ''} Warm genuine tone. Sign as: ${senderName} | ContentBoost. Write only the email body.`;
  return await callClaude(prompt, 500);
}

async function writeBlogPost(client) {
  const prompt = `Write a 500-word SEO blog post for "${client.name}", a ${client.niche || 'local business'} in ${client.suburb || client.city}, Australia. Target local Google search keywords. Natural helpful tone. Strong intro, 2-3 sections, clear call to action. Return ONLY JSON (no markdown): {"title":"...","metaDescription":"...","body":"...","keywords":["...","...","...","..."]}`;
  const text = await callClaude(prompt, 1500);
  return JSON.parse(text);
}

async function writeMonthlyReport(client, posts) {
  const prompt = `Write a short friendly monthly SEO report email for a client. Client: ${client.name}, ${client.suburb}. Posts published: ${posts.length}. Titles: ${posts.map(p => p.title).join(', ')}. Cover what was published, why it helps their SEO, what to expect next month. Under 150 words. Sign as: ${process.env.FROM_NAME || 'Alex'} | ContentBoost`;
  const intro = await callClaude(prompt, 400);

  const postSections = posts.map((p, i) => `
==========================================
POST ${i + 1} OF ${posts.length} — READY TO PUBLISH
==========================================

TITLE:
${p.title}

META DESCRIPTION (paste this into your SEO settings):
${p.metaDescription}

KEYWORDS (for your SEO plugin):
${(p.keywords || []).join(', ')}

FULL POST (copy and paste into your website):
${p.body}

==========================================
`).join('\n');

  return `${intro}

---

YOUR BLOG POSTS THIS MONTH
===========================

Simply copy and paste each post below into your website. If you use WordPress, Squarespace, or Wix — just create a new blog post, paste the content in, and hit publish. It takes about 2 minutes per post.

If you need any help publishing, just reply to this email and we'll walk you through it.

${postSections}

---
Questions? Just reply to this email.
${process.env.FROM_NAME || 'Alex'} | ContentBoost`;
}
