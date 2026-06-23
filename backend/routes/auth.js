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
function welcomeEmailHtml(name) {
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
              We're thrilled to have you join <strong>Open Climb Aviation</strong>. Your journey to mastering the A320 starts here.
            </p>
            <p style="color:#555;line-height:1.8;margin:0 0 28px;">
              Capt. Jay Kotecha and the team are here to help you walk into your Type Rating simulator sessions fully prepared — confident on systems, flows, abnormals, and MCDU programming.
            </p>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td style="background:#f5a623;border-radius:8px;padding:14px 32px;">
                  <a href="${process.env.FRONTEND_URL || '#'}" style="color:#0d1b2a;font-weight:700;font-size:15px;text-decoration:none;">Browse Courses →</a>
                </td>
              </tr>
            </table>

            <!-- Courses preview -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef;border-radius:10px;overflow:hidden;margin-bottom:28px;">
              <tr style="background:#f4f7fb;">
                <td style="padding:16px 20px;border-bottom:1px solid #eef;">
                  <strong style="color:#0d1b2a;font-size:14px;">A320 Systems</strong>
                  <span style="float:right;color:#2196f3;font-weight:700;">₹25,000</span>
                  <p style="margin:4px 0 0;color:#888;font-size:13px;">Complete systems deep-dive · 20 days</p>
                </td>
              </tr>
              <tr style="background:#fff;">
                <td style="padding:16px 20px;">
                  <strong style="color:#0d1b2a;font-size:14px;">Flows &amp; Procedures incl. MCDU</strong>
                  <span style="float:right;color:#2196f3;font-weight:700;">₹10,000</span>
                  <p style="margin:4px 0 0;color:#888;font-size:13px;">Flows, abnormals &amp; MCDU programming · 10 days</p>
                </td>
              </tr>
            </table>

            <p style="color:#888;font-size:13px;line-height:1.7;margin:0;">
              For any questions, reply to this email or reach out directly to Capt. Jay Kotecha.<br/>
              We look forward to flying with you.
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
        whatsapp:  whatsapp  || null,
        age:       age       ? parseInt(age) : null,
        role:      'student'
      })
      .select('id, name, email, whatsapp, age, role, created_at')
      .single();

    if (insertErr) throw insertErr;

    const token = signToken(user);

    // Welcome email — fire-and-forget, don't block response
    sendEmail({
      to:      user.email,
      subject: 'Welcome to Open Climb Aviation ✈️',
      html:    welcomeEmailHtml(user.name)
    }, 'Welcome email');

    return ok(res, { token, user }, 'Account created successfully! Welcome aboard.', 201);
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
      .select('id, name, email, whatsapp, age, password_hash, role, created_at')
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
