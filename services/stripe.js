const Stripe = require('stripe');
const db = require('./db');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  starter: { name: 'Starter', price: 497, priceId: process.env.STRIPE_STARTER_PRICE_ID },
  growth:  { name: 'Growth',  price: 797, priceId: process.env.STRIPE_GROWTH_PRICE_ID },
  pro:     { name: 'Pro',     price: 1497, priceId: process.env.STRIPE_PRO_PRICE_ID }
};

async function createCheckoutLink(clientData, plan) {
  const planConfig = PLANS[plan];
  if (!planConfig) throw new Error('Invalid plan: ' + plan);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: planConfig.priceId, quantity: 1 }],
    customer_email: clientData.email,
    metadata: { businessName: clientData.name, suburb: clientData.suburb || '', niche: clientData.niche || '', plan },
    success_url: `${process.env.APP_URL || 'http://localhost:3000'}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/payment-cancelled`,
    subscription_data: { metadata: { businessName: clientData.name, plan } }
  });
  return session.url;
}

async function handleWebhook(rawBody, signature) {
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw new Error('Webhook signature failed: ' + err.message);
  }
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const meta = session.metadata;
      db.addClient({
        name: meta.businessName, suburb: meta.suburb, niche: meta.niche, plan: meta.plan,
        planLabel: PLANS[meta.plan]?.name || meta.plan, email: session.customer_email,
        stripeCustomerId: session.customer, stripeSubscriptionId: session.subscription,
        monthlyRevenue: PLANS[meta.plan]?.price || 0
      });
      db.addLog(`New client signed up: ${meta.businessName} — ${PLANS[meta.plan]?.name} ($${PLANS[meta.plan]?.price}/mo)`, 'success');
      break;
    }
    case 'invoice.paid': {
      const invoice = event.data.object;
      db.addLog(`Renewal payment received from ${invoice.customer_email} — $${invoice.amount_paid / 100}`, 'payment');
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const dbData = db.get();
      const client = dbData.clients.find(c => c.stripeSubscriptionId === sub.id);
      if (client) {
        db.updateProspect(client.id, { status: 'churned' });
        db.addLog(`Client cancelled: ${client.name}`, 'warning');
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      db.addLog(`Payment failed for ${invoice.customer_email} — will retry automatically`, 'warning');
      break;
    }
  }
  return { received: true };
}

module.exports = { createCheckoutLink, handleWebhook, PLANS };
