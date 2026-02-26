# 🏗️ Portavio Architecture Diagram

## Production Stack Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           USERS / BROWSERS                           │
│                                                                      │
│                    https://app.portavio.io                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         VERCEL (Frontend)                            │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  frontend/index.html                                        │    │
│  │  - Pure HTML/CSS/JS SPA                                     │    │
│  │  - No build step required                                   │    │
│  │  - Global CDN                                               │    │
│  │  - Auto SSL                                                 │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Cost: FREE                                                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               │ API Calls (HTTPS)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    RAILWAY (Backend API)                             │
│  https://api.portavio.io                                             │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  backend/server.js (Node.js + Express)                      │    │
│  │  - REST API endpoints                                       │    │
│  │  - JWT authentication                                       │    │
│  │  - Multi-tenancy middleware                                 │    │
│  │  - Jira API integration                                     │    │
│  │  - Stripe webhooks                                          │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Resources:                                                          │
│  - 512MB RAM, 1 CPU                                                  │
│  - Auto-scaling                                                      │
│  - Automatic deploys from GitHub                                    │
│  - SSL included                                                      │
│                                                                      │
│  Cost: $5-20/month                                                   │
└──────┬────────────┬────────────┬────────────┬────────────┬──────────┘
       │            │            │            │            │
       │            │            │            │            │
       ▼            ▼            ▼            ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│   NEON   │ │ UPSTASH  │ │  RESEND  │ │  STRIPE  │ │  SENTRY  │
│ Database │ │  Redis   │ │   Email  │ │ Payments │ │  Errors  │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

---

## Service Breakdown

### Frontend: Vercel
```
┌─────────────────────────────────────┐
│  Vercel Edge Network                │
│                                     │
│  • 100+ global locations            │
│  • Automatic HTTPS                  │
│  • Instant cache invalidation       │
│  • Deploy on git push               │
│  • Free tier: Unlimited bandwidth   │
│                                     │
│  Deployment:                        │
│  1. Connect GitHub repo             │
│  2. Set root: frontend/             │
│  3. Deploy → Done!                  │
└─────────────────────────────────────┘

Domain: app.portavio.io
Cost: FREE
```

### Backend: Railway
```
┌─────────────────────────────────────┐
│  Railway Container                  │
│                                     │
│  • Docker-based deployment          │
│  • Auto-scaling (0.5-4 GB RAM)      │
│  • GitHub integration               │
│  • Environment variables UI         │
│  • Automatic HTTPS                  │
│  • Built-in monitoring              │
│                                     │
│  Deployment:                        │
│  1. Connect GitHub repo             │
│  2. Set root: backend/              │
│  3. Add env vars                    │
│  4. Deploy → Auto-restart on push   │
└─────────────────────────────────────┘

Domain: api.portavio.io
Resources: 512MB RAM, shared CPU
Cost: $5-20/month (scales with usage)
```

### Database: Neon
```
┌─────────────────────────────────────┐
│  Neon Serverless Postgres           │
│                                     │
│  • Auto-scaling compute             │
│  • Auto-pause when idle             │
│  • Instant branching                │
│  • Daily backups (7 days)           │
│  • Connection pooling built-in      │
│  • 3GB storage free tier            │
│                                     │
│  Tables:                            │
│  • organizations                    │
│  • users, organization_members      │
│  • jira_connections                 │
│  • projects, teams, epics           │
│  • risks, blockers, dependencies    │
│  • Plus 15+ more tables             │
└─────────────────────────────────────┘

Endpoint: ep-xxx.us-east-2.aws.neon.tech
Cost: $0-19/month
```

### Queue: Upstash Redis
```
┌─────────────────────────────────────┐
│  Upstash Serverless Redis           │
│                                     │
│  • Used for: Background jobs        │
│  • Sync scheduling                  │
│  • Job retry logic                  │
│  • Pay-per-request pricing          │
│  • Free tier: 10K requests/day      │
│                                     │
│  Jobs:                              │
│  • Auto-sync Jira (hourly)          │
│  • Email queue                      │
│  • Analytics aggregation            │
└─────────────────────────────────────┘

Endpoint: xxx.upstash.io:6379
Cost: $0-10/month
```

### Email: Resend
```
┌─────────────────────────────────────┐
│  Resend Transactional Email         │
│                                     │
│  • Send from: hello@portavio.io     │
│  • Templates:                       │
│    - Welcome email                  │
│    - Team invitation                │
│    - Trial ending warning           │
│    - Payment receipt                │
│    - Weekly digest                  │
│  • Bounce/complaint handling        │
│  • Free tier: 3,000 emails/month    │
└─────────────────────────────────────┘

API: https://api.resend.com
Cost: $0-20/month
```

### Payments: Stripe
```
┌─────────────────────────────────────┐
│  Stripe Payment Processing          │
│                                     │
│  • Products:                        │
│    - Starter: $49/month             │
│    - Pro: $149/month                │
│    - Enterprise: $499/month         │
│                                     │
│  • Features:                        │
│    - Hosted checkout                │
│    - Subscription management        │
│    - Webhooks                       │
│    - Customer portal                │
│    - Invoice generation             │
│                                     │
│  • Test mode for development        │
└─────────────────────────────────────┘

Webhooks: api.portavio.io/api/billing/webhook
Cost: 2.9% + 30¢ per transaction
```

### Monitoring: Sentry + UptimeRobot
```
┌─────────────────────────────────────┐
│  Sentry - Error Tracking            │
│                                     │
│  • JavaScript errors                │
│  • API exceptions                   │
│  • Performance monitoring           │
│  • Alerts via email/Slack           │
│  • Free: 5K events/month            │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  UptimeRobot - Uptime Monitoring    │
│                                     │
│  • Ping api.portavio.io every 5min  │
│  • Email alert if down              │
│  • Status page                      │
│  • Free: 50 monitors                │
└─────────────────────────────────────┘

Cost: FREE (both)
```

---

## Data Flow

### 1. User Registration
```
User (browser)
    ↓ POST /api/auth/register
Railway (backend)
    ↓ INSERT INTO users, organizations
Neon (database)
    ↓ return user + org
Railway
    ↓ Generate JWT
User (browser)
    → Logged in
```

### 2. Jira Sync
```
User clicks "Sync"
    ↓ POST /api/jira/sync
Railway (backend)
    ↓ Fetch from Jira API
Jira Cloud (Atlassian)
    ↓ Return projects, epics, issues
Railway
    ↓ INSERT/UPDATE 1000+ rows
Neon (database)
    ↓ Confirm
Railway
    ↓ Enqueue background job
Upstash (Redis)
    ↓ Schedule next sync
User
    → Dashboard shows data
```

### 3. Team Invitation
```
Owner invites member
    ↓ POST /api/org/:slug/invite
Railway (backend)
    ↓ INSERT INTO invitations
Neon (database)
    ↓ Generate token
Railway
    ↓ Send email
Resend
    ↓ Deliver to recipient
Member clicks link
    ↓ GET /accept-invite/:token
Railway
    ↓ INSERT INTO organization_members
Member
    → Joins organization
```

### 4. Payment
```
User clicks "Upgrade"
    ↓ POST /api/billing/checkout
Railway (backend)
    ↓ Create checkout session
Stripe
    ↓ Return checkout URL
User
    ↓ Redirected to Stripe
User enters card
    ↓ Payment processed
Stripe
    ↓ POST /api/billing/webhook
Railway
    ↓ UPDATE organizations SET plan='starter'
Neon
User
    → Limits increased
```

---

## Scaling Plan

### Month 1-3: Free Tier + Railway Basic
- Users: 0-50
- Database: Neon Free (3GB)
- Backend: Railway Starter ($5/month)
- **Total: $5-10/month**

### Month 4-6: Growing
- Users: 50-200
- Database: Neon Scale ($19/month, 10GB)
- Backend: Railway Pro ($20/month, 2GB RAM)
- Redis: Upstash Pay-as-go ($10/month)
- **Total: $49/month**

### Month 7-12: Scaling
- Users: 200-1000
- Database: Neon Scale ($50/month, 50GB)
- Backend: Railway Pro ($50/month, 8GB RAM)
- Redis: Upstash Pro ($20/month)
- Email: Resend Pro ($20/month)
- **Total: $140/month**

### Year 2: Enterprise
- Users: 1000+
- Database: Neon Business ($200/month, 200GB)
- Backend: Railway Team ($200/month, dedicated)
- Redis: Upstash Enterprise ($100/month)
- Email: Resend Pro ($80/month)
- CDN: Cloudflare Pro ($20/month)
- **Total: $600/month**

**Break-even at every stage:**
- Month 1: 1 customer ($49 Starter plan)
- Month 6: 1 customer ($49 Starter plan)
- Month 12: 3 customers ($149 Pro plan)
- Year 2: 2 customers ($499 Enterprise plan)

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Security Layers                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. TRANSPORT (HTTPS)                                        │
│     All traffic encrypted via TLS 1.3                        │
│     Vercel + Railway: Automatic SSL certificates            │
│                                                              │
│  2. AUTHENTICATION (JWT)                                     │
│     JSON Web Tokens with 7-day expiry                        │
│     Stored in localStorage, sent via Authorization header    │
│                                                              │
│  3. AUTHORIZATION (Multi-Tenancy)                            │
│     Every API call validates:                                │
│     - User is authenticated                                  │
│     - User belongs to requested org                          │
│     - User has required role (owner/admin/member/viewer)     │
│                                                              │
│  4. DATA ENCRYPTION                                          │
│     Jira API tokens encrypted at rest (AES-256)              │
│     Database connection uses SSL                             │
│                                                              │
│  5. RATE LIMITING                                            │
│     100 requests per 15 minutes per IP                       │
│     Prevents brute force attacks                             │
│                                                              │
│  6. INPUT VALIDATION                                         │
│     All inputs sanitized                                     │
│     SQL injection prevented via parameterized queries        │
│                                                              │
│  7. SECRETS MANAGEMENT                                       │
│     No secrets in code                                       │
│     All env vars in Railway/Vercel dashboards                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Cost Summary

| Service | Free Tier | Paid Tier | At Scale |
|---------|-----------|-----------|----------|
| **Vercel** | Unlimited | Unlimited | Unlimited |
| **Railway** | - | $5-20/mo | $50-200/mo |
| **Neon** | 3GB | $19/mo | $50-200/mo |
| **Upstash** | 10K/day | $10/mo | $20-100/mo |
| **Resend** | 3K/mo | $20/mo | $80/mo |
| **Stripe** | - | 2.9%+30¢ | 2.9%+30¢ |
| **Sentry** | 5K/mo | Free | $26/mo |
| **UptimeRobot** | 50 monitors | Free | Free |
| **Domain** | - | $12/yr | $12/yr |
| **TOTAL** | **$6/mo** | **$30-70/mo** | **$140-600/mo** |

**Revenue to cover costs:**
- Month 1: Need 1 Starter customer ($49/mo)
- Month 6: Need 1 Starter customer ($49/mo)
- Month 12: Need 3 Starter customers ($147/mo)
- Year 2: Need 2 Enterprise customers ($998/mo)

---

## Deployment Checklist

Use this to track your progress:

### Infrastructure
- [ ] Neon database created
- [ ] Railway backend deployed
- [ ] Vercel frontend deployed
- [ ] Upstash Redis created
- [ ] Resend domain verified
- [ ] Stripe products created

### DNS Configuration
- [ ] `portavio.io` → Vercel
- [ ] `app.portavio.io` → Vercel
- [ ] `api.portavio.io` → Railway
- [ ] MX records → Resend
- [ ] TXT records → Resend

### Environment Variables
- [ ] DATABASE_URL
- [ ] JWT_SECRET
- [ ] ENCRYPTION_KEY
- [ ] REDIS_URL
- [ ] RESEND_API_KEY
- [ ] STRIPE_SECRET_KEY
- [ ] STRIPE_WEBHOOK_SECRET
- [ ] STRIPE_PRICE_* (3 products)

### Testing
- [ ] User registration works
- [ ] Jira connection works
- [ ] Data sync completes
- [ ] Plan limits enforced
- [ ] Stripe checkout works (test mode)
- [ ] Email sending works
- [ ] Multi-tenancy isolation verified

### Monitoring
- [ ] Sentry configured
- [ ] UptimeRobot monitoring api.portavio.io
- [ ] Railway metrics reviewed
- [ ] Neon connection pool checked

### Launch
- [ ] Terms of Service page added
- [ ] Privacy Policy page added
- [ ] Support email forwarding setup
- [ ] Stripe switched to Live Mode
- [ ] Announced on Twitter/LinkedIn

---

**Ready to deploy?** → [START_HERE.md](START_HERE.md)
