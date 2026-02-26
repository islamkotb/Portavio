# 🏗️ Data Model: Projects, Teams, and Epics

## Current Data Model

### 📊 Entity Relationships

```
User
  └── Jira Connection
        ├── Projects (Many) ──────────────┐
        │     └── Epics (Many)            │
        │                                  │
        └── Teams (Many)                   │  ⚠️ NO DIRECT LINK
              └── Sprints (Many)           │
                    └── Issues (Many) ─────┘
                            └── Epic Link (Optional)
```

### Current Schema Relationships

**Projects:**
```sql
projects
  ├── id (Primary Key)
  ├── jira_connection_id → jira_connections(id)
  ├── jira_project_id (from Jira)
  ├── jira_project_key (e.g., "PROJ")
  ├── name
  ├── status
  ├── health
  └── description
```

**Epics:**
```sql
epics
  ├── id (Primary Key)
  ├── jira_connection_id → jira_connections(id)
  ├── project_id → projects(id)  ✅ LINKED TO PROJECT
  ├── jira_epic_id
  ├── jira_epic_key
  ├── name
  ├── status
  └── progress
```

**Teams:**
```sql
teams
  ├── id (Primary Key)
  ├── jira_connection_id → jira_connections(id)
  ├── jira_team_id (board ID)
  ├── name
  ├── capacity
  ├── velocity
  └── predictability_score

  ⚠️ NO link to projects!
```

**Sprints:**
```sql
sprints
  ├── id (Primary Key)
  ├── jira_connection_id → jira_connections(id)
  ├── team_id → teams(id)  ✅ LINKED TO TEAM
  ├── jira_sprint_id
  ├── name
  ├── state
  └── dates
```

**Issues:**
```sql
issues
  ├── id (Primary Key)
  ├── jira_connection_id → jira_connections(id)
  ├── project_id → projects(id)  ✅ LINKED TO PROJECT
  ├── epic_id → epics(id)  ✅ LINKED TO EPIC
  ├── sprint_id → sprints(id)  ✅ LINKED TO SPRINT
  ├── jira_issue_key
  └── summary
```

## 🎯 How It Maps to Jira

### In Jira:

1. **Project** = A Jira Project (e.g., "Mobile App", key: "MOBILE")
   - Contains epics, stories, bugs
   - Has a project key (e.g., MOBILE-123)

2. **Board** = Team in the dashboard
   - Associated with one or more projects
   - Teams work from boards
   - A board can show issues from multiple projects

3. **Epic** = Large body of work
   - Always belongs to ONE project
   - Can have issues from multiple sprints
   - Issues in epic may be worked on by multiple teams

4. **Sprint** = Time-boxed iteration
   - Belongs to ONE board (team)
   - Can have issues from multiple projects
   - Can have issues from multiple epics

### Visual Example from Jira:

```
Project: "Mobile App" (MOBILE)
  ├── Epic: MOBILE-1 "User Authentication"
  ├── Epic: MOBILE-2 "Push Notifications"
  └── Epic: MOBILE-3 "Offline Mode"

Board: "Mobile Team" (Team)
  ├── Sprint 1
  │     ├── MOBILE-10 (from Epic MOBILE-1)
  │     ├── MOBILE-15 (from Epic MOBILE-1)
  │     └── API-45 (from different project!)
  └── Sprint 2
        ├── MOBILE-20 (from Epic MOBILE-2)
        └── MOBILE-21 (from Epic MOBILE-3)
```

## ⚠️ Current Issues with the Model

### Problem 1: Teams ↔ Projects Not Linked

**What's Missing:**
```
Teams are NOT directly linked to Projects
```

**Why This Matters:**
- Can't answer: "Which teams are working on Project X?"
- Can't answer: "What projects is Team Y working on?"
- Can't calculate: "Team capacity allocated to each project"
- Can't show: "Project health by team"

**In Reality:**
- One team can work on multiple projects
- One project can have multiple teams working on it
- This is a **many-to-many relationship**

### Problem 2: No Team ↔ Epic Relationship

**What's Missing:**
```
Can't determine which team "owns" an epic
```

**Why This Matters:**
- Can't answer: "Which team is responsible for Epic X?"
- Can't show: "Epic progress by team"
- Can't calculate: "Team velocity per epic"

### Problem 3: No Project ↔ Team Assignment Table

**What's Missing:**
```
No way to track:
- Which teams are assigned to which projects
- How much capacity each team allocates to each project
- Primary vs. contributing teams
```

## 🔧 Recommended Data Model Improvements

### Option 1: Add Many-to-Many Relationship Tables

#### Add: `team_projects` (Junction Table)

```sql
CREATE TABLE team_projects (
    id SERIAL PRIMARY KEY,
    team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    allocation_percentage INTEGER DEFAULT 100,  -- How much of team's capacity
    is_primary BOOLEAN DEFAULT false,  -- Primary team for this project
    role VARCHAR(100),  -- e.g., "Development", "QA", "DevOps"
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, project_id)
);
```

**Usage:**
```sql
-- Team "Mobile Team" works 80% on "Mobile App" project
INSERT INTO team_projects (team_id, project_id, allocation_percentage, is_primary)
VALUES (1, 5, 80, true);

-- Team "Platform Team" contributes 20% to "Mobile App"
INSERT INTO team_projects (team_id, project_id, allocation_percentage, is_primary)
VALUES (2, 5, 20, false);
```

#### Add: `epic_teams` (Junction Table)

```sql
CREATE TABLE epic_teams (
    id SERIAL PRIMARY KEY,
    epic_id INTEGER REFERENCES epics(id) ON DELETE CASCADE,
    team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    is_owner BOOLEAN DEFAULT false,  -- Primary team responsible
    contribution_percentage INTEGER DEFAULT 0,  -- Estimated work split
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(epic_id, team_id)
);
```

**Usage:**
```sql
-- "Mobile Team" owns the "User Authentication" epic
INSERT INTO epic_teams (epic_id, team_id, is_owner, contribution_percentage)
VALUES (10, 1, true, 70);

-- "Security Team" contributes to the epic
INSERT INTO epic_teams (epic_id, team_id, is_owner, contribution_percentage)
VALUES (10, 3, false, 30);
```

### Option 2: Infer Relationships from Issues (Simpler)

Instead of explicit junction tables, **calculate relationships dynamically** from issues:

```sql
-- Find which teams work on which projects
SELECT 
    t.name as team_name,
    p.name as project_name,
    COUNT(DISTINCT i.id) as issue_count
FROM teams t
JOIN sprints s ON s.team_id = t.id
JOIN issues i ON i.sprint_id = s.id
JOIN projects p ON i.project_id = p.id
GROUP BY t.id, p.id;

-- Find which teams work on which epics
SELECT 
    t.name as team_name,
    e.name as epic_name,
    COUNT(DISTINCT i.id) as issue_count
FROM teams t
JOIN sprints s ON s.team_id = t.id
JOIN issues i ON i.sprint_id = s.id
JOIN epics e ON i.epic_id = e.id
GROUP BY t.id, e.id;
```

**Pros:**
- ✅ No schema changes needed
- ✅ Automatically accurate (based on actual work)
- ✅ No manual assignment needed

**Cons:**
- ❌ Only works after issues are synced
- ❌ Can't pre-assign teams to future work
- ❌ Performance: requires joins across multiple tables

## 🎯 How Jira Actually Works

### Jira's Native Relationships:

1. **Project ← Issue** (Direct)
   - Every issue belongs to exactly ONE project
   - Project key is in the issue key (MOBILE-123)

2. **Board → Project** (Configuration)
   - Boards can be configured to show issues from:
     - One project
     - Multiple projects
     - Issues matching a JQL filter

3. **Board ← Sprint** (Direct)
   - Every sprint belongs to exactly ONE board

4. **Sprint ← Issue** (Assignment)
   - Issues can be added to sprints
   - Issues can move between sprints
   - Issues can be in no sprint (backlog)

5. **Epic ← Issue** (Epic Link)
   - Issues can belong to ONE epic
   - Epic link is a special field
   - Epics themselves are issues of type "Epic"

### What Jira DOESN'T Have:

- ❌ No "team" entity (boards are proxies)
- ❌ No explicit team ↔ project assignment
- ❌ No team ↔ epic ownership
- ❌ No capacity allocation tracking

## 💡 Recommended Approach

### For Your Current MVP: **Option 2 (Infer from Issues)**

**Why:**
1. No schema changes needed
2. Works with data you already have
3. Automatically accurate
4. Simpler to implement

**Implementation:**

Add these API endpoints:

```javascript
// GET /api/dashboard/team-projects
// Returns which teams work on which projects
app.get('/api/dashboard/team-projects', authenticateToken, async (req, res) => {
  const result = await pool.query(`
    SELECT 
      t.id as team_id,
      t.name as team_name,
      p.id as project_id,
      p.name as project_name,
      COUNT(DISTINCT i.id) as issue_count,
      COUNT(DISTINCT s.id) as sprint_count
    FROM teams t
    JOIN sprints s ON s.team_id = t.id
    JOIN issues i ON i.sprint_id = s.id
    JOIN projects p ON i.project_id = p.id
    WHERE t.jira_connection_id = $1
    GROUP BY t.id, p.id
    ORDER BY issue_count DESC
  `, [connectionId]);
  
  res.json({ teamProjects: result.rows });
});

// GET /api/dashboard/epic-teams
// Returns which teams work on which epics
app.get('/api/dashboard/epic-teams', authenticateToken, async (req, res) => {
  const result = await pool.query(`
    SELECT 
      e.id as epic_id,
      e.name as epic_name,
      t.id as team_id,
      t.name as team_name,
      COUNT(DISTINCT i.id) as issue_count,
      SUM(i.story_points) as story_points
    FROM epics e
    LEFT JOIN issues i ON i.epic_id = e.id
    LEFT JOIN sprints s ON i.sprint_id = s.id
    LEFT JOIN teams t ON s.team_id = t.id
    WHERE e.jira_connection_id = $1
    GROUP BY e.id, t.id
    HAVING COUNT(i.id) > 0
    ORDER BY story_points DESC
  `, [connectionId]);
  
  res.json({ epicTeams: result.rows });
});
```

### For Future (After Product-Market Fit): **Option 1 (Explicit Tables)**

**When to Add:**
- When users ask for manual team assignment
- When you need to plan future capacity
- When you want "what-if" scenarios

**Implementation:**
1. Add junction tables (team_projects, epic_teams)
2. Add UI for manual assignment
3. Sync automatically populates based on issues
4. Users can override/adjust allocations

## 📊 Current Data Flow

### What Currently Happens in Sync:

```
1. Fetch Projects from Jira
   ↓
   Store in `projects` table
   
2. Fetch Epics per Project
   ↓
   Store in `epics` table with project_id link ✅
   
3. Fetch Boards from Jira
   ↓
   Store in `teams` table (no project link) ⚠️
   
4. Fetch Sprints per Board
   ↓
   Store in `sprints` table with team_id link ✅
   
5. Issues are NOT currently synced ❌
   ↓
   This means we can't infer team-project relationships yet!
```

## 🚨 Critical Missing Piece

### **Issues are not being synced!**

This is why you can't currently show:
- Which teams work on which projects
- Which teams work on which epics
- Team velocity per project
- Epic progress by team

### To Fix: Add Issue Syncing

```javascript
// In the sync function, after syncing sprints:

// Sync issues
console.log('Syncing issues...');
for (const project of projects) {
  try {
    // Get all issues in project
    const issues = await jiraClient.getIssues(
      `project = ${project.key}`,
      ['summary', 'status', 'issuetype', 'assignee', 'sprint', 'epic']
    );
    
    for (const issue of issues) {
      // Find epic if exists
      let epicId = null;
      if (issue.fields.epic) {
        const epicResult = await pool.query(
          'SELECT id FROM epics WHERE jira_epic_key = $1',
          [issue.fields.epic.key]
        );
        epicId = epicResult.rows[0]?.id;
      }
      
      // Find sprint if exists
      let sprintId = null;
      if (issue.fields.sprint) {
        const sprintResult = await pool.query(
          'SELECT id FROM sprints WHERE jira_sprint_id = $1',
          [issue.fields.sprint.id.toString()]
        );
        sprintId = sprintResult.rows[0]?.id;
      }
      
      // Insert issue
      await pool.query(`
        INSERT INTO issues (
          jira_connection_id, project_id, epic_id, sprint_id,
          jira_issue_id, jira_issue_key, summary, 
          issue_type, status, assignee
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT DO NOTHING
      `, [
        connection.id, projectDbId, epicId, sprintId,
        issue.id, issue.key, issue.fields.summary,
        issue.fields.issuetype.name, issue.fields.status.name,
        issue.fields.assignee?.displayName || null
      ]);
    }
  } catch (error) {
    console.error(`Error syncing issues for ${project.key}:`, error);
  }
}
```

## 🎯 Summary

### Current State:

| Relationship | Status | Notes |
|-------------|--------|-------|
| Project → Epic | ✅ Direct link | Works perfectly |
| Team → Sprint | ✅ Direct link | Works perfectly |
| Sprint → Issue | ✅ Direct link | But issues not synced yet! |
| Issue → Epic | ✅ Direct link | But issues not synced yet! |
| Issue → Project | ✅ Direct link | But issues not synced yet! |
| **Team → Project** | ❌ No link | **Can be inferred from issues** |
| **Team → Epic** | ❌ No link | **Can be inferred from issues** |

### To Make It Work:

**Short term (This week):**
1. ✅ Add issue syncing to the sync function
2. ✅ Add API endpoints to query team-project relationships
3. ✅ Update frontend to show these relationships

**Long term (After PMF):**
1. Add explicit junction tables (team_projects, epic_teams)
2. Add UI for manual team assignment
3. Add capacity planning features

### Architecture Decision:

**I recommend: Infer from issues** (Option 2)

**Reasoning:**
- Simpler to implement
- Automatically accurate
- No manual data entry needed
- Matches how Jira actually works
- Can add explicit tables later if needed

Want me to:
1. Update the sync function to include issues?
2. Add the team-project relationship queries?
3. Add a visual dashboard showing team-project matrix?
4. Create a migration script for the junction tables?

Let me know which direction you want to go! 🚀
