# 🚀 Portavio SaaS Transformation Guide

## The Core Difference: Self-Hosted vs SaaS

Today Portavio is a **self-hosted application** — customers download it, run it on their own servers, and manage it themselves. 

As a **SaaS product**, YOU run one shared cloud instance. Customers sign up on your website, pay you monthly, and never touch a server. You handle everything: hosting, uptime, updates, backups.

This changes everything: the database model, the business model, the infrastructure, the legal requirements, and how you sell it.

---

## Part 1: What Needs to Change in the Application

### 1.1 — The Biggest Change: Multi-Tenancy

Right now the database has no concept of an "organization." Each user connects their own Jira and owns their own data. This works fine for self-hosted but **breaks for SaaS** because:

- Company A's data would be mixed with Company B's
- There's no way to manage billing per account
- Team members from the same company can't share one dashboard

**You need to add an `organizations` (workspace) layer.**

#### New Database Structure

```sql
-- The new top-level entity: an Organization / Workspace
CREATE TABLE organizations (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) UNIQUE NOT NULL,  -- e.g. "acme-corp" for app.portavio.io/acme-corp
    plan            VARCHAR(50) DEFAULT 'trial',   -- trial, starter, pro, enterprise
    trial_ends_at   TIMESTAMP DEFAULT (NOW() + INTERVAL '14 days'),
    stripe_customer_id   VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    subscription_status  VARCHAR(50) DEFAULT 'trialing', -- trialing, active, past_due, canceled
    max_users       INTEGER DEFAULT 5,
    max_projects    INTEGER DEFAULT 10,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users now belong to an organization
CREATE TABLE organization_members (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(50) DEFAULT 'member',  -- owner, admin, member, viewer
    invited_by      INTEGER REFERENCES users(id),
    joined_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, user_id)
);

-- Invite tokens for team member onboarding
CREATE TABLE invitations (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    token           VARCHAR(255) UNIQUE NOT NULL,
    role            VARCHAR(50) DEFAULT 'member',
    invited_by      INTEGER REFERENCES users(id),
    expires_at      TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at     TIMESTAMP,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Then all existing tables need `organization_id` instead of being tied to a single user:**

```sql
-- jira_connections: one per organization, not per user
ALTER TABLE jira_connections 
    DROP COLUMN user_id,
    ADD COLUMN organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE;

-- All domain tables cascade from organization
-- teams, projects, epics, sprints, issues, etc. already
-- use jira_connection_id which chains to organization_id
-- so those tables don't need direct changes.
```

#### Updated Authentication Flow

Every API request must now resolve: **which organization does this user belong to, and do they have permission?**

```javascript
// Middleware: resolve org from JWT + check membership
const requireOrg = async (req, res, next) => {
  const orgSlug = req.headers['x-org-slug'] || req.params.orgSlug;
  const org = await pool.query(
    `SELECT o.* FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     WHERE o.slug = $1 AND om.user_id = $2`,
    [orgSlug, req.user.userId]
  );
  if (!org.rows.length) return res.status(403).json({ error: 'Access denied' });
  req.org = org.rows[0];
  next();
};
```

---

### 1.2 — Billing Integration (Stripe)

This is the most important new feature. Every SaaS needs a billing system.

#### Install Stripe

```bash
npm install stripe
```

#### Pricing Plans to Implement

| Plan | Price | Limits | Target |
|------|-------|--------|--------|
| **Trial** | Free 14 days | 3 users, 5 projects, 1 sync/day | Everyone |
| **Starter** | $49/month | 10 users, 20 projects, auto-sync | Small teams |
| **Pro** | $149/month | 50 users, unlimited projects, hourly sync | Mid-market |
| **Enterprise** | $499/month | Unlimited users, SSO, priority support | Large orgs |

#### New Backend Endpoints for Billing

```javascript
// Create Stripe checkout session
app.post('/api/billing/checkout', authenticateToken, requireOrg, async (req, res) => {
  const { planId } = req.body; // 'starter', 'pro', 'enterprise'

  const priceIds = {
    starter:    process.env.STRIPE_PRICE_STARTER,
    pro:        process.env.STRIPE_PRICE_PRO,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  };

  const session = await stripe.checkout.sessions.create({
    customer_email: req.user.email,
    mode: 'subscription',
    line_items: [{ price: priceIds[planId], quantity: 1 }],
    success_url: `${process.env.APP_URL}/app/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${process.env.APP_URL}/app/billing`,
    metadata: { organizationId: req.org.id },
  });

  res.json({ url: session.url });
});

// Stripe webhook — handles subscription lifecycle
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig   = req.headers['stripe-signature'];
  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

  switch (event.type) {
    case 'checkout.session.completed':
      // Activate subscription after payment
      await activateSubscription(event.data.object);
      break;
    case 'customer.subscription.updated':
      // Handle plan upgrades/downgrades
      await updateSubscription(event.data.object);
      break;
    case 'customer.subscription.deleted':
      // Downgrade to free/canceled
      await cancelSubscription(event.data.object);
      break;
    case 'invoice.payment_failed':
      // Send payment failure email, set status to past_due
      await handlePaymentFailure(event.data.object);
      break;
  }

  res.json({ received: true });
});
```

#### Plan Enforcement Middleware

```javascript
const checkPlanLimits = (resource) => async (req, res, next) => {
  const limits = {
    trial:      { users: 3,   projects: 5,   syncsPerDay: 1   },
    starter:    { users: 10,  projects: 20,  syncsPerDay: 24  },
    pro:        { users: 50,  projects: 999, syncsPerDay: 999 },
    enterprise: { users: 999, projects: 999, syncsPerDay: 999 },
  };

  const plan  = req.org.plan;
  const limit = limits[plan]?.[resource] || 0;

  if (resource === 'users') {
    const count = await pool.query(
      'SELECT COUNT(*) FROM organization_members WHERE organization_id = $1',
      [req.org.id]
    );
    if (parseInt(count.rows[0].count) >= limit) {
      return res.status(402).json({
        error: 'User limit reached',
        upgradeUrl: '/app/billing',
        currentPlan: plan
      });
    }
  }
  // Similar checks for projects, sync frequency...
  next();
};

// Usage:
app.post('/api/team/invite', authenticateToken, requireOrg, checkPlanLimits('users'), ...);
```

---

### 1.3 — Automatic Sync Scheduling

Self-hosted Portavio requires manual clicks to sync. SaaS customers expect **automatic background syncing**.

#### Add a Job Queue

```bash
npm install bull ioredis
# Bull uses Redis for job queuing
```

```javascript
const Queue = require('bull');
const syncQueue = new Queue('jira-sync', process.env.REDIS_URL);

// Worker: processes sync jobs
syncQueue.process(async (job) => {
  const { organizationId } = job.data;
  const conn = await getConnectionForOrg(organizationId);
  if (conn) await syncJiraData(conn);
});

// Schedule: queue sync for all active orgs
const scheduleSyncs = async () => {
  const activeOrgs = await pool.query(
    `SELECT o.id, o.plan FROM organizations o
     JOIN jira_connections jc ON jc.organization_id = o.id
     WHERE o.subscription_status IN ('trialing','active')
     AND jc.is_active = true`
  );

  for (const org of activeOrgs.rows) {
    const delay = org.plan === 'trial' ? 86400000 : // once/day for trial
                  org.plan === 'starter' ? 3600000  : // hourly for starter
                  900000;                             // every 15 min for pro+
    await syncQueue.add({ organizationId: org.id }, {
      delay,
      jobId: `sync-${org.id}`,  // prevents duplicate jobs
      removeOnComplete: true,
    });
  }
};

// Run on startup and every hour
scheduleSyncs();
setInterval(scheduleSyncs, 3600000);
```

---

### 1.4 — Team Invites & Multi-User Support

Right now each account is a single user. SaaS needs collaborative workspaces.

#### New Endpoints

```javascript
// Invite a team member
app.post('/api/org/invite', authenticateToken, requireOrg, requireRole('admin'), async (req, res) => {
  const { email, role } = req.body;
  const token = crypto.randomBytes(32).toString('hex');

  await pool.query(
    `INSERT INTO invitations (organization_id, email, token, role, invited_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.org.id, email, token, role, req.user.userId]
  );

  // Send invitation email
  await sendEmail({
    to: email,
    subject: `You've been invited to ${req.org.name} on Portavio`,
    html: inviteEmailTemplate(req.org.name, token),
  });

  res.json({ message: 'Invitation sent' });
});

// Accept invite (no auth required — this is the landing link)
app.get('/api/org/accept-invite/:token', async (req, res) => {
  const invite = await pool.query(
    'SELECT * FROM invitations WHERE token = $1 AND expires_at > NOW() AND accepted_at IS NULL',
    [req.params.token]
  );
  if (!invite.rows.length) return res.status(400).json({ error: 'Invalid or expired invitation' });

  // Redirect to registration/login with invite token pre-filled
  res.redirect(`${process.env.APP_URL}/accept-invite?token=${req.params.token}`);
});
```

---

### 1.5 — Transactional Email (Mandatory for SaaS)

You need email for: welcome, invite, payment receipt, trial ending warning, sync failure alert.

```bash
npm install @sendgrid/mail
# OR: npm install nodemailer  (with SMTP)
```

#### Key Emails to Build

| Email | Trigger | Content |
|-------|---------|---------|
| Welcome | Sign up | Confirm email + onboarding steps |
| Invite | Team member invited | Join link, expires in 7 days |
| Trial ending | 3 days before trial expires | Upgrade CTA |
| Payment failed | Stripe webhook | Update card link |
| Sync complete | After each sync | Summary of what changed |
| Weekly digest | Every Monday | Portfolio health summary |

---

### 1.6 — Other Application Changes Needed

| Change | Why | Effort |
|--------|-----|--------|
| **Email verification** | Ensure real users, reduce abuse | 1 day |
| **Password reset flow** | Users forget passwords | 1 day |
| **Audit log table** | Enterprise compliance requirement | 1 day |
| **Data export (CSV/PDF)** | Users want their data | 2 days |
| **SSO / Google OAuth** | Reduces signup friction 80% | 2 days |
| **Usage tracking** | Know what features users actually use | 1 day |
| **Rate limiting per org** | Prevent one customer hammering Jira API | 1 day |
| **Org settings page** | Name, billing, members, danger zone | 2 days |
| **In-app upgrade prompts** | Revenue — show upgrade CTA at limits | 1 day |

---

## Part 2: Infrastructure Changes

### Self-Hosted Today
```
Customer's server → Docker → PostgreSQL + Node + Nginx
```

### SaaS Tomorrow
```
portavio.io (Vercel/Cloudflare)     → Marketing site + auth
app.portavio.io (Railway/Render)    → Node.js API
db.portavio.io (Supabase/Neon)      → PostgreSQL (managed)
redis.portavio.io (Upstash)         → Job queue
email (SendGrid/Resend)             → Transactional email
payments (Stripe)                   → Billing
cdn (Cloudflare)                    → Static assets + DDoS protection
monitoring (Sentry + Uptime Robot)  → Errors + uptime alerts
```

### Recommended SaaS Stack (Cost-Optimized)

| Service | Provider | Monthly Cost |
|---------|----------|-------------|
| API hosting | Railway | $10–20 |
| Database | Neon (serverless Postgres) | $0–19 |
| Redis (job queue) | Upstash | $0–10 |
| Email | Resend | $0–20 |
| Payments | Stripe | 2.9% + 30¢/transaction |
| Frontend/Marketing | Vercel | Free |
| Monitoring | Sentry | Free |
| Uptime | Uptime Robot | Free |
| **Total** | | **~$30–70/month** |

You reach profitability at 1–2 paying customers.

---

## Part 3: Legal & Compliance Requirements

These are **not optional** for a SaaS product. Without them you can't legally collect money or data.

### Documents You Must Have (Before Launch)

#### 1. Terms of Service
Must cover:
- What the service does and doesn't do
- Acceptable use policy (no scraping, no abuse)
- Your right to suspend accounts for non-payment or abuse
- Limitation of liability (caps your exposure)
- Governing law and jurisdiction
- Changes to terms with notice

#### 2. Privacy Policy
Must cover:
- What data you collect (email, Jira URL, usage data)
- How you store it (encrypted at rest, TLS in transit)
- Who you share it with (Stripe, SendGrid — name them)
- Data retention policy
- User rights (GDPR: right to delete, export, access)
- Cookie policy

#### 3. Data Processing Agreement (DPA)
Required for any customer in the EU/UK under GDPR.
- Defines you as a Data Processor, the customer as Data Controller
- Commits you to security standards
- Lists sub-processors (Stripe, Resend, Neon, etc.)

#### 4. GDPR / Data Residency
If you want EU customers:
- Host database in EU region (Neon has EU regions)
- Add "Delete my data" endpoint
- Add data export endpoint
- Have a cookie consent banner

#### Quick Option
Use **Termly.io** or **Iubenda** (~$10–30/month) to generate legally compliant documents. Don't write them yourself.

---

## Part 4: The Go-To-Market Strategy for SaaS

### Your Website: portavio.io

A SaaS marketing site needs 6 pages minimum:

**Homepage** — Hero, 3 features, social proof, pricing, CTA
**Pricing** — 3–4 tiers, feature comparison table, FAQ
**Features** — Deep dives on each major capability  
**Integrations** — Jira (and future: GitHub, Linear, Azure DevOps)
**Blog/Docs** — SEO + customer education
**Changelog** — Shows you're actively building (builds trust)

#### Homepage Copy Framework

```
HERO:
  Headline: "Your Jira portfolio, finally visible."
  Subline:  "Portavio surfaces risks, blockers, and team load 
             across all your Jira projects — in real time.
             Set up in 5 minutes."
  CTA:      [Start free trial →]  [See a demo]

SOCIAL PROOF:
  "Trusted by engineering teams at ___"  (add logos as you get them)

3 KEY FEATURES:
  ① Auto-detect risks & blockers — no manual tagging
  ② Team → Project → Epic ownership mapping  
  ③ Velocity trends & predictability scores

PAIN/SOLUTION:
  "Jira tells you what's being worked on.
   Portavio tells you what's going wrong."

PRICING SECTION:
  $49 / $149 / $499 — with 14-day free trial on all plans

FINAL CTA:
  "Start your free trial. No credit card required."
```

### Customer Acquisition Channels (Prioritized)

#### Channel 1: Atlassian Marketplace (Highest ROI)
- List Portavio as a Jira Cloud app
- 50,000+ companies browsing for Jira tools every month
- Atlassian takes 30% but sends you qualified buyers
- **Timeline:** 4–8 weeks to get listed (review process)
- **Expected:** 100–500 installs/month once listed

To list on Marketplace, Portavio needs to become an **Atlassian Connect app** — a web app that embeds inside Jira using their iframe/plugin system. This is a meaningful but one-time engineering effort (~2–4 weeks).

#### Channel 2: Content SEO
Target keywords buyers are already searching:

| Keyword | Monthly Searches | Difficulty |
|---------|-----------------|------------|
| jira portfolio dashboard | 1,900 | Low |
| jira risk management | 2,400 | Medium |
| jira team velocity tracking | 880 | Low |
| jira epic progress tracking | 720 | Low |
| jira blocker tracking | 590 | Low |

Write one deep tutorial per keyword. Rank in 3–6 months. Each article drives 20–100 trial signups/month long-term.

#### Channel 3: LinkedIn Outreach
Your buyers are Engineering Directors, VPs of Engineering, Portfolio Managers, PMO leads. They're all on LinkedIn.

**Daily routine:**
- Connect with 10 Engineering Directors at companies with 50–500 employees
- Send: *"Hey [Name], I built a tool that auto-detects risks and blockers across Jira portfolios — no manual setup. Would a 10-minute demo be worth your time?"*
- 5–10% response rate = 2–3 demos/week
- 20% close rate = 1–2 new customers/week early on

#### Channel 4: Reddit & Communities
Post genuinely helpful content (not ads) in:
- r/projectmanagement (2.1M members)
- r/agile (180K members)
- r/jira (45K members)
- r/devops (280K members)

Share the tool when it's relevant to questions about Jira portfolio visibility.

#### Channel 5: Product Hunt Launch
A Product Hunt launch done right gets:
- 500–2,000 website visitors in one day
- 50–200 trial signups
- Press coverage
- Backlinks that boost SEO

Schedule this for when the product is polished and you have a few testimonials.

---

## Part 5: Metrics to Track From Day One

### The SaaS Dashboard You Need

| Metric | What It Tells You | Target |
|--------|------------------|--------|
| **MRR** (Monthly Recurring Revenue) | Business health | +15%/month |
| **Trial → Paid conversion** | Product/pricing fit | >15% |
| **Churn rate** | Are customers getting value? | <5%/month |
| **Time to first sync** | Onboarding friction | <10 minutes |
| **DAU/MAU ratio** | Engagement | >40% |
| **NPS score** | Word-of-mouth potential | >40 |
| **CAC** (Cost to Acquire Customer) | Marketing efficiency | <3x MRR |
| **LTV** (Lifetime Value) | Revenue per customer | >12 months |

### Revenue Projections (Conservative)

| Month | Customers | MRR | Notes |
|-------|-----------|-----|-------|
| 1–2 | 0–5 | $0–245 | Friends, beta users, Reddit |
| 3 | 10 | $990 | First LinkedIn conversions |
| 6 | 30 | $3,000 | SEO starts working |
| 9 | 60 | $6,000 | Marketplace listing |
| 12 | 100 | $10,000 | First full-time salary |
| 18 | 200 | $22,000 | Hire first employee |
| 24 | 400 | $48,000 | Series A territory |

---

## Part 6: Prioritized Build Sequence

### Phase 1 — SaaS Foundation (Weeks 1–4)
Must-have before charging anyone:
1. ✅ Organizations table + multi-tenancy
2. ✅ Stripe billing + checkout + webhooks
3. ✅ Plan limits enforcement
4. ✅ Email: welcome, trial ending, payment failed
5. ✅ Password reset
6. ✅ Terms of Service + Privacy Policy live on site
7. ✅ Managed hosting (Railway + Neon) — your responsibility now

### Phase 2 — Growth Features (Weeks 5–8)
Needed to reduce churn and increase conversion:
1. ✅ Team invites + multi-user workspace
2. ✅ Automatic background sync (per plan frequency)
3. ✅ In-app upgrade prompts at limits
4. ✅ Onboarding checklist (connect Jira → sync → invite team → done)
5. ✅ Google OAuth login (reduces signup friction)
6. ✅ Data export (CSV)

### Phase 3 — Market Expansion (Weeks 9–16)
Needed to unlock bigger customers and marketplace:
1. ✅ Atlassian Marketplace listing (Connect app wrapper)
2. ✅ Weekly email digest
3. ✅ Org-level audit log
4. ✅ SSO (SAML for enterprise)
5. ✅ GDPR data deletion + export endpoints
6. ✅ Usage analytics dashboard (for you)

---

## Summary: The 3 Most Important Changes

If you do nothing else, do these three things first:

### 1. Add Organizations + Multi-Tenancy
Without this, you cannot safely share infrastructure between customers. One user's data could leak to another. This is the architectural foundation everything else rests on.

### 2. Add Stripe Billing
Without this you have a free tool, not a SaaS. The billing integration also forces you to define your pricing, which clarifies your entire go-to-market.

### 3. Deploy on Managed Infrastructure (Your Responsibility)
In the self-hosted model, customers manage their own servers. In SaaS, you manage one shared server with everyone's data. This means you need: automated backups (daily), uptime monitoring, SSL, and a disaster recovery plan.

The good news: the application code itself is already 80% of the way there. The data model is already scoped per `jira_connection_id` → `user_id`, which is only a moderate refactor to `jira_connection_id` → `organization_id`. The core work to go SaaS is roughly **4–6 weeks of development** on top of what already exists.
