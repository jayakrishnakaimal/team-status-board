/**
 * headless-summary.js
 * 
 * Headless Manager Briefing Tool
 * Direct command-line utility to aggregate, analyze, and summarize 
 * team status, blockers, in-progress tasks, and active conversation threads (Slack/Figma/Jira/Boxnotes).
 * 
 * Usage: node headless-summary.js
 */

const Database = require('better-sqlite3');
const path = require('path');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m'
};

const db = new Database(path.join(__dirname, 'team_status.db'));

// Fetch all members, status updates, and sources
const members = db.prepare('SELECT * FROM team_members ORDER BY name').all();
const dailyUpdates = db.prepare(`
  SELECT su.*, tm.name as member_name
  FROM status_updates su
  JOIN team_members tm ON su.member_id = tm.id
  WHERE su.type = 'daily'
  ORDER BY su.submitted_at DESC
`).all();

const weeklyUpdates = db.prepare(`
  SELECT su.*, tm.name as member_name
  FROM status_updates su
  JOIN team_members tm ON su.member_id = tm.id
  WHERE su.type = 'weekly'
  ORDER BY su.submitted_at DESC
`).all();

const sources = db.prepare(`
  SELECT ss.*, su.member_id, su.type as update_type
  FROM status_sources ss
  JOIN status_updates su ON ss.status_id = su.id
`).all();

// Map sources to statuses
const sourcesMap = {};
sources.forEach(s => {
  if (!sourcesMap[s.status_id]) sourcesMap[s.status_id] = [];
  sourcesMap[s.status_id].push(s);
});

// Group active statuses by member (get the latest for each member)
const memberStatus = {};
members.forEach(m => {
  memberStatus[m.id] = {
    member: m,
    daily: dailyUpdates.find(u => u.member_id === m.id),
    weekly: weeklyUpdates.find(u => u.member_id === m.id)
  };
});

// Calculate statistics
const totalMembers = members.length;
const submittedDailyCount = dailyUpdates.length;
const submittedWeeklyCount = weeklyUpdates.length;

const activeBlockers = [];
dailyUpdates.concat(weeklyUpdates).forEach(u => {
  if (u.blockers && u.blockers.trim() !== '' && u.blockers.toLowerCase() !== 'none') {
    activeBlockers.push({
      member_name: u.member_name,
      type: u.type,
      blocker: u.blockers.trim(),
      status_id: u.id
    });
  }
});

// Print Headless Dashboard Report
console.log(`\n${colors.bright}${colors.cyan}========================================================================${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}             IKIGAI UX - HEADLESS MANAGER BRIEFING REPORT               ${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}========================================================================${colors.reset}\n`);

// ── 1. EXECUTIVE SUMMARY ──────────────────────────────────────────────────
console.log(`${colors.bright}${colors.yellow}📊 1. EXECUTIVE SUMMARY${colors.reset}`);
console.log(`${colors.dim}------------------------------------------------------------------------${colors.reset}`);
console.log(`• ${colors.bright}Team Size:${colors.reset} ${totalMembers} Active Contributors`);
console.log(`• ${colors.bright}Daily Submissions:${colors.reset} ${submittedDailyCount}/${totalMembers} logged today`);
console.log(`• ${colors.bright}Weekly Summaries:${colors.reset} ${submittedWeeklyCount}/${totalMembers} logged this week`);
console.log(`• ${colors.bright}Key Workstream:${colors.reset} ${colors.blue}IKIGAI UX Alignment (Carbon 11 Standard)${colors.reset}`);
console.log(`• ${colors.bright}Active Core Focuses:${colors.reset}`);
console.log(`  - UX/Design Wireframing & Grid Alignments (Ashraf, Jayakrishna)`);
console.log(`  - Backend REST API Status History Mapping & SQL Optimization (Divine, Abhiram)`);
console.log(`  - Security Vulnerability Remediation & Compliance Verification (Mahima)`);
console.log(`  - Test Framework & Regression Suite Automation Deployment (Shagun)`);
console.log(`  - Data Indexing Schema Planning & Benchmarking (Drron Sharma)`);
console.log();

// ── 2. ACTIVE BLOCKERS (CRITICAL) ─────────────────────────────────────────
console.log(`${colors.bright}${colors.red}🛑 2. ACTIVE BLOCKERS & IMPEDIMENTS${colors.reset}`);
console.log(`${colors.dim}------------------------------------------------------------------------${colors.reset}`);

if (activeBlockers.length === 0) {
  console.log(`${colors.green}✔ No critical blockers reported across the team!${colors.reset}\n`);
} else {
  activeBlockers.forEach((b, idx) => {
    console.log(`${idx + 1}. [${b.type.toUpperCase()}] ${colors.bright}${b.member_name}${colors.reset}`);
       console.log(`   ${colors.bgRed}${colors.bright} BLOCKER ${colors.reset} ${colors.red}${b.blocker}${colors.reset}`);
       // Find links for this blocker's status
       const sList = sourcesMap[b.status_id] || [];
       if (sList.length > 0) {
         console.log(`   ${colors.dim}Relevant threads for coordination:${colors.reset}`);
         sList.forEach(s => {
           console.log(`     - [${s.source_type.toUpperCase()}] ${colors.underline}${s.url}${colors.reset}`);
         });
       }
       console.log();
  });
}

// ── 3. TEAM WORKSTREAM DRILLDOWN ──────────────────────────────────────────
console.log(`${colors.bright}${colors.green}👥 3. TEAM MEMBER TASKS & PROGRESS${colors.reset}`);
console.log(`${colors.dim}------------------------------------------------------------------------${colors.reset}`);

members.forEach(m => {
  const status = memberStatus[m.id];
  console.log(`\n${colors.bright}• ${m.name} (${colors.cyan}${m.email}${colors.reset})`);
  
  // Daily status
  if (status.daily) {
    const d = status.daily;
    const dSources = sourcesMap[d.id] || [];
    console.log(`  ${colors.bright}${colors.green}[DAILY]${colors.reset}`);
    console.log(`    ${colors.bright}Done :${colors.reset} ${d.done}`);
    console.log(`    ${colors.bright}Doing:${colors.reset} ${colors.yellow}${d.doing}${colors.reset}`);
    if (d.blockers && d.blockers.toLowerCase() !== 'none') {
      console.log(`    ${colors.red}Block:${colors.reset} ${colors.red}${d.blockers}${colors.reset}`);
    }
    if (d.plan) {
      console.log(`    ${colors.bright}Next :${colors.reset} ${d.plan}`);
    }
    if (dSources.length > 0) {
      console.log(`    ${colors.bright}Links:${colors.reset} ` + dSources.map(s => `[${s.source_type.toUpperCase()}] ${s.label}`).join(' | '));
    }
  } else {
    console.log(`  ${colors.dim}[DAILY] No daily status logged for today.${colors.reset}`);
  }

  // Weekly status
  if (status.weekly) {
    const w = status.weekly;
    const wSources = sourcesMap[w.id] || [];
    console.log(`  ${colors.bright}${colors.blue}[WEEKLY]${colors.reset}`);
    console.log(`    ${colors.bright}Achieved this week:${colors.reset} ${w.done}`);
    console.log(`    ${colors.bright}Planned next week :${colors.reset} ${colors.cyan}${w.doing}${colors.reset}`);
    if (wSources.length > 0) {
      console.log(`    ${colors.bright}Weekly Sources     :${colors.reset} ` + wSources.map(s => `[${s.source_type.toUpperCase()}] ${s.label}`).join(' | '));
    }
  } else {
    console.log(`  ${colors.dim}[WEEKLY] No weekly summary logged for this week.${colors.reset}`);
  }
});
console.log('\n');

// ── 4. WORKSPACE CONVERSATIONS & DIRECTORY ─────────────────────────────────
console.log(`${colors.bright}${colors.magenta}💬 4. CONVERSATIONS & WORKSPACE DIRECTORY${colors.reset}`);
console.log(`${colors.dim}------------------------------------------------------------------------${colors.reset}`);
console.log(`${colors.dim}Grouped reference links mapping exactly to your active team workspace channels:${colors.reset}\n`);

// Aggregate unique sources across database
const allUniqueSources = {};
sources.forEach(s => {
  allUniqueSources[s.url] = {
    type: s.source_type,
    label: s.label,
    notes: s.notes
  };
});

const groupedSources = {
  boxnotes: [],
  figma: [],
  jira: [],
  slack: []
};

Object.keys(allUniqueSources).forEach(url => {
  const s = allUniqueSources[url];
  if (groupedSources[s.type]) {
    groupedSources[s.type].push({ url, label: s.label, notes: s.notes });
  }
});

// Render grouped directories
console.log(`💬 ${colors.bright}SLACK COORDINATION CHANNELS & THREADS:${colors.reset}`);
groupedSources.slack.forEach(s => {
  console.log(`  • ${colors.bright}${s.label}${colors.reset} - ${colors.dim}${s.notes}${colors.reset}`);
  console.log(`    URL: ${colors.underline}${s.url}${colors.reset}`);
});
console.log();

console.log(`🎨 ${colors.bright}FIGMA WORKSPACE DIRECTORY:${colors.reset}`);
groupedSources.figma.forEach(s => {
  console.log(`  • ${colors.bright}${s.label}${colors.reset} - ${colors.dim}${s.notes}${colors.reset}`);
  console.log(`    URL: ${colors.underline}${s.url}${colors.reset}`);
});
console.log();

console.log(`🎫 ${colors.bright}JIRA WORKSTREAM TRACKING:${colors.reset}`);
groupedSources.jira.forEach(s => {
  console.log(`  • ${colors.bright}${s.label}${colors.reset} - ${colors.dim}${s.notes}${colors.reset}`);
  console.log(`    URL: ${colors.underline}${s.url}${colors.reset}`);
});
console.log();

console.log(`📝 ${colors.bright}SHARED TEAM BOXNOTES:${colors.reset}`);
groupedSources.boxnotes.forEach(s => {
  console.log(`  • ${colors.bright}${s.label}${colors.reset} - ${colors.dim}${s.notes}${colors.reset}`);
  console.log(`    URL: ${colors.underline}${s.url}${colors.reset}`);
});

console.log(`\n${colors.bright}${colors.cyan}========================================================================${colors.reset}\n`);
db.close();
