const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── POST /api/track ─────────────────────────────────────────────────────────────
// Public, fire-and-forget page-view logging. Always responds 204 immediately and
// never surfaces an error to the visitor — tracking must never block or break a
// page. The insert runs after the response is sent and swallows any failure
// (e.g. the page_views table not yet created).
router.post('/', [
  body('path').optional().isString().isLength({ max: 512 }),
  body('visitor_id').optional().isString().isLength({ max: 128 })
], (req, res) => {
  res.status(204).end();

  try {
    if (!validationResult(req).isEmpty()) return;

    const path       = (req.body.path || '/').toString().slice(0, 512);
    const visitor_id = req.body.visitor_id ? req.body.visitor_id.toString().slice(0, 128) : null;

    supabase
      .from('page_views')
      .insert({ path, visitor_id })
      .then(({ error }) => { if (error) console.warn('Track insert failed:', error.message); })
      .catch(() => { /* swallow — response already sent */ });
  } catch {
    /* never throw — response already sent */
  }
});

module.exports = router;
