const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'team_status.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS status_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('daily', 'weekly')),
    done TEXT NOT NULL,
    doing TEXT NOT NULL,
    blockers TEXT DEFAULT '',
    plan TEXT DEFAULT '',
    week_start DATE,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(member_id) REFERENCES team_members(id)
  );

  CREATE TABLE IF NOT EXISTS status_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status_id INTEGER NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('boxnotes','figma','aha','jira','slack')),
    label TEXT,
    url TEXT,
    notes TEXT,
    FOREIGN KEY(status_id) REFERENCES status_updates(id)
  );
`);

// Clean up old default seed data if present (or incorrect format)
const oldSeedCheck = db.prepare("SELECT COUNT(*) as c FROM team_members WHERE name IN ('Alice Johnson', 'Drron Sharma')").get();
if (oldSeedCheck && oldSeedCheck.c > 0) {
  db.exec(`
    DELETE FROM status_sources;
    DELETE FROM status_updates;
    DELETE FROM team_members;
    DELETE FROM sqlite_sequence WHERE name IN ('team_members', 'status_updates', 'status_sources');
  `);
}

const count = db.prepare('SELECT COUNT(*) as c FROM team_members').get();
if (count.c === 0) {
  const ins = db.prepare('INSERT INTO team_members (name, email) VALUES (?, ?)');
  ins.run('Abhiram C S', 'abhiram.cs@ibm.com');
  ins.run('Ashraf L', 'Ashraf.L@ibm.com');
  ins.run('Divine Antony', 'divineantony@ibm.com');
  ins.run('Drron Sharma', 'drronsharma@ibm.com');
  ins.run('Jayakrishna Kaimal', 'jayakrishna.kaimal@ibm.com');
  ins.run('Mahima Shrivastava', 'Mahima.Shrivastava@ibm.com');
  ins.run('Shagun Bajpai', 'Shagun.Bajpai@ibm.com');
}

// Seed Boxnotes and initial status updates if empty
const statusCount = db.prepare('SELECT COUNT(*) as c FROM status_updates').get();
if (statusCount.c === 0) {
  const members = db.prepare('SELECT * FROM team_members').all();
  
  const jk = members.find(m => m.email === 'jayakrishna.kaimal@ibm.com');
  const abhiram = members.find(m => m.email === 'abhiram.cs@ibm.com');
  const mahima = members.find(m => m.email === 'Mahima.Shrivastava@ibm.com');
  const ashraf = members.find(m => m.email === 'Ashraf.L@ibm.com');
  const divine = members.find(m => m.email === 'divineantony@ibm.com');
  const ron = members.find(m => m.email === 'drronsharma@ibm.com');
  const shagun = members.find(m => m.email === 'Shagun.Bajpai@ibm.com');

  const insertStatus = db.prepare(`
    INSERT INTO status_updates (member_id, type, done, doing, blockers, plan, week_start)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSource = db.prepare(`
    INSERT INTO status_sources (status_id, source_type, label, url, notes)
    VALUES (?, ?, ?, ?, ?)
  `);

  const today = new Date().toISOString().slice(0, 10);
  
  // Find current Monday
  const todayObj = new Date();
  const day = todayObj.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const mondayObj = new Date(todayObj);
  mondayObj.setDate(todayObj.getDate() + diff);
  const monday = mondayObj.toISOString().slice(0, 10);

  // 1. Jayakrishna Kaimal (Muted - No seeded history so they appear in Pending)

  // 2. Abhiram C S
  if (abhiram) {
    const infoD = insertStatus.run(abhiram.id, 'daily', 'Refactored user authentication middleware and ran unit tests.', 'Helping review front-end layout changes.', 'None', 'Check system logs for memory leaks.', null);
    insertSource.run(infoD.lastInsertRowid, 'boxnotes', 'Daily Tasks Boxnote', 'https://ibm.ent.box.com/notes/1927699378844', 'Main team daily board');
    insertSource.run(infoD.lastInsertRowid, 'jira', 'IKIGAI UX Board', 'https://jsw.ibm.com/issues/?jql=project%20%3D%20IKIGAI%20AND%20component%20%3D%20ux', 'UX Issues query');

    const infoW = insertStatus.run(abhiram.id, 'weekly', 'Resolved CORS issues on internal APIs and structured authentication routing.', 'Drafting technical documentation and preparing database index suggestions.', 'None', 'Conduct a review session with database developers.', monday);
    insertSource.run(infoW.lastInsertRowid, 'boxnotes', 'Weekly Goals Boxnote', 'https://ibm.ent.box.com/notes/2034979194525?s=wry30epnb59bmkfly0m7yik74jhguiz6', 'Team weekly high-level tracking');
    insertSource.run(infoW.lastInsertRowid, 'slack', 'CORS Issue Thread', 'https://ibm.slack.com/archives/C01234567/p1623456789012300', 'Discussion about CORS configuration with UI team');
  }

  // 3. Mahima Shrivastava
  if (mahima) {
    const infoD = insertStatus.run(mahima.id, 'daily', 'Conducted security scans, resolved critical dependency vulnerabilities.', 'Reviewing active firewall logs and configuring sandbox environments.', 'None', 'Coordinate access permissions for staging deployment.', null);
    insertSource.run(infoD.lastInsertRowid, 'boxnotes', 'Daily Tasks Boxnote', 'https://ibm.ent.box.com/notes/1927699378844', 'Main team daily board');

    const infoW = insertStatus.run(mahima.id, 'weekly', 'Completed full compliance audit check for dependency libraries and fixed major alerts.', 'Working on setting up testing environments and coordinating with QA team.', 'Requires access to staging VPC for deployment', 'Review compliance audit next week.', monday);
    insertSource.run(infoW.lastInsertRowid, 'boxnotes', 'Weekly Goals Boxnote', 'https://ibm.ent.box.com/notes/2034979194525?s=wry30epnb59bmkfly0m7yik74jhguiz6', 'Team weekly high-level tracking');
    insertSource.run(infoW.lastInsertRowid, 'figma', 'UX Workspace Folder', 'https://www.figma.com/files/902667414815738345/folder/425630937?fuid=1065932638881237472', 'UX Folder link');
    insertSource.run(infoW.lastInsertRowid, 'slack', 'Staging VPC Thread', 'https://ibm.slack.com/archives/C01234567/p1623456789045600', 'VPC Access discussion thread');
  }

  // 4. Ashraf L
  if (ashraf) {
    const infoD = insertStatus.run(ashraf.id, 'daily', 'Reviewed IKIGAI mobile and desktop wireframes, aligned components with Carbon spacing guidelines.', 'Iterating on UX user research feedback and updating design mockups in the shared designs folder.', 'None', 'Publish updated high-fidelity design specs for engineering review.', null);
    insertSource.run(infoD.lastInsertRowid, 'figma', 'IKIGAI Figma Workspace', 'https://www.figma.com/files/902667414815738345/folder/425630937?fuid=1065932638881237472', 'Shared design files');
    insertSource.run(infoD.lastInsertRowid, 'jira', 'IKIGAI UX Board', 'https://jsw.ibm.com/issues/?jql=project%20%3D%20IKIGAI%20AND%20component%20%3D%20ux', 'UX Issues query');

    const infoW = insertStatus.run(ashraf.id, 'weekly', 'Completed wireframes for mobile dashboard, aligned UI component library with IBM Carbon 11 Design language.', 'Developing higher fidelity responsive screens and discussing grid-layouts with engineering.', 'None', 'Finalise layout reviews with Product Owners.', monday);
    insertSource.run(infoW.lastInsertRowid, 'figma', 'IKIGAI Figma Workspace', 'https://www.figma.com/files/902667414815738345/folder/425630937?fuid=1065932638881237472', 'Shared design files');
    insertSource.run(infoW.lastInsertRowid, 'boxnotes', 'Weekly Goals Boxnote', 'https://ibm.ent.box.com/notes/2034979194525?s=wry30epnb59bmkfly0m7yik74jhguiz6', 'Team weekly high-level tracking');
  }

  // 5. Divine Antony
  if (divine) {
    const infoD = insertStatus.run(divine.id, 'daily', 'Implemented REST endpoint for status updates history and mapped SQL relations.', 'Testing endpoint load times and handling database edge cases.', 'None', 'Review endpoint performance with Abhiram.', null);
    insertSource.run(infoD.lastInsertRowid, 'boxnotes', 'Daily Tasks Boxnote', 'https://ibm.ent.box.com/notes/1927699378844', 'Main team daily board');
    insertSource.run(infoD.lastInsertRowid, 'jira', 'IKIGAI UX Board', 'https://jsw.ibm.com/issues/?jql=project%20%3D%20IKIGAI%20AND%20component%20%3D%20ux', 'UX Issues query');
    insertSource.run(infoD.lastInsertRowid, 'slack', 'IKIGAI UX Thread', 'https://ibm.enterprise.slack.com/archives/C094N18FF09', 'Discussion about history endpoints integration');

    const infoW = insertStatus.run(divine.id, 'weekly', 'Designed SQLite status database structure, built constraints, and mapped dynamic references.', 'Optimizing index queries and finalizing backend server configuration.', 'None', 'Validate history loading under large data sets.', monday);
    insertSource.run(infoW.lastInsertRowid, 'boxnotes', 'Weekly Goals Boxnote', 'https://ibm.ent.box.com/notes/2034979194525?s=wry30epnb59bmkfly0m7yik74jhguiz6', 'Team weekly high-level tracking');
  }

  // 6. Drron Sharma
  if (ron) {
    const infoD = insertStatus.run(ron.id, 'daily', 'Completed data indexing plan for the telemetry metrics tables.', 'Drafting physical model schemas for secondary DB clusters.', 'None', 'Review clustering plan with infrastructure team.', null);
    insertSource.run(infoD.lastInsertRowid, 'boxnotes', 'Daily Tasks Boxnote', 'https://ibm.ent.box.com/notes/1927699378844', 'Main team daily board');

    const infoW = insertStatus.run(ron.id, 'weekly', 'Designed high-volume transactions storage strategy and developed indexing benchmarks.', 'Refining database query architectures for telemetry and history searches.', 'None', 'Hold index optimization workshops.', monday);
    insertSource.run(infoW.lastInsertRowid, 'boxnotes', 'Weekly Goals Boxnote', 'https://ibm.ent.box.com/notes/2034979194525?s=wry30epnb59bmkfly0m7yik74jhguiz6', 'Team weekly high-level tracking');
  }

  // 7. Shagun Bajpai
  if (shagun) {
    const infoD = insertStatus.run(shagun.id, 'daily', 'Created initial test plans for Manager Dashboard UI features and verified validation.', 'Writing Selenium/WebDriver regression scripts for automated runs.', 'None', 'Incorporate backend status updates mock tests.', null);
    insertSource.run(infoD.lastInsertRowid, 'boxnotes', 'Daily Tasks Boxnote', 'https://ibm.ent.box.com/notes/1927699378844', 'Main team daily board');
    insertSource.run(infoD.lastInsertRowid, 'jira', 'IKIGAI UX Board', 'https://jsw.ibm.com/issues/?jql=project%20%3D%20IKIGAI%20AND%20component%20%3D%20ux', 'UX Issues query');

    const infoW = insertStatus.run(shagun.id, 'weekly', 'Set up automation framework in CI/CD, integrated daily regression suite run.', 'Structuring end-to-end user scenarios test script coverage.', 'None', 'Generate UI test coverage audit report next week.', monday);
    insertSource.run(infoW.lastInsertRowid, 'boxnotes', 'Weekly Goals Boxnote', 'https://ibm.ent.box.com/notes/2034979194525?s=wry30epnb59bmkfly0m7yik74jhguiz6', 'Team weekly high-level tracking');
    insertSource.run(infoW.lastInsertRowid, 'figma', 'UX Workspace', 'https://www.figma.com/files/902667414815738345/folder/425630937?fuid=1065932638881237472', 'UX Shared Designs folder');
    insertSource.run(infoW.lastInsertRowid, 'slack', 'UX Collab Channel', 'https://ibm.enterprise.slack.com/archives/C07HUADGRV1', 'Regression suite run discussions');
  }
}

module.exports = db;
