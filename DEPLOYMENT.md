# Open Climb Aviation — Deployment Guide

Click-by-click steps to take the site from local code to a live production
deployment. Anything that needs **your** logins or payment is called out clearly.

**Architecture (all free except the domain):**

```
   Visitor
      │
      ▼
  [ Custom domain ]  ──root──►  Netlify   (static frontend: index/dashboard/admin.html)
                     ──api.──►  Render    (Express API)  ──►  Supabase (Postgres)
                                                          ──►  Razorpay (payments)
                                                          ──►  Gmail SMTP (email)
```

| Piece     | Host               | Cost            |
|-----------|--------------------|-----------------|
| Frontend  | Netlify            | Free            |
| Backend   | Render web service | Free            |
| Database  | Supabase           | Free            |
| Payments  | Razorpay           | Per-transaction |
| Email     | Gmail SMTP         | Free            |
| Domain    | Cloudflare Registrar | ~₹900/yr      |
| Keep-alive| cron-job.org       | Free            |

> **Order matters.** Do the steps top to bottom — later steps need URLs/keys
> produced by earlier ones.

---

## 0. One-time: push the code to GitHub

See **Section 5** in the task / the commands below. The repo must be on GitHub
before Render can deploy from it. Do this first, then continue.

---

## a) Buy a domain — Cloudflare Registrar (~₹900/yr)  *[needs your login + card]*

Cloudflare Registrar sells domains at wholesale (no markup, free WHOIS privacy,
free SSL). Recommended names (check availability):

1. **`openclimbaviation.com`**  ← recommended (clear, brandable, international)
2. `openclimbaviation.in`  (cheaper, India-focused)
3. `openclimb.aero` (aviation TLD, pricier) or `flyopenclimb.com`

Steps:

1. Create/log in at <https://dash.cloudflare.com>.
2. Left sidebar → **Domain Registration → Register Domains**.
3. Search your chosen name, add to cart, complete payment.
4. The domain now appears as a "zone" in your Cloudflare dashboard with DNS you
   control. You'll add DNS records in **step (e)**.

> If a name is taken, Cloudflare suggests alternatives at checkout.

---

## b) Production Supabase project  *[needs your login]*

1. Go to <https://supabase.com/dashboard> → **New project**.
   - Name: `openclimb-aviation`
   - Database password: generate a strong one and **save it** (you rarely need it
     again, but keep it safe).
   - Region: **Mumbai / Singapore** (closest to India).
   - Plan: **Free**.
2. Wait ~2 min for provisioning.
3. **Run the schema:** left sidebar → **SQL Editor** → **New query**. Open
   `backend/schema.sql` from this repo, copy the **entire** file, paste, click
   **Run**. You should see "Success. No rows returned." This creates all tables,
   indexes, RLS, and seeds the two default courses.
4. **Copy your keys:** left sidebar → **Project Settings → API**:
   - **Project URL** → this is `SUPABASE_URL`.
   - **`service_role` secret key** (click "Reveal") → this is
     `SUPABASE_SERVICE_KEY`.
     ⚠️ Use the **service_role** key, NOT the anon key. Keep it secret — never put
     it in the frontend.
5. Hold onto these two values for step (c).

> **Create your admin login later:** there's no admin sign-up page. After the
> site is live, register normally on the website, then in Supabase SQL Editor run:
> `UPDATE users SET role = 'admin' WHERE email = 'YOUR_EMAIL';`

---

## c) Deploy the backend to Render  *[needs your login]*

Render's free web service is perfect for ~50 users/month. It sleeps after ~15
min of inactivity (first request after sleep takes ~30–50s to wake) — step (h)
fixes that with a keep-alive ping.

1. Go to <https://render.com> → sign up / log in (use "Sign in with GitHub" so it
   can see your repos).
2. **New → Web Service** → connect your `openclimb-aviation` GitHub repo.
3. Configure:
   - **Name:** `openclimb-aviation-api`
   - **Region:** Singapore
   - **Branch:** `main`
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**

   *(The repo also ships `backend/render.yaml` — alternatively choose
   **New → Blueprint** and Render reads all of this automatically.)*
4. **Health Check Path:** in Advanced settings set it to `/api/health`.
5. **Environment variables** — click **Add Environment Variable** for each
   (these are secrets; do NOT commit them):

   | Key                    | Value |
   |------------------------|-------|
   | `NODE_VERSION`         | `20` |
   | `PORT`                 | `5000` |
   | `SUPABASE_URL`         | *(from step b)* |
   | `SUPABASE_SERVICE_KEY` | *(service_role key from step b)* |
   | `JWT_SECRET`           | run `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and paste the output |
   | `RAZORPAY_KEY_ID`      | start with your **test** key `rzp_test_...` (swap to live in step f) |
   | `RAZORPAY_KEY_SECRET`  | matching test secret |
   | `EMAIL_USER`           | the sending Gmail address |
   | `EMAIL_PASS`           | Gmail **App Password** (see step g / `.env.example`) |
   | `FRONTEND_URL`         | `https://jaywebsiteklm.netlify.app` for now (update to your domain in step e) |
   | `ADMIN_EMAIL`          | inbox for enquiry/enrollment notifications |

6. Click **Create Web Service**. Watch the logs — success looks like
   `Open Climb Aviation API running on port ...`.
7. **Copy the service URL**, e.g. `https://openclimb-aviation-api.onrender.com`.
8. **Verify it's live:** open `https://<your-render-url>/api/health` in a browser.
   You should see `{"status":"ok","timestamp":"..."}`.

---

## d) Point the frontend at the real backend, redeploy Netlify

1. In this repo, open **all three** frontend files and replace the placeholder
   `REPLACE_WITH_RENDER_URL` with your Render host (no `https://`, no trailing
   `/api` — just the host):
   - `frontend/index.html`     (~line 1239)
   - `frontend/dashboard.html`  (~line 1092)
   - `frontend/admin.html`      (~line 344)

   Each line should end up like:
   ```js
   : 'https://openclimb-aviation-api.onrender.com/api';
   ```
2. Commit and push:
   ```powershell
   git add frontend/index.html frontend/dashboard.html frontend/admin.html
   git commit -m "Point frontend at production Render API"
   git push
   ```
3. **Redeploy Netlify:**
   - If your Netlify site is connected to this GitHub repo, the push auto-deploys.
   - If it's a manual/drag-drop deploy, go to <https://app.netlify.com> → your
     site → **Deploys** → drag the `frontend/` folder onto the deploy area, OR
     **Trigger deploy → Deploy site**.
4. Visit `https://jaywebsiteklm.netlify.app`, open DevTools → Network, submit the
   enquiry form, and confirm the request goes to your `onrender.com` URL and
   returns success.

> Because `API_BASE` is `localhost`-aware, opening the HTML files locally still
> talks to your local backend — production untouched.

---

## e) Connect the custom domain (root → Netlify, `api.` → Render)

**Root domain → Netlify (frontend):**

1. Netlify → your site → **Domain management → Add a domain** → enter
   `openclimbaviation.com` → **Verify** → **Add**.
2. Netlify shows the DNS target. In **Cloudflare → your domain → DNS → Records**
   add what Netlify asks for, typically:
   - `CNAME  www   <your-site>.netlify.app`  (Proxy status: **DNS only / grey
     cloud** — Netlify manages its own SSL)
   - For the root/apex: add Netlify's load-balancer **A record** `75.2.60.5`
     (Netlify shows the current value) OR use Cloudflare's CNAME flattening with
     `CNAME  @  <your-site>.netlify.app`.
3. In Netlify, set the **primary domain** and enable **HTTPS** (Let's Encrypt,
   automatic, free). Certificate provisioning takes a few minutes.

**`api.` subdomain → Render (backend) — optional but recommended:**

1. Render → your service → **Settings → Custom Domains → Add Custom Domain** →
   `api.openclimbaviation.com`.
2. Render gives you a `CNAME` target like
   `openclimb-aviation-api.onrender.com`. In Cloudflare DNS add:
   - `CNAME  api   openclimb-aviation-api.onrender.com`  (Proxy: **DNS only /
     grey cloud** so Render can issue its own SSL).
3. Wait for Render to show "Certificate issued" (free SSL).
4. **If you use the `api.` subdomain**, update two things:
   - Render env `FRONTEND_URL` → `https://openclimbaviation.com`, and add the
     domain to the CORS allow-list in `backend/server.js` (uncomment the TODO
     lines), commit, push (Render auto-redeploys).
   - The three frontend files' `API_BASE` → `https://api.openclimbaviation.com/api`,
     then redeploy Netlify (step d).

> Keeping the plain `onrender.com` URL is totally fine too — the `api.` subdomain
> is just nicer branding. If you skip it, only update `FRONTEND_URL` to your root
> domain and add the root domain to CORS.

---

## f) Razorpay — go live  *[needs your login + KYC]*

1. <https://dashboard.razorpay.com> → complete **KYC / Activation** (business
   details, bank account, PAN/GST). Approval can take 1–2 business days.
2. Once **Live mode** is enabled, go to **Settings → API Keys → Generate Live
   Keys**. Copy `rzp_live_...` key id + secret (the secret is shown once — save it).
3. In Render → Environment, replace:
   - `RAZORPAY_KEY_ID` → `rzp_live_...`
   - `RAZORPAY_KEY_SECRET` → live secret
   Save → Render redeploys automatically.
4. The frontend gets the key id from the backend at order-creation time, so no
   frontend change is needed.

> Until live KYC is approved, keep the **test** keys and use Razorpay test cards
> (see the test checklist below) so you can fully exercise the flow.

---

## g) Email — Gmail App Password & FormSubmit

**Gmail App Password** (for the nodemailer transactional emails):

1. The sending Gmail account must have **2-Step Verification ON**
   (Google Account → Security).
2. Visit <https://myaccount.google.com/apppasswords> → app name
   "Open Climb Aviation" → **Create**.
3. Copy the 16-char code, remove spaces, set it as `EMAIL_PASS` in Render.
   Full walkthrough is also in `backend/.env.example`.

**FormSubmit activation** (only if any static form posts to FormSubmit for
`training.ocaa@gmail.com`):

1. The very first submission to `https://formsubmit.co/training.ocaa@gmail.com`
   triggers a confirmation email from FormSubmit to that inbox.
2. Open that email and click **Activate Form** once. Subsequent submissions then
   deliver without the prompt.

> Note: the main enquiry/enrollment emails in this app are sent by the **backend
> via nodemailer/Gmail**, not FormSubmit — so the App Password above is the
> important one. Only do the FormSubmit step if a form in the HTML actually
> targets formsubmit.co.

---

## h) Keep-alive ping (stop Render free tier sleeping)

Render free services sleep after ~15 min idle. A cron ping every 14 min keeps it
warm so visitors never hit a cold start.

1. <https://cron-job.org> → sign up (free) → **Create cronjob**.
2. **URL:** `https://<your-render-url>/api/health`
   (or `https://api.openclimbaviation.com/api/health`).
3. **Schedule:** every **14 minutes**.
4. Save & enable. The dashboard will show 200 OK responses.

> This stays comfortably within both Render's and cron-job.org's free limits at
> ~50 users/month.

---

## ✅ Final end-to-end test checklist

Do this in **Razorpay test mode** first (test keys in Render), then once more
after going live with a small real payment if you wish.

- [ ] `https://<render-url>/api/health` returns `{"status":"ok",...}`.
- [ ] Visit the live site (Netlify URL or domain). It loads over HTTPS.
- [ ] **Enquiry:** submit the enquiry form →
      - [ ] success message shows,
      - [ ] a row appears in Supabase **enquiries** table (Table Editor),
      - [ ] admin inbox (`ADMIN_EMAIL`) receives the "New Enrollment Enquiry" email,
      - [ ] the enquirer receives the confirmation email.
- [ ] **Register:** create a student account →
      - [ ] success + redirect to dashboard,
      - [ ] row appears in Supabase **users** table,
      - [ ] welcome email arrives.
- [ ] **Login / logout** works; refreshing the dashboard keeps you signed in.
- [ ] **Payment (test mode):** pick a course → Pay →
      use Razorpay test card `4111 1111 1111 1111`, any future expiry, any CVV,
      OTP `1234` →
      - [ ] payment success screen,
      - [ ] Supabase **payments** row shows `status = paid`,
      - [ ] Supabase **enrollments** row shows `status = active` with `payment_id`,
      - [ ] student gets "Payment Confirmed" email; admin gets "New Student
            Enrolled" email.
- [ ] **Admin:** promote your account to admin (SQL in step b), log into
      `admin.html` →
      - [ ] dashboard stats/revenue load,
      - [ ] students, enrollments, payments, enquiries lists populate,
      - [ ] changing an enquiry/enrollment status persists.
- [ ] **CORS:** the live frontend's requests succeed (no CORS errors in the
      browser console).

When all boxes are checked, swap Razorpay to **live keys** (step f) and you're in
production. 🎉

---

## Quick reference — environment variables

All set in **Render → Environment** (never committed). Template + descriptions
live in `backend/.env.example`.

`PORT` · `SUPABASE_URL` · `SUPABASE_SERVICE_KEY` · `JWT_SECRET` ·
`RAZORPAY_KEY_ID` · `RAZORPAY_KEY_SECRET` · `EMAIL_USER` · `EMAIL_PASS` ·
`FRONTEND_URL` · `ADMIN_EMAIL` · `NODE_VERSION`
