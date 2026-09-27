/**
 * Email transport for OTP verification codes, built on Nodemailer + plain SMTP.
 *
 * Why SMTP over a specific vendor SDK (Resend/SendGrid/etc.): it's
 * provider-agnostic. Point these same .env values at Gmail (with an app
 * password), Outlook, SendGrid's SMTP relay, Mailtrap (great for local
 * dev/testing — free, catches mail without really sending it), or your
 * institution's own mail server. No code changes, no extra vendor SDKs.
 */
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587/25 (STARTTLS)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Minimal HTML-escaping for values we interpolate into the email body,
// since fullName is user-supplied and this is rendered as HTML.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendOtpEmail(toEmail, fullName, code) {
  const fromAddress = process.env.SMTP_FROM || '"UJ Connect" <no-reply@ujconnect.app>';
  const safeName = escapeHtml(fullName || 'there');

  await transporter.sendMail({
    from: fromAddress,
    to: toEmail,
    subject: 'Your UJ Connect verification code',
    text: `Hi ${fullName || 'there'},\n\nYour UJ Connect verification code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="margin-bottom: 4px;">Verify your email</h2>
        <p>Hi ${safeName},</p>
        <p>Use the code below to verify your UJ Connect account. It expires in <strong>10 minutes</strong>.</p>
        <div style="font-size: 32px; letter-spacing: 8px; font-weight: bold; background: #f4f4f5; padding: 16px 24px; border-radius: 8px; text-align: center; margin: 24px 0;">
          ${code}
        </div>
        <p style="color: #666; font-size: 13px;">If you didn't request this, you can safely ignore this email — no account will be created.</p>
      </div>
    `
  });
}

module.exports = { transporter, sendOtpEmail };
