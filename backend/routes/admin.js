const express = require('express');
const router  = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const { createClient } = require('@supabase/supabase-js');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── All admin routes require both middlewares ─────────────────────────────────
router.use(verifyToken, verifyAdmin);

// ── Helpers ───────────────────────────────────────────────────────────────────
function ok(res, data, message = 'Success', status = 200) {
  return res.status(status).json({ success: true, message, data });
}
function fail(res, message, errors = [], status = 400) {
  return res.status(status).json({ success: false, message, errors });
}

function handleValidation(req, res) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    fail(res, 'Validation failed.', result.array().map(e => ({ field: e.path, message: e.msg })));
    return false;
  }
  return true;
}

// Build last N months as { label, year, month } objects (1-indexed month)
function lastNMonths(n = 6) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: d.toLocaleString('en-IN', { month: 'short', year: 'numeric' }),
      year:  d.getFullYear(),
      month: d.getMonth() + 1   // 1-indexed
    });
  }
  return months;
}

// ── GET /api/admin/dashboard ──────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const [
      studentsRes,
      activeEnrRes,
      paidPayRes,
      newEnqRes,
      recentEnrRes,
      recentEnqRes
    ] = await Promise.all([
      supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'student'),
      supabase
        .from('enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      supabase
        .from('payments')
        .select('amount')
        .eq('status', 'paid'),
      supabase
        .from('enquiries')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'new'),
      supabase
        .from('enrollments')
        .select('id, status, enrolled_at, users(id, name, email, whatsapp), courses(id, name, price)')
        .order('enrolled_at', { ascending: false })
        .limit(5),
      supabase
        .from('enquiries')
        .select('id, name, email, whatsapp, course_interest, status, created_at')
        .order('created_at', { ascending: false })
        .limit(5)
    ]);

    const totalRevenuePaise = (paidPayRes.data || []).reduce((s, p) => s + (p.amount || 0), 0);

    return ok(res, {
      stats: {
        total_students:    studentsRes.count   || 0,
        total_enrollments: activeEnrRes.count  || 0,
        total_revenue:     Math.round(totalRevenuePaise / 100),   // in rupees
        new_enquiries:     newEnqRes.count     || 0
      },
      recent_enrollments: recentEnrRes.data  || [],
      recent_enquiries:   recentEnqRes.data  || []
    }, 'Dashboard data fetched.');
  } catch (err) {
    console.error('Dashboard error:', err);
    return fail(res, 'Failed to load dashboard.', [], 500);
  }
});

// ── GET /api/admin/students ───────────────────────────────────────────────────
router.get('/students', async (req, res) => {
  try {
    // Fetch students with nested enrollments → nested payments
    const { data: students, error } = await supabase
      .from('users')
      .select(`
        id, name, email, whatsapp, age, created_at, email_verified,
        enrollments (
          id, status,
          payments ( amount, status )
        )
      `)
      .eq('role', 'student')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Compute summary fields per student in JS
    const enriched = (students || []).map(s => {
      const enrs = s.enrollments || [];
      const totalPaid = enrs
        .flatMap(e => e.payments || [])
        .filter(p => p.status === 'paid')
        .reduce((sum, p) => sum + (p.amount || 0), 0);
      return {
        id:               s.id,
        name:             s.name,
        email:            s.email,
        whatsapp:         s.whatsapp,
        age:              s.age,
        created_at:       s.created_at,
        email_verified:   s.email_verified,
        enrollment_count: enrs.length,
        active_count:     enrs.filter(e => e.status === 'active').length,
        total_paid_paise: totalPaid,
        total_paid_inr:   Math.round(totalPaid / 100)
      };
    });

    return ok(res, { students: enriched }, `${enriched.length} students found.`);
  } catch (err) {
    console.error('Students fetch error:', err);
    return fail(res, 'Failed to fetch students.', [], 500);
  }
});

// ── GET /api/admin/enrollments ────────────────────────────────────────────────
const ENROLLMENT_STATUSES = ['pending', 'payment_claimed', 'paid', 'active', 'completed'];

router.get('/enrollments', [
  query('status').optional().isIn(ENROLLMENT_STATUSES)
    .withMessage(`status must be one of: ${ENROLLMENT_STATUSES.join(', ')}`)
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  try {
    let q = supabase
      .from('enrollments')
      .select('id, status, enrolled_at, payment_id, upi_utr, coupon_code, paid_amount, users(id, name, email, whatsapp, age), courses(id, name, price, duration_days)')
      .order('enrolled_at', { ascending: false });

    if (req.query.status) q = q.eq('status', req.query.status);

    const { data, error } = await q;
    if (error) throw error;

    return ok(res, { enrollments: data || [] }, `${(data || []).length} enrollments found.`);
  } catch (err) {
    console.error('Enrollments fetch error:', err);
    return fail(res, 'Failed to fetch enrollments.', [], 500);
  }
});

// ── PATCH /api/admin/enrollments/:id ─────────────────────────────────────────
router.patch('/enrollments/:id', [
  param('id').isUUID().withMessage('Invalid enrollment ID'),
  body('status').isIn(ENROLLMENT_STATUSES)
    .withMessage(`status must be one of: ${ENROLLMENT_STATUSES.join(', ')}`)
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  try {
    const { data, error } = await supabase
      .from('enrollments')
      .update({ status: req.body.status })
      .eq('id', req.params.id)
      .select('id, status, enrolled_at, users(name, email), courses(name)')
      .single();

    if (error || !data) return fail(res, 'Enrollment not found.', [], 404);

    return ok(res, { enrollment: data }, 'Enrollment status updated.');
  } catch (err) {
    console.error('Enrollment update error:', err);
    return fail(res, 'Failed to update enrollment.', [], 500);
  }
});

// ── GET /api/admin/enquiries ──────────────────────────────────────────────────
const ENQUIRY_STATUSES = ['new', 'contacted', 'enrolled'];

router.get('/enquiries', [
  query('status').optional().isIn(ENQUIRY_STATUSES)
    .withMessage(`status must be one of: ${ENQUIRY_STATUSES.join(', ')}`)
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  try {
    let q = supabase
      .from('enquiries')
      .select('id, name, email, whatsapp, age, course_interest, message, status, created_at')
      .order('created_at', { ascending: false });

    if (req.query.status) q = q.eq('status', req.query.status);

    const { data, error } = await q;
    if (error) throw error;

    return ok(res, { enquiries: data || [] }, `${(data || []).length} enquiries found.`);
  } catch (err) {
    console.error('Enquiries fetch error:', err);
    return fail(res, 'Failed to fetch enquiries.', [], 500);
  }
});

// ── PATCH /api/admin/enquiries/:id ───────────────────────────────────────────
router.patch('/enquiries/:id', [
  param('id').isUUID().withMessage('Invalid enquiry ID'),
  body('status').isIn(ENQUIRY_STATUSES)
    .withMessage(`status must be one of: ${ENQUIRY_STATUSES.join(', ')}`)
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  try {
    const { data, error } = await supabase
      .from('enquiries')
      .update({ status: req.body.status })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) return fail(res, 'Enquiry not found.', [], 404);

    return ok(res, { enquiry: data }, 'Enquiry status updated.');
  } catch (err) {
    console.error('Enquiry update error:', err);
    return fail(res, 'Failed to update enquiry.', [], 500);
  }
});

// ── GET /api/admin/revenue ────────────────────────────────────────────────────
router.get('/revenue', async (req, res) => {
  try {
    // Fetch all paid payments from the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const { data: payments, error } = await supabase
      .from('payments')
      .select('amount, created_at')
      .eq('status', 'paid')
      .gte('created_at', sixMonthsAgo.toISOString())
      .order('created_at');

    if (error) throw error;

    // Build the 6-month skeleton (ensures months with no revenue still appear)
    const months = lastNMonths(6);
    const buckets = {};
    months.forEach(m => {
      buckets[m.label] = { month: m.label, revenue: 0, enrollments: 0 };
    });

    // Aggregate payments into the correct month bucket
    (payments || []).forEach(p => {
      const d = new Date(p.created_at);
      const label = d.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
      if (buckets[label]) {
        buckets[label].revenue     += Math.round((p.amount || 0) / 100);  // rupees
        buckets[label].enrollments += 1;
      }
    });

    const breakdown = months.map(m => buckets[m.label]);
    const totalRevenue     = breakdown.reduce((s, b) => s + b.revenue, 0);
    const totalEnrollments = breakdown.reduce((s, b) => s + b.enrollments, 0);

    return ok(res, {
      breakdown,
      summary: { total_revenue: totalRevenue, total_enrollments: totalEnrollments }
    }, 'Revenue data fetched.');
  } catch (err) {
    console.error('Revenue fetch error:', err);
    return fail(res, 'Failed to fetch revenue data.', [], 500);
  }
});

// ── POST /api/admin/courses ───────────────────────────────────────────────────
router.post('/courses', [
  body('name').trim().notEmpty().withMessage('Course name is required'),
  body('slug').trim().notEmpty().withMessage('Slug is required')
    .matches(/^[a-z0-9-]+$/).withMessage('Slug must be lowercase letters, numbers, and hyphens only'),
  body('description').optional({ checkFalsy: true }).trim(),
  body('price').isInt({ min: 1 }).withMessage('Price must be a positive integer in paise'),
  body('duration_days').isInt({ min: 1 }).withMessage('Duration must be a positive integer')
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  try {
    const { name, slug, description, price, duration_days } = req.body;

    // Check slug uniqueness
    const { data: existing } = await supabase
      .from('courses')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (existing) return fail(res, 'A course with this slug already exists.', [], 409);

    const { data: course, error } = await supabase
      .from('courses')
      .insert({ name, slug, description: description || null, price: parseInt(price), duration_days: parseInt(duration_days) })
      .select()
      .single();

    if (error) throw error;

    return ok(res, { course }, 'Course created successfully.', 201);
  } catch (err) {
    console.error('Course create error:', err);
    return fail(res, 'Failed to create course.', [], 500);
  }
});

// ── PATCH /api/admin/courses/:id ─────────────────────────────────────────────
router.patch('/courses/:id', [
  param('id').isUUID().withMessage('Invalid course ID'),
  body('name').optional({ checkFalsy: true }).trim().notEmpty().withMessage('Name cannot be empty'),
  body('description').optional({ checkFalsy: true }).trim(),
  body('price').optional().isInt({ min: 1 }).withMessage('Price must be a positive integer in paise'),
  body('duration_days').optional().isInt({ min: 1 }).withMessage('Duration must be a positive integer'),
  body('is_active').optional().isBoolean().withMessage('is_active must be true or false')
], async (req, res) => {
  if (!handleValidation(req, res)) return;

  try {
    const allowed = ['name', 'description', 'price', 'duration_days', 'is_active'];
    const updates = {};
    allowed.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    if (!Object.keys(updates).length) {
      return fail(res, 'No valid fields provided to update.');
    }

    const { data: course, error } = await supabase
      .from('courses')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !course) return fail(res, 'Course not found.', [], 404);

    return ok(res, { course }, `Course ${updates.is_active === false ? 'deactivated' : 'updated'} successfully.`);
  } catch (err) {
    console.error('Course update error:', err);
    return fail(res, 'Failed to update course.', [], 500);
  }
});

// ── GET /api/admin/courses ────────────────────────────────────────────────────
router.get('/courses', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('courses')
      .select('id, name, slug, description, price, duration_days, is_active, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return ok(res, { courses: data || [] }, 'Courses fetched.');
  } catch (err) {
    console.error('Admin courses fetch error:', err);
    return fail(res, 'Failed to fetch courses.', [], 500);
  }
});

// ── GET /api/admin/payments ───────────────────────────────────────────────────
router.get('/payments', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('id, amount, status, created_at, razorpay_order_id, razorpay_payment_id, users(name, email, whatsapp), enrollments(courses(name))')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return ok(res, { payments: data || [] }, 'Payments fetched.');
  } catch (err) {
    console.error('Payments fetch error:', err);
    return fail(res, 'Failed to fetch payments.', [], 500);
  }
});

// ── GET /api/admin/coupons ────────────────────────────────────────────────────
// Aggregates coupon usage across enrollments: per code, the total number of
// enrollments that applied it, a per-course breakdown, and the total discount
// given (course.price - paid_amount, summed over rows where both are known).
router.get('/coupons', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('enrollments')
      .select('id, coupon_code, paid_amount, courses(name, price)')
      .not('coupon_code', 'is', null);

    if (error) throw error;

    // code -> { count, by_course: Map(courseName -> { count, discount_paise, discount_known }) }
    const byCode = new Map();

    (data || []).forEach(e => {
      const code = (e.coupon_code || '').trim().toUpperCase();
      if (!code) return;
      const courseName = e.courses?.name || 'Unknown course';

      if (!byCode.has(code)) byCode.set(code, { count: 0, courses: new Map() });
      const entry = byCode.get(code);
      entry.count += 1;

      if (!entry.courses.has(courseName)) {
        entry.courses.set(courseName, { count: 0, discount_paise: 0 });
      }
      const c = entry.courses.get(courseName);
      c.count += 1;

      // Discount is only computable when we know both the original price and
      // the post-coupon paid amount (older enrollments may predate paid_amount).
      const price = e.courses?.price;
      if (price != null && e.paid_amount != null) {
        c.discount_paise += Math.max(0, price - e.paid_amount);
      }
    });

    const coupons = [...byCode.entries()].map(([code, entry]) => {
      const by_course = [...entry.courses.entries()]
        .map(([course, c]) => ({
          course,
          count: c.count,
          discount_inr: Math.round(c.discount_paise / 100)
        }))
        .sort((a, b) => b.count - a.count);

      const total_discount_inr = by_course.reduce((s, c) => s + c.discount_inr, 0);

      return {
        code,
        total_count: entry.count,
        total_discount_inr,
        by_course
      };
    }).sort((a, b) => b.total_count - a.total_count);

    return ok(res, { coupons }, `${coupons.length} coupon code(s) used.`);
  } catch (err) {
    console.error('Coupons fetch error:', err);
    return fail(res, 'Failed to fetch coupon usage.', [], 500);
  }
});

// ── GET /api/admin/visitors ───────────────────────────────────────────────────
// Self-hosted visitor stats from the page_views table: all-time totals, today's
// figures, and a last-7-days daily breakdown. All bucketing is done in UTC (Render
// runs UTC), consistent with how created_at is stored.
router.get('/visitors', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('page_views')
      .select('visitor_id, created_at')
      .order('created_at', { ascending: false })
      .range(0, 99999);   // generous cap; comfortably covers current scale

    if (error) throw error;
    const rows = data || [];

    const now = new Date();
    const startOfTodayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    // Build the last-7-days skeleton (oldest → newest) keyed by YYYY-MM-DD (UTC).
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const ms = startOfTodayMs - i * 86400000;
      const d  = new Date(ms);
      days.push({
        key:    d.toISOString().slice(0, 10),
        date:   d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
        views:  0,
        _uniq:  new Set()
      });
    }
    const dayMap = new Map(days.map(d => [d.key, d]));

    const allUniq   = new Set();
    const todayUniq = new Set();
    let viewsToday  = 0;

    rows.forEach(r => {
      const vid = r.visitor_id || null;
      if (vid) allUniq.add(vid);

      const t = new Date(r.created_at).getTime();
      if (t >= startOfTodayMs) {
        viewsToday++;
        if (vid) todayUniq.add(vid);
      }

      const key = new Date(r.created_at).toISOString().slice(0, 10);
      const bucket = dayMap.get(key);
      if (bucket) {
        bucket.views++;
        if (vid) bucket._uniq.add(vid);
      }
    });

    const daily = days.map(d => ({ date: d.date, views: d.views, uniques: d._uniq.size }));

    return ok(res, {
      total_views:   rows.length,
      total_unique:  allUniq.size,
      views_today:   viewsToday,
      unique_today:  todayUniq.size,
      daily
    }, 'Visitor stats fetched.');
  } catch (err) {
    console.error('Visitors fetch error:', err);
    return fail(res, 'Failed to fetch visitor stats.', [], 500);
  }
});

module.exports = router;
