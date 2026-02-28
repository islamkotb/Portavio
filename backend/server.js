const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');
const CryptoJS = require('crypto-js');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================================
// DATABASE
// ============================================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection error:', err.stack);
  } else {
    console.log('✅ Database connected successfully');
    release();
  }
});

pool.on('error', (err) => console.error('Database error:', err));

// ============================================================================
// MIDDLEWARE
// ============================================================================
app.use(helmet());
console.log('================================');
console.log('🔍 CORS Configuration:');
console.log('  CORS_ORIGIN:', process.env.CORS_ORIGIN);
console.log('  Expected:', 'https://portavio-islamkotb-2775s-projects.vercel.app');
console.log('  Match:', process.env.CORS_ORIGIN === 'https://portavio-islamkotb-2775s-projects.vercel.app');
console.log('================================');

//app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
// CORS configuration with array of allowed origins
const allowedOrigins = [
  'https://portavio-islamkotb-2775s-projects.vercel.app',
  'https://portavio.vercel.app',
  'https://api.portavio.io',
  'https://portavio-production.up.railway.app',
  'http://localhost:3000',
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // Temporarily allow all for debugging
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Org-Slug'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// ============================================================================
// UTILITIES
// ============================================================================
const encrypt = (text) => CryptoJS.AES.encrypt(text, process.env.ENCRYPTION_KEY).toString();
const decrypt = (text) => CryptoJS.AES.decrypt(text, process.env.ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
const generateToken = (userId, email) =>
  jwt.sign({ userId, email }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// Helper: get active connection for authenticated user
const getConnection = async (userId) => {
  const result = await pool.query(
    'SELECT id, jira_url, jira_email, jira_api_token FROM jira_connections WHERE user_id = $1 AND is_active = true',
    [userId]
  );
  return result.rows[0] || null;
};

// ============================================================================
// JIRA CLIENT
// ============================================================================
class JiraClient {
  constructor(jiraUrl, email, encryptedToken) {
    this.jiraUrl = jiraUrl.replace(/\/$/, '');
    this.email = email;
    this.apiToken = decrypt(encryptedToken);
    this.authHeader = `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`;
    this.client = axios.create({
      baseURL: `${this.jiraUrl}/rest/api/3`,
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
      timeout: 30000,
    });
  }

  async testConnection() {
    try {
      const res = await this.client.get('/myself');
      return { success: true, user: res.data };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async getProjects() {
    const res = await this.client.get('/project/search', { params: { maxResults: 1000 } });
    return res.data.values || [];
  }

  async getBoards() {
    const res = await axios.get(`${this.jiraUrl}/rest/agile/1.0/board`, {
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
      params: { maxResults: 1000 },
    });
    return res.data.values || [];
  }

  async getSprints(boardId) {
    try {
      const res = await axios.get(`${this.jiraUrl}/rest/agile/1.0/board/${boardId}/sprint`, {
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
        params: { maxResults: 1000 },
      });
      return res.data.values || [];
    } catch (e) { return []; }
  }

  async getSprintIssues(sprintId) {
    try {
      const res = await axios.get(`${this.jiraUrl}/rest/agile/1.0/sprint/${sprintId}/issue`, {
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
        params: {
          maxResults: 1000,
          fields: 'summary,status,issuetype,priority,assignee,story_points,customfield_10016,customfield_10014,epic',
        },
      });
      return res.data.issues || [];
    } catch (e) { return []; }
  }

  async getProjectIssues(projectKey) {
    try {
      const res = await this.client.get('/search', {
        params: {
          jql: `project = ${projectKey} AND issuetype != Epic ORDER BY created DESC`,
          maxResults: 1000,
          fields: 'summary,status,issuetype,priority,assignee,customfield_10016,customfield_10014,epic,sprint',
        },
      });
      return res.data.issues || [];
    } catch (e) { return []; }
  }

  async getEpics(projectKey) {
    try {
      const res = await this.client.get('/search', {
        params: {
          jql: `project = ${projectKey} AND issuetype = Epic ORDER BY created DESC`,
          maxResults: 1000,
          fields: 'summary,status,created,updated,customfield_10016',
        },
      });
      return res.data.issues || [];
    } catch (e) { return []; }
  }

  async getEpicIssues(epicKey) {
    try {
      const res = await this.client.get('/search', {
        params: {
          jql: `"Epic Link" = ${epicKey} OR parent = ${epicKey}`,
          maxResults: 1000,
          fields: 'summary,status,issuetype,assignee,customfield_10016,sprint',
        },
      });
      return res.data.issues || [];
    } catch (e) { return []; }
  }

  async getRisks() {
    try {
      const res = await this.client.get('/search', {
        params: {
          jql: `(labels IN (risk, risk-high, risk-medium, risk-low, RISK) OR issuetype = Risk OR summary ~ "RISK*" OR priority = Highest) AND resolution = Unresolved ORDER BY priority DESC`,
          maxResults: 100,
          fields: 'summary,description,priority,labels,status,created,project',
        },
      });
      return res.data.issues || [];
    } catch (e) { return []; }
  }

  async getBlockers() {
    try {
      const res = await this.client.get('/search', {
        params: {
          jql: `(status = Blocked OR labels IN (blocked, blocker, impediment, BLOCKED) OR flagged IS NOT EMPTY) AND resolution = Unresolved ORDER BY created DESC`,
          maxResults: 100,
          fields: 'summary,description,status,assignee,created,project,issuelinks,epic',
        },
      });
      return res.data.issues || [];
    } catch (e) { return []; }
  }

  async getEpicLinks(projectKey) {
    try {
      const res = await this.client.get('/search', {
        params: {
          jql: `project = ${projectKey} AND issuetype = Epic AND issuelinks is not EMPTY`,
          maxResults: 500,
          fields: 'summary,issuelinks,issuetype',
        },
      });
      return res.data.issues || [];
    } catch (e) { return []; }
  }
}

// ============================================================================
// SYNC ORCHESTRATOR
// ============================================================================
async function syncJiraData(connection) {
  const { id: connectionId } = connection;
  const jira = new JiraClient(connection.jira_url, connection.jira_email, connection.jira_api_token);

  const stats = { projects: 0, teams: 0, epics: 0, sprints: 0, issues: 0, risks: 0, blockers: 0, dependencies: 0 };

  // ------------------------------------------------------------------
  // 1. PROJECTS
  // ------------------------------------------------------------------
  console.log('📁 Syncing projects...');
  const projects = await jira.getProjects();
  for (const p of projects) {
    await pool.query(
      `INSERT INTO projects (jira_connection_id, jira_project_id, jira_project_key, name, description)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (jira_connection_id, jira_project_id)
       DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, updated_at=NOW()`,
      [connectionId, p.id, p.key, p.name, p.description || '']
    );
    stats.projects++;
  }

  // ------------------------------------------------------------------
  // 2. EPICS (per project)
  // ------------------------------------------------------------------
  console.log('🎯 Syncing epics...');
  for (const p of projects) {
    const projectRow = await pool.query(
      'SELECT id FROM projects WHERE jira_project_id=$1 AND jira_connection_id=$2',
      [p.id, connectionId]
    );
    if (!projectRow.rows.length) continue;
    const projectDbId = projectRow.rows[0].id;

    const epics = await jira.getEpics(p.key);
    for (const e of epics) {
      await pool.query(
        `INSERT INTO epics (jira_connection_id, project_id, jira_epic_id, jira_epic_key, name, status)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (jira_connection_id, jira_epic_id)
         DO UPDATE SET name=EXCLUDED.name, status=EXCLUDED.status, updated_at=NOW()`,
        [connectionId, projectDbId, e.id, e.key, e.fields.summary, e.fields.status.name]
      );
      stats.epics++;
    }
  }

  // ------------------------------------------------------------------
  // 3. TEAMS (boards) + SPRINTS
  // ------------------------------------------------------------------
  console.log('👥 Syncing teams and sprints...');
  const boards = await jira.getBoards();
  for (const b of boards) {
    await pool.query(
      `INSERT INTO teams (jira_connection_id, jira_team_id, name)
       VALUES ($1,$2,$3)
       ON CONFLICT (jira_connection_id, jira_team_id)
       DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()`,
      [connectionId, b.id.toString(), b.name]
    );
    stats.teams++;

    const teamRow = await pool.query(
      'SELECT id FROM teams WHERE jira_team_id=$1 AND jira_connection_id=$2',
      [b.id.toString(), connectionId]
    );
    if (!teamRow.rows.length) continue;
    const teamDbId = teamRow.rows[0].id;

    const sprints = await jira.getSprints(b.id);
    for (const s of sprints) {
      await pool.query(
        `INSERT INTO sprints (jira_connection_id, team_id, jira_sprint_id, name, state, start_date, end_date, goal)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (jira_connection_id, jira_sprint_id)
         DO UPDATE SET name=EXCLUDED.name, state=EXCLUDED.state, updated_at=NOW()`,
        [connectionId, teamDbId, s.id.toString(), s.name, s.state,
         s.startDate || null, s.endDate || null, s.goal || '']
      );
      stats.sprints++;

      // ------------------------------------------------------------------
      // 4. ISSUES (per sprint)
      // ------------------------------------------------------------------
      const sprintRow = await pool.query(
        'SELECT id FROM sprints WHERE jira_sprint_id=$1 AND jira_connection_id=$2',
        [s.id.toString(), connectionId]
      );
      if (!sprintRow.rows.length) continue;
      const sprintDbId = sprintRow.rows[0].id;

      const sprintIssues = await jira.getSprintIssues(s.id);
      for (const issue of sprintIssues) {
        // Story points: try customfield_10016 (most common) or customfield_10028
        const storyPoints = issue.fields.customfield_10016 || issue.fields.customfield_10028 || issue.fields.story_points || 0;

        // Resolve project
        const issueProjectKey = issue.key.split('-')[0];
        const pRow = await pool.query(
          'SELECT id FROM projects WHERE jira_project_key=$1 AND jira_connection_id=$2',
          [issueProjectKey, connectionId]
        );
        const projectDbId = pRow.rows[0]?.id || null;

        // Resolve epic
        let epicDbId = null;
        const epicKey = issue.fields.customfield_10014 || issue.fields.epic?.key || null;
        if (epicKey) {
          const eRow = await pool.query(
            'SELECT id FROM epics WHERE jira_epic_key=$1 AND jira_connection_id=$2',
            [epicKey, connectionId]
          );
          epicDbId = eRow.rows[0]?.id || null;
        }

        await pool.query(
          `INSERT INTO issues (jira_connection_id, project_id, epic_id, sprint_id,
             jira_issue_id, jira_issue_key, summary, issue_type, status, priority,
             story_points, assignee_name, assignee_account_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (jira_connection_id, jira_issue_id)
           DO UPDATE SET status=EXCLUDED.status, sprint_id=EXCLUDED.sprint_id,
             story_points=EXCLUDED.story_points, updated_at=NOW()`,
          [connectionId, projectDbId, epicDbId, sprintDbId,
           issue.id, issue.key, issue.fields.summary,
           issue.fields.issuetype.name, issue.fields.status.name,
           issue.fields.priority?.name || null,
           storyPoints,
           issue.fields.assignee?.displayName || null,
           issue.fields.assignee?.accountId || null]
        );
        stats.issues++;
      }
    }
  }

  // ------------------------------------------------------------------
  // 5. POPULATE JUNCTION TABLE: team_projects
  //    Infer from issues: if a team's sprint contains issues from project X → link them
  // ------------------------------------------------------------------
  console.log('🔗 Building team ↔ project relationships...');
  const teamProjectLinks = await pool.query(`
    SELECT DISTINCT
      s.team_id,
      i.project_id,
      COUNT(i.id)              AS issue_count,
      SUM(i.story_points)      AS total_points
    FROM issues i
    JOIN sprints s ON i.sprint_id = s.id
    WHERE i.jira_connection_id = $1
      AND i.project_id IS NOT NULL
    GROUP BY s.team_id, i.project_id
  `, [connectionId]);

  for (const row of teamProjectLinks.rows) {
    // Determine if this is the primary team (highest issue count for this project)
    const primaryCheck = await pool.query(`
      SELECT team_id FROM (
        SELECT s.team_id, COUNT(i.id) AS cnt
        FROM issues i
        JOIN sprints s ON i.sprint_id = s.id
        WHERE i.jira_connection_id = $1 AND i.project_id = $2
        GROUP BY s.team_id
        ORDER BY cnt DESC LIMIT 1
      ) sub
    `, [connectionId, row.project_id]);
    const isPrimary = primaryCheck.rows[0]?.team_id === row.team_id;

    await pool.query(
      `INSERT INTO team_projects (team_id, project_id, is_primary, auto_assigned)
       VALUES ($1,$2,$3,true)
       ON CONFLICT (team_id, project_id)
       DO UPDATE SET is_primary=$3, auto_assigned=true, updated_at=NOW()`,
      [row.team_id, row.project_id, isPrimary]
    );
  }

  // ------------------------------------------------------------------
  // 6. POPULATE JUNCTION TABLE: epic_teams
  //    Infer from issues: if a team worked on issues in epic X → link them
  // ------------------------------------------------------------------
  console.log('🔗 Building team ↔ epic relationships...');
  const epicTeamLinks = await pool.query(`
    SELECT
      i.epic_id,
      s.team_id,
      COUNT(i.id)                                              AS issue_count,
      COALESCE(SUM(i.story_points), 0)                        AS total_points,
      COALESCE(SUM(CASE WHEN i.status IN ('Done','Closed','Resolved') THEN i.story_points ELSE 0 END), 0) AS completed_points
    FROM issues i
    JOIN sprints s ON i.sprint_id = s.id
    WHERE i.jira_connection_id = $1
      AND i.epic_id IS NOT NULL
    GROUP BY i.epic_id, s.team_id
  `, [connectionId]);

  for (const row of epicTeamLinks.rows) {
    // Owner = team with most story points in this epic
    const ownerCheck = await pool.query(`
      SELECT s.team_id FROM issues i
      JOIN sprints s ON i.sprint_id = s.id
      WHERE i.jira_connection_id = $1 AND i.epic_id = $2
      GROUP BY s.team_id
      ORDER BY SUM(i.story_points) DESC LIMIT 1
    `, [connectionId, row.epic_id]);
    const isOwner = ownerCheck.rows[0]?.team_id === row.team_id;

    // Total points for this epic across all teams
    const epicTotal = await pool.query(
      'SELECT COALESCE(SUM(story_points),0) AS total FROM issues WHERE epic_id=$1 AND jira_connection_id=$2',
      [row.epic_id, connectionId]
    );
    const totalPts = parseInt(epicTotal.rows[0]?.total || 1);
    const contribution = Math.round((parseInt(row.total_points) / totalPts) * 100);

    await pool.query(
      `INSERT INTO epic_teams (epic_id, team_id, is_owner, contribution_percentage, story_points_allocated, story_points_completed, auto_assigned)
       VALUES ($1,$2,$3,$4,$5,$6,true)
       ON CONFLICT (epic_id, team_id)
       DO UPDATE SET is_owner=$3, contribution_percentage=$4,
         story_points_allocated=$5, story_points_completed=$6, auto_assigned=true, updated_at=NOW()`,
      [row.epic_id, row.team_id, isOwner, contribution, row.total_points, row.completed_points]
    );
  }

  // ------------------------------------------------------------------
  // 7. UPDATE EPIC PROGRESS from issues
  // ------------------------------------------------------------------
  console.log('📊 Calculating epic progress...');
  await pool.query(`
    UPDATE epics e SET
      total_story_points = sub.total_pts,
      completed_story_points = sub.done_pts,
      progress = CASE WHEN sub.total_pts > 0 THEN ROUND((sub.done_pts::numeric / sub.total_pts) * 100) ELSE 0 END,
      updated_at = NOW()
    FROM (
      SELECT
        epic_id,
        COALESCE(SUM(story_points), 0) AS total_pts,
        COALESCE(SUM(CASE WHEN status IN ('Done','Closed','Resolved') THEN story_points ELSE 0 END), 0) AS done_pts
      FROM issues
      WHERE jira_connection_id = $1 AND epic_id IS NOT NULL
      GROUP BY epic_id
    ) sub
    WHERE e.id = sub.epic_id AND e.jira_connection_id = $1
  `, [connectionId]);

  // ------------------------------------------------------------------
  // 8. UPDATE TEAM VELOCITY & LOAD from sprints + issues
  // ------------------------------------------------------------------
  console.log('📈 Calculating team metrics...');
  const teamIds = await pool.query('SELECT id FROM teams WHERE jira_connection_id=$1', [connectionId]);
  for (const { id: teamId } of teamIds.rows) {
    // Velocity = avg completed points over last 6 closed sprints
    const velResult = await pool.query(`
      SELECT COALESCE(AVG(sub.completed), 0) AS avg_velocity
      FROM (
        SELECT s.id,
          COALESCE(SUM(CASE WHEN i.status IN ('Done','Closed','Resolved') THEN i.story_points ELSE 0 END), 0) AS completed
        FROM sprints s
        LEFT JOIN issues i ON i.sprint_id = s.id
        WHERE s.team_id = $1 AND s.state = 'closed'
        GROUP BY s.id
        ORDER BY s.end_date DESC LIMIT 6
      ) sub
    `, [teamId]);

    // Capacity = sum of story points in active sprint
    const capResult = await pool.query(`
      SELECT COALESCE(SUM(i.story_points), 0) AS load_pts
      FROM sprints s
      JOIN issues i ON i.sprint_id = s.id
      WHERE s.team_id = $1 AND s.state = 'active'
    `, [teamId]);

    const velocity = Math.round(parseFloat(velResult.rows[0]?.avg_velocity || 0));
    const loadPts = parseInt(capResult.rows[0]?.load_pts || 0);
    const load = velocity > 0 ? Math.min(Math.round((loadPts / velocity) * 100), 200) : 0;

    // Predictability = % of sprints where completed >= 80% of committed (last 6 sprints)
    const predResult = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE completed_points >= committed_points * 0.8) AS on_target
      FROM velocity_history
      WHERE team_id = $1
      ORDER BY sprint_start_date DESC LIMIT 6
    `, [teamId]);
    const { total, on_target } = predResult.rows[0];
    const predictability = total > 0 ? Math.round((on_target / total) * 100) : 0;

    await pool.query(
      `UPDATE teams SET velocity=$1, current_load=$2, capacity=$3, predictability_score=$4, updated_at=NOW() WHERE id=$5`,
      [velocity, load, velocity, predictability, teamId]
    );

    // Upsert velocity_history for active sprint
    const activeSprint = await pool.query(
      'SELECT id, start_date, end_date FROM sprints WHERE team_id=$1 AND state=$2 LIMIT 1',
      [teamId, 'active']
    );
    if (activeSprint.rows.length) {
      const sp = activeSprint.rows[0];
      await pool.query(
        `INSERT INTO velocity_history (team_id, sprint_id, committed_points, completed_points, velocity, sprint_start_date, sprint_end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (team_id, sprint_id) DO UPDATE
         SET committed_points=$3, completed_points=$4, velocity=$5`,
        [teamId, sp.id, loadPts, 0, velocity, sp.start_date, sp.end_date]
      );
    }
  }

  // ------------------------------------------------------------------
  // 9. RISKS
  // ------------------------------------------------------------------
  console.log('⚠️  Syncing risks...');
  const risks = await jira.getRisks();
  for (const r of risks) {
    const pRow = await pool.query(
      'SELECT id FROM projects WHERE jira_project_key=$1 AND jira_connection_id=$2',
      [r.fields.project.key, connectionId]
    );
    const projectDbId = pRow.rows[0]?.id || null;

    const labels = r.fields.labels || [];
    const priority = r.fields.priority?.name?.toLowerCase() || '';
    let severity = 'medium';
    if (['highest', 'critical'].includes(priority) || labels.includes('risk-high')) severity = 'high';
    else if (labels.includes('risk-low')) severity = 'low';

    await pool.query(
      `INSERT INTO risks (jira_connection_id, project_id, jira_issue_key, title, description, severity, status, auto_detected)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true)
       ON CONFLICT DO NOTHING`,
      [connectionId, projectDbId, r.key, r.fields.summary, r.fields.description || '',
       severity, r.fields.status.name.toLowerCase().includes('done') ? 'closed' : 'open']
    );
    stats.risks++;
  }

  // ------------------------------------------------------------------
  // 10. BLOCKERS
  // ------------------------------------------------------------------
  console.log('🚫 Syncing blockers...');
  const blockers = await jira.getBlockers();
  for (const b of blockers) {
    const pRow = await pool.query(
      'SELECT id FROM projects WHERE jira_project_key=$1 AND jira_connection_id=$2',
      [b.fields.project.key, connectionId]
    );
    const projectDbId = pRow.rows[0]?.id || null;

    // Try to find the issue and its team via sprint
    const issueRow = await pool.query(
      'SELECT id, sprint_id, epic_id FROM issues WHERE jira_issue_key=$1 AND jira_connection_id=$2',
      [b.key, connectionId]
    );
    const issueDbId = issueRow.rows[0]?.id || null;
    const epicDbId  = issueRow.rows[0]?.epic_id || null;

    let teamDbId = null;
    if (issueRow.rows[0]?.sprint_id) {
      const spRow = await pool.query('SELECT team_id FROM sprints WHERE id=$1', [issueRow.rows[0].sprint_id]);
      teamDbId = spRow.rows[0]?.team_id || null;
    }

    await pool.query(
      `INSERT INTO blockers (jira_connection_id, issue_id, team_id, epic_id, project_id,
         jira_issue_key, title, description, status, blocked_since, auto_detected)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
       ON CONFLICT DO NOTHING`,
      [connectionId, issueDbId, teamDbId, epicDbId, projectDbId, b.key,
       b.fields.summary, b.fields.description || '',
       b.fields.status.name.toLowerCase().includes('done') ? 'resolved' : 'active',
       b.fields.created ? new Date(b.fields.created) : new Date()]
    );
    stats.blockers++;
  }

  // ------------------------------------------------------------------
  // 11. DEPENDENCIES (epic-to-epic links)
  // ------------------------------------------------------------------
  console.log('🔗 Syncing dependencies...');
  for (const p of projects) {
    const epicsWithLinks = await jira.getEpicLinks(p.key);
    for (const epic of epicsWithLinks) {
      const sourceRow = await pool.query(
        'SELECT id FROM epics WHERE jira_epic_key=$1 AND jira_connection_id=$2',
        [epic.key, connectionId]
      );
      if (!sourceRow.rows.length) continue;
      const sourceId = sourceRow.rows[0].id;

      for (const link of (epic.fields.issuelinks || [])) {
        const linked = link.outwardIssue || link.inwardIssue;
        if (!linked) continue;

        const targetRow = await pool.query(
          'SELECT id FROM epics WHERE jira_epic_key=$1 AND jira_connection_id=$2',
          [linked.key, connectionId]
        );
        if (!targetRow.rows.length) continue;
        const targetId = targetRow.rows[0].id;

        const typeName = link.type?.name?.toLowerCase() || '';
        let depType = 'relates-to';
        if (typeName.includes('block')) depType = 'blocks';
        else if (typeName.includes('depend')) depType = 'depends-on';
        else if (typeName.includes('require')) depType = 'requires';

        await pool.query(
          `INSERT INTO dependencies (jira_connection_id, source_epic_id, target_epic_id, dependency_type, status, description)
           VALUES ($1,$2,$3,$4,'active',$5)
           ON CONFLICT (source_epic_id, target_epic_id, dependency_type) DO NOTHING`,
          [connectionId, sourceId, targetId, depType, link.type?.name || '']
        );
        stats.dependencies++;
      }
    }
  }

  console.log('✅ Sync complete:', stats);
  return stats;
}

// ============================================================================
// AUTH ROUTES
// ============================================================================
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'All fields required' });
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) return res.status(400).json({ error: 'User already exists' });
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1,$2,$3) RETURNING id,email,name',
      [email, hash, name]
    );
    res.status(201).json({ message: 'Registered', token: generateToken(result.rows[0].id, email), user: result.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await pool.query('SELECT id,email,name,password_hash,role FROM users WHERE email=$1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ message: 'Login successful', token: generateToken(user.id, user.email), user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id,email,name,role,created_at FROM users WHERE id=$1', [req.user.userId]);
    res.json({ user: result.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ============================================================================
// JIRA CONNECTION ROUTES
// ============================================================================
app.post('/api/jira/connect', authenticateToken, async (req, res) => {
  const { jiraUrl, jiraEmail, jiraApiToken } = req.body;
  if (!jiraUrl || !jiraEmail || !jiraApiToken) return res.status(400).json({ error: 'All fields required' });
  try {
    const encToken = encrypt(jiraApiToken);
    const jira = new JiraClient(jiraUrl, jiraEmail, encToken);
    const test = await jira.testConnection();
    if (!test.success) return res.status(400).json({ error: 'Jira connection failed', details: test.error });

    const result = await pool.query(
      `INSERT INTO jira_connections (user_id, jira_url, jira_email, jira_api_token, is_active)
       VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (user_id) DO UPDATE
       SET jira_url=$2, jira_email=$3, jira_api_token=$4, is_active=true, updated_at=NOW()
       RETURNING id, jira_url, jira_email`,
      [req.user.userId, jiraUrl, jiraEmail, encToken]
    );
    res.json({ message: 'Connected to Jira', connection: result.rows[0], jiraUser: test.user });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/jira/status', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id,jira_url,jira_email,is_active,last_sync FROM jira_connections WHERE user_id=$1',
      [req.user.userId]
    );
    if (!result.rows.length) return res.json({ connected: false });
    res.json({ connected: true, connection: result.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/jira/sync', authenticateToken, async (req, res) => {
  try {
    const conn = await getConnection(req.user.userId);
    if (!conn) return res.status(404).json({ error: 'No active Jira connection' });

    const stats = await syncJiraData(conn);
    await pool.query('UPDATE jira_connections SET last_sync=NOW() WHERE id=$1', [conn.id]);
    res.json({ message: 'Sync completed', stats });
  } catch (e) {
    console.error('Sync failed:', e);
    res.status(500).json({ error: 'Sync failed', details: e.message });
  }
});

app.post('/api/jira/disconnect', authenticateToken, async (req, res) => {
  await pool.query('UPDATE jira_connections SET is_active=false WHERE user_id=$1', [req.user.userId]);
  res.json({ message: 'Disconnected' });
});

// ============================================================================
// DASHBOARD ROUTES
// ============================================================================

// -- Portfolio Overview
app.get('/api/dashboard/overview', authenticateToken, async (req, res) => {
  try {
    const conn = await getConnection(req.user.userId);
    if (!conn) return res.status(404).json({ error: 'No active connection' });
    const cid = conn.id;

    const [projects, teams, epics, issues, velocity] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total, health FROM projects WHERE jira_connection_id=$1 GROUP BY health', [cid]),
      pool.query('SELECT COUNT(*) AS total FROM teams WHERE jira_connection_id=$1', [cid]),
      pool.query('SELECT COUNT(*) AS total, status FROM epics WHERE jira_connection_id=$1 GROUP BY status', [cid]),
      pool.query('SELECT COUNT(*) AS total FROM issues WHERE jira_connection_id=$1', [cid]),
      pool.query('SELECT COALESCE(AVG(velocity),0) AS avg FROM teams WHERE jira_connection_id=$1', [cid]),
    ]);

    res.json({
      projects: { total: projects.rows.reduce((s, r) => s + parseInt(r.total), 0), byHealth: projects.rows },
      teams:    { total: parseInt(teams.rows[0]?.total || 0) },
      epics:    { total: epics.rows.reduce((s, r) => s + parseInt(r.total), 0), byStatus: epics.rows },
      issues:   { total: parseInt(issues.rows[0]?.total || 0) },
      avgVelocity: parseFloat(velocity.rows[0]?.avg || 0).toFixed(1),
    });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// -- Teams with their projects and epics (uses junction tables)
app.get('/api/dashboard/teams', authenticateToken, async (req, res) => {
  try {
    const conn = await getConnection(req.user.userId);
    if (!conn) return res.status(404).json({ error: 'No active connection' });

    const teams = await pool.query('SELECT * FROM v_team_overview WHERE jira_connection_id=$1 ORDER BY team_name', [conn.id]);

    // For each team, get their linked projects and epics
    const enriched = await Promise.all(teams.rows.map(async (team) => {
      const [linkedProjects, ownedEpics] = await Promise.all([
        pool.query(`
          SELECT p.id, p.name, p.jira_project_key, p.health,
                 tp.is_primary, tp.role, tp.allocation_percentage, tp.auto_assigned
          FROM team_projects tp
          JOIN projects p ON tp.project_id = p.id
          WHERE tp.team_id = $1 ORDER BY tp.is_primary DESC, p.name
        `, [team.team_id]),
        pool.query(`
          SELECT e.id, e.name, e.jira_epic_key, e.status, e.progress,
                 et.is_owner, et.contribution_percentage, et.story_points_allocated,
                 p.name AS project_name
          FROM epic_teams et
          JOIN epics e ON et.epic_id = e.id
          JOIN projects p ON e.project_id = p.id
          WHERE et.team_id = $1 ORDER BY et.is_owner DESC, e.name
        `, [team.team_id]),
      ]);

      return { ...team, projects: linkedProjects.rows, epics: ownedEpics.rows };
    }));

    res.json({ teams: enriched });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// -- Projects with their teams and epics (uses junction tables)
app.get('/api/dashboard/projects', authenticateToken, async (req, res) => {
  try {
    const conn = await getConnection(req.user.userId);
    if (!conn) return res.status(404).json({ error: 'No active connection' });

    const projects = await pool.query('SELECT * FROM v_project_overview WHERE jira_connection_id=$1 ORDER BY project_name', [conn.id]);

    const enriched = await Promise.all(projects.rows.map(async (project) => {
      const [linkedTeams, epics] = await Promise.all([
        pool.query(`
          SELECT t.id, t.name, t.velocity, t.current_load,
                 tp.is_primary, tp.role, tp.allocation_percentage, tp.auto_assigned
          FROM team_projects tp
          JOIN teams t ON tp.team_id = t.id
          WHERE tp.project_id = $1 ORDER BY tp.is_primary DESC, t.name
        `, [project.project_id]),
        pool.query(`
          SELECT e.id, e.name, e.jira_epic_key, e.status, e.progress,
                 e.total_story_points, e.completed_story_points, e.due_date,
                 t.name AS owner_team
          FROM epics e
          LEFT JOIN epic_teams et ON et.epic_id = e.id AND et.is_owner = true
          LEFT JOIN teams t ON et.team_id = t.id
          WHERE e.project_id = $1 ORDER BY e.status, e.name
        `, [project.project_id]),
      ]);
      return { ...project, teams: linkedTeams.rows, epics: epics.rows };
    }));

    res.json({ projects: enriched });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// -- Epics with team ownership and contributors
app.get('/api/dashboard/epics', authenticateToken, async (req, res) => {
  try {
    const conn = await getConnection(req.user.userId);
    if (!conn) return res.status(404).json({ error: 'No active connection' });

    const epics = await pool.query('SELECT * FROM v_epic_overview WHERE jira_connection_id=$1 ORDER BY project_name, epic_name', [conn.id]);

    const enriched = await Promise.all(epics.rows.map(async (epic) => {
      const contributors = await pool.query(`
        SELECT t.id, t.name, et.is_owner, et.contribution_percentage,
               et.story_points_allocated, et.story_points_completed
        FROM epic_teams et
        JOIN teams t ON et.team_id = t.id
        WHERE et.epic_id = $1 ORDER BY et.is_owner DESC, et.contribution_percentage DESC
      `, [epic.epic_id]);
      return { ...epic, contributing_teams: contributors.rows };
    }));

    res.json({ epics: enriched });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// -- Manual override: assign a team to a project
app.post('/api/dashboard/team-projects', authenticateToken, async (req, res) => {
  const { teamId, projectId, isPrimary, allocationPercentage, role } = req.body;
  try {
    await pool.query(
      `INSERT INTO team_projects (team_id, project_id, is_primary, allocation_percentage, role, auto_assigned)
       VALUES ($1,$2,$3,$4,$5,false)
       ON CONFLICT (team_id, project_id)
       DO UPDATE SET is_primary=$3, allocation_percentage=$4, role=$5, auto_assigned=false, updated_at=NOW()`,
      [teamId, projectId, isPrimary || false, allocationPercentage || 100, role || 'Development']
    );
    res.json({ message: 'Team-project assignment saved' });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// -- Manual override: assign a team to an epic
app.post('/api/dashboard/epic-teams', authenticateToken, async (req, res) => {
  const { epicId, teamId, isOwner, contributionPercentage } = req.body;
  try {
    await pool.query(
      `INSERT INTO epic_teams (epic_id, team_id, is_owner, contribution_percentage, auto_assigned)
       VALUES ($1,$2,$3,$4,false)
       ON CONFLICT (epic_id, team_id)
       DO UPDATE SET is_owner=$3, contribution_percentage=$4, auto_assigned=false, updated_at=NOW()`,
      [epicId, teamId, isOwner || false, contributionPercentage || 0]
    );
    res.json({ message: 'Epic-team assignment saved' });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// -- Dependencies
app.get('/api/dashboard/dependencies', authenticateToken, async (req, res) => {
  try {
    const conn = await getConnection(req.user.userId);
    if (!conn) return res.status(404).json({ error: 'No active connection' });

    const result = await pool.query(`
      SELECT d.id, d.dependency_type, d.status, d.description,
             e1.name AS source_epic, e1.jira_epic_key AS source_key, e1.status AS source_status,
             e2.name AS target_epic, e2.jira_epic_key AS target_key, e2.status AS target_status,
             p1.name AS source_project, p2.name AS target_project,
             t1.name AS source_team, t2.name AS target_team
      FROM dependencies d
      JOIN epics e1 ON d.source_epic_id = e1.id
      JOIN epics e2 ON d.target_epic_id = e2.id
      JOIN projects p1 ON e1.project_id = p1.id
      JOIN projects p2 ON e2.project_id = p2.id
      LEFT JOIN epic_teams et1 ON et1.epic_id = e1.id AND et1.is_owner = true
      LEFT JOIN teams t1 ON et1.team_id = t1.id
      LEFT JOIN epic_teams et2 ON et2.epic_id = e2.id AND et2.is_owner = true
      LEFT JOIN teams t2 ON et2.team_id = t2.id
      WHERE d.jira_connection_id = $1 AND d.status = 'active'
      ORDER BY d.dependency_type
    `, [conn.id]);

    res.json({ dependencies: result.rows });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// -- Risks
app.get('/api/dashboard/risks', authenticateToken, async (req, res) => {
  try {
    const conn = await getConnection(req.user.userId);
    if (!conn) return res.status(404).json({ error: 'No active connection' });

    const result = await pool.query(`
      SELECT r.*, p.name AS project_name, p.jira_project_key
      FROM risks r
      LEFT JOIN projects p ON r.project_id = p.id
      WHERE r.jira_connection_id = $1 AND r.status = 'open'
      ORDER BY CASE r.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
    `, [conn.id]);

    res.json({ risks: result.rows });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// -- Blockers (now linked to teams AND epics AND projects)
app.get('/api/dashboard/blockers', authenticateToken, async (req, res) => {
  try {
    const conn = await getConnection(req.user.userId);
    if (!conn) return res.status(404).json({ error: 'No active connection' });

    const result = await pool.query(`
      SELECT b.*, 
             t.name AS team_name,
             e.name AS epic_name, e.jira_epic_key,
             p.name AS project_name
      FROM blockers b
      LEFT JOIN teams t    ON b.team_id    = t.id
      LEFT JOIN epics e    ON b.epic_id    = e.id
      LEFT JOIN projects p ON b.project_id = p.id
      WHERE b.jira_connection_id = $1 AND b.status = 'active'
      ORDER BY b.blocked_since DESC
    `, [conn.id]);

    res.json({ blockers: result.rows });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// -- Predictability
app.get('/api/dashboard/predictability', authenticateToken, async (req, res) => {
  try {
    const conn = await getConnection(req.user.userId);
    if (!conn) return res.status(404).json({ error: 'No active connection' });

    const result = await pool.query(`
      SELECT t.id, t.name, t.predictability_score, t.velocity, t.capacity,
             COUNT(vh.id) AS sprint_count,
             COALESCE(AVG(vh.velocity), 0) AS avg_velocity,
             COALESCE(STDDEV(vh.velocity), 0) AS velocity_stddev
      FROM teams t
      LEFT JOIN velocity_history vh ON vh.team_id = t.id
      WHERE t.jira_connection_id = $1
      GROUP BY t.id ORDER BY t.predictability_score DESC
    `, [conn.id]);

    res.json({ predictability: result.rows });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// -- Velocity History
app.get('/api/dashboard/velocity-history', authenticateToken, async (req, res) => {
  try {
    const conn = await getConnection(req.user.userId);
    if (!conn) return res.status(404).json({ error: 'No active connection' });

    const result = await pool.query(`
      SELECT t.id AS team_id, t.name AS team_name,
             vh.sprint_start_date, vh.committed_points, vh.completed_points, vh.velocity,
             s.name AS sprint_name
      FROM velocity_history vh
      JOIN teams t ON vh.team_id = t.id
      JOIN sprints s ON vh.sprint_id = s.id
      WHERE t.jira_connection_id = $1
      ORDER BY t.name, vh.sprint_start_date DESC
    `, [conn.id]);

    // Group by team
    const grouped = result.rows.reduce((acc, row) => {
      if (!acc[row.team_id]) acc[row.team_id] = { teamId: row.team_id, teamName: row.team_name, history: [] };
      acc[row.team_id].history.push(row);
      return acc;
    }, {});

    res.json({ velocityHistory: Object.values(grouped) });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// -- Timeline
app.get('/api/dashboard/timeline', authenticateToken, async (req, res) => {
  try {
    const conn = await getConnection(req.user.userId);
    if (!conn) return res.status(404).json({ error: 'No active connection' });

    const result = await pool.query(`
      SELECT te.*, p.name AS project_name, e.name AS epic_name, t.name AS team_name
      FROM timeline_events te
      LEFT JOIN projects p ON te.project_id = p.id
      LEFT JOIN epics e    ON te.epic_id    = e.id
      LEFT JOIN teams t    ON te.team_id    = t.id
      WHERE te.jira_connection_id = $1
      ORDER BY te.event_date ASC
    `, [conn.id]);

    res.json({ timeline: result.rows });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ============================================================================
// ROOT + ERROR HANDLING
// ============================================================================
app.get('/health', (req, res) => res.json({ status: 'healthy', timestamp: new Date() }));

app.get('/', (req, res) => res.json({
  message: 'Portavio API v2',
  tagline: 'Portfolio Intelligence for Engineering Teams',
  endpoints: {
    auth: ['POST /api/auth/register', 'POST /api/auth/login', 'GET /api/auth/profile'],
    jira: ['POST /api/jira/connect', 'GET /api/jira/status', 'POST /api/jira/sync', 'POST /api/jira/disconnect'],
    dashboard: [
      'GET /api/dashboard/overview',
      'GET /api/dashboard/projects',   // Projects + their teams + their epics
      'GET /api/dashboard/teams',      // Teams + their projects + their epics
      'GET /api/dashboard/epics',      // Epics + owner + contributing teams
      'GET /api/dashboard/dependencies',
      'GET /api/dashboard/risks',
      'GET /api/dashboard/blockers',   // Blockers linked to team + epic + project
      'GET /api/dashboard/predictability',
      'GET /api/dashboard/velocity-history',
      'GET /api/dashboard/timeline',
    ],
    assignments: [
      'POST /api/dashboard/team-projects',  // Manual team → project assignment
      'POST /api/dashboard/epic-teams',     // Manual team → epic assignment
    ],
  },
}));

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => res.status(500).json({ error: err.message || 'Server error' }));

// ============================================================================
// START
// ============================================================================
const startServer = async () => {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected');
	// ============================================================================
// ADMIN ROUTES
// ============================================================================

// Middleware: Require admin role
const requireAdmin = async (req, res, next) => {
  try {
    const user = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.userId]);
    if (!user.rows.length || user.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authorization check failed' });
  }
};

// Admin: Dashboard stats
app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM organizations WHERE subscription_status IN ('active', 'trialing')) as active_subscriptions,
        (SELECT 
          SUM(CASE 
            WHEN plan = 'starter' THEN 49
            WHEN plan = 'pro' THEN 149
            WHEN plan = 'enterprise' THEN 499
            ELSE 0
          END)
          FROM organizations 
          WHERE subscription_status = 'active'
        ) as mrr,
        (SELECT 
          ROUND((COUNT(*) FILTER (WHERE plan != 'trial')::decimal / NULLIF(COUNT(*), 0)) * 100, 1)
          FROM organizations
        ) as conversion_rate
    `);
    res.json({
      totalUsers: parseInt(stats.rows[0].total_users),
      activeSubscriptions: parseInt(stats.rows[0].active_subscriptions),
      mrr: parseInt(stats.rows[0].mrr || 0),
      conversionRate: parseFloat(stats.rows[0].conversion_rate || 0),
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Admin: Recent signups
app.get('/api/admin/recent-signups', authenticateToken, requireAdmin, async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  try {
    const signups = await pool.query(`
      SELECT 
        u.id, u.name as user_name, u.email as user_email,
        o.name as org_name, o.plan, u.created_at
      FROM users u
      JOIN organization_members om ON om.user_id = u.id
      JOIN organizations o ON o.id = om.organization_id
      ORDER BY u.created_at DESC
      LIMIT $1
    `, [limit]);
    res.json(signups.rows);
  } catch (error) {
    console.error('Recent signups error:', error);
    res.status(500).json({ error: 'Failed to fetch signups' });
  }
});

// Admin: All organizations
app.get('/api/admin/organizations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orgs = await pool.query(`
      SELECT o.*, COUNT(DISTINCT om.user_id) as member_count
      FROM organizations o
      LEFT JOIN organization_members om ON om.organization_id = o.id
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `);
    res.json(orgs.rows);
  } catch (error) {
    console.error('Organizations fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// Admin: Organization details
app.get('/api/admin/organizations/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const org = await pool.query(`
      SELECT o.*, COUNT(DISTINCT om.user_id) as member_count
      FROM organizations o
      LEFT JOIN organization_members om ON om.organization_id = o.id
      WHERE o.id = $1
      GROUP BY o.id
    `, [id]);
    if (!org.rows.length) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    res.json(org.rows[0]);
  } catch (error) {
    console.error('Organization detail error:', error);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

// Admin: Update subscription
app.patch('/api/admin/organizations/:id/subscription', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { subscription_status, plan } = req.body;
  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;
    if (subscription_status) {
      updates.push(`subscription_status = $${paramIndex++}`);
      values.push(subscription_status);
    }
    if (plan) {
      updates.push(`plan = $${paramIndex++}`);
      values.push(plan);
    }
    updates.push(`updated_at = NOW()`);
    values.push(id);
    const result = await pool.query(`
      UPDATE organizations SET ${updates.join(', ')}
      WHERE id = $${paramIndex} RETURNING *
    `, values);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Subscription update error:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// Admin: All users
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.created_at, u.last_login_at,
             o.name as org_name, om.role as org_role
      FROM users u
      LEFT JOIN organization_members om ON om.user_id = u.id
      LEFT JOIN organizations o ON o.id = om.organization_id
      ORDER BY u.created_at DESC
    `);
    res.json(users.rows);
  } catch (error) {
    console.error('Users fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Admin: User details
app.get('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const user = await pool.query(`
      SELECT u.*, 
        json_agg(json_build_object('org_id', o.id, 'org_name', o.name, 'role', om.role, 'joined_at', om.joined_at))
        FILTER (WHERE o.id IS NOT NULL) as organizations
      FROM users u
      LEFT JOIN organization_members om ON om.user_id = u.id
      LEFT JOIN organizations o ON o.id = om.organization_id
      WHERE u.id = $1
      GROUP BY u.id
    `, [id]);
    if (!user.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user.rows[0]);
  } catch (error) {
    console.error('User detail error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Admin: All subscriptions
app.get('/api/admin/subscriptions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const subs = await pool.query(`
      SELECT o.id, o.name as org_name, o.plan, o.subscription_status,
             o.stripe_customer_id, o.trial_ends_at, o.created_at
      FROM organizations o
      ORDER BY o.subscription_status, o.created_at DESC
    `);
    res.json(subs.rows);
  } catch (error) {
    console.error('Subscriptions fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});
    app.listen(PORT, () => {
      console.log(`\n🚀 Jira Portfolio Dashboard API v2\n   http://localhost:${PORT}\n`);
    });
  } catch (e) {
    console.error('❌ Failed to start:', e.message);
    process.exit(1);
  }
};

process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });
process.on('SIGINT',  async () => { await pool.end(); process.exit(0); });

startServer();
module.exports = app;
