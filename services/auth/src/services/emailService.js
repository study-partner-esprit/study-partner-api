const nodemailer = require('nodemailer');

// Create transport (uses env vars; falls back to Ethereal for dev)
let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  } else {
    // Dev: use Ethereal fake SMTP
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    console.log('[Email] Using Ethereal test account:', testAccount.user);
  }

  return transporter;
}

const FROM_ADDRESS = process.env.EMAIL_FROM || 'StudyPartner <noreply@studypartner.app>';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

/**
 * Send an email verification link.
 */
async function sendVerificationEmail(to, token) {
  const t = await getTransporter();
  const link = `${APP_URL}/verify-email/${token}`;

  const info = await t.sendMail({
    from: FROM_ADDRESS,
    to,
    subject: 'Verify your StudyPartner email',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;">
        <h2 style="color:#7c3aed;">Welcome to StudyPartner!</h2>
        <p>Please click the button below to verify your email address:</p>
        <a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Verify Email</a>
        <p style="color:#888;font-size:12px;margin-top:24px;">If you didn't create an account, ignore this email. This link expires in 24 hours.</p>
      </div>
    `
  });

  console.log('[Email] Verification sent to', to, '| MessageId:', info.messageId);
  if (info.messageId && !process.env.SMTP_HOST) {
    console.log('[Email] Preview URL:', nodemailer.getTestMessageUrl(info));
  }
}

/**
 * Send a password reset link.
 */
async function sendPasswordResetEmail(to, token) {
  const t = await getTransporter();
  const link = `${APP_URL}/reset-password/${token}`;

  const info = await t.sendMail({
    from: FROM_ADDRESS,
    to,
    subject: 'Reset your StudyPartner password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;">
        <h2 style="color:#7c3aed;">Password Reset</h2>
        <p>You requested a password reset. Click the button below to set a new password:</p>
        <a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a>
        <p style="color:#888;font-size:12px;margin-top:24px;">If you didn't request this, ignore this email. This link expires in 1 hour.</p>
      </div>
    `
  });

  console.log('[Email] Reset sent to', to, '| MessageId:', info.messageId);
  if (info.messageId && !process.env.SMTP_HOST) {
    console.log('[Email] Preview URL:', nodemailer.getTestMessageUrl(info));
  }
}

/**
 * Send a subscription expiry reminder email.
 */
async function sendSubscriptionExpiryNotice(to, { tier, endDate, daysRemaining }) {
  const t = await getTransporter();
  const pricingLink = `${APP_URL}/pricing`;

  const info = await t.sendMail({
    from: FROM_ADDRESS,
    to,
    subject: 'Your StudyPartner subscription is ending soon',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;">
        <h2 style="color:#7c3aed;">Subscription Reminder</h2>
        <p>Your <strong>${tier}</strong> plan expires on <strong>${new Date(endDate).toLocaleDateString()}</strong>.</p>
        <p>You have <strong>${daysRemaining}</strong> day(s) left. You can change or renew your plan in the last 5 days of your cycle.</p>
        <a href="${pricingLink}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Manage Plan</a>
      </div>
    `
  });

  console.log('[Email] Subscription reminder sent to', to, '| MessageId:', info.messageId);
  if (info.messageId && !process.env.SMTP_HOST) {
    console.log('[Email] Preview URL:', nodemailer.getTestMessageUrl(info));
  }
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendSubscriptionExpiryNotice };
