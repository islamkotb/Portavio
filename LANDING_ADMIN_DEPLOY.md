# 🚀 Landing Pages & Admin Dashboard — Deployment Guide

This guide shows you how to deploy the marketing website, login page, and admin dashboard.

---

## What's Included

### 1. Landing Pages (`landing/`)
- **index.html** — Marketing website with features, pricing, CTA
- **login.html** — Login and registration page

### 2. Admin Dashboard (`admin/`)
- **index.html** — Complete admin panel for managing users and subscriptions

### 3. Backend API (`backend/`)
- **routes-admin.js** — Admin API endpoints

---

## Quick Deployment Overview

```
┌─────────────────────────────────────────────────┐
│ portavio.io              → Landing page         │
│ app.portavio.io          → Main application     │
│ admin.portavio.io        → Admin dashboard      │
│ api.portavio.io          → Backend API          │
└─────────────────────────────────────────────────┘
```

---

## Step 1: Integrate Admin API

### 1.1. Add to `backend/server.js`

Add this near the top after other requires:

```javascript
// Import admin routes
const { requireAdmin } = require('./routes-admin');
```

Then **copy all route handlers** from `backend/routes-admin.js` and paste them into `server.js` before the final `app.listen()`.

The routes you're adding:
- `GET /api/admin/stats`
- `GET /api/admin/recent-signups`
- `GET /api/admin/organizations`
- `GET /api/admin/organizations/:id`
- `PATCH /api/admin/organizations/:id/subscription`
- `GET /api/admin/users`
- `GET /api/admin/users/:id`
- `GET /api/admin/subscriptions`
- `PATCH /api/admin/users/:id/role`

### 1.2. Update Database Schema

The admin routes use the `role` column in the `users` table. If you haven't run the multi-tenant migration yet, add this:

```sql
-- Add role column if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';

-- Make yourself an admin
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

### 1.3. Commit and Deploy

```bash
git add backend/
git commit -m "Add admin API endpoints"
git push
```

Railway will auto-deploy the backend.

---

## Step 2: Deploy Landing Pages

You have 2 options:

### Option A: Deploy with Main App (Simpler)

Copy landing pages into your existing frontend:

```bash
# Copy landing pages
cp landing/index.html frontend/home.html
cp landing/login.html frontend/login.html

# Update navigation in frontend/index.html
# Change logo link to: <a href="/home.html">

git add frontend/
git commit -m "Add landing pages"
git push
```

Now:
- `app.portavio.io` → Main app
- `app.portavio.io/home.html` → Landing page
- `app.portavio.io/login.html` → Login

**Better approach:** Make landing page the default by renaming:
```bash
mv frontend/index.html frontend/app.html
mv landing/index.html frontend/index.html
```

### Option B: Separate Vercel Project (Recommended)

Deploy landing on main domain, app on subdomain:

1. **Create new Vercel project:**
   - Import your repo
   - Root directory: `landing/`
   - Framework: Other
   - Deploy

2. **Add custom domain:**
   - Settings → Domains → `portavio.io`

3. **Update links:**
   - In `landing/index.html`, change:
     ```html
     <a href="/login.html">Sign In</a>
     ```
   - In `landing/login.html`, change redirect:
     ```javascript
     window.location.href = 'https://app.portavio.io';
     ```

Now you have:
- `portavio.io` → Landing page (separate deployment)
- `app.portavio.io` → Main app (existing deployment)

---

## Step 3: Deploy Admin Dashboard

**Important:** Deploy admin separately for security!

### 3.1. Create Separate Vercel Project

1. Go to Vercel → New Project
2. Import `portavio` repo
3. Settings:
   - **Root Directory:** `admin/`
   - **Framework Preset:** Other
   - **Build Command:** (leave empty)
   - **Output Directory:** `.`

4. Deploy

### 3.2. Add Custom Domain

In Vercel project settings:
- Domains → Add `admin.portavio.io`

In Namecheap DNS:
```
Type: CNAME
Host: admin
Value: cname.vercel-dns.com
TTL: Automatic
```

### 3.3. Add Password Protection (CRITICAL!)

In Vercel project → Settings → Deployment Protection:

1. Enable **Password Protection**
2. Set password: (strong password)
3. Save

Now anyone visiting `admin.portavio.io` must enter password first.

### 3.4. Update API URL in Admin Dashboard

Edit `admin/index.html`, line ~750:

```javascript
const API_BASE = 'https://api.portavio.io';  // Your Railway backend
```

Commit and redeploy:
```bash
git add admin/index.html
git commit -m "Update admin API URL"
git push
```

---

## Step 4: Create First Admin User

### 4.1. Via Database

```sql
-- Connect to your Neon database
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

### 4.2. Verify Admin Access

1. Go to `https://app.portavio.io` (or your main app URL)
2. Log in with your email
3. Open browser console and run:
   ```javascript
   fetch('https://api.portavio.io/api/admin/stats', {
     headers: { 
       'Authorization': 'Bearer ' + localStorage.getItem('pv_token')
     }
   }).then(r => r.json()).then(console.log)
   ```
4. If you see stats → Admin access works! ✅
5. If you see 403 error → Check role in database

---

## Step 5: Access Admin Dashboard

1. Visit `https://admin.portavio.io`
2. Enter password (from Vercel protection)
3. You'll see login page
4. Sign in with your admin account
5. You should see:
   - Dashboard with stats
   - Recent signups
   - Navigation sidebar

**Bookmark this!** You'll use it to manage customers.

---

## How to Use Admin Dashboard

### View All Users

1. Click **Users** in sidebar
2. See table with all registered users
3. Click **View** to see user details
4. Check which organization they belong to

### Manage Subscriptions

1. Click **Subscriptions** in sidebar
2. See all organizations with their plans
3. **Enable** button → Reactivate subscription
4. **Disable** button → Cancel subscription immediately

### View Organization Details

1. Click **Organizations** in sidebar
2. Click **View** on any organization
3. See:
   - Plan type
   - Member count
   - Trial end date
   - Subscription status

### Make Someone Else Admin

Currently not in UI, but you can do it via API:

```bash
curl -X PATCH https://api.portavio.io/api/admin/users/USER_ID/role \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}'
```

---

## Security Checklist

Before going live, verify:

- [ ] Admin dashboard has password protection in Vercel
- [ ] Admin dashboard is on separate subdomain (`admin.portavio.io`)
- [ ] Backend validates admin role on all `/api/admin/*` routes
- [ ] Admin actions are logged in `audit_log` table
- [ ] You've tested enable/disable subscription
- [ ] Regular users get 403 when accessing admin routes

---

## Testing the Admin Dashboard

### Test 1: View Statistics

1. Log in to admin dashboard
2. Dashboard should show:
   - Total users count
   - Active subscriptions
   - MRR (Monthly Recurring Revenue)
   - Conversion rate

### Test 2: Disable a Subscription

1. Go to **Subscriptions**
2. Find a test organization
3. Click **Disable**
4. Confirm the action
5. Verify in database:
   ```sql
   SELECT subscription_status FROM organizations WHERE id = X;
   -- Should be 'canceled'
   ```
6. Try logging in as that org → Should fail or show "subscription inactive"

### Test 3: Enable a Subscription

1. Click **Enable** on the same organization
2. Verify status changed to 'active'
3. Log in as that org → Should work

---

## Troubleshooting

### "403 Forbidden" when accessing admin routes

**Fix:** Make sure you're logged in as admin:
```sql
SELECT role FROM users WHERE email = 'your@email.com';
-- Should return 'admin'
```

### Admin dashboard shows "Loading..." forever

**Fix:** Check API URL in `admin/index.html`:
```javascript
const API_BASE = 'https://api.portavio.io';  // Must match your backend
```

### Can't access admin dashboard at admin.portavio.io

**Fix:** Check DNS propagation:
```bash
dig admin.portavio.io
# Should point to Vercel
```

### Enable/Disable buttons don't work

**Fix:** Check Railway logs:
```bash
railway logs
```

Look for errors in the PATCH endpoint.

---

## URLs Summary

After deployment, you'll have:

| URL | Purpose | Deployed To |
|-----|---------|-------------|
| `portavio.io` | Marketing website | Vercel (landing/) |
| `portavio.io/login.html` | Login/register | Vercel (landing/) |
| `app.portavio.io` | Main application | Vercel (frontend/) |
| `admin.portavio.io` | Admin dashboard | Vercel (admin/) |
| `api.portavio.io` | Backend API | Railway (backend/) |

---

## Next Steps

1. **Add email notifications** when you enable/disable subscriptions
2. **Add bulk actions** (disable multiple orgs at once)
3. **Add charts** for MRR growth, user growth
4. **Add export** to CSV for user lists
5. **Add 2FA** for admin accounts

---

## Cost Impact

New deployments:
- Landing page (Vercel): **FREE**
- Admin dashboard (Vercel): **FREE**

Total cost remains: **$30-70/month** (no change)

---

## Final Checklist

- [ ] Backend admin routes added to `server.js`
- [ ] Database has `role` column in `users` table
- [ ] At least one admin user created
- [ ] Landing page deployed to `portavio.io`
- [ ] Admin dashboard deployed to `admin.portavio.io`
- [ ] Admin dashboard has password protection
- [ ] Tested enable/disable subscription
- [ ] All domains point to correct Vercel projects
- [ ] API_BASE URLs updated in all HTML files

Once all boxes are checked, you're live! 🎉

---

**Need help?** Check the main deployment guide: `DEPLOYMENT_GUIDE.md`
