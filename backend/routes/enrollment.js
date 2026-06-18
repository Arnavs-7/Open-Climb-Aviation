const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function ok(res, data, message = 'Success', status = 200) {
  return res.status(status).json({ success: true, message, data });
}
function fail(res, message, errors = [], status = 400) {
  return res.status(status).json({ success: false, message, errors });
}

// ── GET /api/enrollment/courses — public ──────────────────────────────────────
router.get('/courses', async (req, res) => {
  const { data, error } = await supabase
    .from('courses')
    .select('id, name, slug, description, price, duration_days')
    .eq('is_active', true)
    .order('created_at');

  if (error) {
    console.error('Fetch courses error:', error);
    return fail(res, 'Failed to fetch courses.', [], 500);
  }

  return ok(res, { courses: data || [] }, 'Courses fetched successfully.');
});

// ── GET /api/enrollment/my-courses — protected ────────────────────────────────
// Returns only active (paid/active/completed) enrollments with full course details
router.get('/my-courses', verifyToken, async (req, res) => {
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
    .in('status', ['paid', 'active', 'completed'])
    .order('enrolled_at', { ascending: false });

  if (error) {
    console.error('Fetch my-courses error:', error);
    return fail(res, 'Failed to fetch your courses.', [], 500);
  }

  return ok(res, { enrollments: data || [] }, 'Active courses fetched successfully.');
});

// ── GET /api/enrollment/my — protected ───────────────────────────────────────
// All enrollments including pending
router.get('/my', verifyToken, async (req, res) => {
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
    console.error('Fetch my enrollments error:', error);
    return fail(res, 'Failed to fetch enrollments.', [], 500);
  }

  return ok(res, { enrollments: data || [] }, 'Enrollments fetched successfully.');
});

// ── GET /api/enrollment/:id — protected ──────────────────────────────────────
// Must be defined AFTER all specific paths to avoid swallowing /my, /my-courses, /courses
router.get('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;

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
      ),
      payments (
        id,
        amount,
        status,
        razorpay_order_id,
        razorpay_payment_id,
        created_at
      )
    `)
    .eq('id', id)
    .eq('user_id', req.user.id)   // ensures users can only see their own enrollments
    .maybeSingle();

  if (error) {
    console.error('Fetch enrollment error:', error);
    return fail(res, 'Failed to fetch enrollment details.', [], 500);
  }

  if (!data) return fail(res, 'Enrollment not found.', [], 404);

  return ok(res, { enrollment: data }, 'Enrollment fetched successfully.');
});

module.exports = router;
