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
// Trust Railway proxy
app.set('trust proxy', 1);
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
  async getEpicDetails(epicKey) {
	 try {
		const res = await this.client.get(`/issue/${epicKey}`, {
		  params: {
			fields: 'summary,status,created,updated,duedate,labels,issuelinks,customfield_10016'
		  }
		});
		return res.data;
	  } catch (error) {
		console.error(`⚠️  Could not fetch details for ${epicKey}:`, error.message);
		return null;
	 }
  }
  async getIssueDetails(issueKey) {
	try {
		const res = await this.client.get(`/issue/${issueKey}`, {
		params: {
			fields: 'summary,status,issuetype,issuelinks,project,created,assignee,epic,sprint'
		}
		});
		return res.data;
	} catch (error) {
		console.error(`⚠️  Could not fetch details for ${issueKey}:`, error.message);
		return null;
	  }
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
		console.log(`🔍 Fetching epics for project: ${projectKey}`);
		
		// Get boards for this project
		const boardRes = await axios.get(`${this.jiraUrl}/rest/agile/1.0/board`, {
		  headers: { 
			Authorization: this.authHeader,
			Accept: 'application/json' 
		  },
		  params: { 
			projectKeyOrId: projectKey,
			maxResults: 100
		  },
		  timeout: 30000
		});
		
		if (!boardRes.data.values || boardRes.data.values.length === 0) {
		  console.log(`⚠️  No boards found for project ${projectKey}`);
		  return [];
		}
		
		const boardId = boardRes.data.values[0].id;
		const boardName = boardRes.data.values[0].name;
		console.log(`   Found board: ${boardName} (ID: ${boardId})`);
		
		// Get epics from the board
		const epicRes = await axios.get(`${this.jiraUrl}/rest/agile/1.0/board/${boardId}/epic`, {
		  headers: { 
			Authorization: this.authHeader,
			Accept: 'application/json' 
		  },
		  params: {
			maxResults: 1000
		  },
		  timeout: 30000
		});
		
		const epics = epicRes.data.values || [];
		console.log(`✅ Found ${epics.length} epics in ${projectKey}`);
		
		// Enrich each epic with full details
		const enrichedEpics = await Promise.all(
		  epics.map(async (epic) => {
			const details = await this.getEpicDetails(epic.key);
			
			if (details) {
			  return {
				id: epic.id.toString(),
				key: epic.key,
				fields: details.fields
			  };
			} else {
			  // Fallback to basic data if details fetch fails
			  return {
				id: epic.id.toString(),
				key: epic.key,
				fields: {
				  summary: epic.summary || epic.name,
				  status: { name: epic.done ? 'Done' : 'In Progress' },
				  created: epic.created || new Date().toISOString(),
				  updated: epic.updated || new Date().toISOString(),
				  duedate: null,
				  labels: [],
				  issuelinks: [],
				  customfield_10016: null
				}
			  };
			}
		  })
		);
		
		console.log(`   Enriched ${enrichedEpics.length} epics with full details`);
		return enrichedEpics;
		
	  } catch (error) {
		console.error(`❌ Error fetching epics for ${projectKey}:`, error.message);
		if (error.response) {
		  console.error(`   Status: ${error.response.status}`);
		  console.error(`   Data:`, error.response.data);
		}
		return [];
	  }
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
    console.log('🔍 Fetching risks from Jira Software API...');
    
    // Get all boards
    const boardRes = await axios.get(`${this.jiraUrl}/rest/agile/1.0/board`, {
      headers: { 
        Authorization: this.authHeader,
        Accept: 'application/json' 
      },
      params: { maxResults: 100 },
      timeout: 30000
    });
    
    if (!boardRes.data.values || boardRes.data.values.length === 0) {
      console.log('⚠️  No boards found');
      return [];
    }
    
    const allRiskIssues = [];
    
    // Search across all boards for issues with risk labels
    for (const board of boardRes.data.values) {
      try {
        const issuesRes = await axios.get(`${this.jiraUrl}/rest/agile/1.0/board/${board.id}/issue`, {
          headers: { 
            Authorization: this.authHeader,
            Accept: 'application/json' 
          },
          params: {
            jql: 'labels IN (risk, risk-high, risk-medium, risk-low, RISK) AND resolution = Unresolved',
            maxResults: 1000,
            fields: 'summary,description,priority,labels,status,created,project'
          },
          timeout: 30000
        });
        
        if (issuesRes.data.issues?.length > 0) {
          console.log(`   Found ${issuesRes.data.issues.length} risk issues from board: ${board.name}`);
          allRiskIssues.push(...issuesRes.data.issues);
        }
      } catch (boardError) {
        console.log(`   ⚠️  Error fetching from board ${board.name}: ${boardError.message}`);
      }
    }
    
    // Remove duplicates (in case issue appears on multiple boards)
    const uniqueRisks = Array.from(
      new Map(allRiskIssues.map(issue => [issue.key, issue])).values()
    );
    
    console.log(`✅ Found ${uniqueRisks.length} total risk issues`);
    return uniqueRisks;
    
  } catch (error) {
    console.error('❌ Error fetching risks:', error.message);
    return [];
  }
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

	  async getIssuesWithLinks(projectKey) {
		  try {
			console.log(`🔗 Fetching issues with links for project: ${projectKey}`);
			const res = await this.client.get('/search', {
			  params: {
				jql: `project = ${projectKey} AND issuelinks is not EMPTY AND resolution = Unresolved`,
				maxResults: 1000,
				fields: 'summary,status,issuetype,issuelinks,project,created,assignee,epic,sprint'
			  }
			});
			console.log(`   Found ${res.data.issues?.length || 0} issues with links`);
			return res.data.issues || [];
		  } catch (e) {
			console.error(`Error fetching issues with links for ${projectKey}:`, e.message);
			return [];
		  }
	  }
	  async getEpicLinks(projectKey) {
  try {
    console.log(`🔗 Fetching epic links for project: ${projectKey}`);
    
    // Get epics with links using the same approach as getEpics
    const boardRes = await axios.get(`${this.jiraUrl}/rest/agile/1.0/board`, {
      headers: { 
        Authorization: this.authHeader,
        Accept: 'application/json' 
      },
      params: { 
        projectKeyOrId: projectKey,
        maxResults: 100
      },
      timeout: 30000
    });
    
    if (!boardRes.data.values || boardRes.data.values.length === 0) {
      console.log(`   ⚠️  No boards found for project ${projectKey}`);
      return [];
    }
    
    const boardId = boardRes.data.values[0].id;
    
    // Get epics from the board
    const epicRes = await axios.get(`${this.jiraUrl}/rest/agile/1.0/board/${boardId}/epic`, {
      headers: { 
        Authorization: this.authHeader,
        Accept: 'application/json' 
      },
      params: {
        maxResults: 1000
      },
      timeout: 30000
    });
    
    const epics = epicRes.data.values || [];
    
    if (epics.length === 0) {
      console.log(`   No epics found in ${projectKey}`);
      return [];
    }
    
    // Now fetch full details for each epic to get issue links
    const epicsWithLinks = [];
    for (const epic of epics) {
      try {
        const details = await this.client.get(`/issue/${epic.key}`, {
          params: {
            fields: 'summary,issuelinks,issuetype'
          }
        });
        
        if (details.data.fields.issuelinks && details.data.fields.issuelinks.length > 0) {
          epicsWithLinks.push({
            key: epic.key,
            fields: details.data.fields
          });
        }
      } catch (e) {
        console.log(`   ⚠️  Could not fetch links for ${epic.key}: ${e.message}`);
      }
    }
    
    console.log(`   ✅ Found ${epicsWithLinks.length} epics with links in ${projectKey}`);
    return epicsWithLinks;
    
  } catch (error) {
    console.error(`❌ Error fetching epic links for ${projectKey}:`, error.message);
    return [];
  }
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
	if (!projectRow.rows.length) {
		console.log(`⚠️  Project ${p.key} not found in database, skipping epics`);
		continue;
	}
	const projectDbId = projectRow.rows[0].id;

	console.log(`📊 Syncing epics for project: ${p.key}`);
	const epics = await jira.getEpics(p.key);
	console.log(`   Found ${epics.length} epics in ${p.key}`);
  
	for (const e of epics) {
		// Extract story points
		const storyPoints = e.fields.customfield_10016 
                     || e.fields.customfield_10028 
                     || e.fields.story_points 
                     || 0;

		// Extract due date
		const dueDate = e.fields.duedate ? new Date(e.fields.duedate) : null;
		const startDate = e.fields.created ? new Date(e.fields.created) : null;

		console.log(`   Inserting epic: ${e.key} - ${e.fields.summary}`);

		await pool.query(
      `		INSERT INTO epics (
				jira_connection_id, 
				project_id, 
				jira_epic_id, 
				jira_epic_key, 
				name, 
				status,
				due_date,
				start_date,
				total_story_points,
				progress
			)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0)
			ON CONFLICT (jira_connection_id, jira_epic_id)
			DO UPDATE SET 
			name=EXCLUDED.name, 
			status=EXCLUDED.status, 
			due_date=EXCLUDED.due_date,
			updated_at=NOW()`,
		[
			connectionId, 
			projectDbId, 
			e.id, 
			e.key, 
			e.fields.summary, 
			e.fields.status.name,
			dueDate,
			startDate,
			storyPoints
		]
		);
		stats.epics++;
	}
  }
  console.log(`✅ Synced ${stats.epics} epics total`);
  
  // ------------------------------------------------------------------
  // 2b. LINK ISSUES TO EPICS & CALCULATE PROGRESS
  // ------------------------------------------------------------------
  console.log('🔗 Linking issues to epics and calculating progress...');
  let linkedCount = 0;

  const allEpics = await pool.query(
    'SELECT id, jira_epic_id, jira_epic_key FROM epics WHERE jira_connection_id = $1',
    [connectionId]
  );

  for (const epic of allEpics.rows) {
    try {
      // Get issues for this epic using JQL (parent field)
      const epicIssues = await axios.get(
        `${jira.jiraUrl}/rest/api/3/search`,
        {
          headers: { 
            Authorization: jira.authHeader,
            Accept: 'application/json' 
          },
          params: { 
            jql: `parent = ${epic.jira_epic_key}`,
            maxResults: 1000,
            fields: 'key'
          },
          timeout: 30000
        }
      );

      const issues = epicIssues.data.issues || [];
      
      for (const issue of issues) {
        // Update issue with epic_id
        const result = await pool.query(
          `UPDATE issues 
           SET epic_id = $1 
           WHERE jira_issue_key = $2 AND jira_connection_id = $3`,
          [epic.id, issue.key, connectionId]
        );
        if (result.rowCount > 0) linkedCount++;
      }
      
      if (issues.length > 0) {
        console.log(`   ✅ Linked ${issues.length} issues to ${epic.jira_epic_key}`);
      }
      
    } catch (err) {
      console.log(`   ⚠️  Could not get issues for ${epic.jira_epic_key}: ${err.message}`);
    }

    // Step 2: Calculate progress for this epic
    const issueStats = await pool.query(`
      SELECT 
        COUNT(*) as total_issues,
        COUNT(CASE WHEN status IN ('Done', 'Closed') THEN 1 END) as completed_issues,
        COALESCE(SUM(story_points), 0) as total_points,
        COALESCE(SUM(CASE WHEN status IN ('Done', 'Closed') THEN story_points ELSE 0 END), 0) as completed_points
      FROM issues
      WHERE epic_id = $1 AND jira_connection_id = $2
    `, [epic.id, connectionId]);
    
    const stats = issueStats.rows[0];
    let progress = 0;
    
    // Calculate progress: prefer story points, fall back to issue count
    if (stats.total_points && stats.total_points > 0) {
      progress = Math.round((stats.completed_points / stats.total_points) * 100);
    } else if (stats.total_issues && stats.total_issues > 0) {
      progress = Math.round((stats.completed_issues / stats.total_issues) * 100);
    }
    
    // Update epic with calculated progress
    await pool.query(
      'UPDATE epics SET progress = $1, total_story_points = $2, completed_story_points = $3 WHERE id = $4',
      [progress, stats.total_points || 0, stats.completed_points || 0, epic.id]
    );
  }

  console.log(`✅ Linked ${linkedCount} issues to epics`);
  console.log(`✅ Calculated progress for ${allEpics.rows.length} epics`);

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
		// ====== ADD THIS DEBUG CODE HERE ======
        // Debug: Log epic-related fields for first 5 issues
        if (stats.issues < 5) {
          console.log(`\n🔍 DEBUG Issue ${issue.key}:`);
          console.log('  customfield_10014:', issue.fields.customfield_10014);
          console.log('  customfield_10008:', issue.fields.customfield_10008);
          console.log('  parent:', issue.fields.parent);
          console.log('  epic:', issue.fields.epic);
          console.log('  All custom fields:', Object.keys(issue.fields).filter(k => k.startsWith('customfield')));
        }
        // ====== END DEBUG CODE ======

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
     story_points, assignee, assignee_name, assignee_account_id)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
   ON CONFLICT (jira_connection_id, jira_issue_id)
   DO UPDATE SET 
     status=EXCLUDED.status, 
     sprint_id=EXCLUDED.sprint_id,
     story_points=EXCLUDED.story_points, 
     assignee=EXCLUDED.assignee,
     assignee_name=EXCLUDED.assignee_name,
     assignee_account_id=EXCLUDED.assignee_account_id,
     updated_at=NOW()`,
  [connectionId, projectDbId, epicDbId, sprintDbId,
   issue.id, issue.key, issue.fields.summary,
   issue.fields.issuetype.name, issue.fields.status.name,
   issue.fields.priority?.name || null,
   storyPoints,
   issue.fields.assignee?.displayName || null,  // assignee
   issue.fields.assignee?.displayName || null,  // assignee_name (backward compat)
   issue.fields.assignee?.accountId || null]    // assignee_account_id
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
	  FROM (
		SELECT completed_points, committed_points
		FROM velocity_history
		WHERE team_id = $1
		ORDER BY sprint_start_date DESC 
		LIMIT 6
	  ) sub
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
	  
	  // First, delete any existing entry to avoid GROUP BY issues
	  await pool.query(
		'DELETE FROM velocity_history WHERE team_id=$1 AND sprint_id=$2',
		[teamId, sp.id]
	  );
	  
	  // Then insert fresh data
	  await pool.query(
		`INSERT INTO velocity_history (team_id, sprint_id, committed_points, completed_points, velocity, sprint_start_date, sprint_end_date)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		[teamId, sp.id, loadPts, 0, velocity, sp.start_date, sp.end_date]
	  );
	}
  }

  // ------------------------------------------------------------------
// 9. RISKS - Comprehensive detection
// ------------------------------------------------------------------
console.log('⚠️  Syncing risks...');

// Method 1: Issues with risk labels (already working)
console.log('   Method 1: Detecting risks via labels/status...');
const riskIssues = await jira.getRisks();
let risksFromLabels = 0;

for (const r of riskIssues) {
  try {
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
      `INSERT INTO risks (jira_connection_id, project_id, jira_issue_key, title, description, severity, status, auto_detected, risk_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,'labeled_risk')
       ON CONFLICT (jira_issue_key, jira_connection_id)
       DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, severity=EXCLUDED.severity, status=EXCLUDED.status, updated_at=NOW()`,
      [connectionId, projectDbId, r.key, r.fields.summary, r.fields.description || '',
       severity, r.fields.status.name.toLowerCase().includes('done') ? 'closed' : 'open']
    );
    risksFromLabels++;
    stats.risks++;
  } catch (err) {
    console.error(`   ⚠️  Failed to insert risk ${r.key}:`, err.message);
  }
}
console.log(`   ✅ Found ${risksFromLabels} risks via labels/status`);

// Method 2: Auto-detect at-risk epics
console.log('   Method 2: Auto-detecting at-risk epics...');
let risksFromEpics = 0;

const atRiskEpics = await pool.query(`
  SELECT 
    e.id as epic_id,
    e.name,
    e.jira_epic_key,
    e.project_id,
    e.progress,
    e.due_date,
    e.total_story_points,
    e.completed_story_points,
    p.name as project_name,
    p.jira_project_key
  FROM epics e
  JOIN projects p ON e.project_id = p.id
  WHERE e.jira_connection_id = $1
    AND e.status NOT IN ('Done', 'Closed', 'Cancelled')
    AND (
      -- Less than 30% complete with due date within 7 days
      (e.progress < 30 AND e.due_date IS NOT NULL AND e.due_date < NOW() + INTERVAL '7 days')
      OR
      -- Due date passed but not complete
      (e.due_date IS NOT NULL AND e.due_date < NOW() AND e.progress < 100)
      OR
      -- No progress but has story points and due date
      (e.progress = 0 AND e.total_story_points > 0 AND e.due_date IS NOT NULL)
    )
`, [connectionId]);

for (const epic of atRiskEpics.rows) {
  try {
    let riskTitle = `Epic at risk: ${epic.name}`;
    let riskDesc = '';
    let severity = 'medium';

    if (epic.due_date && epic.due_date < new Date()) {
      const daysOverdue = Math.ceil((new Date() - new Date(epic.due_date)) / (1000 * 60 * 60 * 24));
      riskDesc = `Epic is ${daysOverdue} days overdue. Progress: ${epic.progress}%`;
      severity = 'high';
    } else if (epic.progress < 30 && epic.due_date) {
      const daysLeft = Math.ceil((new Date(epic.due_date) - new Date()) / (1000 * 60 * 60 * 24));
      riskDesc = `Epic only ${epic.progress}% complete with ${daysLeft} days remaining`;
      severity = daysLeft < 3 ? 'high' : 'medium';
    } else {
      riskDesc = `Epic has ${epic.total_story_points} story points but no progress`;
      severity = 'low';
    }

    const syntheticKey = `EPIC-RISK-${epic.jira_epic_key}`;

    await pool.query(
      `INSERT INTO risks (jira_connection_id, project_id, jira_issue_key, title, description, severity, status, auto_detected, risk_type)
       VALUES ($1,$2,$3,$4,$5,$6,'open',true,'epic_at_risk')
       ON CONFLICT (jira_issue_key, jira_connection_id) 
       DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, severity=EXCLUDED.severity, status='open', updated_at=NOW()`,
      [connectionId, epic.project_id, syntheticKey, riskTitle, riskDesc, severity]
    );
    
    risksFromEpics++;
    stats.risks++;
    console.log(`   📊 ${epic.jira_epic_key}: ${riskDesc}`);
  } catch (err) {
    console.error(`   ⚠️  Failed to insert epic risk:`, err.message);
  }
}
console.log(`   ✅ Found ${risksFromEpics} at-risk epics`);

// Method 3: Auto-detect overloaded teams
console.log('   Method 3: Auto-detecting overloaded teams...');
let risksFromTeams = 0;

const overloadedTeams = await pool.query(`
  SELECT 
    t.id as team_id,
    t.name as team_name,
    t.velocity,
    t.current_load,
    t.capacity
  FROM teams t
  WHERE t.jira_connection_id = $1
    AND t.current_load > 100
`, [connectionId]);

for (const team of overloadedTeams.rows) {
  try {
    const riskTitle = `Team overloaded: ${team.team_name}`;
    const loadPercent = Math.round(team.current_load);
    const riskDesc = `Team is at ${loadPercent}% capacity (velocity: ${team.velocity} points). Current workload exceeds team capacity.`;
    const severity = loadPercent > 150 ? 'high' : 'medium';

    const syntheticKey = `TEAM-OVERLOAD-${team.team_id}`;

    await pool.query(
      `INSERT INTO risks (jira_connection_id, project_id, jira_issue_key, title, description, severity, status, auto_detected, risk_type)
       VALUES ($1,NULL,$2,$3,$4,$5,'open',true,'team_overload')
       ON CONFLICT (jira_issue_key, jira_connection_id) 
       DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, severity=EXCLUDED.severity, status='open', updated_at=NOW()`,
      [connectionId, syntheticKey, riskTitle, riskDesc, severity]
    );
    
    risksFromTeams++;
    stats.risks++;
    console.log(`   👥 ${team.team_name}: ${loadPercent}% capacity`);
  } catch (err) {
    console.error(`   ⚠️  Failed to insert team risk:`, err.message);
  }
}
console.log(`   ✅ Found ${risksFromTeams} overloaded teams`);

// Method 4: Auto-detect at-risk issues
console.log('   Method 4: Auto-detecting at-risk issues...');
let risksFromIssues = 0;

const atRiskIssues = await pool.query(`
  SELECT 
    i.id as issue_id,
    i.jira_issue_key,
    i.summary,
    i.status,
    i.priority,
    i.story_points,
    i.assignee,
    i.issue_type,
    i.created_at,
    i.updated_at,
    i.sprint_id,
    i.epic_id,
    i.project_id,
    s.end_date as sprint_end_date,
    s.name as sprint_name
  FROM issues i
  LEFT JOIN sprints s ON i.sprint_id = s.id
  WHERE i.jira_connection_id = $1
    AND i.status NOT IN ('Done', 'Closed', 'Resolved')
    AND (
      -- High priority unassigned issues
      (i.priority IN ('Highest', 'High', 'Critical') AND i.assignee IS NULL)
      OR
      -- Issues in progress for more than 7 days with no updates
      (i.status = 'In Progress' AND i.updated_at < NOW() - INTERVAL '7 days')
      OR
      -- Large story points (>8) near sprint end with no progress
      (i.story_points > 8 AND s.end_date IS NOT NULL AND s.end_date < NOW() + INTERVAL '3 days' AND i.status IN ('To Do', 'Backlog'))
      OR
      -- Critical bugs not assigned
      (i.issue_type = 'Bug' AND i.priority IN ('Highest', 'Critical') AND i.assignee IS NULL)
    )
  LIMIT 50
`, [connectionId]);

for (const issue of atRiskIssues.rows) {
  try {
    let riskTitle = '';
    let riskDesc = '';
    let severity = 'medium';

    if (issue.priority && ['Highest', 'High', 'Critical'].includes(issue.priority) && !issue.assignee) {
      riskTitle = `Unassigned high priority: ${issue.jira_issue_key}`;
      riskDesc = `${issue.priority} priority issue "${issue.summary}" is not assigned`;
      severity = 'high';
    } else if (issue.status === 'In Progress' && issue.updated_at < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
      const daysStale = Math.ceil((new Date() - new Date(issue.updated_at)) / (1000 * 60 * 60 * 24));
      riskTitle = `Stalled issue: ${issue.jira_issue_key}`;
      riskDesc = `Issue "${issue.summary}" has been in progress for ${daysStale} days with no updates`;
      severity = daysStale > 14 ? 'high' : 'medium';
    } else if (issue.story_points > 8 && issue.sprint_end_date) {
      const daysLeft = Math.ceil((new Date(issue.sprint_end_date) - new Date()) / (1000 * 60 * 60 * 24));
      riskTitle = `Large story at risk: ${issue.jira_issue_key}`;
      riskDesc = `${issue.story_points}-point story "${issue.summary}" not started with ${daysLeft} days left in sprint`;
      severity = daysLeft < 2 ? 'high' : 'medium';
    } else if (issue.issue_type === 'Bug' && issue.priority && ['Highest', 'Critical'].includes(issue.priority)) {
      riskTitle = `Critical bug unassigned: ${issue.jira_issue_key}`;
      riskDesc = `${issue.priority} bug "${issue.summary}" needs immediate attention`;
      severity = 'high';
    }

    if (!riskTitle) continue;

    const syntheticKey = `ISSUE-RISK-${issue.jira_issue_key}`;

    await pool.query(
      `INSERT INTO risks (jira_connection_id, project_id, jira_issue_key, title, description, severity, status, auto_detected, risk_type)
       VALUES ($1,$2,$3,$4,$5,$6,'open',true,'issue_at_risk')
       ON CONFLICT (jira_issue_key, jira_connection_id) 
       DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, severity=EXCLUDED.severity, status='open', updated_at=NOW()`,
      [connectionId, issue.project_id, syntheticKey, riskTitle, riskDesc, severity]
    );
    
    risksFromIssues++;
    stats.risks++;
    console.log(`   🎫 ${issue.jira_issue_key}: ${riskTitle}`);
  } catch (err) {
    console.error(`   ⚠️  Failed to insert issue risk:`, err.message);
  }
}
console.log(`   ✅ Found ${risksFromIssues} at-risk issues`);

// Method 5: Auto-detect at-risk sprints
console.log('   Method 5: Auto-detecting at-risk sprints...');
let risksFromSprints = 0;

const atRiskSprints = await pool.query(`
  WITH sprint_progress AS (
    SELECT 
      s.id as sprint_id,
      s.name as sprint_name,
      s.start_date,
      s.end_date,
      s.team_id,
      t.name as team_name,
      COUNT(i.id) as total_issues,
      COUNT(CASE WHEN i.status IN ('Done', 'Closed') THEN 1 END) as completed_issues,
      SUM(i.story_points) as total_points,
      SUM(CASE WHEN i.status IN ('Done', 'Closed') THEN i.story_points ELSE 0 END) as completed_points,
      ROUND(
        CASE 
          WHEN COUNT(i.id) > 0 
          THEN (COUNT(CASE WHEN i.status IN ('Done', 'Closed') THEN 1 END)::numeric / COUNT(i.id)::numeric * 100)
          ELSE 0 
        END, 
        0
      ) as completion_percent
    FROM sprints s
    LEFT JOIN teams t ON s.team_id = t.id
    LEFT JOIN issues i ON i.sprint_id = s.id
    WHERE s.jira_connection_id = $1
      AND s.state = 'active'
      AND s.end_date IS NOT NULL
    GROUP BY s.id, s.name, s.start_date, s.end_date, s.team_id, t.name
  )
  SELECT *
  FROM sprint_progress
  WHERE 
    -- Sprint ending soon with low completion
    (end_date < NOW() + INTERVAL '3 days' AND completion_percent < 30)
    OR
    -- Sprint past end date but not complete
    (end_date < NOW() AND completion_percent < 100)
`, [connectionId]);

for (const sprint of atRiskSprints.rows) {
  try {
    let riskTitle = '';
    let riskDesc = '';
    let severity = 'medium';

    const daysLeft = Math.ceil((new Date(sprint.end_date) - new Date()) / (1000 * 60 * 60 * 24));

    if (sprint.end_date < new Date()) {
      const daysOverdue = Math.abs(daysLeft);
      riskTitle = `Sprint overdue: ${sprint.sprint_name}`;
      riskDesc = `Sprint is ${daysOverdue} days overdue with only ${sprint.completion_percent}% complete (${sprint.completed_issues}/${sprint.total_issues} issues)`;
      severity = 'high';
    } else if (daysLeft <= 3 && sprint.completion_percent < 30) {
      riskTitle = `Sprint at risk: ${sprint.sprint_name}`;
      riskDesc = `Only ${sprint.completion_percent}% complete with ${daysLeft} days remaining (${sprint.completed_issues}/${sprint.total_issues} issues done)`;
      severity = daysLeft <= 1 ? 'high' : 'medium';
    }

    if (!riskTitle) continue;

    const syntheticKey = `SPRINT-RISK-${sprint.sprint_id}`;

    await pool.query(
      `INSERT INTO risks (jira_connection_id, project_id, jira_issue_key, title, description, severity, status, auto_detected, risk_type)
       VALUES ($1,NULL,$2,$3,$4,$5,'open',true,'sprint_at_risk')
       ON CONFLICT (jira_issue_key, jira_connection_id) 
       DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, severity=EXCLUDED.severity, status='open', updated_at=NOW()`,
      [connectionId, syntheticKey, riskTitle, riskDesc, severity]
    );
    
    risksFromSprints++;
    stats.risks++;
    console.log(`   🏃 ${sprint.sprint_name}: ${sprint.completion_percent}% complete with ${daysLeft} days left`);
  } catch (err) {
    console.error(`   ⚠️  Failed to insert sprint risk:`, err.message);
  }
}
console.log(`   ✅ Found ${risksFromSprints} at-risk sprints`);

console.log(`✅ Total risks synced: ${stats.risks} (${risksFromLabels} labeled + ${risksFromEpics} epic + ${risksFromTeams} team + ${risksFromIssues} issue + ${risksFromSprints} sprint)`);
  // ------------------------------------------------------------------
  // 10. BLOCKERS - Multiple detection methods
  // ------------------------------------------------------------------
  console.log('🚫 Syncing blockers...');

  // Method 1: Issues with blocked status or labels (existing method)
  console.log('   Method 1: Detecting blocked issues via status/labels...');
  const blockedIssues = await jira.getBlockers();
  let blockersFromStatus = 0;

  for (const b of blockedIssues) {
	  try {
		const pRow = await pool.query(
		  'SELECT id FROM projects WHERE jira_project_key=$1 AND jira_connection_id=$2',
		  [b.fields.project.key, connectionId]
		);
		const projectDbId = pRow.rows[0]?.id || null;

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
		   ON CONFLICT (jira_issue_key, jira_connection_id)
		   DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status, updated_at = NOW()`,
		  [connectionId, issueDbId, teamDbId, epicDbId, projectDbId, b.key,
		   b.fields.summary, b.fields.description || '',
		   b.fields.status.name.toLowerCase().includes('done') ? 'resolved' : 'active',
		   b.fields.created ? new Date(b.fields.created) : new Date()]
		);
		blockersFromStatus++;
		stats.blockers++;
	  } catch (err) {
		console.error(`   ⚠️  Failed to insert blocker ${b.key}:`, err.message);
	  }
	}
  console.log(`   ✅ Found ${blockersFromStatus} blockers via status/labels`);

  // Method 2: Parse issue links from already-synced issues
  console.log('   Method 2: Detecting blockers via issue links from synced issues...');
  let blockersFromLinks = 0;

  // Get all issues we've already synced
  const syncedIssues = await pool.query(
	'SELECT jira_issue_key, id, sprint_id, epic_id, project_id FROM issues WHERE jira_connection_id=$1',
	[connectionId]
  );

  console.log(`   Checking ${syncedIssues.rows.length} synced issues for blocking links...`);

  // Process in batches to avoid overwhelming the API
  const batchSize = 20;
  for (let i = 0; i < syncedIssues.rows.length; i += batchSize) {
	const batch = syncedIssues.rows.slice(i, i + batchSize);
  
	await Promise.all(batch.map(async (syncedIssue) => {
		try {
			// Fetch full details including links
			const issueDetails = await jira.getIssueDetails(syncedIssue.jira_issue_key);
		  
			if (!issueDetails || !issueDetails.fields.issuelinks || issueDetails.fields.issuelinks.length === 0) {
			return;
			}
		  
			const issueLinks = issueDetails.fields.issuelinks;
		  
			for (const link of issueLinks) {
				const linkType = link.type?.name?.toLowerCase() || '';
				const isBlockedBy = linkType.includes('block') || linkType.includes('depend');
			
				if (!isBlockedBy) continue;
			
				let blockedIssueKey = null;
				let blockingIssueKey = null;
			
				// Parse blocking relationship
				if (link.inwardIssue && link.type?.inward?.toLowerCase().includes('block')) {
					blockedIssueKey = syncedIssue.jira_issue_key;
					blockingIssueKey = link.inwardIssue.key;
				} else if (link.outwardIssue && link.type?.outward?.toLowerCase().includes('block')) {
					blockedIssueKey = link.outwardIssue.key;
					blockingIssueKey = syncedIssue.jira_issue_key;
					}
			
				if (!blockedIssueKey || !blockingIssueKey) continue;
			
				// Use the synced issue data
				const issueDbId = syncedIssue.id;
				const epicDbId = syncedIssue.epic_id;
				const projectDbId = syncedIssue.project_id;
			
				let teamDbId = null;
				if (syncedIssue.sprint_id) {
					const spRow = await pool.query('SELECT team_id FROM sprints WHERE id=$1', [syncedIssue.sprint_id]);
					teamDbId = spRow.rows[0]?.team_id || null;
				}
			
				const blockerTitle = `${blockedIssueKey} blocked by ${blockingIssueKey}`;
				const blockerDesc = `Issue is blocked by ${blockingIssueKey}`;
			
				await pool.query(
			  `		INSERT INTO blockers (jira_connection_id, issue_id, team_id, epic_id, project_id,
					jira_issue_key, title, description, status, blocked_since, auto_detected)
					VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',NOW(),true)
					ON CONFLICT (jira_issue_key, jira_connection_id)
					DO UPDATE SET title = EXCLUDED.title, status = 'active', updated_at = NOW()`,
					[connectionId, issueDbId, teamDbId, epicDbId, projectDbId, 
			   `	LINK-${blockedIssueKey}-${blockingIssueKey}`,
					blockerTitle, blockerDesc]
				);
			
				blockersFromLinks++;
				stats.blockers++;
				console.log(`   📌 ${blockedIssueKey} is blocked by ${blockingIssueKey}`);
			}
		} catch (err) {
		console.error(`   ⚠️  Error processing ${syncedIssue.jira_issue_key}:`, err.message);
	}
  }));
  
	if (i + batchSize < syncedIssues.rows.length) {
		console.log(`   Processed ${i + batchSize}/${syncedIssues.rows.length} issues...`);
	}
  }

  console.log(`   ✅ Found ${blockersFromLinks} blockers via issue links`);
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
  } catch (e) { 
	console.error('❌ Teams endpoint error:', e);
	res.status(500).json({ error: 'Server error', details: e.message }); 
	}
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
  } catch (e) { 
	console.error('❌ Projects endpoint error:', e);
	res.status(500).json({ error: 'Server error', details: e.message }); 
	}
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
  } catch (e) { 
  console.error('❌ Epics endpoint error:', e);
  res.status(500).json({ error: 'Server error', details: e.message });
  }
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
 
    // Get epics with dates for timeline
    const result = await pool.query(`
      SELECT 
        e.id,
        e.jira_epic_key,
        e.name,
        e.status,
        e.start_date,
        e.due_date,
        e.progress,
        e.total_story_points,
        e.completed_story_points,
        p.name AS project_name,
        p.jira_project_key,
        p.id as project_id
      FROM epics e
      JOIN projects p ON e.project_id = p.id
      WHERE e.jira_connection_id = $1
        AND (e.start_date IS NOT NULL OR e.due_date IS NOT NULL)
      ORDER BY 
        COALESCE(e.start_date, e.due_date) ASC,
        e.due_date ASC NULLS LAST
    `, [conn.id]);
 
    res.json({ 
      epics: result.rows,
      summary: {
        total: result.rows.length,
        with_due_date: result.rows.filter(e => e.due_date).length,
        in_progress: result.rows.filter(e => e.status === 'In Progress').length,
        completed: result.rows.filter(e => e.status === 'Done' || e.status === 'Closed').length
      }
    });
  } catch (e) { 
    console.error('Timeline error:', e);
    res.status(500).json({ error: 'Server error' }); 
  }
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


// ============================================================================
// ADMIN ROUTES
// ============================================================================

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
console.log('✅ Admin routes loaded');
app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
	const stats = await pool.query(`
	  SELECT
		(SELECT COUNT(*) FROM users) as total_users,
		(SELECT COUNT(*) FROM organizations WHERE subscription_status IN ('active', 'trialing')) as active_subscriptions,
		(SELECT SUM(CASE WHEN plan = 'starter' THEN 49 WHEN plan = 'pro' THEN 149 WHEN plan = 'enterprise' THEN 499 ELSE 0 END) FROM organizations WHERE subscription_status = 'active') as mrr
	`);
	res.json({
	  totalUsers: parseInt(stats.rows[0].total_users),
	  activeSubscriptions: parseInt(stats.rows[0].active_subscriptions),
	  mrr: parseInt(stats.rows[0].mrr || 0),
	  conversionRate: 0,
	});
  } catch (error) {
	console.error('Admin stats error:', error);
	res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
	const users = await pool.query(`
	  SELECT u.id, u.name, u.email, u.role, u.created_at,
			 o.name as org_name
	  FROM users u
	  LEFT JOIN organization_members om ON om.user_id = u.id
	  LEFT JOIN organizations o ON o.id = om.organization_id
	  ORDER BY u.created_at DESC
	`);
	res.json(users.rows);
  } catch (error) {
	res.status(500).json({ error: 'Failed to fetch users' });
  }
});

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
	res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});
app.get('/api/admin/subscriptions', authenticateToken, requireAdmin, async (req, res) => {
  try {
	const subs = await pool.query(`
	  SELECT o.id, o.name as org_name, o.plan, o.subscription_status,
			 o.stripe_customer_id, o.trial_ends_at, o.created_at
	  FROM organizations o
	  ORDER BY o.created_at DESC
	`);
	res.json(subs.rows);
  } catch (error) {
	res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

app.patch('/api/admin/organizations/:id/subscription', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { subscription_status } = req.body;
  try {
	const result = await pool.query(`
	  UPDATE organizations 
	  SET subscription_status = $1, updated_at = NOW()
	  WHERE id = $2 
	  RETURNING *
	`, [subscription_status, id]);
	res.json(result.rows[0]);
  } catch (error) {
	res.status(500).json({ error: 'Failed to update subscription' });
  }
});

app.get('/api/admin/recent-signups', authenticateToken, requireAdmin, async (req, res) => {
  try {
	const signups = await pool.query(`
	  SELECT u.id, u.name as user_name, u.email as user_email,
			 o.name as org_name, o.plan, u.created_at
	  FROM users u
	  JOIN organization_members om ON om.user_id = u.id
	  JOIN organizations o ON o.id = om.organization_id
	  ORDER BY u.created_at DESC
	  LIMIT 10
	`);
	res.json(signups.rows);
  } catch (error) {
	res.status(500).json({ error: 'Failed to fetch signups' });
  }
});
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
