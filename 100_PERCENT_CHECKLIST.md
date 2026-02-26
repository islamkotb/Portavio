# 🚀 Portavio: 0% → 100% SaaS Launch Checklist

This is the complete, prioritized roadmap to transform Portavio from a self-hosted prototype into a production-ready, revenue-generating SaaS product.

**Current state:** 20% ready (core product works, no billing, no multi-tenancy, no infrastructure)  
**Target state:** 100% ready (live SaaS, accepting payments, handling real customers)  
**Total time:** 8–12 weeks full-time (or 16–24 weeks part-time)

---

## Phase 1: Foundation (Weeks 1–3) — CRITICAL PATH

These changes are **blocking** — nothing else works until these are done.

### ✅ 1.1 — Multi-Tenancy Database Migration

**What:** Add `organizations`, `organization_members`, `invitations` tables. Migrate all data to be scoped by organization.

**Files to change:**
- `database/saas_migration.sql` — already written, just run it
- `backend/server.js` — add `requireOrg` middleware to all routes

**Acceptance criteria:**
- [ ] Run `saas_migration.sql` on dev database without errors
- [ ] Every API route resolves `req.org` from token + org slug
- [ ] User A in Org A cannot see data from Org B
- [ ] Test: Create 2 orgs, 2 users, verify complete isolation

**Time:** 3–4 days

---

### ✅ 1.2 — Stripe Integration

**What:** Add billing with Stripe. Support subscription checkout, webhook handling, and plan enforcement.

**Files to create/modify:**
- `backend/server.js` — add `/api/billing/*` endpoints
- `backend/stripe.js` — new file for Stripe logic
- `frontend/billing.html` — new billing settings page
- `.env` — add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, etc.

**Code to write:**

```javascript
// backend/stripe.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  starter:    { price: process.env.STRIPE_PRICE_STARTER,    limits: { users: 10,  projects: 20  } },
  pro:        { price: process.env.STRIPE_PRICE_PRO,        limits: { users: 50,  projects: 999 } },
  enterprise: { price: process.env.STRIPE_PRICE_ENTERPRISE, limits: { users: 999, projects: 999 } },
};

async function createCheckoutSession(orgId, plan, successUrl, cancelUrl) {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: PLANS[plan].price, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { organizationId: orgId, plan },
  });
  return session.url;
}

async function handleWebhook(rawBody, signature) {
  const event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  
  switch (event.type) {
    case 'checkout.session.completed':
      return await activateSubscription(event.data.object);
    case 'customer.subscription.updated':
      return await updateSubscription(event.data.object);
    case 'customer.subscription.deleted':
      return await cancelSubscription(event.data.object);
    case 'invoice.payment_failed':
      return await handlePaymentFailure(event.data.object);
  }
}

module.exports = { createCheckoutSession, handleWebhook };
```

**Acceptance criteria:**
- [ ] Create test Stripe account, get API keys
- [ ] Create 3 subscription products in Stripe dashboard (Starter $49, Pro $149, Enterprise $499)
- [ ] User can click "Upgrade" → redirected to Stripe checkout → payment succeeds → org.plan updates to 'starter'
- [ ] Stripe webhook endpoint at `/api/billing/webhook` receives events
- [ ] When subscription expires, org is downgraded and features are blocked
- [ ] Test with Stripe test cards (4242 4242 4242 4242)

**Time:** 4–5 days

---

### ✅ 1.3 — Plan Limits Enforcement

**What:** Users on Trial can only have 3 users, 5 projects. Users on Starter get 10 users, 20 projects. Enforce at runtime.

**Code to write:**

```javascript
// backend/middleware/checkLimits.js
const checkPlanLimits = (resource) => async (req, res, next) => {
  const limits = {
    trial:      { users: 3,   projects: 5,   syncsPerDay: 1   },
    starter:    { users: 10,  projects: 20,  syncsPerDay: 24  },
    pro:        { users: 50,  projects: 999, syncsPerDay: 999 },
    enterprise: { users: 999, projects: 999, syncsPerDay: 999 },
  };

  const plan  = req.org.plan;
  const limit = limits[plan]?.[resource];

  if (resource === 'users') {
    const count = await pool.query(
      'SELECT COUNT(*) FROM organization_members WHERE organization_id = $1',
      [req.org.id]
    );
    if (parseInt(count.rows[0].count) >= limit) {
      return res.status(402).json({
        error: 'User limit reached',
        limit,
        current: parseInt(count.rows[0].count),
        upgradeUrl: '/billing',
      });
    }
  }

  if (resource === 'projects') {
    const count = await pool.query(
      `SELECT COUNT(DISTINCT p.id) FROM projects p
       JOIN jira_connections jc ON p.jira_connection_id = jc.id
       WHERE jc.organization_id = $1`,
      [req.org.id]
    );
    if (parseInt(count.rows[0].count) >= limit) {
      return res.status(402).json({
        error: 'Project limit reached',
        limit,
        current: parseInt(count.rows[0].count),
        upgradeUrl: '/billing',
      });
    }
  }

  next();
};
```

**Acceptance criteria:**
- [ ] Trial org with 3 users: 4th invite attempt returns 402 error + upgrade prompt
- [ ] Trial org with 5 projects: 6th project sync is blocked
- [ ] Upgrading to Starter immediately lifts limits to 10 users, 20 projects
- [ ] Test all transitions: trial → starter, starter → pro, pro → cancel → downgrade

**Time:** 2 days

---

### ✅ 1.4 — Email Verification

**What:** New signups receive a verification email. Unverified users can't invite team members or connect Jira.

**Steps:**
1. Install email provider: `npm install @sendgrid/mail` (or use Resend, Postmark)
2. Add `email_verified`, `email_verify_token` columns to users table (already in `saas_migration.sql`)
3. On registration: generate token, save to DB, send email
4. Add `/api/auth/verify-email/:token` endpoint
5. Block certain actions until `email_verified = true`

**Code:**

```javascript
// backend/email.js
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendVerificationEmail(email, token) {
  await sgMail.send({
    to: email,
    from: 'hello@portavio.io',
    subject: 'Verify your Portavio account',
    html: `
      <h1>Welcome to Portavio!</h1>
      <p>Click below to verify your email:</p>
      <a href="${process.env.APP_URL}/verify-email/${token}">Verify Email</a>
    `,
  });
}

// In registration endpoint:
const verifyToken = crypto.randomBytes(32).toString('hex');
await pool.query(
  'UPDATE users SET email_verify_token = $1 WHERE id = $2',
  [verifyToken, userId]
);
await sendVerificationEmail(email, verifyToken);
```

**Acceptance criteria:**
- [ ] New user registers → receives email with verification link
- [ ] Clicking link sets `email_verified = true`
- [ ] Unverified user tries to connect Jira → blocked with "Please verify your email first" message
- [ ] Test with real email address (yours)

**Time:** 1 day

---

### ✅ 1.5 — Password Reset Flow

**What:** Users can reset forgotten passwords via email link.

**Steps:**
1. Add `/api/auth/forgot-password` endpoint (generates token, sends email)
2. Add `/api/auth/reset-password/:token` endpoint (validates token, updates password)
3. Add `password_reset_token`, `password_reset_expires` to users table (already in migration)

**Acceptance criteria:**
- [ ] User clicks "Forgot password" → enters email → receives reset link
- [ ] Link expires after 1 hour
- [ ] User sets new password → can log in with it
- [ ] Old password no longer works

**Time:** 1 day

---

### ✅ 1.6 — Deploy to Production Infrastructure

**What:** Move from local development to real cloud hosting where customers can access it.

**Recommended stack:**
- **Frontend:** Vercel (free)
- **Backend API:** Railway ($10–20/month)
- **Database:** Neon (serverless Postgres, $0–19/month)
- **Redis:** Upstash (job queue, $0–10/month)
- **Email:** Resend ($0–20/month)

**Steps:**

1. **Database (Neon):**
   - Sign up at neon.tech
   - Create database named `portavio_production`
   - Run `schema.sql`, then `saas_migration.sql`
   - Copy connection string

2. **Backend (Railway):**
   - Sign up at railway.app
   - Create new project from GitHub repo
   - Add environment variables:
     ```
     DATABASE_URL=<neon connection string>
     JWT_SECRET=<generate with: openssl rand -hex 32>
     ENCRYPTION_KEY=<generate with: openssl rand -hex 32>
     STRIPE_SECRET_KEY=<from stripe.com>
     STRIPE_WEBHOOK_SECRET=<from stripe.com>
     SENDGRID_API_KEY=<from sendgrid.com>
     APP_URL=https://app.portavio.io
     CORS_ORIGIN=https://app.portavio.io
     NODE_ENV=production
     ```
   - Deploy

3. **Frontend (Vercel):**
   - Sign up at vercel.com
   - Import GitHub repo, set root directory to `frontend/`
   - Set environment variable: `API_BASE=https://your-backend.railway.app`
   - Deploy
   - Add custom domain: `app.portavio.io`

4. **Redis (Upstash):**
   - Sign up at upstash.com
   - Create Redis database
   - Copy `REDIS_URL` to Railway env vars
   - Deploy background worker for sync jobs

**Acceptance criteria:**
- [ ] Can access app at https://app.portavio.io
- [ ] Can register, verify email, log in
- [ ] Can connect Jira and sync (end-to-end test)
- [ ] Backend API responds at https://api.portavio.io/health
- [ ] SSL works (https, not http)
- [ ] Check uptime: https://uptimerobot.com

**Time:** 2–3 days

---

## Phase 2: Core SaaS Features (Weeks 4–6)

These make it functional as a true multi-user SaaS.

### ✅ 2.1 — Team Invitations

**What:** Org owners can invite team members by email.

**Endpoints to add:**
- `POST /api/org/invite` — send invite email
- `GET /api/org/invites` — list pending invites
- `DELETE /api/org/invite/:id` — cancel invite
- `GET /api/auth/accept-invite/:token` — accept and join org

**Frontend:**
- Add "Team" page in settings
- Show list of current members + pending invites
- Invite form: email + role dropdown (admin/member/viewer)

**Acceptance criteria:**
- [ ] Owner invites user@example.com → email sent with join link
- [ ] Recipient clicks link → registers/logs in → auto-joins org
- [ ] New member sees org's Jira data in their dashboard
- [ ] Invite expires after 7 days

**Time:** 2 days

---

### ✅ 2.2 — Automatic Background Sync

**What:** Stop requiring manual clicks to sync. Sync happens automatically based on plan.

**Implementation:**

```javascript
// backend/worker.js (new file)
const Queue = require('bull');
const syncQueue = new Queue('jira-sync', process.env.REDIS_URL);

// Process sync jobs
syncQueue.process(async (job) => {
  const { organizationId } = job.data;
  console.log(`[Sync Worker] Starting sync for org ${organizationId}`);
  
  const conn = await getConnectionForOrg(organizationId);
  if (!conn) return;
  
  await syncJiraData(conn);
  
  // Log completion
  await pool.query(
    'UPDATE jira_connections SET last_sync = NOW() WHERE organization_id = $1',
    [organizationId]
  );
});

// Scheduler: enqueue sync jobs based on plan
async function scheduleAllSyncs() {
  const orgs = await pool.query(`
    SELECT o.id, o.plan, o.subscription_status, jc.id AS conn_id
    FROM organizations o
    JOIN jira_connections jc ON jc.organization_id = o.id
    WHERE o.subscription_status IN ('trialing', 'active')
    AND jc.is_active = true
  `);

  for (const org of orgs.rows) {
    const delayMs = getSyncDelay(org.plan);
    await syncQueue.add(
      { organizationId: org.id },
      {
        delay: delayMs,
        jobId: `sync-${org.id}`,  // prevent duplicates
        removeOnComplete: true,
      }
    );
  }
}

function getSyncDelay(plan) {
  switch (plan) {
    case 'trial':      return 86400000;  // 24 hours
    case 'starter':    return 3600000;   // 1 hour
    case 'pro':        return 900000;    // 15 minutes
    case 'enterprise': return 300000;    // 5 minutes
    default:           return 86400000;
  }
}

// Run scheduler every hour
scheduleAllSyncs();
setInterval(scheduleAllSyncs, 3600000);
```

**Acceptance criteria:**
- [ ] Trial org syncs once every 24 hours automatically
- [ ] Pro org syncs every 15 minutes automatically
- [ ] Manual sync button still works for immediate refresh
- [ ] Failed syncs are retried 3 times before giving up
- [ ] User receives email if sync fails permanently

**Time:** 3 days

---

### ✅ 2.3 — Org Settings Page

**What:** Admin panel for managing the workspace.

**Tabs to build:**
1. **General:** Org name, logo, slug
2. **Members:** List, invite, remove, change roles
3. **Billing:** Current plan, payment method, invoices, upgrade/downgrade
4. **Jira:** Connection status, last sync, disconnect
5. **Danger Zone:** Delete organization

**Acceptance criteria:**
- [ ] Owner can rename org
- [ ] Owner can remove members
- [ ] Owner can upgrade plan → redirected to Stripe
- [ ] Non-owners see settings but can't edit
- [ ] "Delete organization" requires typing org name to confirm

**Time:** 3 days

---

### ✅ 2.4 — Google OAuth Login

**What:** "Sign in with Google" button — reduces signup friction by 80%.

**Steps:**
1. Create Google OAuth app at console.cloud.google.com
2. Install: `npm install passport passport-google-oauth20`
3. Add `/api/auth/google` and `/api/auth/google/callback` routes
4. On successful auth: create user if new, log them in

**Acceptance criteria:**
- [ ] User clicks "Sign in with Google" → Google login page → redirected back → logged in
- [ ] If user exists: log in
- [ ] If new user: create account + set email_verified = true (Google already verified)
- [ ] Works on both register and login pages

**Time:** 1 day

---

### ✅ 2.5 — In-App Upgrade Prompts

**What:** When user hits a limit, show upgrade CTA instead of cryptic error.

**UI to add:**
- Modal: "You've reached your 3-user limit. Upgrade to Starter for $49/month to add 10 users."
- Banner at top: "Your trial ends in 3 days. Upgrade now to keep your data."
- Billing page: Feature comparison table

**Acceptance criteria:**
- [ ] Trial user invites 4th member → sees upgrade modal
- [ ] Trial user with 3 days left → sees banner on every page
- [ ] Clicking upgrade → Stripe checkout
- [ ] After upgrading → banner disappears

**Time:** 2 days

---

## Phase 3: Growth & Polish (Weeks 7–9)

These unlock higher revenue and enterprise customers.

### ✅ 3.1 — Atlassian Marketplace Listing

**What:** List Portavio on the Atlassian Marketplace so 50,000+ Jira customers discover it.

**Requirements:**
1. Build an Atlassian Connect app wrapper (iframe that embeds in Jira)
2. Write `atlassian-connect.json` descriptor
3. Pass Atlassian security review (2–4 week process)

**Key benefit:** 100–500 installs/month from organic marketplace traffic.

**Steps:**
1. Read: https://developer.atlassian.com/cloud/jira/platform/getting-started/
2. Create `atlassian-connect.json` in your backend
3. Add `/api/atlassian/installed` webhook (Atlassian calls this when someone installs)
4. Submit to marketplace review

**Acceptance criteria:**
- [ ] App appears on Atlassian Marketplace
- [ ] User can install directly from Jira
- [ ] Clicking "Portavio" in Jira sidebar opens the dashboard
- [ ] 10 test installs successful

**Time:** 1 week (includes review wait time)

---

### ✅ 3.2 — Weekly Email Digest

**What:** Every Monday, send a summary email: "Your portfolio health this week."

**Content:**
- X new risks detected
- Y blockers resolved
- Top 3 at-risk projects
- Team velocity summary

**Implementation:**
- Cron job runs every Monday at 9am
- Query portfolio health metrics per org
- Render HTML email template
- Send via SendGrid/Resend

**Acceptance criteria:**
- [ ] Receives email every Monday morning
- [ ] Email contains accurate, org-specific data
- [ ] Users can unsubscribe via link in footer
- [ ] Unsubscribe preference persists in database

**Time:** 2 days

---

### ✅ 3.3 — Data Export

**What:** Users can export their data to CSV/JSON.

**Endpoints:**
- `GET /api/export/projects` → CSV of all projects
- `GET /api/export/teams` → CSV of all teams
- `GET /api/export/epics` → CSV of all epics
- `GET /api/export/all` → ZIP of all CSVs

**Acceptance criteria:**
- [ ] User clicks "Export Data" → downloads portavio-export.zip
- [ ] ZIP contains: projects.csv, teams.csv, epics.csv, risks.csv
- [ ] Open in Excel: data is readable and correct

**Time:** 1 day

---

### ✅ 3.4 — GDPR Compliance

**What:** Legal requirement for EU customers.

**What to implement:**
1. Data deletion: `DELETE /api/org/delete-my-data` (soft delete, 30-day retention)
2. Data export: Already covered in 3.3
3. Cookie consent banner on marketing site
4. Privacy Policy page
5. GDPR-compliant DPA document

**Use:** Termly.io or Iubenda to auto-generate legal docs.

**Acceptance criteria:**
- [ ] Privacy Policy live at portavio.io/privacy
- [ ] User can request data deletion via settings
- [ ] Deletion queues for 30 days before permanently removing
- [ ] All sub-processors listed in privacy policy (Stripe, Neon, Resend, Railway)

**Time:** 1 day (mostly copy-paste from Termly)

---

### ✅ 3.5 — SSO (Enterprise Only)

**What:** Large companies require Single Sign-On (SAML).

**Use:** SaaS library like WorkOS ($0 for <1M users) or Auth0.

**Acceptance criteria:**
- [ ] Enterprise customer provides SAML metadata XML
- [ ] You upload to WorkOS dashboard
- [ ] Their employees click "Sign in with SSO" → redirected to Okta/Azure AD → logged into Portavio
- [ ] Works for 5+ test users

**Time:** 2 days (with WorkOS it's mostly config)

---

## Phase 4: Launch (Week 10)

### ✅ 4.1 — Marketing Website

**What:** portavio.io — the public-facing site where people sign up.

**Pages needed:**
1. Homepage (hero, features, pricing, testimonials, CTA)
2. Pricing (3 plans + FAQ)
3. Features (detailed capability breakdown)
4. Blog (for SEO)
5. Changelog (shows you're actively building)
6. Docs (getting started guide)

**Tools:**
- Build with: Next.js or Webflow
- Host on: Vercel (free)
- Domain: portavio.io ($12/year from Namecheap)

**Acceptance criteria:**
- [ ] Homepage loads in <1 second
- [ ] "Start free trial" button works end-to-end (sign up → verify email → first login)
- [ ] SSL enabled (https://portavio.io, not http)
- [ ] Mobile responsive
- [ ] 5 people test and give feedback

**Time:** 1 week

---

### ✅ 4.2 — Onboarding Flow

**What:** First-time user experience. Get them to value FAST.

**Steps:**
1. Welcome screen: "Let's connect your Jira"
2. Connect Jira form (URL, email, API token)
3. "Syncing your data..." progress bar
4. "Done! Here's your portfolio" → redirect to dashboard
5. Checklist widget: ✅ Connect Jira ⬜ Invite team ⬜ Upgrade plan

**Acceptance criteria:**
- [ ] New user goes from signup to seeing their Jira data in <5 minutes
- [ ] No confusing steps, no dead ends
- [ ] 3 test users complete it without asking for help

**Time:** 2 days

---

### ✅ 4.3 — Analytics & Monitoring

**What:** Know what's happening in production.

**Tools to add:**
1. **Error tracking:** Sentry (free tier)
2. **Uptime monitoring:** UptimeRobot (free tier)
3. **User analytics:** PostHog (free tier) or Plausible
4. **Internal dashboard:** Track MRR, trial → paid %, churn

**Acceptance criteria:**
- [ ] Sentry alerts you when backend errors occur
- [ ] UptimeRobot pings every 5 minutes, emails if down
- [ ] PostHog tracks: signups, trial starts, first sync, upgrade, churn
- [ ] Stripe Dashboard shows MRR chart

**Time:** 1 day

---

### ✅ 4.4 — Customer Support Setup

**What:** Users will have questions. Be ready.

**Setup:**
1. Email: support@portavio.io (forward to your personal email)
2. In-app chat widget: Crisp or Intercom (free tier)
3. Help docs: 5 articles minimum
   - How to get Jira API token
   - How to invite team members
   - How billing works
   - How to export data
   - Troubleshooting: "Sync failed" errors

**Acceptance criteria:**
- [ ] User clicks "Help" → chat widget appears
- [ ] You receive message within 60 seconds
- [ ] Help docs are searchable and clear
- [ ] Test: have friend ask 3 questions, verify answers are in docs

**Time:** 1 day

---

### ✅ 4.5 — Final Pre-Launch Checklist

Run through this list before announcing to the world:

**Security:**
- [ ] All API routes require authentication
- [ ] Jira credentials are encrypted (already done)
- [ ] Rate limiting enabled (100 requests/15min per user)
- [ ] CORS configured correctly (only allow app.portavio.io)
- [ ] SQL injection: all queries use parameterized statements (already done)
- [ ] Secrets in `.env`, not committed to Git

**Performance:**
- [ ] Dashboard loads in <2 seconds
- [ ] Sync completes in <1 minute for 1000 Jira issues
- [ ] Database has indexes on all foreign keys (already done)
- [ ] No N+1 query problems

**Reliability:**
- [ ] Daily backups configured (Neon does this automatically)
- [ ] Can restore from backup (test once)
- [ ] Failed payment → user gets email within 1 hour
- [ ] App still works if Stripe is down (payments fail, but users can still view data)

**User Experience:**
- [ ] 5 people outside your company test end-to-end
- [ ] Mobile works (at least viewable, not necessarily perfect)
- [ ] Error messages are helpful, not cryptic
- [ ] Loading states: show spinners, not blank screens

**Legal:**
- [ ] Terms of Service live at /terms
- [ ] Privacy Policy live at /privacy
- [ ] Cookie banner on marketing site

**Time:** 2 days (testing & fixing issues)

---

## Phase 5: Launch & Growth (Week 11+)

### ✅ 5.1 — Soft Launch

**What:** Launch to a small audience first to find bugs before going public.

**Steps:**
1. Email 20 friends/colleagues: "I built this, want to try?"
2. Post in 3 Slack/Discord communities you're in
3. Tweet about it
4. Monitor closely for 1 week
5. Fix any critical bugs

**Goal:** 10–20 users, 5+ paying after trial

**Time:** 1 week

---

### ✅ 5.2 — Product Hunt Launch

**What:** Launch on Product Hunt to get 1,000+ visitors in one day.

**Steps:**
1. Prepare: screenshots, demo video, tagline
2. Schedule launch for Tuesday–Thursday (best days)
3. Email everyone you know: "I'm launching on PH, can you upvote?"
4. Reply to every comment
5. Cross-post to Twitter, LinkedIn, Reddit

**Goal:** Top 5 product of the day → 500–2,000 website visitors → 50–200 signups

**Time:** 1 day (prep) + 1 day (launch day)

---

### ✅ 5.3 — SEO Content

**What:** Rank for keywords buyers are searching.

**Articles to write:**
1. "How to Track Jira Portfolio Risk Across Multiple Projects"
2. "The Complete Guide to Jira Team Velocity Tracking"
3. "5 Signs Your Jira Portfolio Is Out of Control (And How to Fix It)"
4. "Jira Epic Dependencies: A Visual Guide"
5. "How to Build a Jira Portfolio Dashboard (DIY vs SaaS)"

Each article should be 2,000+ words, with screenshots, and a CTA to try Portavio.

**Goal:** Rank on page 1 for 3+ keywords within 6 months → 200–500 organic visitors/month

**Time:** 1 article/week (4 hours each)

---

## The 100% Definition

You've reached **100% launch-ready** when:

✅ A stranger can visit portavio.io → sign up → verify email → connect Jira → see their data → invite team → enter credit card → become a paying customer → use it daily for a week → NOT cancel

✅ The app doesn't crash when 100 people are using it simultaneously  
✅ You've made your first $500 MRR  
✅ You can sleep soundly knowing backups run nightly and monitoring alerts you to problems  
✅ Enterprise customers can buy without you manually setting anything up  

---

## Summary: The Critical Path

If you do nothing else, do these in order:

1. **Multi-tenancy + Stripe** (Weeks 1–3) — can't be a SaaS without this
2. **Deploy to production** (Week 3) — need a live URL to test
3. **Team invites + auto-sync** (Weeks 4–5) — makes it actually collaborative
4. **Marketing site + onboarding** (Weeks 6–7) — need a front door
5. **Soft launch → fix bugs → public launch** (Weeks 8–10)

Everything else is optional for launch but required for growth.

**Total time to 100%: 10–12 weeks full-time.**

Good luck building! 🚀
