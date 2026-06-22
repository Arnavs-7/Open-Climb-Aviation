const express    = require('express');
const router     = express.Router();
const Razorpay   = require('razorpay');
const crypto     = require('crypto');
const { Resend }  = require('resend');
const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Only construct the Razorpay client if BOTH keys are present.
// Launching UPI-only for now — online card payments stay disabled until the
// keys are configured, and the server must boot fine without them.
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
} else {
  console.warn('Razorpay keys not set — payment routes disabled');
}

// Returned by Razorpay-backed routes when the client is not configured.
function razorpayDisabled(res) {
  return res.status(503).json({
    success: false,
    message: 'Online card payments are not enabled yet. Please use UPI.'
  });
}

// ── UPI config (primary payment method) ───────────────────────────────────────
// Students pay directly to Jay's UPI ID and submit the UTR reference, which we
// record against the enrollment and email to the admin for manual confirmation.
const UPI_ID    = process.env.UPI_ID    || '9479959933@hdfc';
const UPI_PAYEE = process.env.UPI_PAYEE || 'Open Climb Aviation';

// ── Coupon config ──────────────────────────────────────────────────────────────
// Single promotional code. Maps the course's original price (paise) to its
// discounted price (paise). Validated server-side only — the client never
// decides the amount. Any course price not listed here gets no discount.
const COUPON_CODE = 'CAPTDEEKSHA';
const COUPON_DISCOUNTS = {
  2500000: 2400000, // ₹25,000 -> ₹24,000
  1000000: 950000,  // ₹10,000 -> ₹9,500
  3300000: 3250000, // ₹33,000 -> ₹32,500
  500000:  450000   // ₹5,000  -> ₹4,500
};

// Resolve the amount to charge given a (possibly empty) coupon and the course
// price. `valid` is false only when a non-empty code is supplied that is wrong.
function resolveCoupon(coupon, price) {
  const code = (coupon || '').toString().trim().toUpperCase();
  if (!code) {
    return { amount: price, applied: false, valid: true, code: null };
  }
  if (code !== COUPON_CODE) {
    return { amount: price, applied: false, valid: false, code: null };
  }
  // Look up the discount by the course's ORIGINAL price (the value from the DB),
  // normalized to an integer number of paise. Keying on price — not slug or
  // order/index — means it matches regardless of how courses are ordered.
  const key = Number(price);
  const discounted = Number.isFinite(key) ? COUPON_DISCOUNTS[key] : undefined;
  if (discounted == null) {
    // Valid code, but this course's price isn't part of the promotion.
    return { amount: price, applied: false, valid: true, code: COUPON_CODE };
  }
  return { amount: discounted, applied: true, valid: true, code: COUPON_CODE };
}

// Email via Resend (HTTP API) — Render blocks outbound SMTP, so nodemailer + Gmail
// can't connect. Send from the default onboarding sender until a domain is verified
// in Resend; replies route to ADMIN_EMAIL.
// Only construct the client if the key is present so the server still boots
// without it (the Resend constructor throws on a missing key).
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const MAIL_FROM     = 'Open Climb Aviation <onboarding@resend.dev>';
const MAIL_REPLY_TO = process.env.ADMIN_EMAIL || 'training.ocaa@gmail.com';

// Fire-and-forget sender with error logging (mirrors the old transporter.sendMail).
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
function fmtInr(paise) {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

// ── Email templates ───────────────────────────────────────────────────────────
function studentConfirmationHtml({ studentName, courseName, amount, paymentId, whatsapp }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- Header -->
  <tr><td style="background:#0d1b2a;border-radius:14px 14px 0 0;padding:36px 40px;text-align:center;">
    <h1 style="margin:0;color:#f5a623;font-size:24px;letter-spacing:1px;">Open Climb Aviation</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,0.55);font-size:12px;letter-spacing:2px;text-transform:uppercase;">A320 Pre-Type Rating Training</p>
  </td></tr>

  <!-- Confirmation banner -->
  <tr><td style="background:#27ae60;padding:18px 40px;text-align:center;">
    <p style="margin:0;color:#fff;font-size:16px;font-weight:700;">&#10003;&nbsp; Payment Confirmed!</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#fff;padding:40px;">
    <h2 style="color:#0d1b2a;margin:0 0 16px;">You're enrolled, ${studentName}! ✈️</h2>
    <p style="color:#555;line-height:1.8;margin:0 0 24px;">
      Your payment for <strong>${courseName}</strong> has been received and your enrollment is now <strong style="color:#27ae60;">active</strong>.
    </p>

    <!-- Receipt box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;border-radius:10px;margin-bottom:28px;">
      <tr><td style="padding:24px 28px;">
        <p style="margin:0 0 14px;color:#0d1b2a;font-weight:700;font-size:15px;">Payment Receipt</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:8px 0;color:#888;font-size:13px;">Course</td>
            <td style="padding:8px 0;color:#0d1b2a;font-weight:600;font-size:13px;text-align:right;">${courseName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-top:1px solid #e8edf5;color:#888;font-size:13px;">Amount Paid</td>
            <td style="padding:8px 0;border-top:1px solid #e8edf5;color:#27ae60;font-weight:700;font-size:15px;text-align:right;">${fmtInr(amount)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-top:1px solid #e8edf5;color:#888;font-size:13px;">Payment ID</td>
            <td style="padding:8px 0;border-top:1px solid #e8edf5;color:#555;font-size:12px;text-align:right;font-family:monospace;">${paymentId}</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <!-- Next steps -->
    <p style="color:#0d1b2a;font-weight:700;font-size:15px;margin:0 0 14px;">What happens next?</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="width:32px;vertical-align:top;padding:0 12px 14px 0;">
          <div style="width:28px;height:28px;background:#2196f3;border-radius:50%;text-align:center;line-height:28px;color:#fff;font-weight:700;font-size:13px;">1</div>
        </td>
        <td style="vertical-align:top;padding-bottom:14px;">
          <p style="margin:0;color:#0d1b2a;font-weight:600;font-size:13px;">Capt. Jay will reach out within 24 hours</p>
          <p style="margin:4px 0 0;color:#888;font-size:12px;">Via WhatsApp or email to confirm your schedule</p>
        </td>
      </tr>
      <tr>
        <td style="width:32px;vertical-align:top;padding:0 12px 14px 0;">
          <div style="width:28px;height:28px;background:#f5a623;border-radius:50%;text-align:center;line-height:28px;color:#0d1b2a;font-weight:700;font-size:13px;">2</div>
        </td>
        <td style="vertical-align:top;padding-bottom:14px;">
          <p style="margin:0;color:#0d1b2a;font-weight:600;font-size:13px;">Study materials will be shared</p>
          <p style="margin:4px 0 0;color:#888;font-size:12px;">PDFs, videos, and reference documents for your course</p>
        </td>
      </tr>
      <tr>
        <td style="width:32px;vertical-align:top;padding:0 12px 0 0;">
          <div style="width:28px;height:28px;background:#27ae60;border-radius:50%;text-align:center;line-height:28px;color:#fff;font-weight:700;font-size:13px;">3</div>
        </td>
        <td style="vertical-align:top;">
          <p style="margin:0;color:#0d1b2a;font-weight:600;font-size:13px;">Sessions begin at your convenience</p>
          <p style="margin:4px 0 0;color:#888;font-size:12px;">Flexible scheduling around your training timeline</p>
        </td>
      </tr>
    </table>

    <!-- Contact box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff8e8;border:1px solid #f5a623;border-radius:10px;margin-bottom:24px;">
      <tr><td style="padding:18px 22px;">
        <p style="margin:0 0 6px;color:#0d1b2a;font-weight:700;font-size:13px;">&#128222;&nbsp; Contact Capt. Jay Kotecha</p>
        <p style="margin:0;color:#555;font-size:13px;">
          Email: <a href="mailto:${process.env.ADMIN_EMAIL}" style="color:#2196f3;">${process.env.ADMIN_EMAIL}</a><br/>
          ${whatsapp ? `WhatsApp: ${whatsapp}` : ''}
        </p>
      </td></tr>
    </table>

    <p style="color:#aaa;font-size:12px;margin:0;">Keep this email for your records. Your payment ID is your proof of enrollment.</p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#0d1b2a;border-radius:0 0 14px 14px;padding:22px 40px;text-align:center;">
    <p style="margin:0;color:rgba(255,255,255,0.4);font-size:12px;">&copy; 2025 Open Climb Aviation &nbsp;|&nbsp; Capt. Jay Kotecha</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function adminEnrollmentHtml({ studentName, studentEmail, studentWhatsapp, courseName, amount, paymentId }) {
  const rows = [
    ['Student Name',  studentName            || '—'],
    ['Email',         studentEmail           || '—'],
    ['WhatsApp',      studentWhatsapp        || '—'],
    ['Course',        courseName             || '—'],
    ['Amount Paid',   fmtInr(amount)],
    ['Payment ID',    paymentId              || '—'],
    ['Enrolled At',   new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })]
  ];
  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:11px 16px;background:#f4f7fb;font-weight:600;color:#0d1b2a;font-size:13px;width:35%;border-bottom:1px solid #e8edf5;">${label}</td>
      <td style="padding:11px 16px;color:#444;font-size:13px;border-bottom:1px solid #e8edf5;">${value}</td>
    </tr>`).join('');

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="background:#0d1b2a;border-radius:14px 14px 0 0;padding:28px 36px;">
    <h2 style="margin:0;color:#f5a623;font-size:20px;">&#127881; New Student Enrolled!</h2>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.5);font-size:12px;">Open Climb Aviation — Admin Notification</p>
  </td></tr>
  <tr><td style="background:#27ae60;padding:14px 36px;">
    <p style="margin:0;color:#fff;font-size:14px;font-weight:600;">Payment of ${fmtInr(amount)} confirmed for ${courseName}</p>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 36px;">
    <p style="color:#555;margin:0 0 20px;line-height:1.7;font-size:14px;">A new student has completed payment. Here are the full details:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8edf5;border-radius:8px;overflow:hidden;">
      ${tableRows}
    </table>
    <p style="margin:22px 0 0;color:#888;font-size:12px;">
      Manage this enrollment in your <a href="${process.env.FRONTEND_URL || '#'}/admin.html" style="color:#2196f3;">admin panel</a>.
    </p>
  </td></tr>
  <tr><td style="background:#0d1b2a;border-radius:0 0 14px 14px;padding:18px 36px;text-align:center;">
    <p style="margin:0;color:rgba(255,255,255,0.35);font-size:12px;">&copy; 2025 Open Climb Aviation</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function adminUpiClaimHtml({ studentName, studentEmail, studentWhatsapp, courseName, amount, utr, coupon }) {
  const rows = [
    ['Student Name',  studentName     || '—'],
    ['Email',         studentEmail    || '—'],
    ['WhatsApp',      studentWhatsapp || '—'],
    ['Course',        courseName      || '—'],
    ['Amount',        fmtInr(amount)],
    ...(coupon ? [['Coupon Applied', coupon]] : []),
    ['UPI Ref (UTR)', utr             || '—'],
    ['Paid To',       `${UPI_PAYEE} (${UPI_ID})`],
    ['Claimed At',    new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })]
  ];
  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:11px 16px;background:#f4f7fb;font-weight:600;color:#0d1b2a;font-size:13px;width:35%;border-bottom:1px solid #e8edf5;">${label}</td>
      <td style="padding:11px 16px;color:#444;font-size:13px;border-bottom:1px solid #e8edf5;">${value}</td>
    </tr>`).join('');

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="background:#0d1b2a;border-radius:14px 14px 0 0;padding:28px 36px;">
    <h2 style="margin:0;color:#f5a623;font-size:20px;">&#128241; UPI Payment Claimed — Action Needed</h2>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.5);font-size:12px;">Open Climb Aviation — Admin Notification</p>
  </td></tr>
  <tr><td style="background:#f5a623;padding:14px 36px;">
    <p style="margin:0;color:#0d1b2a;font-size:14px;font-weight:700;">${studentName} says they paid ${fmtInr(amount)} for ${courseName}</p>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 36px;">
    <p style="color:#555;margin:0 0 20px;line-height:1.7;font-size:14px;">
      A student submitted a UPI payment claim. <strong>Please verify the UTR in your bank/UPI app</strong>, then mark the enrollment active in the admin panel.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8edf5;border-radius:8px;overflow:hidden;">
      ${tableRows}
    </table>
    <p style="margin:22px 0 0;color:#888;font-size:12px;">
      Open the <a href="${process.env.FRONTEND_URL || '#'}/admin.html" style="color:#2196f3;">admin panel</a> to confirm and activate.
    </p>
  </td></tr>
  <tr><td style="background:#0d1b2a;border-radius:0 0 14px 14px;padding:18px 36px;text-align:center;">
    <p style="margin:0;color:rgba(255,255,255,0.35);font-size:12px;">&copy; 2025 Open Climb Aviation</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── POST /api/payment/create-order ────────────────────────────────────────────
router.post('/create-order', verifyToken, async (req, res) => {
  if (!razorpay) return razorpayDisabled(res);

  const { course_id } = req.body;
  if (!course_id) return fail(res, 'course_id is required');

  // 1. Fetch course
  const { data: course, error: courseErr } = await supabase
    .from('courses')
    .select('id, name, price, duration_days')
    .eq('id', course_id)
    .eq('is_active', true)
    .maybeSingle();

  if (courseErr || !course) return fail(res, 'Course not found.', [], 404);

  // 2. Check for existing enrollment — reuse pending, block paid/active/completed
  const { data: existing } = await supabase
    .from('enrollments')
    .select('id, status')
    .eq('user_id', req.user.id)
    .eq('course_id', course_id)
    .maybeSingle();

  if (existing && existing.status !== 'pending') {
    return fail(res, `You are already enrolled in this course (status: ${existing.status}).`, [], 409);
  }

  // 3. Create or reuse enrollment
  let enrollmentId;
  if (existing) {
    enrollmentId = existing.id;
  } else {
    const { data: newEnr, error: enrErr } = await supabase
      .from('enrollments')
      .insert({ user_id: req.user.id, course_id, status: 'pending' })
      .select('id')
      .single();
    if (enrErr) {
      console.error('Enrollment insert error:', enrErr);
      return fail(res, 'Failed to create enrollment. Please try again.', [], 500);
    }
    enrollmentId = newEnr.id;
  }

  // 4. Create Razorpay order
  let order;
  try {
    order = await razorpay.orders.create({
      amount:   course.price,
      currency: 'INR',
      receipt:  `receipt_${Date.now()}`,
      notes: {
        course_name: course.name,
        user_email:  req.user.email,
        user_name:   req.user.name
      }
    });
  } catch (err) {
    console.error('Razorpay order error:', err);
    return fail(res, 'Payment gateway error. Please try again.', [], 502);
  }

  // 5. Record payment row
  const { error: payErr } = await supabase
    .from('payments')
    .insert({
      user_id:           req.user.id,
      enrollment_id:     enrollmentId,
      razorpay_order_id: order.id,
      amount:            course.price,
      status:            'created'
    });

  if (payErr) {
    console.error('Payment insert error:', payErr);
    return fail(res, 'Failed to record payment. Please try again.', [], 500);
  }

  return ok(res, {
    order_id:      order.id,
    amount:        order.amount,
    currency:      order.currency,
    key_id:        process.env.RAZORPAY_KEY_ID,
    enrollment_id: enrollmentId,
    user_name:     req.user.name,
    user_email:    req.user.email,
    course_name:   course.name
  }, 'Order created successfully.');
});

// ── POST /api/payment/verify ──────────────────────────────────────────────────
router.post('/verify', verifyToken, async (req, res) => {
  if (!razorpay) return razorpayDisabled(res);

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, enrollment_id } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !enrollment_id) {
    return fail(res, 'Missing required payment verification fields.');
  }

  // 1. Verify HMAC-SHA256 signature
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature) {
    // Mark payment as failed for audit trail
    await supabase
      .from('payments')
      .update({ status: 'failed' })
      .eq('razorpay_order_id', razorpay_order_id);

    return fail(res, 'Payment signature verification failed. Contact support if amount was deducted.', [], 400);
  }

  // 2. Update payment record
  const { error: payErr } = await supabase
    .from('payments')
    .update({
      razorpay_payment_id,
      razorpay_signature,
      status: 'paid'
    })
    .eq('razorpay_order_id', razorpay_order_id);

  if (payErr) {
    console.error('Payment update error:', payErr);
    return fail(res, 'Failed to update payment record. Please contact support.', [], 500);
  }

  // 3. Activate enrollment
  const { error: enrErr } = await supabase
    .from('enrollments')
    .update({ status: 'active', payment_id: razorpay_payment_id })
    .eq('id', enrollment_id)
    .eq('user_id', req.user.id);

  if (enrErr) {
    console.error('Enrollment update error:', enrErr);
    return fail(res, 'Payment recorded but enrollment update failed. Please contact support.', [], 500);
  }

  // 4. Fetch course details for emails
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('courses(id, name, price)')
    .eq('id', enrollment_id)
    .single();

  const courseName  = enrollment?.courses?.name  || 'your course';
  const coursePrice = enrollment?.courses?.price || 0;

  // 5. Fire emails — non-blocking
  const studentEmailData = {
    studentName:     req.user.name,
    courseName,
    amount:          coursePrice,
    paymentId:       razorpay_payment_id,
    whatsapp:        req.user.whatsapp
  };

  sendEmail({
    to:      req.user.email,
    subject: 'Payment Confirmed — Open Climb Aviation ✈️',
    html:    studentConfirmationHtml(studentEmailData)
  }, 'Student confirmation email');

  sendEmail({
    to:      process.env.ADMIN_EMAIL,
    subject: `New Student Enrolled — ${req.user.name}`,
    html:    adminEnrollmentHtml({
      studentName:     req.user.name,
      studentEmail:    req.user.email,
      studentWhatsapp: req.user.whatsapp,
      courseName,
      amount:          coursePrice,
      paymentId:       razorpay_payment_id
    })
  }, 'Admin enrollment email');

  return ok(res, { enrollment_id }, 'Payment verified. Enrollment is now active!');
});

// ── GET /api/payment/my-enrollments ──────────────────────────────────────────
router.get('/my-enrollments', verifyToken, async (req, res) => {
  const { data, error } = await supabase
    .from('enrollments')
    .select(`
      id,
      status,
      enrolled_at,
      payment_id,
      courses (
        id,
        name,
        slug,
        description,
        price,
        duration_days
      )
    `)
    .eq('user_id', req.user.id)
    .order('enrolled_at', { ascending: false });

  if (error) {
    console.error('Fetch enrollments error:', error);
    return fail(res, 'Failed to fetch enrollments.', [], 500);
  }

  return ok(res, { enrollments: data || [] }, 'Enrollments fetched successfully.');
});

// ── POST /api/payment/upi-init ────────────────────────────────────────────────
// Primary payment method. Creates/reuses a pending enrollment and returns the
// details the browser needs to render the UPI QR code and pay-to box.
router.post('/upi-init', verifyToken, async (req, res) => {
  const { course_id, coupon } = req.body;
  if (!course_id) return fail(res, 'course_id is required');

  // 1. Fetch course
  const { data: course, error: courseErr } = await supabase
    .from('courses')
    .select('id, name, price, duration_days')
    .eq('id', course_id)
    .eq('is_active', true)
    .maybeSingle();

  if (courseErr || !course) return fail(res, 'Course not found.', [], 404);

  // 1b. Resolve coupon server-side. Reject an explicitly-wrong code so the
  //     client can show an error and keep full price.
  const couponResult = resolveCoupon(coupon, course.price);
  if (!couponResult.valid) {
    return fail(res, 'Invalid coupon code.', [], 400);
  }

  // 2. Block if already enrolled (paid/active/completed). Allow pending and
  //    payment_claimed to continue so a student can re-show the QR / re-submit.
  const { data: existing } = await supabase
    .from('enrollments')
    .select('id, status')
    .eq('user_id', req.user.id)
    .eq('course_id', course_id)
    .maybeSingle();

  if (existing && ['paid', 'active', 'completed'].includes(existing.status)) {
    return fail(res, `You are already enrolled in this course (status: ${existing.status}).`, [], 409);
  }

  // 3. Create or reuse enrollment
  let enrollmentId;
  if (existing) {
    enrollmentId = existing.id;
  } else {
    const { data: newEnr, error: enrErr } = await supabase
      .from('enrollments')
      .insert({ user_id: req.user.id, course_id, status: 'pending' })
      .select('id')
      .single();
    if (enrErr) {
      console.error('Enrollment insert error:', enrErr);
      return fail(res, 'Failed to create enrollment. Please try again.', [], 500);
    }
    enrollmentId = newEnr.id;
  }

  return ok(res, {
    enrollment_id:   enrollmentId,
    amount:          couponResult.amount,     // paise — discounted if coupon applied
    original_amount: course.price,            // paise — pre-discount
    coupon_applied:  couponResult.applied,
    coupon_code:     couponResult.code,       // the canonical code if applied, else null
    course_name:     course.name,
    upi_id:          UPI_ID,
    payee_name:      UPI_PAYEE,
    user_name:       req.user.name,
    user_email:      req.user.email
  }, couponResult.applied ? 'Coupon applied.' : 'UPI payment details ready.');
});

// ── POST /api/payment/upi-claim ───────────────────────────────────────────────
// Student confirms they paid and submits their UPI reference (UTR). We mark the
// enrollment "payment_claimed" and email the admin to verify & activate.
router.post('/upi-claim', verifyToken, async (req, res) => {
  const { enrollment_id, coupon } = req.body;
  const utr = (req.body.utr || '').toString().trim();

  if (!enrollment_id) return fail(res, 'enrollment_id is required.');
  if (!utr)           return fail(res, 'Please enter your UPI reference (UTR) number.');
  // UPI UTR is standardly 12 digits; allow 12–22 to be safe across banks.
  if (!/^\d{12,22}$/.test(utr)) {
    return fail(res, 'That UTR doesn\'t look right. Enter the 12-digit reference (UTR) number from your UPI app (numbers only).');
  }

  // 1. Load the enrollment (must belong to this user) + course details for email
  const { data: enrollment, error: enrErr } = await supabase
    .from('enrollments')
    .select('id, status, courses(name, price)')
    .eq('id', enrollment_id)
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (enrErr || !enrollment) return fail(res, 'Enrollment not found.', [], 404);

  if (['paid', 'active', 'completed'].includes(enrollment.status)) {
    return fail(res, `This enrollment is already ${enrollment.status}.`, [], 409);
  }

  // 2. Re-resolve the coupon server-side so the recorded/emailed amount always
  //    matches what the student was shown and what the QR encoded.
  const coursePrice  = enrollment?.courses?.price || 0;
  const couponResult = resolveCoupon(coupon, coursePrice);
  const paidAmount   = couponResult.amount;

  // 3. Record the claim
  const { error: updErr } = await supabase
    .from('enrollments')
    .update({ status: 'payment_claimed', upi_utr: utr })
    .eq('id', enrollment_id)
    .eq('user_id', req.user.id);

  if (updErr) {
    console.error('UPI claim update error:', updErr);
    return fail(res, 'Failed to record your payment claim. Please try again.', [], 500);
  }

  // 3b. Best-effort persistence of the applied amount + coupon. These columns are
  //     added by the migration in schema.sql; if they don't exist yet the claim
  //     still succeeds (the amount is always captured in the admin email below).
  const { error: amtErr } = await supabase
    .from('enrollments')
    .update({ paid_amount: paidAmount, coupon_code: couponResult.code })
    .eq('id', enrollment_id)
    .eq('user_id', req.user.id);
  if (amtErr) {
    console.warn('Could not persist paid_amount/coupon_code (run the migration?):', amtErr.message);
  }

  const courseName = enrollment?.courses?.name || 'your course';

  // 4. Email the admin to verify the UTR — non-blocking
  sendEmail({
    to:      process.env.ADMIN_EMAIL,
    subject: `UPI Payment Claimed — ${req.user.name} (₹${(paidAmount / 100).toLocaleString('en-IN')})`,
    html:    adminUpiClaimHtml({
      studentName:     req.user.name,
      studentEmail:    req.user.email,
      studentWhatsapp: req.user.whatsapp,
      courseName,
      amount:          paidAmount,
      utr,
      coupon:          couponResult.code
    })
  }, 'Admin UPI-claim email');

  return ok(res, { enrollment_id, status: 'payment_claimed' },
    'Thanks! We\'ve recorded your payment. Capt. Jay will verify and confirm your enrollment shortly.');
});

module.exports = router;
