/**
 * headless-summary.js
 * 
 * Headless Manager Briefing Tool
 * Direct command-line utility to aggregate, analyze, and summarize 
 * design squad status, leave availability, blockers, in-progress tasks,
 * and active conversation threads (Slack/Figma/Jira/Boxnotes).
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

// Fetch all members, status updates, sources, and availability
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

const availRows = db.prepare(`
  SELECT ra.*, tm.name as member_name
  FROM resource_availability ra
  JOIN team_members tm ON ra.member_id = tm.id
  ORDER BY ra.created_at DESC
`).all();

const latestAvail = {};
availRows.forEach(r => {
  if (!latestAvail[r.member_id]) latestAvail[r.member_id] = r;
});

// Map sources to statuses
const sourcesMap = {};
sources.forEach(s => {
  if (!sourcesMap[s.status_id]) sourcesMap[s.status_id] = [];
  sourcesMap[s.status_id].push(s);
});

// Group active statuses by member
const memberStatus = {};
members.forEach(m => {
  memberStatus[m.id] = {
    member: m,
    daily: dailyUpdates.find(u => u.member_id === m.id),
    weekly: weeklyUpdates.find(u => u.member_id === m.id),
    avail: latestAvail[m.id]
  };
});

// Calculate statistics
const totalMembers = members.length;
const submittedDailyCount = dailyUpdates.length;
const submittedWeeklyCount = weeklyUpdates.length;

let inOfficeCount = 0, wfhCount = 0, onLeaveCount = 0;
members.forEach(m => {
  const av = latestAvail[m.id];
  const mode = av ? av.work_mode : 'in_office';
  if (mode === 'in_office') inOfficeCount++;
  else if (mode === 'wfh') wfhCount++;
  else if (mode === 'on_leave') onLeaveCount++;
});

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
console.log(`${colors.bright}${colors.cyan}   IBM DesignPulse - WATSONX AI DESIGN OPERATIONS EXECUTIVE BRIEFING    ${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}========================================================================${colors.reset}\n`);

// ── 1. EXECUTIVE SUMMARY ──────────────────────────────────────────────────
console.log(`${colors.bright}${colors.yellow}📊 1. EXECUTIVE SUMMARY & ROSTER${colors.reset}`);
console.log(`${colors.dim}------------------------------------------------------------------------${colors.reset}`);
console.log(`• ${colors.bright}Design Squad:${colors.reset} ${totalMembers} Active Designers`);
console.log(`• ${colors.bright}Daily Submissions:${colors.reset} ${submittedDailyCount}/${totalMembers} logged today (${Math.round((submittedDailyCount/totalMembers)*100)}%)`);
console.log(`• ${colors.bright}Weekly Summaries:${colors.reset} ${submittedWeeklyCount}/${totalMembers} logged this week`);
console.log(`• ${colors.bright}Design System Standard:${colors.reset} ${colors.blue}IBM Carbon Design System v11 (Dark Theme g100/g90)${colors.reset}`);
console.log();

// ── 2. LEAVE & RESOURCE AVAILABILITY ──────────────────────────────────────
console.log(`${colors.bright}${colors.green}🌴 2. LEAVE & RESOURCE AVAILABILITY BREAKDOWN${colors.reset}`);
console.log(`${colors.dim}------------------------------------------------------------------------${colors.reset}`);
console.log(`• ${colors.bright}🏢 In Office (Studio):${colors.reset} ${inOfficeCount} designers`);
console.log(`• ${colors.bright}🏠 Working From Home (WFH):${colors.reset} ${wfhCount} designers`);
console.log(`• ${colors.bright}🌴 On Leave / Vacation (PTO):${colors.reset} ${onLeaveCount} designers\n`);

members.forEach(m => {
  const av = latestAvail[m.id];
  const mode = av ? av.work_mode : 'in_office';
  const note = av ? av.location_note : 'In Office';
  const tag = mode === 'in_office' ? `${colors.green}[IN OFFICE]${colors.reset}` :
              mode === 'wfh' ? `${colors.blue}[WFH REMOTE]${colors.reset}` :
              `${colors.yellow}[ON LEAVE]${colors.reset}`;
  console.log(`  ${tag} ${colors.bright}${m.name}${colors.reset} - ${colors.dim}${note}${colors.reset}`);
});
console.log();

// ── 3. ACTIVE BLOCKERS (CRITICAL) ─────────────────────────────────────────
console.log(`${colors.bright}${colors.red}🛑 3. ACTIVE DESIGN BLOCKERS & RISKS${colors.reset}`);
console.log(`${colors.dim}------------------------------------------------------------------------${colors.reset}`);

if (activeBlockers.length === 0) {
  console.log(`${colors.green}✔ No critical blockers reported across the design squad!${colors.reset}\n`);
} else {
  activeBlockers.forEach((b, idx) => {
    console.log(`${idx + 1}. [${b.type.toUpperCase()}] ${colors.bright}${b.member_name}${colors.reset}`);
    console.log(`   ${colors.bgRed}${colors.bright} BLOCKER ${colors.reset} ${colors.red}${b.blocker}${colors.reset}`);
  });
  console.log();
}

// ── 4. INDIVIDUAL DESIGN DELIVERABLES ────────────────────────────────────
console.log(`${colors.bright}${colors.cyan}👤 4. INDIVIDUAL DESIGN SQUAD DELIVERABLES${colors.reset}`);
console.log(`${colors.dim}------------------------------------------------------------------------${colors.reset}`);

members.forEach((m, idx) => {
  const data = memberStatus[m.id];
  console.log(`\n${colors.bright}${idx + 1}. ${m.name}${colors.reset} (${colors.dim}${m.email || 'N/A'}${colors.reset})`);

  if (data.daily) {
    console.log(`   ${colors.green}✔ Done:${colors.reset} ${data.daily.done}`);
    console.log(`   ${colors.blue}⚡ Doing:${colors.reset} ${data.daily.doing}`);
    if (data.daily.plan && data.daily.plan.toLowerCase() !== 'none') {
      console.log(`   ${colors.magenta}📅 Plan:${colors.reset} ${data.daily.plan}`);
    }
  } else {
    console.log(`   ${colors.yellow}⏳ Daily status pending for today.${colors.reset}`);
  }
});

console.log(`\n${colors.bright}${colors.cyan}========================================================================${colors.reset}\n`);
