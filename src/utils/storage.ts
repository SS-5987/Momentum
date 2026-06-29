import { Profile, Task, Action, ActivityLogEntry, ToolType, AutonomyLevel } from "../types";

// Key constants
const PROFILE_KEY = "clearpath_profile";
const TASKS_KEY = "clearpath_tasks";
const ACTIONS_KEY = "clearpath_actions";
const LOGS_KEY = "clearpath_logs";
const BRIEFING_KEY = "clearpath_briefing_cache";
const SCHEMA_VERSION_KEY = "clearpath_schema_version";
const SEED_VERSION_KEY = "clearpath_seed_version";

// Bump this whenever the shape of any persisted object changes. On mismatch we
// reset the seeded collections so a stale/incompatible payload can't crash the app.
const SCHEMA_VERSION = "2";

// Bump this whenever the *seed content* changes (e.g. retuned risk, new sample
// tasks). On mismatch we re-seed tasks/actions/logs so old tasks with now-past
// deadlines (which made everything read as "high risk") are cleared out — WITHOUT
// touching the user's profile / autonomy settings.
// v3: refresh the demo set — one ready-to-run sample task per capability (all 6 tool types).
const SEED_VERSION = "3";

// Safe localStorage read: returns `fallback` (and clears the bad key) if the value
// is missing or corrupt, instead of throwing and white-screening the whole app.
function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[Storage] Corrupt value for "${key}" — resetting.`);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return fallback;
  }
}

// Returns a YYYY-MM-DD string `days` from today (UTC), used to keep seed deadlines
// relative to "now" so the demo doesn't rot once the old hardcoded dates pass.
function isoDaysFromToday(days: number): string {
  const d = todayUTC();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

// Returns "today" normalized to UTC midnight so day-difference math lines up
// with the YYYY-MM-DD deadline strings (which parse as UTC midnight).
function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Computes the date of the next given weekday (0=Sun..6=Sat) at or after `from`+1 day.
function nextWeekday(from: Date, weekday: number): Date {
  const result = new Date(from);
  const delta = ((weekday - from.getUTCDay() + 7) % 7) || 7; // always move forward at least 1 day
  result.setUTCDate(result.getUTCDate() + delta);
  return result;
}

// Seed Data
const defaultProfile: Profile = {
  name: "Alex Mercer",
  email: "alex.mercer@gmail.com",
  role: "Software Engineering Intern",
  writingTone: "Concise & professional, ending with an elegant signature",
  signature: "Best,\nAlex Mercer",
  contacts: [
    { name: "Prof. Lee", email: "lee.j@university.edu", relationship: "Academic Advisor" },
    { name: "Sarah Jenkins", email: "sarah@innovatetech.com", relationship: "Internship Coordinator" },
    { name: "David Chen", email: "david.chen@groupwise.com", relationship: "Lead Developer" }
  ],
  savedDetails: {
    "Internship Project ID": "IP-9402",
    "Student ID": "SID-88210",
    "Utility Account Number": "948-2810-184"
  },
  autonomySettings: {
    "draft_message": "stage",
    "schedule_event": "stage",
    "generate_document": "draft",
    "prefill_link": "stage",
    "research_decide": "draft",
    "breakdown_first_step": "draft"
  }
};

const defaultTasks: Task[] = [
  {
    id: "task_1",
    title: "Reply to Prof. Lee about the deadline extension",
    description: "Email Prof. Lee to ask for an extra 48 hours on the database systems lab submission.",
    deadline: isoDaysFromToday(1),
    category: "Email",
    priorityScore: 85,
    riskLevel: "med",
    status: "action_ready",
    snoozeCount: 0,
    source: "Inbox Scan"
  },
  {
    id: "task_2",
    title: "Book a 2-hour focused study block for the database exam",
    description: "Block out dedicated time with no distractions before the big exam on Saturday.",
    deadline: isoDaysFromToday(2),
    category: "Schedule",
    priorityScore: 75,
    riskLevel: "low",
    status: "action_ready",
    snoozeCount: 0,
    source: "Calendar Check"
  },
  {
    id: "task_3",
    title: "Write an outline for the marketing assignment",
    description: "Prepare a solid outline highlighting demographics and growth channels for our marketing assignment.",
    deadline: isoDaysFromToday(2),
    category: "Work",
    priorityScore: 65,
    riskLevel: "low",
    status: "action_ready",
    snoozeCount: 0,
    source: "Syllabus Monitor"
  },
  {
    id: "task_4",
    title: "Pay the electricity bill",
    description: "Account balance payment is due soon to avoid late processing fees.",
    deadline: isoDaysFromToday(3),
    category: "Finance",
    priorityScore: 90,
    riskLevel: "high",
    status: "action_ready",
    snoozeCount: 0,
    source: "E-Bill Portal"
  },
  {
    id: "task_5",
    title: "Decide between two laptop options for the internship",
    description: "Compare options (MacBook Air vs ThinkPad T14) to see which is better suited for compile times and battery life.",
    deadline: isoDaysFromToday(4),
    category: "Research",
    priorityScore: 60,
    riskLevel: "med",
    status: "action_ready",
    snoozeCount: 0,
    source: "Intern Checklist"
  },
  {
    id: "task_6",
    title: "Study for the database exam",
    description: "Review critical relational algebra queries and B-Tree index structures.",
    deadline: isoDaysFromToday(1),
    category: "Study",
    priorityScore: 95,
    riskLevel: "high",
    status: "action_ready",
    snoozeCount: 3,
    source: "Syllabus Monitor"
  }
];

const defaultActions: Action[] = [
  {
    id: "act_1",
    taskId: "task_1",
    toolType: "draft_message",
    autonomyLevel: "stage",
    status: "draft",
    aiReasoning: "This involves direct correspondence with another individual, so I drafted a personalized email in your preferred tone.",
    payload: {
      to: "lee.j@university.edu",
      subject: "Request for Extension - Database Systems Lab submission (SID-88210)",
      body: `Dear Professor Lee,

I hope you are having a productive week.

Regarding our database systems lab, I would like to request a 48-hour extension on the submission deadline. I have run into a few structural edge cases during my testing phase and would appreciate the extra time to resolve them and submit my highest-quality work.

Thank you very much for your understanding and continued support.

Best,
Alex Mercer`,
      tone: "Concise & professional"
    }
  },
  {
    id: "act_2",
    taskId: "task_2",
    toolType: "schedule_event",
    autonomyLevel: "stage",
    status: "draft",
    aiReasoning: "This is a time-management commitment. I have blocked out 2 hours of focused study in your calendar.",
    payload: {
      title: "Focused Study Block: Database Exam",
      proposedStart: `${isoDaysFromToday(1)}T14:00:00.000Z`,
      durationMinutes: 120,
      notes: "No-distraction sprint. Main focal areas: query optimization plans, index types, B-Trees, and transaction isolation levels.",
      needsOtherParty: false
    }
  },
  {
    id: "act_3",
    taskId: "task_3",
    toolType: "generate_document",
    autonomyLevel: "stage",
    status: "draft",
    aiReasoning: "You requested structured written content. I drafted a fully fleshed-out outline in professional markdown.",
    payload: {
      docTitle: "Marketing Strategy Assignment Outline",
      contentMarkdown: `# Marketing Strategy & Launch Campaign Outline

## Executive Summary
* **App Name**: Momentum AI Launch
* **Primary Value Proposition**: Automated prepare-then-approve task orchestration.

## 1. Market Analysis & Target Audience
* **Demographics**: Digital-native knowledge workers, managers, busy students.
* **Pain Point**: Constant alarm-fatigue from traditional notifications.

## 2. Positioning & Content Blueprint
* Focus heavily on "Prepared Actions" over simple alerts.
* Positioning statement: "Momentum prepares the work so you only need to click Approve."

## 3. Growth Channels
* Product Hunt launch checklist.
* Tech-focused newsletters and LinkedIn professional showcases.

## 4. Launch Timeline
* Phase 1: Closed beta for 100 creators (Week 1)
* Phase 2: Public PR and Product Hunt launch (Week 3)
* Phase 3: Community feedback collection & version 1.1 iteration.`
    }
  },
  {
    id: "act_4",
    taskId: "task_4",
    toolType: "prefill_link",
    autonomyLevel: "stage",
    status: "draft",
    aiReasoning: "This requires secure payment on an external portal. I prepared the login link and extracted key details for your quick reference.",
    payload: {
      url: "https://utility-portal-demo.com/payments",
      instructions: "Log in with your saved utility credentials, navigate to billing, and use the prefilled details below for instant check-out.",
      prefillData: {
        amount: "$124.50",
        accountNumber: "948-2810-184",
        dueDate: "2026-06-28"
      }
    }
  },
  {
    id: "act_5",
    taskId: "task_5",
    toolType: "research_decide",
    autonomyLevel: "stage",
    status: "draft",
    aiReasoning: "This is an evaluative decision task. I searched current benchmark sheets and prepared a complete comparative recommendation.",
    payload: {
      query: "MacBook Air M3 vs Lenovo ThinkPad T14 Gen 5 for developer internship",
      summary: "For your Software Engineering Internship, the MacBook Air M3 provides unmatched 18-hour battery life, outstanding multi-threaded compilation speed, and runs cool. On the other hand, the Lenovo ThinkPad T14 offers superior upgradeable DDR5 RAM, standard Linux support, and an ergonomic keyboard. However, compilation workflows heavily benefit from Apple Silicon's unified memory bandwidth.",
      recommendation: "Choose the MacBook Air M3 (16GB RAM, 512GB SSD). The high memory bandwidth and power efficiency will serve you significantly better in fast compilation cycles and cloud IDE work."
    }
  },
  {
    id: "act_6",
    taskId: "task_6",
    toolType: "breakdown_first_step",
    autonomyLevel: "stage",
    status: "draft",
    aiReasoning: "This is a complex personal task requiring individual execution. I have broken it down into micro-steps with an immediate 5-minute action.",
    payload: {
      subtasks: [
        "Open your textbook or lecture slides to Chapter 4: Relational Algebra.",
        "Write out 3 sample queries in SQL and convert them to Relational Algebra trees.",
        "Solve 2 past exam questions regarding database index designs.",
        "Take a 10-minute break, then review database normalization forms (1NF, 2NF, 3NF, BCNF)."
      ],
      firstStep: "Spend just 5 minutes opening your study folder and reviewing the syllabus database outline."
    }
  }
];

const defaultLogs: ActivityLogEntry[] = [
  {
    id: "log_init",
    timestamp: new Date().toISOString(),
    taskTitle: "System Setup",
    summary: "Momentum initialization completed successfully. Morning action cards generated.",
    autonomyLevel: "system",
    undoable: false,
    undone: false,
    taskId: ""
  }
];

// Local Simulation Fallbacks
function simulateParseTask(input: string) {
  const lowercase = input.toLowerCase();
  let category = "Personal";
  let deadline = "";
  let priorityScore = 50;
  let riskLevel: 'low' | 'med' | 'high' = "low";

  if (lowercase.includes("email") || lowercase.includes("reply") || lowercase.includes("write") || lowercase.includes("msg") || lowercase.includes("message")) {
    category = "Email";
    priorityScore = 75;
  } else if (lowercase.includes("study") || lowercase.includes("exam") || lowercase.includes("test") || lowercase.includes("learn")) {
    category = "Study";
    priorityScore = 85;
    riskLevel = "high";
  } else if (lowercase.includes("pay") || lowercase.includes("bill") || lowercase.includes("invoice") || lowercase.includes("card")) {
    category = "Finance";
    priorityScore = 90;
    riskLevel = "high";
  } else if (lowercase.includes("buy") || lowercase.includes("shop") || lowercase.includes("compare") || lowercase.includes("laptop")) {
    category = "Research";
    priorityScore = 60;
    riskLevel = "med";
  } else if (lowercase.includes("book") || lowercase.includes("schedule") || lowercase.includes("reserve") || lowercase.includes("block")) {
    category = "Schedule";
    priorityScore = 70;
  }

  const today = todayUTC();
  if (lowercase.includes("tomorrow")) {
    today.setUTCDate(today.getUTCDate() + 1);
    deadline = today.toISOString().split('T')[0];
  } else if (lowercase.includes("in 2 days") || lowercase.includes("2 days")) {
    today.setUTCDate(today.getUTCDate() + 2);
    deadline = today.toISOString().split('T')[0];
  } else if (lowercase.includes("in 3 days") || lowercase.includes("3 days")) {
    today.setUTCDate(today.getUTCDate() + 3);
    deadline = today.toISOString().split('T')[0];
  } else if (lowercase.includes("friday")) {
    deadline = nextWeekday(today, 5).toISOString().split('T')[0];
  } else {
    today.setUTCDate(today.getUTCDate() + 4);
    deadline = today.toISOString().split('T')[0];
  }

  return {
    title: input.charAt(0).toUpperCase() + input.slice(1),
    deadline,
    category,
    priorityScore,
    riskLevel: riskLevel as 'low' | 'med' | 'high'
  };
}

function simulatePlanAction(task: any, profile: any, forceToolType?: string) {
  const title = task.title.toLowerCase();
  const writingTone = profile?.writingTone || "professional";
  const signature = profile?.signature || `Best, ${profile?.name || "User"}`;
  const firstContact = profile?.contacts?.[0] || { name: "Prof. Lee", email: "lee.j@university.edu" };

  if (forceToolType === "breakdown_first_step" || (task.snoozeCount && task.snoozeCount >= 3)) {
    return {
      toolType: "breakdown_first_step",
      aiReasoning: "You have snoozed this task multiple times, so I have broken it down into tiny, low-friction steps with an immediate 5-minute start action to help you beat procrastination.",
      breakdown_first_step: {
        subtasks: [
          `Prepare study materials/workspace for "${task.title}".`,
          `Work on the next immediate phase of "${task.title}" for 15 minutes.`,
          `Review and mark completed subtasks.`,
          `Consolidate notes and plan next steps.`
        ],
        firstStep: `Spend just 5 minutes starting on "${task.title}" to build momentum.`
      }
    };
  }

  if (title.includes("reply") || title.includes("email") || title.includes("prof. lee") || title.includes("message")) {
    return {
      toolType: "draft_message",
      aiReasoning: "This involves direct correspondence with another individual, so I drafted a personalized message in your preferred tone.",
      draft_message: {
        to: firstContact.email,
        subject: `Re: Query Regarding Database Extension / Study Materials`,
        body: `Dear Professor Lee,

I hope you are having a productive week.

Regarding our discussion on the database exam and assignments, I would like to formally request a short extension if possible, as discussed in my schedule. I want to ensure my submission is of the highest standard.

Thank you very much for your guidance and consideration.

${signature}`,
        tone: writingTone
      }
    };
  } else if (title.includes("book") || title.includes("schedule") || title.includes("study block") || title.includes("focused study")) {
    return {
      toolType: "schedule_event",
      aiReasoning: "This is a time-management commitment. I have blocked out 2 hours of focused study in your calendar.",
      schedule_event: {
        title: "Focused Study Block - Database Exam",
        proposedStart: "2026-06-26T14:00:00Z",
        durationMinutes: 120,
        notes: "No-interruption session to master SQL joins, normalization, and ACID properties.",
        needsOtherParty: false
      }
    };
  } else if (title.includes("write") || title.includes("outline") || title.includes("document") || title.includes("assignment")) {
    return {
      toolType: "generate_document",
      aiReasoning: "You requested structured written content. I drafted a fully fleshed-out outline in professional markdown.",
      generate_document: {
        docTitle: "Marketing Strategy Assignment Outline",
        contentMarkdown: `# Marketing Strategy & Launch Campaign Outline

## Executive Summary
* **App Name**: Momentum AI Launch
* **Primary Value Proposition**: Automated prepare-then-approve task orchestration.

## 1. Market Analysis & Target Audience
* **Demographics**: Digital-native knowledge workers, managers, busy students.
* **Pain Point**: Constant alarm-fatigue from traditional notifications.

## 2. Positioning & Content Blueprint
* Focus heavily on "Prepared Actions" over simple alerts.
* Positioning statement: "Momentum prepares the work so you only need to click Approve."

## 3. Growth Channels
* Product Hunt launch checklist.
* Tech-focused newsletters and LinkedIn professional showcases.

## 4. Launch Timeline
* Phase 1: Closed beta for 100 creators (Week 1)
* Phase 2: Public PR and Product Hunt launch (Week 3)
* Phase 3: Community feedback collection & version 1.1 iteration.`
      }
    };
  } else if (title.includes("pay") || title.includes("bill") || title.includes("electricity")) {
    return {
      toolType: "prefill_link",
      aiReasoning: "This requires an external system with authentication. I prepared the direct login URL and prefilled the bill details.",
      prefill_link: {
        url: "https://utility-portal-demo.com/payments",
        instructions: "Log in with your saved utility credentials. Select 'One-Time Payment' and copy the prefilled billing information below.",
        prefillData: {
          accountNumber: "948-2810-184",
          amount: "$124.50",
          dueDate: "2026-06-28"
        }
      }
    };
  } else if (title.includes("decide") || title.includes("compare") || title.includes("laptop") || title.includes("internship") || forceToolType === "research_decide") {
    const researchQuery = task.title || "Target comparison";
    return {
      toolType: "research_decide",
      aiReasoning: "This is an evaluative decision task. I searched current benchmark sheets and prepared a complete comparative recommendation.",
      research_decide: {
        query: researchQuery,
        summary: `Comparing options for "${researchQuery}". Our research highlights trade-offs in pricing, performance, and longevity. While the premium option offers unmatched speed and build quality, the alternative provides exceptional value and customizability.`,
        recommendation: `Choose the premium option for "${researchQuery}" (e.g., Apple/Pro variant). It offers the best balance of efficiency, future-proofing, and developer satisfaction.`,
        supportingPoints: [
          "Outstanding benchmark results in real-world compilation and development tests.",
          "Superior build quality, screen brightness, and overall reliability for long-term use.",
          "Better ecosystem compatibility and seamless integration with modern developer tools."
        ]
      }
    };
  } else {
    // Default breakdown
    return {
      toolType: "breakdown_first_step",
      aiReasoning: "This is a complex personal task requiring individual execution. I have broken it down into micro-steps with an immediate 5-minute action.",
      breakdown_first_step: {
        subtasks: [
          "Open your textbook or lecture slides to Chapter 4: Relational Algebra.",
          "Write out 3 sample queries in SQL and convert them to Relational Algebra trees.",
          "Solve 2 past exam questions regarding database index designs.",
          "Take a 10-minute break, then review database normalization forms (1NF, 2NF, 3NF, BCNF)."
        ],
        firstStep: "Spend just 5 minutes opening your study folder and reviewing the syllabus database outline."
      }
    };
  }
}

export const AUTONOMY_ORDER: Record<AutonomyLevel, number> = {
  suggest: 0,
  draft: 1,
  stage: 2,
  auto: 3
};

export const DEFAULT_TOOL_LEVELS: Record<ToolType, AutonomyLevel> = {
  draft_message: "stage",
  schedule_event: "stage",
  generate_document: "draft",
  prefill_link: "stage",
  research_decide: "draft",
  breakdown_first_step: "draft"
};

export function getFinalAutonomyLevel(toolType: ToolType, userMax: AutonomyLevel): AutonomyLevel {
  const defaultLevel = DEFAULT_TOOL_LEVELS[toolType] || "draft";
  const defVal = AUTONOMY_ORDER[defaultLevel];
  const maxVal = AUTONOMY_ORDER[userMax || "draft"];
  const minVal = Math.min(defVal, maxVal);
  return (Object.keys(AUTONOMY_ORDER) as AutonomyLevel[]).find(k => AUTONOMY_ORDER[k] === minVal) || "draft";
}

export function getInitialStatusesForLevel(level: AutonomyLevel): { actionStatus: 'draft' | 'staged' | 'executed'; taskStatus: 'action_ready' | 'awaiting_approval' | 'done' } {
  if (level === "suggest" || level === "draft") {
    return { actionStatus: "draft", taskStatus: "action_ready" };
  } else if (level === "stage") {
    return { actionStatus: "staged", taskStatus: "awaiting_approval" };
  } else {
    return { actionStatus: "executed", taskStatus: "done" };
  }
}

export function getEstimatedEffortHours(task: Task): number {
  const title = (task.title || "").toLowerCase();
  const desc = (task.description || "").toLowerCase();
  
  // Try to find numbers followed by "hour", "hr", or "hours"
  const hrMatch = title.match(/(\d+)\s*-?\s*hour/) || desc.match(/(\d+)\s*-?\s*hour/) ||
                  title.match(/(\d+)\s*hr/) || desc.match(/(\d+)\s*hr/);
  if (hrMatch) {
    return parseInt(hrMatch[1], 10);
  }
  
  // Heuristic based on Category
  switch (task.category?.toLowerCase()) {
    case 'study':
    case 'academic':
      return 6;
    case 'work':
    case 'research':
      return 4;
    case 'schedule':
      return 1.5;
    case 'email':
    case 'finance':
    default:
      return 1;
  }
}

export function computeRiskLevel(task: Task): 'low' | 'med' | 'high' {
  const referenceDate = todayUTC();
  const deadlineDate = new Date(task.deadline);
  const diffTime = deadlineDate.getTime() - referenceDate.getTime();
  // Floor at 0.5 day (was 0.2). The old tiny floor made ANY overdue/due-today task
  // explode to "high" — even a 1-hour email. With this floor a low-effort task due
  // today/slightly overdue lands at ~2.0 (med), while genuinely heavy or
  // procrastinated work still crosses into high.
  const daysRemaining = Math.max(0.5, diffTime / (1000 * 60 * 60 * 24));

  const effort = getEstimatedEffortHours(task);
  const snooze = task.snoozeCount || 0;
  const categoryRiskBonus = task.category === "Finance" ? 12 : (task.category === "Study" ? 5 : 0);

  const riskScore = (effort + snooze * 5 + categoryRiskBonus) / daysRemaining;

  // Thresholds retuned alongside the floor so a fresh seed yields a spread
  // (~1-2 high) instead of everything reading urgent.
  if (riskScore >= 5.0) return "high";
  if (riskScore >= 1.5) return "med";
  return "low";
}

export function computePriorityScore(task: Task): number {
  const referenceDate = todayUTC();
  const deadlineDate = new Date(task.deadline);
  const diffTime = deadlineDate.getTime() - referenceDate.getTime();
  const daysRemaining = diffTime / (1000 * 60 * 60 * 24);

  // 1. Urgency: closeness of deadline (0-100)
  let urgency = 50;
  if (daysRemaining <= 0) {
    urgency = 100;
  } else if (daysRemaining <= 1) {
    urgency = 95;
  } else if (daysRemaining <= 2) {
    urgency = 85;
  } else if (daysRemaining <= 3) {
    urgency = 75;
  } else if (daysRemaining <= 5) {
    urgency = 60;
  } else {
    urgency = Math.max(10, 50 - (daysRemaining - 5) * 5);
  }

  // 2. Importance: category weight
  const CATEGORY_WEIGHTS: Record<string, number> = {
    "Finance": 95,
    "Study": 90,
    "Email": 80,
    "Work": 70,
    "Schedule": 65,
    "Research": 60,
    "Personal": 40
  };
  const catKey = task.category ? task.category.charAt(0).toUpperCase() + task.category.slice(1).toLowerCase() : "Personal";
  const importance = CATEGORY_WEIGHTS[catKey] || CATEGORY_WEIGHTS[task.category] || 50;

  // 3. SnoozeCount bonus: floats UP
  const snoozeBonus = (task.snoozeCount || 0) * 12;

  // Combine urgency & importance + snooze bonus, cap at 100, min 1
  let score = Math.round(urgency * 0.45 + importance * 0.55 + snoozeBonus);
  return Math.min(100, Math.max(1, score));
}

export function getPriorityLevel(score: number): 'High' | 'Med' | 'Low' {
  if (score >= 85) return 'High';
  if (score >= 65) return 'Med';
  return 'Low';
}

// Shared comparator so every task list orders identically: EARLIEST deadline first,
// tie-broken by highest priorityScore. Tasks with no/invalid deadline sort last.
export function compareTasksByDeadline(a: Task, b: Task): number {
  const toTime = (d: string) => {
    if (!d) return Infinity;
    const t = new Date(d).getTime();
    return isNaN(t) ? Infinity : t;
  };
  const at = toTime(a.deadline);
  const bt = toTime(b.deadline);
  if (at !== bt) return at - bt;
  return (b.priorityScore || 0) - (a.priorityScore || 0);
}

// Pure Utility Storage Engine
export const StorageEngine = {
  // Reset seeded collections when either the persisted schema version or the seed
  // version is older than the code's. This clears stale tasks/actions/logs (e.g.
  // tasks with now-past deadlines that read as "high risk") and re-seeds, but
  // PRESERVES the user's profile and autonomy settings. Runs once per load.
  ensureSchema(): void {
    try {
      const schemaOk = localStorage.getItem(SCHEMA_VERSION_KEY) === SCHEMA_VERSION;
      const seedOk = localStorage.getItem(SEED_VERSION_KEY) === SEED_VERSION;
      if (schemaOk && seedOk) return;
      [TASKS_KEY, ACTIONS_KEY, LOGS_KEY, BRIEFING_KEY].forEach(k => localStorage.removeItem(k));
      localStorage.setItem(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
      localStorage.setItem(SEED_VERSION_KEY, SEED_VERSION);
    } catch { /* ignore */ }
  },

  // Clear the transient `isNew` highlight from all tasks and persist, so a newly
  // added task only ever shows its "New" accent once.
  clearNewFlags(): void {
    const data = safeRead<Task[] | null>(TASKS_KEY, null);
    if (!data) return;
    let changed = false;
    const cleared = data.map(t => {
      if (t.isNew) { changed = true; return { ...t, isNew: false }; }
      return t;
    });
    if (changed) this.saveTasks(cleared);
  },

  getProfile(): Profile {
    const data = safeRead<Profile | null>(PROFILE_KEY, null);
    if (!data) {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(defaultProfile));
      return defaultProfile;
    }
    // Backfill any fields a partially-stored/older profile may be missing.
    return { ...defaultProfile, ...data, autonomySettings: { ...defaultProfile.autonomySettings, ...(data.autonomySettings || {}) } };
  },

  saveProfile(profile: Profile): void {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  },

  getTasks(): Task[] {
    let taskList = safeRead<Task[] | null>(TASKS_KEY, null);
    if (!taskList) {
      taskList = defaultTasks;
      localStorage.setItem(TASKS_KEY, JSON.stringify(defaultTasks));
    }
    // Enrich with dynamically computed values
    return taskList.map(t => ({
      ...t,
      priorityScore: computePriorityScore(t),
      riskLevel: computeRiskLevel(t)
    }));
  },

  saveTasks(tasks: Task[]): void {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  },

  getActions(): Action[] {
    const data = safeRead<Action[] | null>(ACTIONS_KEY, null);
    if (!data) {
      localStorage.setItem(ACTIONS_KEY, JSON.stringify(defaultActions));
      return defaultActions;
    }
    return data;
  },

  saveActions(actions: Action[]): void {
    localStorage.setItem(ACTIONS_KEY, JSON.stringify(actions));
  },

  getLogs(): ActivityLogEntry[] {
    const data = safeRead<ActivityLogEntry[] | null>(LOGS_KEY, null);
    if (!data) {
      localStorage.setItem(LOGS_KEY, JSON.stringify(defaultLogs));
      return defaultLogs;
    }
    return data.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },

  saveLogs(logs: ActivityLogEntry[]): void {
    localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
  },

  addLogEntry(entry: Omit<ActivityLogEntry, "id" | "timestamp" | "undone">): void {
    const logs = this.getLogs();
    const newEntry: ActivityLogEntry = {
      ...entry,
      id: "log_" + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      undone: false
    };
    logs.push(newEntry);
    this.saveLogs(logs);
  },

  // Prepare a task (Generate Action Card)
  async prepareTask(taskId: string, forceToolType?: ToolType): Promise<{ action: Action; task: Task }> {
    const tasks = this.getTasks();
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) throw new Error("Task not found");

    const task = tasks[taskIndex];
    const profile = this.getProfile();

    try {
      // API call to Express backend
      const response = await fetch("/api/plan-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, profile, forceToolType })
      });

      if (!response.ok) {
        throw new Error("Failed to prepare task action");
      }

      const planResult = await response.json();

      // Create new action
      const actions = this.getActions();
      const existingActionIndex = actions.findIndex(a => a.taskId === taskId);

      const toolType = planResult.toolType as ToolType;
      const userMax = profile.autonomySettings[toolType] || DEFAULT_TOOL_LEVELS[toolType] || "draft";
      let finalLevel = getFinalAutonomyLevel(toolType, userMax);

      const payload = planResult[toolType] || planResult.payload || {};

      // Contact rule: Never auto-send above stage autonomy for specific contacts
      if (toolType === "draft_message") {
        const recipient = (payload.to || "").toLowerCase();
        const matchedContact = profile.contacts?.find(
          c => c.name.toLowerCase() === recipient || c.email.toLowerCase() === recipient || recipient.includes(c.email.toLowerCase()) || recipient.includes(c.name.toLowerCase())
        );
        if (matchedContact?.neverAutoSend) {
          if (AUTONOMY_ORDER[finalLevel] > AUTONOMY_ORDER["stage"]) {
            console.log(`[Autonomy Cap] Restricting autonomy to "stage" for message to ${matchedContact.name} because they are marked "never auto-send".`);
            finalLevel = "stage";
          }
        }
      }

      const { actionStatus, taskStatus } = getInitialStatusesForLevel(finalLevel);

      const newAction: Action = {
        id: "act_" + Math.random().toString(36).substr(2, 9),
        taskId: taskId,
        toolType,
        autonomyLevel: finalLevel,
        status: actionStatus,
        aiReasoning: planResult.aiReasoning || "Action plan formulated based on task details.",
        payload
      };

      if (existingActionIndex !== -1) {
        actions[existingActionIndex] = newAction;
      } else {
        actions.push(newAction);
      }
      this.saveActions(actions);

      // Update task status
      const originalTaskStatus = task.status;
      task.status = taskStatus;
      this.saveTasks(tasks);

      // Log based on final autonomy level
      if (finalLevel === "auto") {
        let summaryDetail = "";
        if (toolType === "draft_message") {
          summaryDetail = `[Auto] Message automatically sent to [${newAction.payload.to}].`;
        } else if (toolType === "schedule_event") {
          summaryDetail = `[Auto] Event [${newAction.payload.title}] automatically booked.`;
        } else if (toolType === "generate_document") {
          summaryDetail = `[Auto] Document [${newAction.payload.docTitle}] automatically generated.`;
        } else if (toolType === "prefill_link") {
          summaryDetail = `[Auto] Deep link prefilled for utility billing checkout.`;
        } else if (toolType === "research_decide") {
          summaryDetail = `[Auto] Recommendation selected automatically: [${newAction.payload.recommendation?.split('.')[0] || "MacBook Air M3"}].`;
        } else {
          summaryDetail = `[Auto] Action breakdown generated. First step auto-started: "${newAction.payload.firstStep}"`;
        }

        this.addLogEntry({
          taskTitle: task.title,
          summary: summaryDetail,
          autonomyLevel: "auto",
          undoable: true,
          taskId: task.id,
          actionId: newAction.id,
          originalTaskStatus,
          originalActionStatus: "draft"
        });
      } else if (finalLevel === "stage") {
        this.addLogEntry({
          taskTitle: task.title,
          summary: `AI prepared and automatically STAGED a [${toolType}] action in the Approval Queue.`,
          autonomyLevel: "stage",
          undoable: false,
          taskId: task.id
        });
      } else {
        this.addLogEntry({
          taskTitle: task.title,
          summary: `AI prepared a new [${toolType}] action card (${finalLevel} level).`,
          autonomyLevel: finalLevel,
          undoable: false,
          taskId: task.id
        });
      }

      return { action: newAction, task };

    } catch (error) {
      console.log("StorageEngine.prepareTask utilizing local fallback planning.");
      // Fallback
      const planResult = simulatePlanAction(task, profile, forceToolType);
      const actions = this.getActions();
      const existingActionIndex = actions.findIndex(a => a.taskId === taskId);

      const toolType = planResult.toolType as ToolType;
      const userMax = profile.autonomySettings[toolType] || DEFAULT_TOOL_LEVELS[toolType] || "draft";
      let finalLevel = getFinalAutonomyLevel(toolType, userMax);

      const payload = (planResult as any)[toolType] || {};

      // Contact rule: Never auto-send above stage autonomy for specific contacts
      if (toolType === "draft_message") {
        const recipient = (payload.to || "").toLowerCase();
        const matchedContact = profile.contacts?.find(
          c => c.name.toLowerCase() === recipient || c.email.toLowerCase() === recipient || recipient.includes(c.email.toLowerCase()) || recipient.includes(c.name.toLowerCase())
        );
        if (matchedContact?.neverAutoSend) {
          if (AUTONOMY_ORDER[finalLevel] > AUTONOMY_ORDER["stage"]) {
            console.log(`[Autonomy Cap Fallback] Restricting autonomy to "stage" for message to ${matchedContact.name} because they are marked "never auto-send".`);
            finalLevel = "stage";
          }
        }
      }

      const { actionStatus, taskStatus } = getInitialStatusesForLevel(finalLevel);

      const fallbackAction: Action = {
        id: "act_" + Math.random().toString(36).substr(2, 9),
        taskId: taskId,
        toolType,
        autonomyLevel: finalLevel,
        status: actionStatus,
        aiReasoning: planResult.aiReasoning,
        payload
      };

      if (existingActionIndex !== -1) {
        actions[existingActionIndex] = fallbackAction;
      } else {
        actions.push(fallbackAction);
      }
      this.saveActions(actions);

      const originalTaskStatus = task.status;
      task.status = taskStatus;
      this.saveTasks(tasks);

      // Log based on final autonomy level
      if (finalLevel === "auto") {
        let summaryDetail = "";
        if (toolType === "draft_message") {
          summaryDetail = `[Auto] Message automatically sent to [${fallbackAction.payload.to}] (Offline).`;
        } else if (toolType === "schedule_event") {
          summaryDetail = `[Auto] Event [${fallbackAction.payload.title}] automatically booked (Offline).`;
        } else if (toolType === "generate_document") {
          summaryDetail = `[Auto] Document [${fallbackAction.payload.docTitle}] automatically generated (Offline).`;
        } else if (toolType === "prefill_link") {
          summaryDetail = `[Auto] Deep link prefilled for billing (Offline).`;
        } else if (toolType === "research_decide") {
          summaryDetail = `[Auto] Recommendation selected automatically (Offline).`;
        } else {
          summaryDetail = `[Auto] First step auto-started (Offline).`;
        }

        this.addLogEntry({
          taskTitle: task.title,
          summary: summaryDetail,
          autonomyLevel: "auto",
          undoable: true,
          taskId: task.id,
          actionId: fallbackAction.id,
          originalTaskStatus,
          originalActionStatus: "draft"
        });
      } else if (finalLevel === "stage") {
        this.addLogEntry({
          taskTitle: task.title,
          summary: `AI prepared and automatically STAGED a [${toolType}] action (Offline).`,
          autonomyLevel: "stage",
          undoable: false,
          taskId: task.id
        });
      } else {
        this.addLogEntry({
          taskTitle: task.title,
          summary: `AI prepared a new [${toolType}] action card (${finalLevel} level, Offline).`,
          autonomyLevel: finalLevel,
          undoable: false,
          taskId: task.id
        });
      }

      return { action: fallbackAction, task };
    }
  },

  // Save/Update specific Action payload (from UI editing)
  updateActionPayload(actionId: string, updatedPayload: any): Action {
    const actions = this.getActions();
    const idx = actions.findIndex(a => a.id === actionId);
    if (idx === -1) throw new Error("Action not found");

    actions[idx].payload = updatedPayload;
    this.saveActions(actions);
    return actions[idx];
  },

  // Stage action manually (Draft -> Staged)
  stageAction(actionId: string): { action: Action; task: Task } {
    const actions = this.getActions();
    const actionIdx = actions.findIndex(a => a.id === actionId);
    if (actionIdx === -1) throw new Error("Action not found");

    const action = actions[actionIdx];
    const tasks = this.getTasks();
    const taskIdx = tasks.findIndex(t => t.id === action.taskId);
    if (taskIdx === -1) throw new Error("Task not found");

    const task = tasks[taskIdx];

    const originalTaskStatus = task.status;
    const originalActionStatus = action.status;

    action.status = "staged";
    task.status = "awaiting_approval";

    this.saveActions(actions);
    this.saveTasks(tasks);

    this.addLogEntry({
      taskTitle: task.title,
      summary: `Action card manually staged to Approval Queue.`,
      autonomyLevel: action.autonomyLevel,
      undoable: true,
      taskId: task.id,
      actionId: action.id,
      originalTaskStatus,
      originalActionStatus
    });

    return { action, task };
  },

  // Execute (Approve & Execute). `emailResult` is supplied when executionType is
  // 'email' so the log can honestly record a real send (with id) vs a simulated one.
  executeAction(
    actionId: string,
    executionType: 'simulated' | 'mailto' | 'email' | 'ics',
    emailResult?: { id?: string; simulated?: boolean }
  ): { action: Action; task: Task } {
    const actions = this.getActions();
    const actionIdx = actions.findIndex(a => a.id === actionId);
    if (actionIdx === -1) throw new Error("Action not found");

    const action = actions[actionIdx];
    const tasks = this.getTasks();
    const taskIdx = tasks.findIndex(t => t.id === action.taskId);
    if (taskIdx === -1) throw new Error("Task not found");

    const task = tasks[taskIdx];

    // Store original statuses for undo purposes
    const originalTaskStatus = task.status;
    const originalActionStatus = action.status;

    // Transition statuses
    action.status = "executed";
    task.status = "done";

    this.saveActions(actions);
    this.saveTasks(tasks);

    // Create a detailed log entry with undo capabilities
    let summaryDetail = "";
    if (action.toolType === "draft_message") {
      if (executionType === 'email') {
        summaryDetail = emailResult?.simulated
          ? `Simulated send to [${action.payload.to}] (no email provider configured).`
          : `Sent via email to [${action.payload.to}]${emailResult?.id ? ` (id: ${emailResult.id})` : ""}.`;
      } else if (executionType === 'mailto') {
        summaryDetail = `Draft message approved. Opened in mail client to [${action.payload.to}].`;
      } else {
        summaryDetail = `Message simulated as SENT to [${action.payload.to}].`;
      }
    } else if (action.toolType === "schedule_event") {
      summaryDetail = executionType === 'ics'
        ? `Event [${action.payload.title}] exported as calendar (.ics) file.`
        : `Event [${action.payload.title}] successfully booked in calendar.`;
    } else if (action.toolType === "generate_document") {
      summaryDetail = `Document [${action.payload.docTitle}] generated & copy-saved.`;
    } else if (action.toolType === "prefill_link") {
      summaryDetail = `Navigated to [${action.payload.url}] with billing details prefilled.`;
    } else if (action.toolType === "research_decide") {
      summaryDetail = `Research recommendation approved: Chosen [${action.payload.recommendation.split('.')[0]}].`;
    } else {
      summaryDetail = `First step started: "${action.payload.firstStep}"`;
    }

    this.addLogEntry({
      taskTitle: task.title,
      summary: summaryDetail,
      autonomyLevel: action.autonomyLevel,
      undoable: true,
      taskId: task.id,
      actionId: action.id,
      originalTaskStatus,
      originalActionStatus
    });

    return { action, task };
  },

  // Reject / Dismiss Action Card
  rejectAction(actionId: string): { action: Action; task: Task } {
    const actions = this.getActions();
    const actionIdx = actions.findIndex(a => a.id === actionId);
    if (actionIdx === -1) throw new Error("Action not found");

    const action = actions[actionIdx];
    const tasks = this.getTasks();
    const taskIdx = tasks.findIndex(t => t.id === action.taskId);
    if (taskIdx === -1) throw new Error("Task not found");

    const task = tasks[taskIdx];
    const originalTaskStatus = task.status;
    const originalActionStatus = action.status;

    action.status = "rejected";
    task.status = "dismissed";

    this.saveActions(actions);
    this.saveTasks(tasks);

    this.addLogEntry({
      taskTitle: task.title,
      summary: "Action card dismissed and task hidden.",
      autonomyLevel: action.autonomyLevel,
      undoable: true,
      taskId: task.id,
      actionId: action.id,
      originalTaskStatus,
      originalActionStatus
    });

    return { action, task };
  },

  // Snooze Action Card (Increment snooze count)
  snoozeAction(actionId: string): { action: Action; task: Task } {
    const actions = this.getActions();
    const actionIdx = actions.findIndex(a => a.id === actionId);
    if (actionIdx === -1) throw new Error("Action not found");

    const action = actions[actionIdx];
    const tasks = this.getTasks();
    const taskIdx = tasks.findIndex(t => t.id === action.taskId);
    if (taskIdx === -1) throw new Error("Task not found");

    const task = tasks[taskIdx];
    task.snoozeCount += 1;

    // Simple reschedule - bump deadline to tomorrow. Use UTC date math to stay
    // consistent with the rest of the app's YYYY-MM-DD (UTC-midnight) handling
    // and avoid a timezone-dependent off-by-one day shift.
    const currentDeadline = task.deadline ? new Date(task.deadline) : todayUTC();
    currentDeadline.setUTCDate(currentDeadline.getUTCDate() + 1);
    task.deadline = currentDeadline.toISOString().split('T')[0];

    this.saveTasks(tasks);

    this.addLogEntry({
      taskTitle: task.title,
      summary: `Action plan snoozed (Snooze Count: ${task.snoozeCount}). Deadline shifted to tomorrow.`,
      autonomyLevel: action.autonomyLevel,
      undoable: false,
      taskId: task.id
    });

    return { action, task };
  },

  // Undo Log Entry
  undoActivity(logId: string): void {
    const logs = this.getLogs();
    const logIdx = logs.findIndex(l => l.id === logId);
    if (logIdx === -1) return;

    const log = logs[logIdx];
    if (!log.undoable || log.undone) return;

    const tasks = this.getTasks();
    const taskIdx = tasks.findIndex(t => t.id === log.taskId);

    const actions = this.getActions();
    // Prefer the exact action this log refers to; fall back to the task's action
    // for older log entries written before actionId was tracked.
    const actionIdx = log.actionId
      ? actions.findIndex(a => a.id === log.actionId)
      : actions.findIndex(a => a.taskId === log.taskId);

    if (taskIdx !== -1 && log.originalTaskStatus) {
      tasks[taskIdx].status = log.originalTaskStatus;
      this.saveTasks(tasks);
    }

    if (actionIdx !== -1 && log.originalActionStatus) {
      actions[actionIdx].status = log.originalActionStatus as any;
      this.saveActions(actions);
    }

    log.undone = true;
    log.summary = `[UNDONE] ${log.summary}`;
    this.saveLogs(logs);

    this.addLogEntry({
      taskTitle: log.taskTitle,
      summary: `Undid action: "${log.taskTitle}" has been restored to its previous state.`,
      autonomyLevel: log.autonomyLevel,
      undoable: false,
      taskId: log.taskId
    });
  },

  // Add Task with NL Parsing support
  async addTask(title: string, description: string = ""): Promise<Task> {
    const profile = this.getProfile();
    let parsedFields: {
      title: string;
      deadline: string;
      category: string;
      priorityScore: number;
      riskLevel: 'low' | 'med' | 'high';
    } = {
      title,
      deadline: "",
      category: "Personal",
      priorityScore: 50,
      riskLevel: "low"
    };

    try {
      // Call parse-task endpoint
      const response = await fetch("/api/parse-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: title, profile })
      });

      if (response.ok) {
        parsedFields = await response.json();
      }
    } catch (err) {
      console.log("NL parsing (using simulated local parser fallback).");
      parsedFields = simulateParseTask(title);
    }

    const newTask: Task = {
      id: "task_" + Math.random().toString(36).substr(2, 9),
      title: parsedFields.title || title,
      description: description || `Manually entered task`,
      deadline: parsedFields.deadline || new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0], // default 2 days out
      category: parsedFields.category || "Personal",
      priorityScore: parsedFields.priorityScore || 50,
      riskLevel: parsedFields.riskLevel || "low",
      status: "inbox", // starts in inbox, ready to prepare
      snoozeCount: 0,
      source: "Manual Entry",
      isNew: true // highlight it the first time it appears, then cleared
    };

    const tasks = this.getTasks();
    tasks.push(newTask);
    this.saveTasks(tasks);

    this.addLogEntry({
      taskTitle: newTask.title,
      summary: `Created new task in Inbox: "${newTask.title}" [Category: ${newTask.category}]`,
      autonomyLevel: "manual",
      undoable: false,
      taskId: newTask.id
    });

    // Auto-prepare immediately as requested: "watch Gemini pick a tool and generate the card"
    // Let's launch this async in background so user gets the task, but wait, we can do it!
    return newTask;
  }
};
