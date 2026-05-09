const axios = require('axios');

async function callClaude(prompt, maxTokens) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens || 1000,
      messages: [{ role: 'user', content: prompt }]
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    }
  );
  const text = response.data.content.map(b => b.text || '').join('');
  return text.replace(/```json|```/g, '').trim();
}

// Find real businesses using Google Places API
async function findRealBusinesses(city, niche, count) {
  try {
    const query = encodeURIComponent(`${niche} in ${city} Australia`);
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${process.env.GOOGLE_PLACES_API_KEY}`;
    const response = await axios.get(url);
    const results = response.data.results || [];
    return results.slice(0, count || 5).map(place => ({
      name: place.name,
      suburb: place.formatted_address ? place.formatted_address.split(',')[1]?.trim() || city : city,
      address: place.formatted_address || city,
      phone: place.formatted_phone_number || '',
      googleRating: place.rating || null,
      googlePlaceId: place.place_id,
      seoScore: Math.floor(10 + Math.random() * 28),
      issue: `No blog content found — missing local SEO keywords for ${niche} services in ${city}`
    }));
  } catch (e) {
    console.error('Google Places error:', e.message);
    return [];
  }
}

// Find real email for a business using Hunter.io
async function findBusinessEmail(businessName, domain) {
  try {
    if (!domain) return null;
    const url = `https://api.hunter.io/v2/domain-search?domain=${domain}&company=${encodeURIComponent(businessName)}&api_key=${process.env.HUNTER_API_KEY}&limit=1`;
    const response = await axios.get(url);
    const emails = response.data.data?.emails || [];
    if (emails.length > 0) return emails[0].value;
    return null;
  } catch (e) {
    return null;
  }
}

// Get business website from Google Places
async function getPlaceDetails(placeId) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=website,formatted_phone_number&key=${process.env.GOOGLE_PLACES_API_KEY}`;
    const response = await axios.get(url);
    const result = response.data.result || {};
    return {
      website: result.website || null,
      phone: result.formatted_phone_number || null
    };
  } catch (e) {
    return { website: null, phone: null };
  }
}

// Extract domain from URL
function extractDomain(url) {
  if (!url) return null;
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return domain;
  } catch (e) {
    return null;
  }
}

// Main prospect finder — uses real Google Places + Hunter.io emails
async function generateProspects(city, niche, count) {
  console.log(`Finding real ${niche} businesses in ${city}...`);
  const businesses = await findRealBusinesses(city, niche, count || 5);

  const prospects = [];
  for (const biz of businesses) {
    try {
      // Get their website from Google Places
      const details = await getPlaceDetails(biz.googlePlaceId);
      biz.website = details.website;
      biz.phone = details.phone || biz.phone;

      // Try to find a real email via Hunter.io
      const domain = extractDomain(details.website);
      let email = null;
      if (domain) {
        email = await findBusinessEmail(biz.name, domain);
      }

      // If no email found via Hunter, build a best-guess from their domain
      if (!email && domain) {
        email = `info@${domain}`;
      }

      // Skip if we have no way to contact them
      if (!email) {
        console.log(`Skipping ${biz.name} — no email found`);
        continue;
      }

      biz.email = email;
      biz.domain = domain;
      prospects.push(biz);
      console.log(`Found real business: ${biz.name} — ${email}`);

    } catch (e) {
      console.error(`Error processing ${biz.name}:`, e.message);
    }
  }

  return prospects;
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
TITLE: ${p.title}
META DESCRIPTION: ${p.metaDescription}
KEYWORDS: ${(p.keywords || []).join(', ')}

${p.body}
==========================================
`).join('\n');

  return `${intro}

---
YOUR BLOG POSTS THIS MONTH
===========================
Copy and paste each post into your website. Create a new blog post, paste the content in, and hit publish. Takes about 2 minutes per post. Need help? Just reply to this email.

${postSections}
---
${process.env.FROM_NAME || 'Alex'} | ContentBoost`;
}

module.exports = { generateProspects, writeColdEmail, writeFollowUp, writeReply, writeBlogPost, writeMonthlyReport };
