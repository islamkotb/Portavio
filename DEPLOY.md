# 🚀 Deployment Guide — Portavio

## Option Comparison at a Glance

| Option | Cost/month | Difficulty | Best For |
|--------|-----------|------------|----------|
| DigitalOcean Droplet | $12–24 | ⭐⭐ Easy | Recommended for most users |
| Railway | $5–20 | ⭐ Easiest | Fastest to launch |
| Render | Free–$25 | ⭐ Easiest | Free tier available |
| AWS/GCP/Azure | $20–50+ | ⭐⭐⭐ Hard | Enterprise scale |
| Self-hosted VPS | $5–15 | ⭐⭐⭐ Hard | Full control / cheapest |

---

## 🥇 Option 1: DigitalOcean (Recommended)

**Why:** Simple UI, predictable pricing, great performance, $200 free credit for new accounts.

### Step 1 — Create a Droplet

1. Sign up at https://digitalocean.com
2. Click **Create → Droplet**
3. Choose:
   - **Image:** Ubuntu 24.04 LTS
   - **Plan:** Basic — $12/month (2GB RAM, 1 vCPU) — enough for 50+ users
   - **Region:** Closest to your users
   - **Authentication:** SSH Key (recommended) or Password
4. Click **Create Droplet**
5. Note the IP address (e.g. `167.99.100.200`)

### Step 2 — SSH Into Your Server

```bash
ssh root@YOUR_IP_ADDRESS
```

### Step 3 — Run the One-Command Setup

```bash
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin git
git clone https://github.com/YOUR_USERNAME/portavio.git
cd portavio
```

Or upload the zip directly:
```bash
# From your local machine:
scp portavio.zip root@YOUR_IP:/root/
ssh root@YOUR_IP
unzip portavio.zip
cd portavio
```

### Step 4 — Configure Environment

```bash
cp .env.production .env
nano .env
```

Fill in these values:
```env
DB_PASSWORD=choose_a_strong_password_here
JWT_SECRET=<run: openssl rand -hex 32>
ENCRYPTION_KEY=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
CORS_ORIGIN=http://YOUR_IP_ADDRESS
```

Generate secrets quickly:
```bash
# JWT Secret
openssl rand -hex 32

# Encryption Key (run once Node is installed via Docker)
docker run --rm node:18-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 5 — Launch with Docker Compose

```bash
docker compose up -d
```

This starts 3 containers:
- **db** — PostgreSQL (schema auto-applied on first run)
- **backend** — Node.js API on port 3001
- **frontend** — Nginx serving the dashboard on port 80

### Step 6 — Verify It's Running

```bash
docker compose ps        # All 3 should show "Up"
docker compose logs -f   # Watch logs live
curl localhost/api/health # Should return {"status":"healthy"}
```

Open `http://YOUR_IP_ADDRESS` in your browser — done! ✅

### Step 7 — Add a Domain Name (Optional but Recommended)

1. Buy a domain (Namecheap ~$12/year, or Cloudflare)
2. Add an A record: `yourdomain.com → YOUR_IP_ADDRESS`
3. Add HTTPS with Let's Encrypt (free):

```bash
apt install -y certbot python3-certbot-nginx

# Replace nginx.conf with HTTPS version
cat > /root/portavio/nginx.conf << 'EOF'
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name yourdomain.com;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri /index.html; }
    location /api/ {
        proxy_pass http://backend:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

certbot --nginx -d yourdomain.com
docker compose restart frontend
```

4. Update `.env`:
```env
CORS_ORIGIN=https://yourdomain.com
```

---

## 🚄 Option 2: Railway (Fastest — 10 Minutes)

**Why:** No server management. Automatic deploys from GitHub. Free $5 credit.

### Step 1 — Push to GitHub

```bash
cd portavio
git init
git add .
git commit -m "Initial commit"
# Create repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/portavio.git
git push -u origin main
```

### Step 2 — Deploy on Railway

1. Go to https://railway.app and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your repo
4. Railway auto-detects the Dockerfile in `/backend`

### Step 3 — Add PostgreSQL

1. In your Railway project, click **New → Database → PostgreSQL**
2. Railway auto-injects `DATABASE_URL` into your backend

### Step 4 — Set Environment Variables

In Railway dashboard → your backend service → **Variables**:

```
JWT_SECRET=<generate with openssl rand -hex 32>
ENCRYPTION_KEY=<generate random hex>
DB_HOST=${{Postgres.PGHOST}}
DB_PORT=${{Postgres.PGPORT}}
DB_NAME=${{Postgres.PGDATABASE}}
DB_USER=${{Postgres.PGUSER}}
DB_PASSWORD=${{Postgres.PGPASSWORD}}
PORT=3001
NODE_ENV=production
CORS_ORIGIN=https://your-app.railway.app
```

### Step 5 — Deploy Frontend

For the frontend, use Vercel (free):
1. Go to https://vercel.com
2. Import your GitHub repo
3. Set **Root Directory** to `frontend`
4. Add environment variable: `API_BASE=https://your-backend.railway.app`
5. Update the `API_BASE` in `frontend/index.html`:
   ```javascript
   const API_BASE = 'https://your-backend.railway.app';
   ```

---

## 🎨 Option 3: Render (Free Tier Available)

**Why:** Has a free tier. Good for testing before paying.

### Backend on Render

1. Go to https://render.com
2. **New → Web Service → Connect GitHub repo**
3. Settings:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free (spins down after 15min inactivity) or Starter $7/month
4. Add environment variables (same as Railway above)

### Database on Render

1. **New → PostgreSQL**
2. Free tier: 1GB storage (enough for small teams)
3. Copy the **Internal Database URL** to your backend env vars

### Frontend on Render

1. **New → Static Site → Connect GitHub repo**
2. **Root Directory:** `frontend`
3. **Build Command:** (leave empty)
4. **Publish Directory:** `.`

---

## 🐳 Option 4: Any VPS with Docker (Cheapest)

Works on Hetzner ($4/mo), Vultr ($6/mo), Linode ($5/mo) — same steps as DigitalOcean above. Hetzner is cheapest in Europe; Vultr is good globally.

---

## 🔧 Post-Deployment Checklist

After deploying, verify everything works:

```bash
# Health check
curl https://yourdomain.com/api/health
# Expected: {"status":"healthy","timestamp":"..."}

# Can reach the API
curl https://yourdomain.com/api/auth/register \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test1234","name":"Test User"}'
# Expected: {"message":"Registered","token":"..."}
```

Then in your browser:
- [ ] Open `https://yourdomain.com`
- [ ] Register an account
- [ ] Connect to Jira
- [ ] Trigger a sync
- [ ] Verify dashboard shows your data

---

## 🔄 Updating the Application

When you make changes:

```bash
# On your server
cd /root/portavio
git pull               # If using git
docker compose down
docker compose up -d --build
```

Or for zero-downtime:
```bash
docker compose up -d --build --no-deps backend
docker compose up -d --no-deps frontend
```

---

## 📊 Scaling Guide

### For up to 50 users: $12/month Droplet
- Current setup handles this easily
- 2GB RAM, 1 vCPU

### For 50–500 users: $24/month Droplet
- Upgrade to 4GB RAM, 2 vCPU
- `docker compose up -d` — no other changes needed

### For 500+ users:
- Separate database server (DigitalOcean Managed PostgreSQL ~$15/month)
- Load balancer for multiple backend instances
- Redis for session caching

---

## 🛡️ Security Hardening (Recommended)

```bash
# 1. Firewall — only allow ports 80, 443, 22
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable

# 2. Fail2ban — blocks brute force SSH
apt install -y fail2ban
systemctl enable fail2ban

# 3. Auto security updates
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# 4. Change SSH port (optional but good)
# Edit /etc/ssh/sshd_config → Port 2222
# ufw allow 2222
```

---

## 💾 Backup Strategy

```bash
# Add this to crontab (runs daily at 2am)
crontab -e
# Add: 0 2 * * * docker exec portavio_db pg_dump -U postgres portavio > /backups/db_$(date +%Y%m%d).sql

# Create backup directory
mkdir -p /backups

# Test backup
docker exec portavio_db pg_dump -U postgres portavio > /backups/test.sql
ls -la /backups/
```

For off-site backups, sync to DigitalOcean Spaces or S3:
```bash
apt install -y s3cmd
s3cmd sync /backups/ s3://your-bucket/portavio-backups/
```

---

## 🐛 Troubleshooting

### Containers won't start
```bash
docker compose logs db       # Check database logs
docker compose logs backend  # Check API logs
docker compose logs frontend # Check nginx logs
```

### Database connection refused
```bash
# Check if DB is healthy
docker compose ps
# Should show: portavio_db   Up (healthy)

# If not healthy, restart it
docker compose restart db
sleep 10
docker compose restart backend
```

### CORS errors in browser
```bash
# Update .env
CORS_ORIGIN=https://yourdomain.com  # Must match exactly

# Restart backend
docker compose restart backend
```

### Out of disk space
```bash
df -h                          # Check disk usage
docker system prune -af        # Remove unused images/containers
docker volume prune            # Remove unused volumes (careful!)
```

### Reset everything (nuclear option)
```bash
docker compose down -v         # Stops all + deletes database volume
docker compose up -d           # Fresh start
```
