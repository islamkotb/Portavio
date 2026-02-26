# 📁 Project Structure

```
portavio/
│
├── 📄 README.md                    # Complete documentation
├── 📄 QUICKSTART.md                # 5-minute setup guide
├── 📄 .gitignore                   # Git ignore rules
│
├── 📂 backend/                     # Backend API server
│   ├── server.js                   # Complete Express server (all-in-one)
│   ├── package.json                # Node.js dependencies
│   ├── .env.example                # Environment template
│   └── .env                        # Your config (created by setup)
│
├── 📂 frontend/                    # Frontend dashboard
│   └── index.html                  # Complete React-based UI
│
├── 📂 database/                    # Database schemas
│   └── schema.sql                  # PostgreSQL schema with all tables
│
└── 📂 scripts/                     # Setup automation
    ├── setup.sh                    # Automated setup (Mac/Linux)
    └── setup.bat                   # Automated setup (Windows)
```

## 📋 File Descriptions

### Backend (backend/)

**server.js** (Complete all-in-one backend)
- Express server setup
- Database connection pool
- JWT authentication middleware
- Encryption utilities
- Jira API client
- Authentication routes (register, login, profile)
- Jira connection routes (connect, sync, status)
- Dashboard routes (overview, teams, epics, etc.)
- Error handling
- All in a single, well-organized file!

**package.json**
- All required dependencies
- Scripts for starting server
- Development tools

**.env.example / .env**
- Database configuration
- JWT secret
- Encryption key
- Server settings
- CORS configuration

### Frontend (frontend/)

**index.html** (Complete React dashboard)
- User authentication interface
- Jira connection panel
- Portfolio overview cards
- Team capacity tracking
- Epic progress visualization
- Dependencies graph
- Risk and blocker displays
- Timeline/roadmap view
- Predictability scores
- Velocity trend charts
- Beautiful, responsive design
- All JavaScript embedded

### Database (database/)

**schema.sql** (Complete PostgreSQL schema)
- 13 core tables:
  - users (authentication)
  - jira_connections (API credentials)
  - teams (team metrics)
  - projects (project tracking)
  - epics (epic progress)
  - sprints (sprint data)
  - issues (task tracking)
  - dependencies (cross-epic dependencies)
  - risks (risk register)
  - blockers (impediment tracking)
  - timeline_events (roadmap)
  - velocity_history (performance tracking)
  - predictability_metrics (consistency scores)
- All indexes for performance
- Foreign key relationships
- Unique constraints

### Scripts (scripts/)

**setup.sh** (Mac/Linux automated setup)
- Checks prerequisites
- Creates database
- Runs schema
- Generates security keys
- Creates .env file
- Installs dependencies
- Fully automated!

**setup.bat** (Windows automated setup)
- Same functionality as setup.sh
- Windows batch file format
- Works on Windows 10/11

## 🎯 Key Features

### Backend Highlights
✅ Single-file architecture (easy to understand)
✅ Complete REST API
✅ JWT authentication
✅ AES-256 encryption for credentials
✅ Rate limiting
✅ Security headers
✅ CORS protection
✅ Error handling
✅ PostgreSQL connection pooling
✅ Jira API integration
✅ Data synchronization

### Frontend Highlights
✅ Modern React-based UI
✅ Responsive design
✅ Chart.js visualizations
✅ Real-time updates
✅ Demo mode with sample data
✅ Connection status indicators
✅ Loading states
✅ Error handling
✅ Beautiful gradients and animations

### Database Highlights
✅ Normalized schema
✅ Performance indexes
✅ Foreign key constraints
✅ Upsert support (ON CONFLICT)
✅ Automatic timestamps
✅ Comprehensive data model

## 🚀 How It All Works Together

1. **User registers/logs in** → Backend creates JWT token
2. **User connects to Jira** → Backend encrypts and stores credentials
3. **User triggers sync** → Backend fetches data from Jira API
4. **Data is stored** → PostgreSQL database with full relationships
5. **Dashboard loads** → Frontend calls backend API endpoints
6. **Metrics calculated** → Backend computes velocities, predictability, etc.
7. **Charts display** → Frontend visualizes all data beautifully

## 📦 What's Included

- ✅ Complete backend API
- ✅ Beautiful frontend dashboard
- ✅ Full database schema
- ✅ Automated setup scripts
- ✅ Comprehensive documentation
- ✅ Security best practices
- ✅ Error handling
- ✅ Sample data for testing

## 🎓 Technology Stack

### Backend
- Node.js + Express
- PostgreSQL with pg driver
- JWT for authentication
- bcrypt for password hashing
- CryptoJS for encryption
- Axios for HTTP requests
- Helmet for security
- Morgan for logging
- Express rate limiting

### Frontend
- Vanilla JavaScript
- Chart.js for visualizations
- CSS3 with gradients and animations
- Responsive design
- Fetch API for backend communication

### Database
- PostgreSQL 13+
- 13 normalized tables
- Foreign key relationships
- Performance indexes

## 📊 Database Size Estimates

Typical usage for medium organization:
- Users: ~50 records
- Projects: ~20 records
- Teams: ~10 records
- Epics: ~100 records
- Sprints: ~60 records
- Issues: ~1,000 records
- Total database size: ~5-10 MB

## 🔐 Security Features

- Passwords hashed with bcrypt (10 rounds)
- JWT tokens with expiration
- Jira API tokens encrypted with AES-256
- Rate limiting (100 req/15min)
- CORS protection
- Security headers via Helmet
- SQL injection protection (parameterized queries)
- XSS protection
- HTTPS ready

## 🎯 Next Steps

1. Run setup script
2. Start backend
3. Open frontend
4. Register account
5. Connect to Jira
6. Sync data
7. Explore dashboard!

See QUICKSTART.md for detailed instructions.

---

**Everything you need in one complete package! 🎉**
