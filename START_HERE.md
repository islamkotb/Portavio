# 🚀 MASTER DEPLOYMENT GUIDE — Start Here

This is your roadmap to deploy Portavio as a live SaaS product. Follow these steps in order.

**Total time:** 4-6 hours  
**Cost:** $30-70/month  
**End result:** Live SaaS at https://app.portavio.io

---

## 📋 Prerequisites

Before you start, you need:

- [ ] GitHub account (free)
- [ ] Domain name: `portavio.io` from Namecheap (~$12/year)
- [ ] Credit card (for cloud services)
- [ ] Jira instance to test with (your company's Jira or a free trial)

---

## Phase 1: Code Setup (30 minutes)

### Step 1: Extract the Package

```bash
# Extract portavio-complete.zip to your computer
unzip portavio-complete.zip
cd portavio/
```

### Step 2: Review the Documentation

You now have these guides:

| File | Purpose | When to Use |
|------|---------|-------------|
| **README.md** | Overview & navigation | Start here |
| **DEPLOYMENT_GUIDE.md** | Complete deployment walkthrough | Main guide |
| **DEPLOYMENT_CHECKLIST.md** | Quick reference | During deployment |
| **FRESH_START_MULTITENANT.md** | Multi-tenancy setup | Before deployment |
| **100_PERCENT_CHECKLIST.md** | Feature roadmap | After launch |

### Step 3: Integrate Multi-Tenancy Code

The package includes reference files for multi-tenant routes:
- `backend/middleware.js` ← Copy this as-is
- `backend/routes-auth.js` ← Reference for auth routes
- `backend/routes-jira.js` ← Reference for Jira routes  
- `backend/routes-dashboard.js` ← Reference for dashboard routes

**Follow FRESH_START_MULTITENANT.md to:**
1. Copy `middleware.js` into your backend folder
2. Update `server.js` auth routes with code from `routes-auth.js`
3. Update `server.js` Jira routes with code from `routes-jira.js`
4. Update `server.js` dashboard routes with code from `routes-dashboard.js`
5. Update frontend `api()` helper to send org slug header

### Step 4: Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit - Portavio SaaS"

# Create repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/portavio.git
git branch -M main
git push -u origin main
```

---

## Phase 2: Database Setup (15 minutes)

### Step 1: Create Neon Account

1. Visit: https://neon.tech
2. Sign up with GitHub
3. Click **Create Project**
4. Name: `portavio-production`
5. Region: **US East** (or closest to your users)
6. Click **Create**

### Step 2: Initialize Database

Neon gives you a connection string like:
```
postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

**Option A: Via Neon SQL Editor (Easiest)**
1. Click **SQL Editor** in Neon dashboard
2. Copy entire contents of `database/schema_multitenant.sql`
3. Paste and click **Run**

**Option B: Via Terminal**
```bash
psql "postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require" \
  -f database/schema_multitenant.sql
```

### Step 3: Verify

In Neon SQL Editor:
```sql
SELECT COUNT(*) FROM organizations;  -- Should return 0
SELECT COUNT(*) FROM users;          -- Should return 0
```

✅ **Checkpoint:** You have a production database with all tables created.

---

## Phase 3: Backend Deployment — Railway (45 minutes)

### Step 1: Create Railway Account

1. Visit: https://railway.app
2. Click **Login with GitHub**
3. Authorize Railway

### Step 2: Deploy Backend

1. Click **New Project**
2. Select **Deploy from GitHub repo**
3. Choose `portavio` repo
4. Railway auto-detects Node.js

### Step 3: Configure Service

Click your service → **Settings**:

- **Service Name:** `portavio-backend`
- **Root Directory:** `backend`
- **Build Command:** `npm install`
- **Start Command:** `node server.js`
- **Watch Paths:** `backend/**`

### Step 4: Generate Secrets

Open your terminal and run:

```bash
# Generate JWT Secret
openssl rand -hex 32
# Output: abc123def456... (64 characters)

# Generate Encryption Key
openssl rand -hex 32
# Output: xyz789uvw012... (64 characters)
```

Copy both outputs.

### Step 5: Add Environment Variables

Click **Variables** tab, add these one by one:

```bash
NODE_ENV=production
PORT=3001

# Database (from Neon Step 2)
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require

# Secrets (from Step 4)
JWT_SECRET=<your 64-char JWT secret>
ENCRYPTION_KEY=<your 64-char encryption key>

# URLs (we'll update these after Vercel deployment)
APP_URL=https://app.portavio.io
CORS_ORIGIN=https://app.portavio.io

# These will be added later
# REDIS_URL=redis://...          (Phase 4)
# RESEND_API_KEY=re_...          (Phase 5)
# STRIPE_SECRET_KEY=sk_test_...  (Phase 6)
# STRIPE_WEBHOOK_SECRET=whsec_...
# STRIPE_PRICE_STARTER=price_...
# STRIPE_PRICE_PRO=price_...
# STRIPE_PRICE_ENTERPRISE=price_...
```

### Step 6: Deploy

1. Click **Deploy**
2. Wait 2-3 minutes
3. Railway assigns you a URL like: `https://portavio-production.up.railway.app`

### Step 7: Test Backend

```bash
curl https://portavio-production.up.railway.app/
# Should return: {"message":"Portavio API v2","tagline":"Portfolio Intelligence for Engineering Teams"}
```

✅ **Checkpoint:** Your backend is live!

### Step 8: Add Custom Domain (Recommended)

1. In Railway → **Settings** → **Networking** → **Public Networking**
2. Click **Generate Domain** (Railway gives you a .railway.app domain)
3. Then click **Custom Domain** → Add `api.portavio.io`
4. Railway shows CNAME record to add

**In Namecheap (or your domain registrar):**
1. Go to **Advanced DNS**
2. Add record:
   ```
   Type: CNAME
   Host: api
   Value: portavio-production.up.railway.app
   TTL: Automatic
   ```
3. Save

**Wait 5-10 minutes**, then test:
```bash
curl https://api.portavio.io/
```

✅ **Checkpoint:** Backend accessible at custom domain!

---

## Phase 4: Redis Setup — Upstash (10 minutes)

Redis is needed for background sync jobs.

### Step 1: Create Upstash Account

1. Visit: https://upstash.com
2. Sign up with GitHub
3. Click **Create Database**

### Step 2: Configure Database

- **Name:** `portavio-jobs`
- **Type:** Redis
- **Region:** Same as Railway (e.g., US East)
- **Eviction:** No eviction

Click **Create**

### Step 3: Get Connection URL

Click your database → **Details** → Copy **REST URL**

It looks like: `redis://default:xxx@xxx.upstash.io:6379`

### Step 4: Add to Railway

In Railway → **Variables** → Add:
```
REDIS_URL=redis://default:xxx@xxx.upstash.io:6379
```

Click **Redeploy**

✅ **Checkpoint:** Background jobs ready!

---

## Phase 5: Frontend Deployment — Vercel (30 minutes)

### Step 1: Update Frontend API URL

Edit `frontend/index.html`, line ~291:

**Find:**
```javascript
const API_BASE = (location.hostname==='localhost'&&location.port==='3000')?'http://localhost:3001':'';
```

**Replace with:**
```javascript
const API_BASE = 'https://api.portavio.io';  // or your Railway URL
```

**Commit changes:**
```bash
git add frontend/index.html
git commit -m "Update API URL for production"
git push
```

### Step 2: Deploy to Vercel

1. Visit: https://vercel.com
2. Sign up with GitHub
3. Click **Add New Project**
4. Import `portavio` repo
5. Configure:
   - **Framework Preset:** Other
   - **Root Directory:** `frontend`
   - **Build Command:** (leave empty)
   - **Output Directory:** `.`
6. Click **Deploy**

Vercel gives you: `https://portavio.vercel.app`

### Step 3: Test

Visit `https://portavio.vercel.app`

You should see the Portavio login page!

### Step 4: Add Custom Domain

1. In Vercel → **Settings** → **Domains**
2. Add: `app.portavio.io`
3. Vercel shows DNS records

**In Namecheap:**
```
Type: CNAME
Host: app
Value: cname.vercel-dns.com
TTL: Automatic
```

Wait 5-10 minutes, then visit: `https://app.portavio.io`

✅ **Checkpoint:** Frontend is live!

### Step 5: Update CORS in Backend

In Railway → **Variables** → Update:
```
CORS_ORIGIN=https://app.portavio.io
```

Redeploy.

---

## Phase 6: Email Setup — Resend (20 minutes)

### Step 1: Create Resend Account

1. Visit: https://resend.com
2. Sign up
3. Verify your email

### Step 2: Add Domain

1. Click **Domains** → **Add Domain**
2. Enter: `portavio.io`
3. Resend shows DNS records:

**Add these in Namecheap:**
```
Type: TXT
Host: _resend
Value: <value from Resend>

Type: MX
Host: @
Value: feedback-smtp.us-east-1.amazonses.com
Priority: 10
```

4. Wait 10-20 minutes
5. Click **Verify** in Resend

### Step 3: Create API Key

1. Click **API Keys** → **Create API Key**
2. Name: `Production`
3. Permission: **Sending access**
4. Copy key: `re_xxxxxxxxx`

### Step 4: Add to Railway

```
RESEND_API_KEY=re_xxxxxxxxx
```

### Step 5: Update package.json

Add to `backend/package.json`:
```json
{
  "dependencies": {
    "resend": "^3.0.0"
  }
}
```

Commit and push:
```bash
git add backend/package.json
git commit -m "Add Resend for email"
git push
```

Railway auto-redeploys.

✅ **Checkpoint:** Email system ready!

---

## Phase 7: Payments — Stripe (25 minutes)

### Step 1: Create Stripe Account

1. Visit: https://stripe.com
2. Sign up
3. **Stay in Test Mode** (toggle in top right)

### Step 2: Create Products

Click **Product Catalog** → **Add Product**

**Product 1: Starter**
- Name: `Portavio Starter`
- Description: `10 users, 20 projects, hourly sync`
- Pricing: `$49.00` / month, recurring
- Click **Save**
- Copy **Price ID**: `price_xxxSTARTER`

**Product 2: Pro**
- Name: `Portavio Pro`
- Description: `50 users, unlimited projects, 15-min sync`
- Pricing: `$149.00` / month, recurring
- Click **Save**
- Copy **Price ID**: `price_xxxPRO`

**Product 3: Enterprise**
- Name: `Portavio Enterprise`
- Description: `Unlimited users, SSO, priority support`
- Pricing: `$499.00` / month, recurring
- Click **Save**
- Copy **Price ID**: `price_xxxENT`

### Step 3: Get API Keys

1. Click **Developers** → **API Keys**
2. Copy **Secret Key**: `sk_test_xxxxx`
3. Copy **Publishable Key**: `pk_test_xxxxx` (not needed yet)

### Step 4: Create Webhook

1. Click **Developers** → **Webhooks**
2. Click **Add Endpoint**
3. Endpoint URL: `https://api.portavio.io/api/billing/webhook`
4. Description: `Production billing events`
5. Events to send:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
6. Click **Add Endpoint**
7. Click the endpoint → **Signing secret** → **Reveal**
8. Copy: `whsec_xxxxx`

### Step 5: Add to Railway

```
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRICE_STARTER=price_xxxSTARTER
STRIPE_PRICE_PRO=price_xxxPRO
STRIPE_PRICE_ENTERPRISE=price_xxxENT
```

### Step 6: Update package.json

Add to `backend/package.json`:
```json
{
  "dependencies": {
    "stripe": "^14.10.0"
  }
}
```

Commit, push, auto-deploys.

✅ **Checkpoint:** Payments ready! (Test mode)

---

## Phase 8: Monitoring (15 minutes)

### Step 1: Error Tracking — Sentry

1. Visit: https://sentry.io
2. Sign up
3. Create project: **Node.js**
4. Copy DSN: `https://xxx@xxx.ingest.sentry.io/xxx`
5. Add to Railway:
   ```
   SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
   ```
6. Add to `package.json`:
   ```json
   {
     "dependencies": {
       "@sentry/node": "^7.91.0"
     }
   }
   ```

### Step 2: Uptime Monitoring

1. Visit: https://uptimerobot.com
2. Sign up (free: 50 monitors)
3. Click **Add New Monitor**
4. Type: **HTTPS**
5. URL: `https://api.portavio.io/`
6. Name: `Portavio API`
7. Interval: `5 minutes`
8. Alert: Add your email
9. Click **Create**

✅ **Checkpoint:** Monitoring active!

---

## Phase 9: End-to-End Testing (30 minutes)

### Test 1: User Registration

1. Visit: `https://app.portavio.io`
2. Click **Register**
3. Enter:
   - Name: Test User
   - Email: test@yourdomain.com
   - Password: test1234
4. Click **Create Account**

**Expected:**
- Registration succeeds
- User is logged in
- Sees empty dashboard

**Verify in Neon:**
```sql
SELECT * FROM users WHERE email = 'test@yourdomain.com';
SELECT * FROM organizations ORDER BY created_at DESC LIMIT 1;
SELECT * FROM organization_members ORDER BY joined_at DESC LIMIT 1;
```

Should see:
- 1 user
- 1 organization ("Test User's Workspace")
- 1 membership (role: owner)

### Test 2: Jira Connection

1. Get Jira API token: https://id.atlassian.com/manage-profile/security/api-tokens
2. In app, click **Connect Jira**
3. Enter:
   - Jira URL: `https://yourcompany.atlassian.net`
   - Email: your Jira email
   - API Token: (from step 1)
4. Click **Connect**

**Expected:**
- "Connected to Jira" message
- Status badge turns green

### Test 3: Sync Data

1. Click **Sync Jira** button
2. Wait 30-60 seconds

**Expected:**
- Sync completes
- Projects appear in dashboard
- Teams appear
- Epics appear
- Risks/blockers detected

**Check Railway logs:**
```
railway logs -f
```

Should see:
```
📁 Syncing projects...
🎯 Syncing epics...
👥 Syncing teams and sprints...
...
✅ Sync completed
```

### Test 4: Plan Limits

**Try to exceed trial limits:**

1. Invite 3 users (should work)
2. Try to invite 4th user → Should fail with:
   ```
   "User limit reached. Upgrade to Starter for $49/month."
   ```

**Manually upgrade to test:**

```sql
UPDATE organizations SET plan = 'starter', max_users = 10 WHERE id = 1;
```

3. Try inviting 4th user again → Should work now

### Test 5: Stripe Checkout (Test Mode)

**You'll need to add billing UI first** (not built yet), but test the webhook:

1. In Stripe Dashboard → **Webhooks** → Your endpoint
2. Click **Send test webhook**
3. Select: `checkout.session.completed`
4. Click **Send**

**Check Railway logs:**
Should see webhook received and processed.

---

## Phase 10: Go Live (When Ready)

When you're ready for real customers:

### Step 1: Switch Stripe to Live Mode

1. In Stripe Dashboard → Toggle **Test Mode** → **Live Mode**
2. Recreate products in Live Mode
3. Get new API keys (will start with `sk_live_` and `pk_live_`)
4. Create new webhook in Live Mode
5. Update Railway variables with live keys

### Step 2: Legal Pages

Add these pages to frontend:
- `/terms` — Terms of Service
- `/privacy` — Privacy Policy

Use https://termly.io to generate them (~$10/month)

### Step 3: Enable Email Verification

Add email verification flow (send verification email on registration).

See `100_PERCENT_CHECKLIST.md` for implementation details.

### Step 4: Launch!

- [ ] Tweet about it
- [ ] Post on Product Hunt
- [ ] Email your network
- [ ] Post in Slack/Discord communities
- [ ] Share on LinkedIn

---

## 🎯 Success Criteria

You've successfully deployed when:

✅ User can visit `https://app.portavio.io`  
✅ User can register and login  
✅ User can connect their Jira instance  
✅ User can sync and see their portfolio data  
✅ Data is isolated between organizations  
✅ Backend API is stable (check Railway metrics)  
✅ No errors in Sentry  
✅ UptimeRobot shows 100% uptime  

---

## 📊 Your Live Stack

```
Frontend:  https://app.portavio.io        (Vercel)
Backend:   https://api.portavio.io        (Railway)
Database:  Neon PostgreSQL                (Neon)
Queue:     Redis                          (Upstash)
Email:     hello@portavio.io              (Resend)
Payments:  Stripe                         (Stripe)
Errors:    Sentry                         (Sentry)
Uptime:    UptimeRobot                    (UptimeRobot)
```

**Monthly cost:** $30-70  
**Break-even:** 1-2 paying customers

---

## 🆘 Troubleshooting

### "Cannot connect to database"
- Check Neon dashboard → Database is "Active"
- Verify DATABASE_URL in Railway matches Neon connection string

### "CORS error" in browser
- Verify CORS_ORIGIN in Railway matches exact frontend URL
- Include `https://` prefix

### "Jira sync failed"
- Check Railway logs: `railway logs`
- Verify Jira credentials are correct
- Check Jira API token hasn't expired

### "Stripe webhook not working"
- Verify webhook URL is `https://api.portavio.io/api/billing/webhook`
- Check webhook signing secret matches Railway variable
- Test webhook in Stripe dashboard

### "Email not sending"
- Check Resend dashboard → Recent emails
- Verify domain is verified (green checkmark)
- Check Railway has correct RESEND_API_KEY

---

## 📚 Next Steps

After deployment works:

1. **Add email templates** — Welcome, invite, trial ending
2. **Build settings page** — Team management, billing portal
3. **Add Google OAuth** — Reduce signup friction
4. **List on Atlassian Marketplace** — 100-500 installs/month
5. **Write SEO content** — "How to track Jira risks" etc.
6. **Collect testimonials** — Ask early users for feedback

See **100_PERCENT_CHECKLIST.md** for the complete roadmap.

---

## 🎉 You're Live!

Congratulations! You now have a production SaaS application.

**Share it:**
- Tweet: "Just launched Portavio - portfolio intelligence for Jira teams"
- LinkedIn: Post about your launch
- Reddit: r/projectmanagement, r/agile

**Monitor:**
- Check Railway metrics daily
- Watch Sentry for errors
- Review UptimeRobot alerts

**Improve:**
- Listen to user feedback
- Fix bugs quickly
- Ship features weekly

---

**Need help?** Review the detailed guides:
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) — Full deployment walkthrough
- [FRESH_START_MULTITENANT.md](FRESH_START_MULTITENANT.md) — Multi-tenancy setup
- [100_PERCENT_CHECKLIST.md](100_PERCENT_CHECKLIST.md) — Feature roadmap

Good luck! 🚀
