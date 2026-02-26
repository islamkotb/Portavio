# 📊 How Data is Synced from Jira

This document explains exactly how the dashboard pulls data from Jira, including risks, blockers, and dependencies.

## 🔄 Automatic Sync Process

When you click "Sync" or call `/api/jira/sync`, the system automatically fetches:

### 1. Projects ✅
- **Source**: All accessible Jira projects via `/rest/api/3/project/search`
- **What's stored**: ID, key, name, description
- **Updates**: Names and descriptions on subsequent syncs

### 2. Epics ✅
- **Source**: JQL query per project: `project = {KEY} AND issuetype = Epic`
- **What's stored**: ID, key, name, status, project reference
- **Updates**: Status and name on subsequent syncs

### 3. Teams (Boards) ✅
- **Source**: All boards via `/rest/agile/1.0/board`
- **What's stored**: Board ID, name (treated as team name)
- **Note**: Capacity, velocity, and load are calculated separately

### 4. Sprints ✅
- **Source**: Sprints per board via `/rest/agile/1.0/board/{id}/sprint`
- **What's stored**: Sprint ID, name, state, dates, goal
- **Updates**: State changes on subsequent syncs

### 5. **Risks** ⚠️ (NEW - Automatically Detected)

**How Jira Risks are Identified:**

The system looks for issues matching ANY of these criteria:

1. **Labels**: Contains `risk`, `risk-high`, `risk-medium`, `risk-low`, or `RISK`
2. **Issue Type**: Issue type is "Risk" (if your Jira has this custom type)
3. **Summary**: Starts with "RISK" (e.g., "RISK: Data breach potential")
4. **Priority**: Set to "Highest" (as these often indicate risks)

**JQL Query Used:**
```jql
(labels IN (risk, risk-high, risk-medium, risk-low, RISK) OR 
 issuetype = Risk OR 
 summary ~ "RISK*" OR 
 priority = Highest) AND 
 resolution = Unresolved
```

**Severity Mapping:**
- **High**: Priority = "Highest" or "Critical", or label = `risk-high`
- **Medium**: Priority = "High", or label = `risk-medium`, or default
- **Low**: Label = `risk-low`

**What's Stored:**
- Title (from issue summary)
- Description (from issue description)
- Severity (calculated from priority/labels)
- Status (open/closed based on resolution)
- Project reference
- Date identified

**Example - How to Mark Risks in Jira:**

Option 1: Add a label
```
Issue: "Security vulnerability in payment system"
Label: risk-high
```

Option 2: Set priority
```
Issue: "Potential delays in Q3 delivery"
Priority: Highest
```

Option 3: Prefix summary
```
Issue: "RISK: Dependency on third-party API"
```

### 6. **Blockers** 🚫 (NEW - Automatically Detected)

**How Jira Blockers are Identified:**

The system looks for issues matching ANY of these criteria:

1. **Status**: Status is "Blocked"
2. **Labels**: Contains `blocked`, `blocker`, `impediment`, or `BLOCKED`
3. **Flagged**: Issue is flagged (impediment marker)

**JQL Query Used:**
```jql
(status = Blocked OR 
 labels IN (blocked, blocker, impediment, BLOCKED) OR 
 flagged IS NOT EMPTY) AND 
 resolution = Unresolved
```

**What's Stored:**
- Title (from issue summary)
- Description (from issue description)
- Status (active/resolved)
- Team reference (if determinable)
- Issue reference
- Date blocked (from created date)

**Example - How to Mark Blockers in Jira:**

Option 1: Change status
```
Issue: "Cannot deploy without infrastructure"
Status: Blocked
```

Option 2: Add a label
```
Issue: "Waiting for legal approval"
Label: blocked
```

Option 3: Flag the issue
```
Issue: "Team waiting on external dependency"
Flag: Set impediment flag
```

### 7. **Dependencies** 🔗 (NEW - Automatically Detected)

**How Jira Dependencies are Identified:**

The system analyzes **issue links** between epics:

1. Fetches all issues in each project with their links
2. Filters for Epic-to-Epic links
3. Maps link types to dependency types

**Link Type Mapping:**
- "Blocks" → `blocks`
- "Is blocked by" → `depends-on`
- "Depends on" → `depends-on`
- "Requires" → `requires`
- Other links → `relates-to`

**What's Stored:**
- Source epic
- Target epic
- Dependency type
- Status (active/inactive)
- Description (link type name)

**Example - How to Create Dependencies in Jira:**

1. Open Epic A
2. Click "Link" or "Link Issue"
3. Select link type: "Blocks" or "Depends on"
4. Choose Epic B
5. System will automatically detect this in next sync

```
Epic: "Mobile App Redesign"
  Blocks → Epic: "API Gateway Implementation"
  Depends on → Epic: "User Authentication"
```

## 🎯 What Gets Synced vs. What Doesn't

### ✅ Automatically Synced:
- Projects
- Epics (with status)
- Boards/Teams
- Sprints (with state)
- **Risks** (based on labels/priority/issue type)
- **Blockers** (based on status/labels/flags)
- **Dependencies** (from epic-to-epic links)

### ❌ NOT Automatically Synced (Yet):
- Individual issues/stories (only epics)
- Story points (would need custom field mapping)
- Team members
- Velocity calculations (done from sprint data)
- Predictability scores (calculated from velocity)
- Timeline events (manual entry)
- Comments or attachments

## 🔧 Customizing Risk/Blocker Detection

### Want Different Risk Criteria?

Edit the `getRisks()` method in `backend/server.js`:

```javascript
async getRisks() {
  // Your custom JQL
  const jql = `labels = your-risk-label AND status != Closed`;
  
  const response = await this.client.get('/search', {
    params: { jql, maxResults: 100, fields: 'summary,description,priority' }
  });
  return response.data.issues || [];
}
```

### Want Different Blocker Criteria?

Edit the `getBlockers()` method in `backend/server.js`:

```javascript
async getBlockers() {
  // Your custom JQL
  const jql = `status IN (Blocked, Impediment) AND resolution = Unresolved`;
  
  const response = await this.client.get('/search', {
    params: { jql, maxResults: 100, fields: 'summary,description,status' }
  });
  return response.data.issues || [];
}
```

### Want to Track Timeline Events?

You could sync from Jira Releases:

```javascript
async getTimelineFromReleases(projectKey) {
  const response = await this.client.get(`/project/${projectKey}/versions`);
  return response.data.map(version => ({
    title: version.name,
    date: version.releaseDate,
    status: version.released ? 'completed' : 'planned'
  }));
}
```

## 📈 Performance Considerations

### Current Limitations:
- Max 1,000 issues per query (Jira limit)
- Sync is sequential (not parallel)
- No incremental sync (fetches everything)

### First Sync Timing:
- Small org (5 projects): ~30 seconds
- Medium org (20 projects): ~2 minutes
- Large org (50+ projects): ~5-10 minutes

### Recommendations:
1. Run sync during off-hours for large orgs
2. Consider cron job for scheduled syncs
3. For 100+ projects, implement batching

## 🐛 Troubleshooting Sync Issues

### Risks Not Appearing?

**Check:**
1. Do your Jira issues have the right labels? (`risk`, `risk-high`, etc.)
2. Is priority set to "Highest"?
3. Are issues resolved? (Only unresolved issues synced)
4. Check backend logs for errors

**Fix:**
- Add labels to existing issues in Jira
- Create a custom issue type "Risk"
- Adjust the JQL query to match your workflow

### Blockers Not Appearing?

**Check:**
1. Is there a "Blocked" status in your workflow?
2. Are issues labeled with `blocked` or `blocker`?
3. Are issues flagged?

**Fix:**
- Add "Blocked" status to your workflow
- Add labels to blocked issues
- Use the impediment flag feature

### Dependencies Not Appearing?

**Check:**
1. Are you linking **Epics** to other **Epics**?
2. Are link types configured? (Blocks, Depends on, etc.)
3. Do both epics exist in synced projects?

**Fix:**
- Link epics using "Link Issue" feature
- Use standard link types (Blocks, Depends on)
- Ensure both epics are in the same sync scope

### Nothing Syncing?

**Check:**
1. Jira connection valid? (test at `/api/jira/status`)
2. API token not expired?
3. User has permission to view projects?
4. Backend logs showing errors?

**Fix:**
- Regenerate API token
- Check user permissions in Jira
- Review backend console output
- Test connection with simple JQL in Jira

## 🔮 Future Enhancements

Possible improvements:

1. **Incremental Sync**: Only fetch changed items since last sync
2. **Parallel Fetching**: Speed up with Promise.all()
3. **Custom Field Mapping**: UI for mapping Jira custom fields
4. **Webhooks**: Real-time updates from Jira
5. **Batch Processing**: Handle 1000+ projects efficiently
6. **Story Point Sync**: Auto-detect story points field
7. **Time Tracking**: Import logged hours
8. **Sprint Velocity**: Calculate from completed stories

## 📞 Need Help?

If sync isn't working as expected:

1. Check Jira permissions
2. Review JQL queries in `server.js`
3. Check backend console logs
4. Test JQL directly in Jira
5. Verify API token is valid
6. Check network connectivity

---

**Now you know exactly where everything comes from! 🎯**
