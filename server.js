require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { startScheduler } = require('./jobs/scheduler');
const apiRoutes = require('./routes/api');
const stripeService = require('./services/stripe');
const db = require('./services/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    await stripeService.handleWebhook(req.body, sig);
    res.json({ received: true });
  } catch (e) {
    res.status(400).send('Webhook error: ' + e.message);
  }
});

app.use(cors());
app.use(express.json());

app.use('/api', apiRoutes);

app.get('/payment-success', (req, res) => {
  res.send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h1 style="color:#166534;">Payment successful!</h1><p>Welcome to ContentBoost. Your first post will be published within 5 business days.</p></body></html>');
});

app.get('/payment-cancelled', (req, res) => {
  res.send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h1>Payment cancelled</h1><p>No problem — feel free to reach out if you have any questions.</p></body></html>');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', mrr: db.getMRR(), timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ message: 'ContentBoost is running', status: 'ok' });
});

app.listen(PORT, () => {
  console.log('ContentBoost running on port ' + PORT);
  if (process.env.NODE_ENV !== 'test') {
    startScheduler();
  }
});

module.exports = app;
