const nodemailer = require('nodemailer');

// Reuses one transporter across requests instead of creating a new SMTP
// connection every time.
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD // Gmail "App Password", not the account password
    }
  });
  return transporter;
}

// Sends the password-reset link. If Gmail credentials aren't configured
// (e.g. local dev without setting them up), logs the link instead of
// throwing — so the rest of the flow can still be tested without email.
async function sendPasswordResetEmail(toEmail, resetUrl) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('[mailer] GMAIL_USER/GMAIL_APP_PASSWORD not set — email not sent. Reset URL:', resetUrl);
    return;
  }

  await getTransporter().sendMail({
    from: `"BodyMath Fitness" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: 'Reset your BodyMath Fitness password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#0891b2;">BodyMath Fitness</h2>
        <p>We received a request to reset your password. This link expires in 1 hour.</p>
        <p style="margin:24px 0;">
          <a href="${resetUrl}" style="background:#0891b2;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
            Reset Password
          </a>
        </p>
        <p style="color:#64748b;font-size:13px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
        <p style="color:#94a3b8;font-size:12px;word-break:break-all;">Or copy this link: ${resetUrl}</p>
      </div>
    `
  });
}

module.exports = { sendPasswordResetEmail };
