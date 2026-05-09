const axios = require('axios');
const db = require('./db');

async function sendEmail({ to, toName, subject, body, prospectId }) {
  const htmlBody = body
    .split('\n')
    .map(line => line.trim() === '' ? '<br>' : `<p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">${line}</p>`)
    .join('');

  const html = `
    <div style="max-width:560px;margin:0 auto;padding:20px;">
      ${htmlBody}
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
      <p style="font-size:11px;color:#aaa;font-family:Arial,sans-serif;">
        You received this because your business appeared in a local search in your area.
        <a href="mailto:${process.env.FROM_EMAIL}?subject=Unsubscribe" style="color:#aaa;">Unsubscribe</a>
      </p>
    </div>`;

  const response = await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: {
        name: `${process.env.FROM_NAME || 'Alex'} | ContentBoost`,
        email: process.env.FROM_EMAIL
      },
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent: html,
      textContent: body
    },
    {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );

  db.addEmail({ to, toName, subject, prospectId, messageId: response.data.messageId });
  db.addLog(`Email sent to ${toName || to}: "${subject}"`, 'email');
  return response.data;
}

async function sendReply({ to, toName, body, subject }) {
  return sendEmail({ to, toName, subject: subject || 'Re: Your enquiry', body });
}

async function sendMonthlyReport({ to, toName, body }) {
  return sendEmail({ to, toName, subject: 'Your ContentBoost Monthly Report', body });
}

async function checkDailyLimit() {
  const data = db.get();
  const today = new Date().toDateString();
  const sentToday = data.emails.filter(e => new Date(e.sentAt).toDateString() === today).length;
  const limit = parseInt(process.env.DAILY_EMAIL_LIMIT) || 50;
  return { sentToday, limit, canSend: sentToday < limit, remaining: Math.max(0, limit - sentToday) };
}

module.exports = { sendEmail, sendReply, sendMonthlyReport, checkDailyLimit };
