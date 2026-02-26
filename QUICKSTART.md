# 🚀 Quick Start Guide

Get your Portavio running in 5 minutes!

## Step 1: Prerequisites Check ✅

Make sure you have:
- [ ] Node.js 16+ installed ([Download](https://nodejs.org/))
- [ ] PostgreSQL 13+ installed ([Download](https://www.postgresql.org/download/))
- [ ] Jira Cloud account
- [ ] Jira API token ([Get one here](https://id.atlassian.com/manage-profile/security/api-tokens))

## Step 2: Run Setup Script 🔧

### On Mac/Linux:
```bash
cd backend
chmod +x ../scripts/setup.sh
../scripts/setup.sh
```

### On Windows:
```cmd
cd backend
..\scripts\setup.bat
```

The script will:
- Create the database
- Set up tables
- Generate security keys
- Install dependencies

## Step 3: Start Backend 🖥️

```bash
cd backend
npm start
```

You should see:
```
✅ Database connection verified
🚀 Server running on port 3001
```

## Step 4: Open Frontend 🌐

### Option A: Direct Open
Just double-click `frontend/index.html`

### Option B: Local Server (recommended)
```bash
cd frontend
python3 -m http.server 3000
```

Then visit: http://localhost:3000

## Step 5: Configure Jira Connection 🔗

1. **Register Account**
   - Click "Register" or go directly to registration
   - Enter your email, password, and name
   - You'll receive a JWT token automatically

2. **Connect to Jira**
   - Enter your Jira URL: `https://your-company.atlassian.net`
   - Enter your Jira email
   - Enter your Jira API token ([get one here](https://id.atlassian.com/manage-profile/security/api-tokens))
   - Click "Connect to Jira"

3. **Sync Your Data**
   - Click the "Sync" button (or it may sync automatically)
   - Wait for data to load (first sync may take 1-2 minutes)
   - Dashboard will populate with your real Jira data!

## Step 6: Explore Dashboard 📊

You now have access to:
- Portfolio overview with project health
- Team capacities and velocities
- Epic progress tracking
- Dependencies visualization
- Risk and blocker management
- Timeline and roadmap
- Predictability metrics
- Velocity trends

## Troubleshooting 🔧

### Database Connection Failed
```bash
# Make sure PostgreSQL is running
# Mac:
brew services start postgresql

# Linux:
sudo systemctl start postgresql

# Windows:
# Start from Services app
```

### Port 3001 Already in Use
```bash
# Find and kill the process
lsof -i :3001
kill -9 <PID>

# Or change the port in backend/.env
PORT=3002
```

### Jira Connection Failed
- Double-check your Jira URL (no trailing slash!)
- Verify API token is correct
- Make sure your email matches your Jira account
- Ensure you have access to the projects

### Frontend Not Loading Data
- Check backend is running (http://localhost:3001/health)
- Open browser console (F12) for error messages
- Verify you're logged in (token saved)
- Try clicking the Refresh button

## Next Steps 🎯

1. **Add Team Members**: Share login credentials with your team
2. **Schedule Sync**: Set up regular data syncs (manual for now)
3. **Customize Metrics**: Adjust team capacities and velocities
4. **Track Risks**: Add and monitor project risks
5. **Plan Roadmap**: Use timeline for strategic planning

## Need Help? 💬

- Check the full README.md for detailed documentation
- Review API endpoints at http://localhost:3001/
- Common issues covered in Troubleshooting section
- Database schema in `database/schema.sql`

## What's Next? 🔮

Consider:
- Setting up automated syncs (cron job)
- Adding custom Jira fields
- Configuring email notifications
- Deploying to production (see README.md)

---

**You're all set! Happy portfolio management! 🎉**
