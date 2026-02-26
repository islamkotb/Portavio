-- =============================================================================
-- Portavio - Complete Database Schema (Option 2)
-- Explicit many-to-many relationships between Teams, Projects, and Epics
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CORE AUTH TABLES
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jira_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    jira_url VARCHAR(255) NOT NULL,
    jira_email VARCHAR(255) NOT NULL,
    jira_api_token TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_sync TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- -----------------------------------------------------------------------------
-- CORE DOMAIN TABLES
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    jira_connection_id INTEGER REFERENCES jira_connections(id) ON DELETE CASCADE,
    jira_team_id VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    capacity INTEGER DEFAULT 0,
    velocity INTEGER DEFAULT 0,
    current_load INTEGER DEFAULT 0,
    predictability_score DECIMAL(5,2) DEFAULT 0,
    member_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(jira_connection_id, jira_team_id)
);

CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    jira_connection_id INTEGER REFERENCES jira_connections(id) ON DELETE CASCADE,
    jira_project_id VARCHAR(255) NOT NULL,
    jira_project_key VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    health VARCHAR(50) DEFAULT 'on-track',
    description TEXT,
    start_date DATE,
    target_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(jira_connection_id, jira_project_id)
);

CREATE TABLE IF NOT EXISTS epics (
    id SERIAL PRIMARY KEY,
    jira_connection_id INTEGER REFERENCES jira_connections(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    jira_epic_id VARCHAR(255) NOT NULL,
    jira_epic_key VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'planned',
    progress INTEGER DEFAULT 0,
    total_story_points INTEGER DEFAULT 0,
    completed_story_points INTEGER DEFAULT 0,
    start_date DATE,
    due_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(jira_connection_id, jira_epic_id)
);

CREATE TABLE IF NOT EXISTS sprints (
    id SERIAL PRIMARY KEY,
    jira_connection_id INTEGER REFERENCES jira_connections(id) ON DELETE CASCADE,
    team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    jira_sprint_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    state VARCHAR(50) DEFAULT 'future',
    start_date DATE,
    end_date DATE,
    goal TEXT,
    committed_points INTEGER DEFAULT 0,
    completed_points INTEGER DEFAULT 0,
    velocity INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(jira_connection_id, jira_sprint_id)
);

CREATE TABLE IF NOT EXISTS issues (
    id SERIAL PRIMARY KEY,
    jira_connection_id INTEGER REFERENCES jira_connections(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    epic_id INTEGER REFERENCES epics(id) ON DELETE SET NULL,
    sprint_id INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
    jira_issue_id VARCHAR(255) NOT NULL,
    jira_issue_key VARCHAR(50) NOT NULL,
    summary VARCHAR(500) NOT NULL,
    issue_type VARCHAR(50) NOT NULL,
    status VARCHAR(100) NOT NULL,
    priority VARCHAR(50),
    story_points INTEGER DEFAULT 0,
    assignee_name VARCHAR(255),
    assignee_account_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(jira_connection_id, jira_issue_id)
);

-- -----------------------------------------------------------------------------
-- JUNCTION TABLES — Teams <-> Projects <-> Epics (Option 2)
-- -----------------------------------------------------------------------------

-- Which teams work on which projects, and how
CREATE TABLE IF NOT EXISTS team_projects (
    id SERIAL PRIMARY KEY,
    team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT false,
    allocation_percentage INTEGER DEFAULT 100 CHECK (allocation_percentage BETWEEN 0 AND 100),
    role VARCHAR(100) DEFAULT 'Development',
    auto_assigned BOOLEAN DEFAULT true,   -- true = inferred from issues, false = manual override
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, project_id)
);

-- Which teams own or contribute to which epics
CREATE TABLE IF NOT EXISTS epic_teams (
    id SERIAL PRIMARY KEY,
    epic_id INTEGER REFERENCES epics(id) ON DELETE CASCADE,
    team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    is_owner BOOLEAN DEFAULT false,
    contribution_percentage INTEGER DEFAULT 0 CHECK (contribution_percentage BETWEEN 0 AND 100),
    story_points_allocated INTEGER DEFAULT 0,
    story_points_completed INTEGER DEFAULT 0,
    auto_assigned BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(epic_id, team_id)
);

-- -----------------------------------------------------------------------------
-- RELATIONSHIP & ANALYTICS TABLES
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dependencies (
    id SERIAL PRIMARY KEY,
    jira_connection_id INTEGER REFERENCES jira_connections(id) ON DELETE CASCADE,
    source_epic_id INTEGER REFERENCES epics(id) ON DELETE CASCADE,
    target_epic_id INTEGER REFERENCES epics(id) ON DELETE CASCADE,
    dependency_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_epic_id, target_epic_id, dependency_type)
);

CREATE TABLE IF NOT EXISTS risks (
    id SERIAL PRIMARY KEY,
    jira_connection_id INTEGER REFERENCES jira_connections(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    jira_issue_key VARCHAR(50),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(50) DEFAULT 'medium',
    status VARCHAR(50) DEFAULT 'open',
    impact TEXT,
    mitigation_plan TEXT,
    identified_date DATE DEFAULT CURRENT_DATE,
    auto_detected BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blockers (
    id SERIAL PRIMARY KEY,
    jira_connection_id INTEGER REFERENCES jira_connections(id) ON DELETE CASCADE,
    issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
    team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    epic_id INTEGER REFERENCES epics(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    jira_issue_key VARCHAR(50),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    blocked_since DATE DEFAULT CURRENT_DATE,
    resolved_date DATE,
    auto_detected BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS timeline_events (
    id SERIAL PRIMARY KEY,
    jira_connection_id INTEGER REFERENCES jira_connections(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    epic_id INTEGER REFERENCES epics(id) ON DELETE SET NULL,
    team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    event_type VARCHAR(50) DEFAULT 'milestone',
    status VARCHAR(50) DEFAULT 'planned',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS velocity_history (
    id SERIAL PRIMARY KEY,
    team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    sprint_id INTEGER REFERENCES sprints(id) ON DELETE CASCADE,
    committed_points INTEGER DEFAULT 0,
    completed_points INTEGER DEFAULT 0,
    velocity INTEGER DEFAULT 0,
    sprint_start_date DATE,
    sprint_end_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, sprint_id)
);

CREATE TABLE IF NOT EXISTS predictability_metrics (
    id SERIAL PRIMARY KEY,
    team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    calculation_date DATE DEFAULT CURRENT_DATE,
    completed_vs_committed_ratio DECIMAL(5,2),
    velocity_variance DECIMAL(10,2),
    predictability_score DECIMAL(5,2),
    sprint_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- INDEXES
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_jira_connections_user_id ON jira_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_teams_jira_connection_id ON teams(jira_connection_id);
CREATE INDEX IF NOT EXISTS idx_projects_jira_connection_id ON projects(jira_connection_id);
CREATE INDEX IF NOT EXISTS idx_epics_project_id ON epics(project_id);
CREATE INDEX IF NOT EXISTS idx_epics_jira_connection_id ON epics(jira_connection_id);
CREATE INDEX IF NOT EXISTS idx_sprints_team_id ON sprints(team_id);
CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_epic_id ON issues(epic_id);
CREATE INDEX IF NOT EXISTS idx_issues_sprint_id ON issues(sprint_id);
CREATE INDEX IF NOT EXISTS idx_issues_jira_connection_id ON issues(jira_connection_id);
CREATE INDEX IF NOT EXISTS idx_team_projects_team_id ON team_projects(team_id);
CREATE INDEX IF NOT EXISTS idx_team_projects_project_id ON team_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_epic_teams_epic_id ON epic_teams(epic_id);
CREATE INDEX IF NOT EXISTS idx_epic_teams_team_id ON epic_teams(team_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_source ON dependencies(source_epic_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_target ON dependencies(target_epic_id);
CREATE INDEX IF NOT EXISTS idx_risks_project_id ON risks(project_id);
CREATE INDEX IF NOT EXISTS idx_blockers_team_id ON blockers(team_id);
CREATE INDEX IF NOT EXISTS idx_blockers_epic_id ON blockers(epic_id);
CREATE INDEX IF NOT EXISTS idx_velocity_history_team_id ON velocity_history(team_id);

-- -----------------------------------------------------------------------------
-- VIEWS — Pre-built queries for dashboard
-- -----------------------------------------------------------------------------

-- Portfolio-level project view
CREATE OR REPLACE VIEW v_project_overview AS
SELECT
    p.id AS project_id,
    p.jira_connection_id,
    p.name AS project_name,
    p.jira_project_key,
    p.health,
    p.status,
    p.target_date,
    COUNT(DISTINCT tp.team_id)              AS team_count,
    COUNT(DISTINCT e.id)                    AS epic_count,
    COALESCE(ROUND(AVG(e.progress)), 0)     AS avg_epic_progress,
    COALESCE(SUM(e.total_story_points), 0)  AS total_story_points,
    COALESCE(SUM(e.completed_story_points), 0) AS completed_story_points,
    COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'open' AND r.severity IN ('high','critical')) AS open_high_risks,
    COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'active') AS active_blockers
FROM projects p
LEFT JOIN team_projects tp  ON tp.project_id = p.id
LEFT JOIN epics e           ON e.project_id  = p.id
LEFT JOIN risks r           ON r.project_id  = p.id
LEFT JOIN blockers b        ON b.project_id  = p.id
GROUP BY p.id;

-- Team-level summary view
CREATE OR REPLACE VIEW v_team_overview AS
SELECT
    t.id AS team_id,
    t.jira_connection_id,
    t.name AS team_name,
    t.velocity,
    t.capacity,
    t.current_load,
    t.predictability_score,
    t.member_count,
    COUNT(DISTINCT tp.project_id)           AS project_count,
    COUNT(DISTINCT et.epic_id)              AS epic_count,
    COALESCE(SUM(et.story_points_allocated), 0)  AS total_allocated_points,
    COALESCE(SUM(et.story_points_completed), 0)  AS total_completed_points,
    COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'active') AS active_blockers
FROM teams t
LEFT JOIN team_projects tp  ON tp.team_id = t.id
LEFT JOIN epic_teams et     ON et.team_id = t.id
LEFT JOIN blockers b        ON b.team_id  = t.id
GROUP BY t.id;

-- Epic health view including team ownership and dependency count
CREATE OR REPLACE VIEW v_epic_overview AS
SELECT
    e.id AS epic_id,
    e.jira_connection_id,
    e.name AS epic_name,
    e.jira_epic_key,
    e.status,
    e.progress,
    e.total_story_points,
    e.completed_story_points,
    e.due_date,
    p.name AS project_name,
    p.health AS project_health,
    p.jira_project_key,
    owner_t.name AS owner_team_name,
    COUNT(DISTINCT et.team_id)              AS contributing_team_count,
    COUNT(DISTINCT d_out.id)               AS blocks_count,
    COUNT(DISTINCT d_in.id)                AS blocked_by_count,
    COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'active') AS active_blockers
FROM epics e
JOIN    projects p      ON e.project_id = p.id
LEFT JOIN epic_teams et         ON et.epic_id = e.id
LEFT JOIN epic_teams et_owner   ON et_owner.epic_id = e.id AND et_owner.is_owner = true
LEFT JOIN teams owner_t         ON et_owner.team_id = owner_t.id
LEFT JOIN dependencies d_out    ON d_out.source_epic_id = e.id AND d_out.status = 'active'
LEFT JOIN dependencies d_in     ON d_in.target_epic_id  = e.id AND d_in.status = 'active'
LEFT JOIN blockers b            ON b.epic_id = e.id
GROUP BY e.id, p.id, owner_t.id;
