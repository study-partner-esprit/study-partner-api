const axios = require('axios');

let transporter = null;
let mailerDisabled = false;

const isEmailEnabled = () => {
  return process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true';
};

const getTransporter = () => {
  if (mailerDisabled || !isEmailEnabled()) {
    return null;
  }

  if (transporter) {
    return transporter;
  }

  try {
    // eslint-disable-next-line global-require
    const nodemailer = require('nodemailer');
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      mailerDisabled = true;
      return null;
    }

    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
    return transporter;
  } catch {
    mailerDisabled = true;
    return null;
  }
};

const resolveUserEmail = async ({ req, metadata = {} }) => {
  if (metadata.email) {
    return metadata.email;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
  try {
    const meRes = await axios.get(`${AUTH_SERVICE_URL}/api/v1/auth/me`, {
      headers: { Authorization: authHeader },
      timeout: 5000
    });
    return meRes.data?.user?.email || null;
  } catch {
    return null;
  }
};

const buildEmailTemplate = ({ title, message, type, metadata = {} }) => {
  const emojiByType = {
    achievement: '🏆',
    level_up: '🚀',
    study_reminder: '⏰',
    session_start: '📚',
    plan_generated: '🧠'
  };

  const emoji = emojiByType[type] || '🔔';
  const action = metadata.actionUrl
    ? `<p style="margin-top:24px"><a href="${metadata.actionUrl}" style="background:#ff4655;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:700">Open Study Partner</a></p>`
    : '';

  return {
    subject: `${emoji} ${title}`,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f7fafc;padding:24px;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
          <h2 style="margin:0 0 10px;color:#0f172a;">${emoji} ${title}</h2>
          <p style="margin:0;color:#334155;line-height:1.6;">${message}</p>
          ${action}
          <p style="margin-top:24px;color:#64748b;font-size:12px;">This email was sent by Study Partner notifications.</p>
        </div>
      </div>
    `
  };
};

const sendNotificationEmail = async ({ req, notification }) => {
  const t = getTransporter();
  if (!t) return { sent: false, reason: 'email_disabled' };

  const to = await resolveUserEmail({ req, metadata: notification.metadata || {} });
  if (!to) return { sent: false, reason: 'email_not_available' };

  const template = buildEmailTemplate({
    title: notification.title,
    message: notification.message,
    type: notification.type,
    metadata: notification.metadata
  });

  const from = process.env.SMTP_FROM || 'Study Partner <no-reply@study-partner.local>';
  await t.sendMail({
    from,
    to,
    subject: template.subject,
    html: template.html
  });

  return { sent: true };
};

module.exports = {
  isEmailEnabled,
  sendNotificationEmail
};
