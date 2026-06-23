const express    = require('express');
const router     = express.Router();
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { Resend }  = require('resend');
const { body, validationResult } = require('express-validator');
const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Mailer ────────────────────────────────────────────────────────────────────
// Resend (HTTP API) instead of SMTP — Render blocks outbound SMTP so nodemailer
// + Gmail times out. Send from the verified custom domain; replies route to
// ADMIN_EMAIL.
// Only construct the client if the key is present so the server still boots
// without it (the Resend constructor throws on a missing key).
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const MAIL_FROM     = 'Open Climb Aviation <noreply@openclimbaviationacademy.com>';
const MAIL_REPLY_TO = process.env.ADMIN_EMAIL || 'training.ocaa@gmail.com';

// Fire-and-forget sender with error logging. Mirrors the old transporter.sendMail
// call shape (to / subject / html) so the call sites barely change.
function sendEmail({ to, subject, html }, label = 'Email') {
  if (!resend) {
    console.warn(`${label} skipped — RESEND_API_KEY not set`);
    return Promise.resolve();
  }
  return resend.emails
    .send({ from: MAIL_FROM, replyTo: MAIL_REPLY_TO, to, subject, html })
    .then(({ error }) => { if (error) console.error(`${label} failed:`, error.message || error); })
    .catch(err => console.error(`${label} failed:`, err.message));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function ok(res, data, message = 'Success', status = 200) {
  return res.status(status).json({ success: true, message, data });
}

function fail(res, message, errors = [], status = 400) {
  return res.status(status).json({ success: false, message, errors });
}

function signToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function handleValidation(req, res) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    fail(res, 'Validation failed', result.array().map(e => ({ field: e.path, message: e.msg })));
    return false;
  }
  return true;
}

// ── Email templates ───────────────────────────────────────────────────────────
// Sent on signup — this is the key onboarding email: it welcomes the new student
// AND asks them to verify their email (we deliberately don't send a separate
// "welcome" email too, to avoid confusing duplicates).
function verificationEmailHtml(name, verifyUrl) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#0d1b2a;border-radius:14px 14px 0 0;padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#f5a623;font-size:24px;letter-spacing:1px;">Open Climb Aviation</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.6);font-size:13px;letter-spacing:2px;text-transform:uppercase;">A320 Pre-Type Rating Training</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:40px;">
            <h2 style="color:#0d1b2a;margin:0 0 16px;">Welcome aboard, ${name}! ✈️</h2>
            <p style="color:#555;line-height:1.8;margin:0 0 20px;">
              We're thrilled to have you join <strong>Open Climb Aviation</strong>. One quick step before you can enrol:
              please confirm your email address by clicking the button below.
            </p>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="background:#f5a623;border-radius:8px;padding:14px 32px;">
                  <a href="${verifyUrl}" style="color:#0d1b2a;font-weight:700;font-size:15px;text-decoration:none;">Verify My Email →</a>
                </td>
              </tr>
            </table>

            <p style="color:#555;line-height:1.7;margin:0 0 20px;font-size:14px;">
              This link expires in <strong>24 hours</strong>. If the button doesn't work, copy and paste this URL into your browser:
            </p>
            <p style="margin:0 0 28px;word-break:break-all;">
              <a href="${verifyUrl}" style="color:#2196f3;font-size:13px;">${verifyUrl}</a>
            </p>

            <p style="color:#888;font-size:13px;line-height:1.7;margin:0;">
              Once verified, you'll be able to enrol in our A320 Pre-TR programmes. If you didn't create this account, you can safely ignore this email.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0d1b2a;border-radius:0 0 14px 14px;padding:22px 40px;text-align:center;">
            <p style="margin:0;color:rgba(255,255,255,0.45);font-size:12px;">
              &copy; 2025 Open Climb Aviation &nbsp;|&nbsp; by Capt. Jay Kotecha
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Build a 24h email-verification JWT + the verify-email.html link, and send it.
// Reuses the same JWT/secret pattern as the forgot-password flow.
function sendVerificationEmail(user) {
  const verifyToken = jwt.sign(
    { userId: user.id, email: user.email, purpose: 'verify' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  const base = process.env.FRONTEND_URL || 'https://openclimbaviationacademy.com';
  const verifyUrl = `${base.replace(/\/$/, '')}/verify-email.html?token=${encodeURIComponent(verifyToken)}`;

  return sendEmail({
    to:      user.email,
    subject: 'Verify your email — Open Climb Aviation',
    html:    verificationEmailHtml(user.name, verifyUrl)
  }, 'Verification email');
}

function enquiryAdminHtml(data) {
  const rows = [
    ['Name',            data.name            || '—'],
    ['Email',           data.email           || '—'],
    ['WhatsApp',        data.whatsapp        || '—'],
    ['Age',             data.age             || '—'],
    ['Course Interest', data.course_interest || '—'],
    ['Message',         data.message         || '—'],
    ['Submitted At',    new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })]
  ];
  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:12px 16px;background:#f4f7fb;font-weight:600;color:#0d1b2a;font-size:14px;width:38%;border-bottom:1px solid #e8edf5;">${label}</td>
      <td style="padding:12px 16px;color:#444;font-size:14px;border-bottom:1px solid #e8edf5;">${value}</td>
    </tr>`).join('');

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background:#0d1b2a;border-radius:14px 14px 0 0;padding:28px 36px;">
            <h2 style="margin:0;color:#f5a623;font-size:20px;">New Enrollment Enquiry</h2>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.55);font-size:13px;">Open Climb Aviation — Admin Notification</p>
          </td>
        </tr>
        <tr>
          <td style="background:#fff;padding:32px 36px;">
            <p style="color:#555;margin:0 0 22px;line-height:1.7;">A new enquiry has been submitted. Here are the details:</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8edf5;border-radius:8px;overflow:hidden;">
              ${tableRows}
            </table>
            <p style="margin:24px 0 0;color:#888;font-size:13px;">
              Log in to your <a href="${process.env.FRONTEND_URL || '#'}/admin.html" style="color:#2196f3;">admin panel</a> to update the enquiry status.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#0d1b2a;border-radius:0 0 14px 14px;padding:18px 36px;text-align:center;">
            <p style="margin:0;color:rgba(255,255,255,0.4);font-size:12px;">&copy; 2025 Open Climb Aviation</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function enquiryStudentHtml(name, courseInterest) {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background:#0d1b2a;border-radius:14px 14px 0 0;padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#f5a623;font-size:22px;">Open Climb Aviation</h1>
          </td>
        </tr>
        <tr>
          <td style="background:#fff;padding:40px;">
            <h2 style="color:#0d1b2a;margin:0 0 16px;">Thanks for reaching out, ${name}!</h2>
            <p style="color:#555;line-height:1.8;margin:0 0 16px;">
              We've received your enquiry${courseInterest ? ` about <strong>${courseInterest}</strong>` : ''} and Capt. Jay Kotecha will personally get back to you within <strong>24 hours</strong>.
            </p>
            <p style="color:#555;line-height:1.8;margin:0 0 28px;">
              In the meantime, feel free to explore more about our courses on the website.
            </p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#f5a623;border-radius:8px;padding:12px 28px;">
                  <a href="${process.env.FRONTEND_URL || '#'}" style="color:#0d1b2a;font-weight:700;font-size:14px;text-decoration:none;">Visit Website →</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#0d1b2a;border-radius:0 0 14px 14px;padding:20px 40px;text-align:center;">
            <p style="margin:0;color:rgba(255,255,255,0.4);font-size:12px;">&copy; 2025 Open Climb Aviation &nbsp;|&nbsp; Capt. Jay Kotecha</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function resetPasswordHtml(resetUrl) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#0d1b2a;border-radius:14px 14px 0 0;padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#f5a623;font-size:24px;letter-spacing:1px;">Open Climb Aviation</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.6);font-size:13px;letter-spacing:2px;text-transform:uppercase;">Password Reset</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:40px;">
            <h2 style="color:#0d1b2a;margin:0 0 16px;">Reset your password</h2>
            <p style="color:#555;line-height:1.8;margin:0 0 20px;">
              We received a request to reset the password for your Open Climb Aviation account. Click the button below to choose a new password.
            </p>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="background:#f5a623;border-radius:8px;padding:14px 32px;">
                  <a href="${resetUrl}" style="color:#0d1b2a;font-weight:700;font-size:15px;text-decoration:none;">Reset Password →</a>
                </td>
              </tr>
            </table>

            <p style="color:#555;line-height:1.7;margin:0 0 20px;font-size:14px;">
              This link expires in <strong>30 minutes</strong>. If the button doesn't work, copy and paste this URL into your browser:
            </p>
            <p style="margin:0 0 28px;word-break:break-all;">
              <a href="${resetUrl}" style="color:#2196f3;font-size:13px;">${resetUrl}</a>
            </p>

            <p style="color:#888;font-size:13px;line-height:1.7;margin:0;">
              If you didn't request a password reset, you can safely ignore this email — your password won't change.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0d1b2a;border-radius:0 0 14px 14px;padding:22px 40px;text-align:center;">
            <p style="margin:0;color:rgba(255,255,255,0.45);font-size:12px;">
              &copy; 2025 Open Climb Aviation &nbsp;|&nbsp; by Capt. Jay Kotecha
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', [
  body('name')
    .trim()
    .notEmpty().withMessage('Full name is required')
    .isLength({ min: 2 }).withMessage('Full name must be at least 2 characters')
    .matches(/[A-Za-z]/).withMessage('Full name must contain letters, not just numbers'),
  body('email')
    .isEmail().withMessage('A valid email address is required')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .custom(v => (v || '').trim().length > 0).withMessage('Password cannot be only spaces'),
  body('whatsapp')
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^\d{10}$/).withMessage('WhatsApp number must be exactly 10 digits'),
  body('age')
    .optional({ checkFalsy: true })
    .isInt({ min: 16, max: 100 }).withMessage('Age must be between 16 and 100')
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  const { name, email, password, whatsapp, age } = req.body;

  try {
    // Duplicate email check
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      return fail(res, 'This email is already registered. Please log in instead.', [], 409);
    }

    const password_hash = await bcrypt.hash(password, 12);

    const { data: user, error: insertErr } = await supabase
      .from('users')
      .insert({
        name,
        email,
        password_hash,
        whatsapp:       whatsapp  || null,
        age:            age       ? parseInt(age) : null,
        role:           'student',
        email_verified: false
      })
      .select('id, name, email, whatsapp, age, role, created_at, email_verified')
      .single();

    if (insertErr) throw insertErr;

    const token = signToken(user);

    // Verification email — fire-and-forget, don't block response. This doubles as
    // the welcome email (greets + asks to verify), so we don't send a separate one.
    sendVerificationEmail(user);

    return ok(res, { token, user }, 'Account created! Please check your email to verify your address.', 201);
  } catch (err) {
    console.error('Register error:', err);
    return fail(res, 'Registration failed. Please try again.', [], 500);
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', [
  body('email')
    .isEmail().withMessage('A valid email address is required')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required')
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  const { email, password } = req.body;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, whatsapp, age, password_hash, role, created_at, email_verified')
      .eq('email', email)
      .maybeSingle();

    // Use same message for missing user and wrong password to avoid user enumeration
    if (error || !user) {
      return fail(res, 'Invalid email or password.', [], 401);
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return fail(res, 'Invalid email or password.', [], 401);
    }

    const token = signToken(user);
    const { password_hash, ...safeUser } = user;

    return ok(res, { token, user: safeUser }, 'Logged in successfully.');
  } catch (err) {
    console.error('Login error:', err);
    return fail(res, 'Login failed. Please try again.', [], 500);
  }
});

// ── POST /api/auth/forgot-password ──────────────────────────────────────────────
// Rate limiting: this route is mounted under /api/auth, which server.js wraps in
// authLimiter, so it's already throttled (20 req / 15 min per IP) — no extra limiter
// needed here.
router.post('/forgot-password', [
  body('email')
    .isEmail().withMessage('A valid email address is required')
    .normalizeEmail()
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  const { email } = req.body;
  // Generic response used for every outcome so we never reveal which emails exist.
  const generic = 'If an account exists for that email, a reset link has been sent.';

  try {
    // Case-insensitive lookup (ilike with no wildcards = exact, case-insensitive match)
    const { data: user } = await supabase
      .from('users')
      .select('id, email')
      .ilike('email', email)
      .maybeSingle();

    if (user) {
      const resetToken = jwt.sign(
        { userId: user.id, email: user.email, purpose: 'pwreset' },
        process.env.JWT_SECRET,
        { expiresIn: '30m' }
      );

      const base = process.env.FRONTEND_URL || 'https://openclimbaviationacademy.com';
      const resetUrl = `${base.replace(/\/$/, '')}/reset-password.html?token=${encodeURIComponent(resetToken)}`;

      // Fire-and-forget — don't block the response or leak timing/existence.
      sendEmail({
        to:      user.email,
        subject: 'Reset your Open Climb Aviation password',
        html:    resetPasswordHtml(resetUrl)
      }, 'Password reset email');
    }

    return ok(res, {}, generic);
  } catch (err) {
    console.error('Forgot-password error:', err);
    // Still return the generic message — don't expose internal errors to the client.
    return ok(res, {}, generic);
  }
});

// ── POST /api/auth/reset-password ───────────────────────────────────────────────
// Also throttled by authLimiter via the /api/auth mount in server.js.
router.post('/reset-password', [
  body('token')
    .notEmpty().withMessage('Reset token is required'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .custom(v => (v || '').trim().length > 0).withMessage('Password cannot be only spaces')
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  const { token, password } = req.body;

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return fail(res, 'This reset link is invalid or has expired. Please request a new one.', [], 400);
  }

  if (!payload || payload.purpose !== 'pwreset' || !payload.userId) {
    return fail(res, 'This reset link is invalid or has expired. Please request a new one.', [], 400);
  }

  try {
    const password_hash = await bcrypt.hash(password, 12);

    const { data: updated, error: updateErr } = await supabase
      .from('users')
      .update({ password_hash })
      .eq('id', payload.userId)
      .select('id')
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!updated) {
      return fail(res, 'This reset link is invalid or has expired. Please request a new one.', [], 400);
    }

    return ok(res, {}, 'Your password has been reset. You can now log in with your new password.');
  } catch (err) {
    console.error('Reset-password error:', err);
    return fail(res, 'Could not reset your password. Please try again.', [], 500);
  }
});

// ── POST /api/auth/verify-email ─────────────────────────────────────────────────
// Confirms the JWT from the verification link and flips email_verified = true.
// Also throttled by authLimiter via the /api/auth mount in server.js.
router.post('/verify-email', [
  body('token').notEmpty().withMessage('Verification token is required')
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  const { token } = req.body;

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return fail(res, 'This verification link is invalid or has expired. Please request a new one.', [], 400);
  }

  if (!payload || payload.purpose !== 'verify' || !payload.userId) {
    return fail(res, 'This verification link is invalid or has expired. Please request a new one.', [], 400);
  }

  try {
    const { data: updated, error: updateErr } = await supabase
      .from('users')
      .update({ email_verified: true })
      .eq('id', payload.userId)
      .select('id')
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!updated) {
      return fail(res, 'This verification link is invalid or has expired. Please request a new one.', [], 400);
    }

    return ok(res, {}, 'Your email has been verified. You can now enrol in our courses.');
  } catch (err) {
    console.error('Verify-email error:', err);
    return fail(res, 'Could not verify your email. Please try again.', [], 500);
  }
});

// ── POST /api/auth/resend-verification ────────────────────────────────────────────
// Generic response (never reveals whether an account exists). If the account exists
// and is still unverified, re-send the verification email. Throttled by authLimiter
// via the /api/auth mount in server.js.
router.post('/resend-verification', [
  body('email')
    .isEmail().withMessage('A valid email address is required')
    .normalizeEmail()
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  const { email } = req.body;
  const generic = 'If your account needs verification, a new link has been sent to your email.';

  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, name, email, email_verified')
      .ilike('email', email)
      .maybeSingle();

    // Only re-send for accounts that exist and are still unverified.
    if (user && !user.email_verified) {
      sendVerificationEmail(user);
    }

    return ok(res, {}, generic);
  } catch (err) {
    console.error('Resend-verification error:', err);
    // Still return the generic message — don't expose internal errors.
    return ok(res, {}, generic);
  }
});

// ── POST /api/auth/enquiry ────────────────────────────────────────────────────
router.post('/enquiry', [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required'),
  body('email')
    .isEmail().withMessage('A valid email address is required')
    .normalizeEmail(),
  body('whatsapp')
    .trim()
    .matches(/^\d{10}$/).withMessage('WhatsApp number must be exactly 10 digits'),
  body('age')
    .optional({ checkFalsy: true })
    .isInt({ min: 16, max: 100 }).withMessage('Age must be between 16 and 100'),
  body('course_interest')
    .optional({ checkFalsy: true })
    .trim()
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  const { name, email, whatsapp, age, course_interest, message } = req.body;

  try {
    const { error: dbErr } = await supabase
      .from('enquiries')
      .insert({
        name,
        email,
        whatsapp:        whatsapp        || null,
        age:             age             ? parseInt(age) : null,
        course_interest: course_interest || null,
        message:         message         || null
      });

    if (dbErr) throw dbErr;

    const enquiryData = { name, email, whatsapp, age, course_interest, message };

    // Notification to admin
    sendEmail({
      to:      process.env.ADMIN_EMAIL,
      subject: `New Enrollment Enquiry — ${name}`,
      html:    enquiryAdminHtml(enquiryData)
    }, 'Admin enquiry email');

    // Confirmation to student
    sendEmail({
      to:      email,
      subject: 'We received your enquiry — Open Climb Aviation',
      html:    enquiryStudentHtml(name, course_interest)
    }, 'Student enquiry email');

    return ok(res, {}, 'Enquiry submitted! We\'ll get back to you within 24 hours.', 201);
  } catch (err) {
    console.error('Enquiry error:', err);
    return fail(res, 'Failed to submit enquiry. Please try again.', [], 500);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', verifyToken, async (req, res) => {
  // verifyToken already fetched the user and attached it as req.user
  return ok(res, { user: req.user }, 'User fetched successfully.');
});

module.exports = router;
