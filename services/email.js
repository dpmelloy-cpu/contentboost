const nodemailer = require('nodemailer');
const db = require('./db');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
      port: parseInt(process.env.BREVO_SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.BREVO_SMTP_USER,
        pass: process.env.BREVO_SMTP_PASS
      }
    });
  }
  return transporter;
}

async function sendEmail({ to, toName, subject, body, prospectId }) {
  const transport = getTransporter();
  const htmlBody = body.split('\n').map(line => line.trim() === '' ? '<br>' : `<p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">${line}</p>`).join('');
  const html = `<div style="max-width:560px;margin:0 auto;padding:20px;">${htmlBody}<hr style="border:none;border-top:1px solid #eee;margin:20px 0;"><p style="font-size:11px;color:#aaa;font-family:Arial,sans-serif;">You received this because your business appeared in a local search in your area. <a href="mailto:${process.env.FROM_EMAIL}?subject=Unsubscribe" style="color:#aaa;">Unsubscribe</a></p></div>`;
  const result = await transport.sendMail({
    from: `"${process.env.FROM_NAME || 'Alex'} | ContentBoost" <${process.env.FROM_EMAIL}>`,
    to: toName ? `"${toName}" <${to}>` : to,
    subject,
    text: body,
    html
  });
  db.addEmail({ to, toName, subject, prospectId, messageId: result.messageId });
  db.addLog(`Email sent to ${toName || to}: "${subject}"`, 'email');
  return result;
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
