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

  CREATE TABLE IF NOT EXISTS resource_availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    work_mode TEXT NOT NULL CHECK(work_mode IN ('in_office', 'wfh', 'on_leave', 'sick_leave', 'travel_training')),
    location_note TEXT DEFAULT '',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(member_id) REFERENCES team_members(id)
  );
`);

// Clean up old default non-design seed data if found
const oldSeedCheck = db.prepare("SELECT COUNT(*) as c FROM team_members WHERE name IN ('Alice Johnson', 'Jayakrishna Kaimal')").get();
if (oldSeedCheck && oldSeedCheck.c > 0) {
  db.exec(`
    DELETE FROM resource_availability;
    DELETE FROM status_sources;
    DELETE FROM status_updates;
    DELETE FROM team_members WHERE name IN ('Alice Johnson', 'Jayakrishna Kaimal');
  `);
}

// 1. Seed Design Team Roster (6 Designers)
const count = db.prepare('SELECT COUNT(*) as c FROM team_members').get();
if (count.c === 0) {
  const ins = db.prepare('INSERT INTO team_members (name, email) VALUES (?, ?)');
  ins.run('Ashraf L', 'Ashraf.L@ibm.com');
  ins.run('Abhiram C S', 'abhiram.cs@ibm.com');
  ins.run('Mahima Shrivastava', 'Mahima.Shrivastava@ibm.com');
  ins.run('Divine Antony', 'divineantony@ibm.com');
  ins.run('Drron Sharma', 'drronsharma@ibm.com');
  ins.run('Shagun Bajpai', 'Shagun.Bajpai@ibm.com');
}

// 2. Seed Initial Design Status Updates
const statusCount = db.prepare('SELECT COUNT(*) as c FROM status_updates').get();
if (statusCount.c === 0) {
  const members = db.prepare('SELECT * FROM team_members').all();
  
  const ashraf = members.find(m => m.email === 'Ashraf.L@ibm.com');
  const abhiram = members.find(m => m.email === 'abhiram.cs@ibm.com');
  const mahima = members.find(m => m.email === 'Mahima.Shrivastava@ibm.com');
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

  const todayObj = new Date();
  const day = todayObj.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const mondayObj = new Date(todayObj);
  mondayObj.setDate(todayObj.getDate() + diff);
  const monday = mondayObj.toISOString().slice(0, 10);

  // 1. Ashraf L (Principal UX / Product Designer)
  if (ashraf) {
    const infoD = insertStatus.run(
      ashraf.id,
      'daily',
      'Synthesized feedback from 12 usability sessions on IKIGAI Dashboard; refined Carbon v11 grid & spacing hierarchy in Figma.',
      'Crafting high-fidelity interactive prototypes in Figma for the AI Manager Copilot and telemetry filters.',
      'None',
      'Present UX design walkthrough to Design Director and engineering leads.',
      null
    );
    insertSource.run(infoD.lastInsertRowid, 'figma', 'IKIGAI Figma Workspace', 'https://www.figma.com/files/902667414815738345/folder/425630937', 'Core UI wireframes & components');
    insertSource.run(infoD.lastInsertRowid, 'jira', 'IKIGAI UX Design Board', 'https://jsw.ibm.com/issues/?jql=project%20%3D%20IKIGAI%20AND%20component%20%3D%20ux', 'UX Sprint tickets');
    insertSource.run(infoD.lastInsertRowid, 'boxnotes', 'Design Daily Notes', 'https://ibm.ent.box.com/notes/1927699378844', 'Daily design standup sync');

    const infoW = insertStatus.run(
      ashraf.id,
      'weekly',
      'Completed wireframes for mobile & desktop dashboard, aligned UI component library with IBM Carbon 11 Design language.',
      'Developing higher fidelity responsive screens and conducting layout reviews with Product Owners.',
      'None',
      'Finalize design handoff package in Figma for upcoming development sprint.',
      monday
    );
    insertSource.run(infoW.lastInsertRowid, 'figma', 'IKIGAI Master UI Specs', 'https://www.figma.com/files/902667414815738345/folder/425630937', 'High-fidelity design components');
    insertSource.run(infoW.lastInsertRowid, 'boxnotes', 'Weekly Design Milestones', 'https://ibm.ent.box.com/notes/2034979194525', 'Weekly design roadmap');
  }

  // 2. Abhiram C S (Senior Design Systems & UI Designer)
  if (abhiram) {
    const infoD = insertStatus.run(
      abhiram.id,
      'daily',
      'Audited Carbon v11 design token aliases across dark theme components; resolved color contrast ratio issues in secondary charts.',
      'Building reusable Figma component variants for status widgets, glassmorphism card elevation, and badge states.',
      'None',
      'Publish Design System v2.4 component library update to team workspace.',
      null
    );
    insertSource.run(infoD.lastInsertRowid, 'figma', 'Carbon v11 Dark Theme Token Library', 'https://www.figma.com/files/902667414815738345/folder/425630937', 'Figma Tokens & Styles');
    insertSource.run(infoD.lastInsertRowid, 'boxnotes', 'Daily Tasks Boxnote', 'https://ibm.ent.box.com/notes/1927699378844', 'Main team daily board');

    const infoW = insertStatus.run(
      abhiram.id,
      'weekly',
      'Constructed comprehensive Figma component auto-layout library with dark (g100/g90) and light (white/g10) themes.',
      'Aligning custom chart visual tokens with Carbon Charts design guidelines.',
      'None',
      'Lead design system workshop for product design squad next Tuesday.',
      monday
    );
    insertSource.run(infoW.lastInsertRowid, 'slack', 'Design System Review Thread', 'https://ibm.slack.com/archives/C01234567/p1623456789012300', 'Discussion on token aliases');
    insertSource.run(infoW.lastInsertRowid, 'boxnotes', 'Weekly Goals Boxnote', 'https://ibm.ent.box.com/notes/2034979194525', 'Team weekly high-level tracking');
  }

  // 3. Mahima Shrivastava (Lead UX Researcher & Usability Specialist)
  if (mahima) {
    const infoD = insertStatus.run(
      mahima.id,
      'daily',
      'Conducted 4 stakeholder user testing interviews; transcribed pain points regarding information hierarchy on status dashboards.',
      'Synthesizing usability test metrics into an affinity diagram and drafting user journey maps in FigJam.',
      'None',
      'Share UX research synthesis deck with Product Management and Design Guild.',
      null
    );
    insertSource.run(infoD.lastInsertRowid, 'figma', 'UX Research Affinity Diagram', 'https://www.figma.com/files/902667414815738345/folder/425630937', 'FigJam affinity board');
    insertSource.run(infoD.lastInsertRowid, 'boxnotes', 'Daily Tasks Boxnote', 'https://ibm.ent.box.com/notes/1927699378844', 'Main team daily board');

    const infoW = insertStatus.run(
      mahima.id,
      'weekly',
      'Delivered Q1 Enterprise User Persona report and heuristic evaluation on status reporting workflows.',
      'Facilitating design thinking empathy workshops with executive stakeholders.',
      'Awaiting approval for UserTesting.com participant recruiting panel credits',
      'Run unmoderated usability tests across 20 enterprise participants.',
      monday
    );
    insertSource.run(infoW.lastInsertRowid, 'boxnotes', 'UX Research Repository', 'https://ibm.ent.box.com/notes/2034979194525', 'User interview transcripts & recordings');
    insertSource.run(infoW.lastInsertRowid, 'slack', 'Research Recruiting Thread', 'https://ibm.slack.com/archives/C01234567/p1623456789045600', 'Discussion with Wes on panel budget');
  }

  // 4. Divine Antony (Senior Interaction & Visual Designer)
  if (divine) {
    const infoD = insertStatus.run(
      divine.id,
      'daily',
      'Designed iconography set and micro-motion transitions for status notifications and modal drawers.',
      'Designing responsive tablet and mobile breakpoints for executive cockpit in Figma.',
      'None',
      'Review motion curves and Lottie animation assets with UI development team.',
      null
    );
    insertSource.run(infoD.lastInsertRowid, 'figma', 'Interactive Motion & Icons', 'https://www.figma.com/files/902667414815738345/folder/425630937', 'Motion prototypes and vector icons');
    insertSource.run(infoD.lastInsertRowid, 'slack', 'Design Critique Channel', 'https://ibm.enterprise.slack.com/archives/C094N18FF09', 'Motion ease-in curves review');

    const infoW = insertStatus.run(
      divine.id,
      'weekly',
      'Established visual hierarchy guidelines, data visualization palette rules, and iconography grid for the application.',
      'Creating design specs and asset exports for all interactive data cards.',
      'None',
      'Finalize brand illustration kit for empty states and error screens.',
      monday
    );
    insertSource.run(infoW.lastInsertRowid, 'boxnotes', 'Weekly Goals Boxnote', 'https://ibm.ent.box.com/notes/2034979194525', 'Team weekly high-level tracking');
  }

  // 5. Drron Sharma (Design Technologist / Design Prototyper)
  if (ron) {
    const infoD = insertStatus.run(
      ron.id,
      'daily',
      'Built high-fidelity interactive code prototype in CodeSandbox for testing keyboard navigation & screen reader accessibility.',
      'Prototyping dynamic AI prompt bubble interactions and Chart.js theme transitions.',
      'None',
      'Run automated Axe accessibility test suite on design prototypes.',
      null
    );
    insertSource.run(infoD.lastInsertRowid, 'boxnotes', 'Daily Tasks Boxnote', 'https://ibm.ent.box.com/notes/1927699378844', 'Main team daily board');

    const infoW = insertStatus.run(
      ron.id,
      'weekly',
      'Created Carbon web component prototype sandbox for rapid UX exploration and concept validation.',
      'Evaluating WCAG 2.1 AA accessibility contrast compliance for dark theme graphs and data visualizations.',
      'None',
      'Deliver accessibility compliance report to Design Operations guild.',
      monday
    );
    insertSource.run(infoW.lastInsertRowid, 'boxnotes', 'Weekly Goals Boxnote', 'https://ibm.ent.box.com/notes/2034979194525', 'Team weekly high-level tracking');
  }

  // 6. Shagun Bajpai (UX Content Strategist & Information Architect)
  if (shagun) {
    const infoD = insertStatus.run(
      shagun.id,
      'daily',
      'Refined UX microcopy, error message taxonomy, and contextual helper tooltips across all dashboard forms.',
      'Developing content design guidelines and voice/tone standards for the AI Manager Copilot.',
      'None',
      'Standardize naming taxonomy for resource status modes and filter tags.',
      null
    );
    insertSource.run(infoD.lastInsertRowid, 'figma', 'UX Copy & Architecture Workspace', 'https://www.figma.com/files/902667414815738345/folder/425630937', 'Copy deck and taxonomy tree');
    insertSource.run(infoD.lastInsertRowid, 'boxnotes', 'Daily Tasks Boxnote', 'https://ibm.ent.box.com/notes/1927699378844', 'Main team daily board');

    const infoW = insertStatus.run(
      shagun.id,
      'weekly',
      'Mapped comprehensive site architecture and navigation taxonomy for team status portal.',
      'Auditing UI terminology across Jira, Figma, Boxnotes, and Slack integration touchpoints.',
      'None',
      'Publish content style guide for watsonx AI conversational prompts.',
      monday
    );
    insertSource.run(infoW.lastInsertRowid, 'boxnotes', 'Weekly Goals Boxnote', 'https://ibm.ent.box.com/notes/2034979194525', 'Team weekly high-level tracking');
    insertSource.run(infoW.lastInsertRowid, 'slack', 'Content Critique Channel', 'https://ibm.enterprise.slack.com/archives/C07HUADGRV1', 'Voice and tone review');
  }
}

// 3. Seed Design Resource Availability / Work Mode
const availCount = db.prepare('SELECT COUNT(*) as c FROM resource_availability').get();
if (availCount.c === 0) {
  const members = db.prepare('SELECT * FROM team_members').all();
  const insertAvail = db.prepare(`
    INSERT INTO resource_availability (member_id, work_mode, location_note, start_date, end_date)
    VALUES (?, ?, ?, ?, ?)
  `);

  const todayStr = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  members.forEach(m => {
    if (m.name.includes('Ashraf')) {
      insertAvail.run(m.id, 'in_office', 'IBM Design Studio - Floor 4 (Figma Collab Zone)', todayStr, nextMonth);
    } else if (m.name.includes('Abhiram')) {
      insertAvail.run(m.id, 'wfh', 'Home Studio (Bengaluru Design Hub)', todayStr, nextMonth);
    } else if (m.name.includes('Mahima')) {
      insertAvail.run(m.id, 'in_office', 'UX Research Lab - Tower B (User Testing Suite)', todayStr, nextMonth);
    } else if (m.name.includes('Divine')) {
      insertAvail.run(m.id, 'wfh', 'Kochi Studio (Remote Visual & Motion Design)', todayStr, nextMonth);
    } else if (m.name.includes('Drron')) {
      insertAvail.run(m.id, 'in_office', 'IBM Tech Lab - Prototype Suite', todayStr, nextMonth);
    } else if (m.name.includes('Shagun')) {
      insertAvail.run(m.id, 'on_leave', 'Annual PTO / Leave (Returns Monday)', todayStr, nextMonth);
    }
  });
}

module.exports = db;
