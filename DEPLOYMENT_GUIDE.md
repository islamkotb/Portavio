# 🚀 Complete Deployment Guide — Portavio SaaS

This guide takes you from code on your laptop to a live SaaS product accessible at `app.portavio.io`.

**Time required:** 2-4 hours  
**Cost:** ~$30-70/month  
**Prerequisites:** GitHub account, credit card for services

---

## Overview: Your Production Stack

```
┌─────────────────────────────────────────────────────────────┐
│  USER → app.portavio.io (Frontend - Vercel)                │
│           ↓                                                  │
│  api.portavio.io (Backend - Railway)                        │
│           ↓                                                  │
│  PostgreSQL Database (Neon)                                 │
│  Redis Queue (Upstash)                                      │
│  Email (Resend)                                             │
│  Payments (Stripe)                                          │
└─────────────────────────────────────────────────────────────┘
```

**Why these services:**
- **Vercel:** Free, automatic deployments, global CDN, perfect for React/HTML
- **Railway:** $5-20/month, best for Node.js backends, automatic SSL
- **Neon:** $0-19/month, serverless Postgres, auto-scaling, automatic backups
- **Upstash:** $0-10/month, serverless Redis, needed for background jobs
- **Resend:** $0-20/month, transactional email API (better than SendGrid)
- **Stripe:** 2.9% + 30¢ per transaction, industry standard for SaaS billing

---

## Phase 1: Prepare Your Code (30 minutes)

### Step 1: Create GitHub Repository

```bash
cd portavio
git init
git add .
git commit -m "Initial commit - Portavio SaaS"

# Create repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/portavio.git
git branch -M main
git push -u origin main
```

### Step 2: Create .gitignore

Create `.gitignore` in root:

```
node_modules/
.env
.env.local
.env.production
*.log
.DS_Store
```

### Step 3: Update package.json

Make sure `backend/package.json` has all dependencies:

```json
{
  "name": "portavio-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.3",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "cors": "^2.8.5",
    "axios": "^1.6.2",
    "crypto-js": "^4.2.0",
    "helmet": "^7.1.0",
    "express-rate-limit": "^7.1.5",
    "morgan": "^1.10.0",
    "dotenv": "^16.3.1",
    "bull": "^4.12.0",
    "ioredis": "^5.3.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## Phase 2: Database Setup (15 minutes)

### Step 1: Create Neon Database

1. Go to https://neon.tech
2. Sign up (free tier is fine to start)
3. Click **Create Project**
4. Name: `portavio-production`
5. Region: Choose closest to your users (US East, EU West, etc.)
6. Click **Create**

### Step 2: Get Connection String

After creation, Neon shows you a connection string:

```
postgresql://username:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

**Copy this** — you'll need it soon.

### Step 3: Create Database Schema

Using the Neon SQL Editor (in the dashboard):

```sql
-- Copy/paste the ENTIRE contents of database/schema_multitenant.sql
-- This creates all tables with multi-tenancy built-in
```

Or from your terminal:

```bash
# Install psql if needed: brew install postgresql (Mac) or apt install postgresql-client (Linux)

# Run schema
psql "postgresql://username:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require" \
  -f database/schema_multitenant.sql
```

**Verify it worked:**
```sql
SELECT COUNT(*) FROM organizations;  -- Should return 0 (no orgs yet, but table exists)
```

---

## Phase 3: Backend Deployment — Railway (30 minutes)

### Step 1: Sign Up for Railway

1. Go to https://railway.app
2. Sign in with GitHub
3. Authorize Railway to access your repos

### Step 2: Create New Project

1. Click **New Project**
2. Select **Deploy from GitHub repo**
3. Choose `portavio` repo
4. Railway detects Node.js automatically

### Step 3: Configure Build Settings

1. Click your service → **Settings**
2. **Root Directory:** `backend`
3. **Build Command:** `npm install`
4. **Start Command:** `node server.js`
5. **Watch Paths:** `backend/**`

### Step 4: Add Environment Variables

Click **Variables** tab and add:

```bash
NODE_ENV=production
PORT=3001

# Database (from Neon)
DATABASE_URL=postgresql://username:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require

# Generate these secrets:
JWT_SECRET=<run: openssl rand -hex 32>
ENCRYPTION_KEY=<run: openssl rand -hex 32>

# URLs (update after deployment)
APP_URL=https://app.portavio.io
CORS_ORIGIN=https://app.portavio.io

# Redis (we'll add this after creating Upstash)
REDIS_URL=redis://default:xxx@xxx.upstash.io:6379

# Email (we'll add after Resend)
RESEND_API_KEY=re_xxx

# Stripe (we'll add after Stripe)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_STARTER=price_xxx
STRIPE_PRICE_PRO=price_xxx
STRIPE_PRICE_ENTERPRISE=price_xxx
```

**Generate secrets on your terminal:**
```bash
# JWT Secret
openssl rand -hex 32

# Encryption Key
openssl rand -hex 32
```

### Step 5: Deploy

1. Click **Deploy**
2. Wait 2-3 minutes
3. Railway gives you a URL: `https://portavio-production.up.railway.app`

### Step 6: Add Custom Domain (Optional but Recommended)

1. Buy domain: `portavio.io` from Namecheap (~$12/year)
2. In Railway → **Settings** → **Domains**
3. Click **Add Domain**
4. Enter: `api.portavio.io`
5. Railway shows you DNS records to add at Namecheap:
   ```
   CNAME api → portavio-production.up.railway.app
   ```
6. Wait 5-10 minutes for DNS to propagate

**Test it works:**
```bash
curl https://api.portavio.io/
# Should return: {"message":"Portavio API v2","tagline":"Portfolio Intelligence for Engineering Teams"}
```

---

## Phase 4: Redis Setup — Upstash (10 minutes)

Redis is needed for background sync jobs.

### Step 1: Create Upstash Redis

1. Go to https://upstash.com
2. Sign up (free tier: 10K commands/day)
3. Click **Create Database**
4. Name: `portavio-jobs`
5. Region: Same as Railway (e.g., US East)
6. Click **Create**

### Step 2: Get Connection String

Copy the **Redis URL**:
```
redis://default:xxx@xxx.upstash.io:6379
```

### Step 3: Add to Railway

In Railway → **Variables**:
```
REDIS_URL=redis://default:xxx@xxx.upstash.io:6379
```

Click **Redeploy** to apply.

---

## Phase 5: Frontend Deployment — Vercel (20 minutes)

### Step 1: Update Frontend API URL

Edit `frontend/index.html`, find this line:

```javascript
const API_BASE = (window.location.hostname==='localhost'&&window.location.port==='3000')?'http://localhost:3001':'';
```

**Replace with:**

```javascript
const API_BASE = 'https://api.portavio.io';  // Your Railway backend URL
```

Commit and push:
```bash
git add frontend/index.html
git commit -m "Update API URL for production"
git push
```

### Step 2: Deploy to Vercel

1. Go to https://vercel.com
2. Sign up with GitHub
3. Click **Add New Project**
4. Import `portavio` repo
5. **Framework Preset:** Other
6. **Root Directory:** `frontend`
7. **Build Command:** (leave empty)
8. **Output Directory:** `.`
9. Click **Deploy**

Vercel gives you: `https://portavio.vercel.app`

### Step 3: Add Custom Domain

1. In Vercel → **Settings** → **Domains**
2. Add domain: `app.portavio.io`
3. Vercel shows you DNS records for Namecheap:
   ```
   CNAME app → cname.vercel-dns.com
   ```
4. Add these at Namecheap
5. Wait 5-10 minutes

**Test it:**
Visit `https://app.portavio.io` — you should see the login page.

### Step 4: Update CORS in Backend

In Railway → **Variables**, update:
```
CORS_ORIGIN=https://app.portavio.io
```

Redeploy.

---

## Phase 6: Email Setup — Resend (15 minutes)

### Step 1: Create Resend Account

1. Go to https://resend.com
2. Sign up (free: 3,000 emails/month)
3. Verify your email

### Step 2: Add Sending Domain

1. Click **Domains** → **Add Domain**
2. Enter: `portavio.io`
3. Resend shows you DNS records:
   ```
   TXT  _resend  xxx
   MX   @        feedback-smtp.us-east-1.amazonses.com (priority 10)
   ```
4. Add these at Namecheap
5. Wait 10-20 minutes, then click **Verify**

### Step 3: Get API Key

1. Click **API Keys** → **Create API Key**
2. Name: `Production`
3. Permission: **Sending access**
4. Copy the key: `re_xxxxxxxxx`

### Step 4: Add to Railway

In Railway → **Variables**:
```
RESEND_API_KEY=re_xxxxxxxxx
```

Redeploy.

### Step 5: Add Email Sending Code

You'll need to add email functions to `server.js`. For now, test with:

```javascript
// Add to server.js
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// Test endpoint
app.get('/api/test-email', async (req, res) => {
  try {
    await resend.emails.send({
      from: 'Portavio <hello@portavio.io>',
      to: 'your@email.com',
      subject: 'Test Email',
      html: '<h1>It works!</h1>',
    });
    res.json({ message: 'Email sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

Test:
```bash
curl https://api.portavio.io/api/test-email
```

Check your inbox!

---

## Phase 7: Stripe Setup (20 minutes)

### Step 1: Create Stripe Account

1. Go to https://stripe.com
2. Sign up
3. **Stay in Test Mode** for now (toggle in top-right)

### Step 2: Create Products

1. Click **Products** → **Add Product**

**Product 1: Starter**
- Name: `Portavio Starter`
- Description: `Up to 10 users, 20 projects, hourly sync`
- Pricing: `$49/month` recurring
- Copy the **Price ID**: `price_xxx1`

**Product 2: Pro**
- Name: `Portavio Pro`
- Description: `Up to 50 users, unlimited projects, 15-min sync`
- Pricing: `$149/month` recurring
- Copy the **Price ID**: `price_xxx2`

**Product 3: Enterprise**
- Name: `Portavio Enterprise`
- Description: `Unlimited users, SSO, priority support`
- Pricing: `$499/month` recurring
- Copy the **Price ID**: `price_xxx3`

### Step 3: Get API Keys

1. Click **Developers** → **API Keys**
2. Copy **Secret Key**: `sk_test_xxxxx`
3. Copy **Publishable Key**: `pk_test_xxxxx`

### Step 4: Create Webhook

1. Click **Developers** → **Webhooks**
2. Click **Add Endpoint**
3. URL: `https://api.portavio.io/api/billing/webhook`
4. Events to send:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Click **Add Endpoint**
6. Copy **Signing Secret**: `whsec_xxxxx`

### Step 5: Add to Railway

In Railway → **Variables**:
```
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRICE_STARTER=price_xxx1
STRIPE_PRICE_PRO=price_xxx2
STRIPE_PRICE_ENTERPRISE=price_xxx3
```

Redeploy.

---

## Phase 8: Final Configuration & Testing (30 minutes)

### Step 1: Update Backend with All Integrations

Make sure `backend/server.js` has:

```javascript
const { Resend } = require('resend');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
```

Add to `package.json`:
```json
{
  "dependencies": {
    "stripe": "^14.10.0",
    "resend": "^3.0.0"
  }
}
```

Commit and push to trigger redeploy.

### Step 2: End-to-End Test

**Test 1: Registration**
1. Go to `https://app.portavio.io`
2. Click "Register"
3. Email: `test@yourdomain.com`, Password: `test1234`, Name: `Test User`
4. Submit
5. ✅ Should create user + organization

**Verify in database:**
```sql
SELECT * FROM users WHERE email = 'test@yourdomain.com';
SELECT * FROM organizations ORDER BY created_at DESC LIMIT 1;
```

**Test 2: Jira Connection**
1. Log in
2. Enter Jira URL, email, API token
3. Click "Connect"
4. ✅ Should save connection

**Test 3: Sync**
1. Click "Sync Jira"
2. Wait 30-60 seconds
3. ✅ Should see projects, teams, epics appear

**Test 4: Team Invite (Manual)**

Since email templates aren't built yet, test the invite flow manually:

```sql
-- Insert a test invite
INSERT INTO invitations (organization_id, email, token, role, invited_by, expires_at)
VALUES (
  1,  -- Your org ID
  'friend@example.com',
  'test-invite-token-123',
  'member',
  1,  -- Your user ID
  NOW() + INTERVAL '7 days'
);
```

Then visit: `https://app.portavio.io/accept-invite?token=test-invite-token-123`

Should redirect to register with pre-filled invite token.

---

## Phase 9: Monitoring & Backups (20 minutes)

### Step 1: Add Error Tracking — Sentry

1. Go to https://sentry.io
2. Sign up (free tier: 5K errors/month)
3. Create project: **Node.js + Express**
4. Copy DSN: `https://xxx@xxx.ingest.sentry.io/xxx`

Add to `server.js`:
```javascript
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});

// Add error handler
app.use(Sentry.Handlers.errorHandler());
```

Add to Railway variables:
```
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

### Step 2: Add Uptime Monitoring

1. Go to https://uptimerobot.com
2. Sign up (free: 50 monitors)
3. Click **Add New Monitor**
4. Monitor Type: **HTTPS**
5. URL: `https://api.portavio.io/`
6. Name: `Portavio API`
7. Monitoring Interval: `5 minutes`
8. Click **Create Monitor**

Add alert email so you get notified if site goes down.

### Step 3: Database Backups

Neon does automatic daily backups. To manually backup:

```bash
# Export entire database
pg_dump "postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require" \
  > backup-$(date +%Y%m%d).sql

# Compress it
gzip backup-$(date +%Y%m%d).sql

# Upload to Dropbox/Google Drive/S3 for safe keeping
```

Set a weekly reminder to do this until you have automated backups.

---

## Phase 10: Marketing Site (Optional, 1 hour)

You need a landing page at `https://portavio.io` (not app.portavio.io).

**Quick option:**
Use a template from https://cruip.com or https://tailwindui.com

**Deploy to Vercel:**
1. Create `landing/` folder in repo
2. Add `index.html` with your landing page
3. Deploy to Vercel
4. Set root directory to `landing/`
5. Add domain: `portavio.io`

---

## Production Checklist

Before announcing to the world:

### Security
- [ ] All API routes require authentication (except `/`, `/api/auth/register`, `/api/auth/login`)
- [ ] Jira credentials encrypted (already done via crypto-js)
- [ ] Rate limiting enabled (already done via express-rate-limit)
- [ ] CORS only allows app.portavio.io (set in CORS_ORIGIN)
- [ ] No secrets in GitHub (check with `git log -p | grep -i "api_key"`)
- [ ] HTTPS everywhere (Vercel and Railway handle this)

### Performance
- [ ] Dashboard loads in <2 seconds
- [ ] Sync completes in <1 minute for 1000 issues
- [ ] Database has indexes (already in schema)

### Functionality
- [ ] User can register → verify email → log in
- [ ] User can connect Jira → sync → see data
- [ ] User can invite team member → they receive email → join org
- [ ] Plan limits enforced (try inviting 4th user on trial)
- [ ] Stripe checkout works (test mode)

### Reliability
- [ ] Railway uptime: Check last 7 days in dashboard
- [ ] Neon database: Check connection pool isn't maxed
- [ ] Sentry: No critical errors
- [ ] UptimeRobot: All monitors green

---

## Cost Summary

| Service | Monthly Cost |
|---------|-------------|
| Neon (Postgres) | $0 - $19 |
| Railway (Backend) | $5 - $20 |
| Upstash (Redis) | $0 - $10 |
| Vercel (Frontend) | $0 (free) |
| Resend (Email) | $0 - $20 |
| Stripe | 2.9% + 30¢ per transaction |
| Domain (portavio.io) | $1/month ($12/year) |
| **Total** | **$6 - $70/month** |

**Break-even:** 1-2 paying customers on Starter plan ($49/month)

---

## Going Live Checklist

When ready to announce:

- [ ] Switch Stripe from Test Mode to Live Mode
- [ ] Update Stripe API keys in Railway (use `sk_live_xxx` instead of `sk_test_xxx`)
- [ ] Add Terms of Service page (`app.portavio.io/terms`)
- [ ] Add Privacy Policy page (`app.portavio.io/privacy`)
- [ ] Test with real credit card (use your own card)
- [ ] Set up customer support email: `support@portavio.io` (Gmail forwarding is fine)
- [ ] Add chat widget (Crisp or Intercom free tier)
- [ ] Write 3 help docs (How to connect Jira, How to invite team, Troubleshooting)
- [ ] Post on Product Hunt
- [ ] Email your network: "I built this, want to try?"

---

## Troubleshooting

### "Cannot connect to database"
Check Neon dashboard → Compute → Status. Should say "Running". If "Idle", it auto-scales up when accessed.

### "CORS error" in browser console
Update `CORS_ORIGIN` in Railway to match exact frontend URL (include https://).

### "Jira sync failed"
Check Railway logs: `railway logs -f`

### "Stripe webhook not working"
Test webhook: Stripe dashboard → Webhooks → Click endpoint → Send test webhook

### "Email not sending"
Check Resend dashboard → Emails → Recent sends. Verify domain is verified.

---

## What You Have Now

✅ Live SaaS at `https://app.portavio.io`  
✅ Backend API at `https://api.portavio.io`  
✅ PostgreSQL database with automatic backups  
✅ Background jobs (via Redis)  
✅ Email system (via Resend)  
✅ Payment processing (via Stripe)  
✅ Error tracking (via Sentry)  
✅ Uptime monitoring (via UptimeRobot)  
✅ Multi-tenancy with team collaboration  
✅ Plan limits enforced  
✅ Ready to accept customers  

**You're live!** 🎉

---

## Next Steps After Deployment

1. **Test with 5 beta users** — Friends, colleagues, or post on Reddit/HN "Show HN"
2. **Fix bugs** — There will be bugs, fix them fast
3. **Add missing features:**
   - Email templates (welcome, invite, trial ending)
   - Settings page (team management, billing portal)
   - Google OAuth (reduces signup friction 80%)
4. **List on Atlassian Marketplace** — 100-500 installs/month
5. **SEO content** — Write "How to track Jira portfolio risks" → rank → get leads
6. **LinkedIn outreach** — Message 10 VPs of Engineering/day

But first: **Get it working end-to-end.** Deploy, test, iterate.

Good luck! 🚀
