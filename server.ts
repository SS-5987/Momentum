import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
// NOTE: `vite` is intentionally NOT imported at the top level. It is a dev-only
// dependency and importing it eagerly would crash a production deploy that pruned
// devDependencies (`npm install --omit=dev`). It is lazily imported in dev mode below.

// Load environment variables. `.env.local` (gitignored) takes precedence over `.env`.
dotenv.config({ path: ".env.local" });
dotenv.config();

const app = express();
// Cloud Run and most PaaS inject PORT (commonly 8080) and health-check against it.
// Hardcoding would fail readiness checks outside the AI Studio wrapper.
const PORT = Number(process.env.PORT) || 3000;

// Model is configurable so we don't have to redeploy to swap models. Default to a
// known-valid current model. (The previous hardcoded "gemini-3.5-flash" does not
// exist, so every live call 404'd and silently fell back to the local simulation.)
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Date helpers so "today" is dynamic instead of frozen.
function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function getTodayInfo() {
  const d = todayUTC();
  return {
    iso: d.toISOString().split("T")[0],
    long: d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }),
  };
}
function nextWeekday(from: Date, weekday: number): Date {
  const result = new Date(from);
  const delta = ((weekday - from.getUTCDay() + 7) % 7) || 7;
  result.setUTCDate(result.getUTCDate() + delta);
  return result;
}

// Ensure JSON parsing. Cap body size so a malicious/oversized payload can't
// balloon memory — these endpoints only ever receive small task/profile objects.
app.use(express.json({ limit: "64kb" }));

// Lightweight in-memory rate limiter for the AI endpoints. Prevents a single
// client from draining the Gemini quota/budget. Per-IP, fixed window.
// (In-memory is fine for a single instance; use a shared store if you scale out.)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else if (bucket.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "Too many requests. Please slow down." });
  } else {
    bucket.count++;
  }
  next();
}
app.use("/api", rateLimit);

// Periodically evict stale rate-limit buckets so the Map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// Initialize Gemini Client
const apiKey = process.env.GEMINI_API_KEY;
const isRealKey = apiKey && apiKey !== "MY_GEMINI_API_KEY" && apiKey.trim() !== "";

const ai = new GoogleGenAI({
  apiKey: isRealKey ? apiKey : "dummy_key",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Email (Resend) config. Server-side only — never exposed to the client.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "Momentum <onboarding@resend.dev>";
const isResendConfigured = !!(RESEND_API_KEY && RESEND_API_KEY.trim() && RESEND_API_KEY !== "MY_RESEND_API_KEY");

// Resilient API Caller with exponential backoff retries for transient failures (e.g., 503)
async function callGeminiWithRetry(params: any, maxRetries = 3, delayMs = 1500): Promise<any> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const response = await ai.models.generateContent(params);
      return response;
    } catch (error: any) {
      attempt++;
      console.warn(`[Gemini API] Call failed (attempt ${attempt}/${maxRetries}): ${error?.message || error}`);
      if (attempt >= maxRetries) {
        throw error;
      }
      const backoffDelay = delayMs * Math.pow(2, attempt - 1);
      console.warn(`[Gemini API] Retrying in ${backoffDelay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }
}

// Helper for realistic simulated task parsing (fallback)
function simulateParseTask(input: string) {
  const lowercase = input.toLowerCase();
  let category = "Personal";
  let deadline = "";
  let priorityScore = 50;
  let riskLevel: 'low' | 'med' | 'high' = "low";

  // Simple heuristic parsing
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

  // Generate a mock deadline
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
    riskLevel
  };
}

// Helper for realistic simulated plan (fallback)
function simulatePlanAction(task: any, profile: any, forceToolType?: string) {
  const title = task.title.toLowerCase();
  const writingTone = profile?.writingTone || "professional";
  const signature = profile?.signature || `Best, ${profile?.name || "User"}`;
  const firstContact = profile?.contacts?.[0] || { name: "Prof. Lee", email: "lee.j@university.edu" };

  if (forceToolType === "breakdown_first_step" || (task.snoozeCount && task.snoozeCount >= 3)) {
    return {
      toolType: "breakdown_first_step",
      aiReasoning: "You have snoozed this task multiple times, so I have broken it down into tiny, low-friction steps with an immediate 5-minute start action.",
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

// ENDPOINTS

// 1. Natural Language Parse Task
app.post("/api/parse-task", async (req, res) => {
  const { input, profile } = req.body;
  if (!input) {
    return res.status(400).json({ error: "Input is required" });
  }

  // Fallback if key is missing
  if (!isRealKey) {
    console.log("No valid Gemini API key found. Using simulation engine for parsing.");
    return res.json(simulateParseTask(input));
  }

  try {
    const { iso: todayStr, long: todayLong } = getTodayInfo();
    const prompt = `You are the backend parsing engine of Momentum, an advanced task-preparation planner.
Today is ${todayLong}.
Parse the following natural language task statement: "${input}".

Formulate the response according to the requested schema. Return:
- title: Clean, human-readable title of the task
- deadline: Derived deadline date in YYYY-MM-DD format based on today (${todayStr}), or empty string if not mentioned.
- category: A category like "Email", "Study", "Personal", "Finance", "Research", "Schedule", or "Work"
- priorityScore: Integer from 1 to 100 based on urgency and priority
- riskLevel: Either "low", "med", or "high"

User profile context:
Name: ${profile?.name || "User"}
Role: ${profile?.role || "Student"}
Writing Tone: ${profile?.writingTone || "Professional"}`;

    const response = await callGeminiWithRetry({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            deadline: { type: Type.STRING },
            category: { type: Type.STRING },
            priorityScore: { type: Type.INTEGER },
            riskLevel: { type: Type.STRING, enum: ["low", "med", "high"] }
          },
          required: ["title", "category", "priorityScore", "riskLevel"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from Gemini API");
    }

    const data = JSON.parse(text.trim());
    return res.json(data);

  } catch (error: any) {
    console.error("[parse-task] Gemini call failed; using local simulation fallback.", error?.message || error);
    // Graceful fallback
    return res.json(simulateParseTask(input));
  }
});

// 2. Plan Action (The Heart of the App)
app.post("/api/plan-action", async (req, res) => {
  const { task, profile, forceToolType } = req.body;
  if (!task) {
    return res.status(400).json({ error: "Task is required" });
  }

  const isForceBreakdown = forceToolType === "breakdown_first_step" || (task.snoozeCount && task.snoozeCount >= 3);

  if (!isRealKey) {
    console.log("No valid Gemini API key found. Using simulation engine for planning.");
    return res.json(simulatePlanAction(task, profile, forceToolType));
  }

  try {
    const { iso: todayStr, long: todayLong } = getTodayInfo();
    const contactsStr = profile?.contacts ? JSON.stringify(profile.contacts) : "[]";
    const savedDetailsStr = profile?.savedDetails ? JSON.stringify(profile.savedDetails) : "{}";

    let forcePromptText = "";
    if (isForceBreakdown) {
      forcePromptText = `\n\nCRITICAL OVERRIDE: Since this task has been snoozed multiple times (or is forced), you MUST select "breakdown_first_step" as the toolType. Provide 4 tiny, low-friction, 5-minute subtasks, and an immediate firstStep of 5-minutes max that the user can easily start on immediately to overcome procrastination. Do NOT choose any other toolType.`;
    }

    const prompt = `You are Momentum's Central AI Action Planner.
Today is ${todayLong}.

Analyze the following task and user profile to select exactly ONE tool from the toolbox below, fill its exact parameters, and write a one-sentence reasoning.${forcePromptText}

TASK DETAILS:
Title: "${task.title}"
Description: "${task.description || "No description provided."}"
Category: "${task.category}"
Deadline: "${task.deadline || "No deadline"}"
Priority Score: ${task.priorityScore}
Risk Level: "${task.riskLevel}"

USER PROFILE:
Name: "${profile?.name || "User"}"
Role: "${profile?.role || "Student"}"
Writing Tone: "${profile?.writingTone || "Professional"}"
Signature: "${profile?.signature || ""}"
Contacts List: ${contactsStr}
Saved Reference Details: ${savedDetailsStr}

TOOLBOX (Choose EXACTLY ONE tool that fits best):
1. draft_message — For correspondence with people (emails, DMs, replies, requests). Fill 'to', 'subject', 'body', 'tone'.
2. schedule_event — For calendar-blocking, scheduling, focused blocks, or meetings. Fill 'title', 'proposedStart' (ISO 8601 string), 'durationMinutes', 'notes', 'needsOtherParty'.
3. generate_document — For drafting content, reports, summaries, cover letters, outlines. Fill 'docTitle', 'contentMarkdown'.
4. prefill_link — For external checkouts, payments, form-submits, or portals. Fill 'url', 'instructions', 'prefillData'.
5. research_decide — For research, shopping, options comparison, decisions. Fill 'query', 'summary', 'recommendation'.
6. breakdown_first_step — Fallback for human-only actions ("study for database exam", "clean room"). Fill 'subtasks' (string array), 'firstStep' (a micro-step of 5-minutes max).

Be highly creative and personalized. Draft complete, finished emails (using the user's name/signature), schedule realistic time slots (e.g., starting tomorrow morning or relative to today: ${todayStr}), create complete professional documents in markdown (no bullet-point summaries for documents, draft the actual document), write detailed instructions, and list concrete recommendations.

You MUST choose exactly one toolType and complete only its corresponding fields in the output JSON. Fill 'toolType' and 'aiReasoning', plus the specific payload block.`;

    const response = await callGeminiWithRetry({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            toolType: {
              type: Type.STRING,
              description: "The name of the selected tool"
            },
            aiReasoning: {
              type: Type.STRING,
              description: "A one-sentence explanation of why you chose this tool"
            },
            draft_message: {
              type: Type.OBJECT,
              properties: {
                to: { type: Type.STRING },
                subject: { type: Type.STRING },
                body: { type: Type.STRING },
                tone: { type: Type.STRING }
              },
              required: ["to", "subject", "body", "tone"]
            },
            schedule_event: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                proposedStart: { type: Type.STRING },
                durationMinutes: { type: Type.INTEGER },
                notes: { type: Type.STRING },
                needsOtherParty: { type: Type.BOOLEAN }
              },
              required: ["title", "proposedStart", "durationMinutes", "notes", "needsOtherParty"]
            },
            generate_document: {
              type: Type.OBJECT,
              properties: {
                docTitle: { type: Type.STRING },
                contentMarkdown: { type: Type.STRING }
              },
              required: ["docTitle", "contentMarkdown"]
            },
            prefill_link: {
              type: Type.OBJECT,
              properties: {
                url: { type: Type.STRING },
                instructions: { type: Type.STRING },
                prefillData: {
                  type: Type.OBJECT,
                  properties: {
                    amount: { type: Type.STRING },
                    accountNumber: { type: Type.STRING },
                    dueDate: { type: Type.STRING }
                  }
                }
              },
              required: ["url", "instructions"]
            },
             research_decide: {
              type: Type.OBJECT,
              properties: {
                query: { type: Type.STRING },
                summary: { type: Type.STRING },
                recommendation: { type: Type.STRING },
                supportingPoints: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["query", "summary", "recommendation"]
            },
            breakdown_first_step: {
              type: Type.OBJECT,
              properties: {
                subtasks: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                firstStep: { type: Type.STRING }
              },
              required: ["subtasks", "firstStep"]
            }
          },
          required: ["toolType", "aiReasoning"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from Gemini API");
    }

    const data = JSON.parse(text.trim());

    if (data.toolType === "research_decide" && isRealKey) {
      try {
        const queryToUse = data.research_decide?.query || task.title;
        console.log(`[Google Search Grounding] Researching query: "${queryToUse}"`);
        const searchPrompt = `You are Momentum's expert research assistant.
Today is ${todayLong}.
Conduct a web search for the following query: "${queryToUse}".
Based on real, current web results, compile:
1. A highly accurate, comprehensive comparative summary (3-4 sentences max).
2. A clear recommended decision (e.g. "Choose X because of Y...").
3. A list of exactly 3-4 supporting points beneath it that justify this decision based on specific up-to-date details.

Provide the response as a JSON object adhering exactly to the following schema:
{
  "query": "the search query",
  "summary": "comparative summary text",
  "recommendation": "the recommended decision",
  "supportingPoints": ["supporting point 1", "supporting point 2", "supporting point 3"]
}`;

        const searchResponse = await callGeminiWithRetry({
          model: GEMINI_MODEL,
          contents: searchPrompt,
          config: {
            tools: [{ googleSearch: {} }],
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                query: { type: Type.STRING },
                summary: { type: Type.STRING },
                recommendation: { type: Type.STRING },
                supportingPoints: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["query", "summary", "recommendation", "supportingPoints"]
            }
          }
        });

        if (searchResponse?.text) {
          const groundedResult = JSON.parse(searchResponse.text.trim());
          data.research_decide = groundedResult;
          console.log("[Google Search Grounding] Successfully retrieved grounded summary & recommendation.");
        }
      } catch (searchErr) {
        console.log("Failed executing Google Search grounding for research task:", searchErr);
        // Ensure supportingPoints exists anyway as fallback
        if (data.research_decide && !data.research_decide.supportingPoints) {
          data.research_decide.supportingPoints = [
            "Provides the best performance and reliability under peak load conditions.",
            "Highly recommended by current user reviews and tech benchmarks.",
            "Ensures full compatibility with modern web technologies and frameworks."
          ];
        }
      }
    }

    return res.json(data);

  } catch (error: any) {
    console.error("[plan-action] Gemini call failed; using local simulation fallback.", error?.message || error);
    return res.json(simulatePlanAction(task, profile, forceToolType));
  }
});

// 3. Generate Briefing — returns a compact, structured payload (not a paragraph):
//   { headline (<=20 words), stats:{urgent,ready,stalled}, next:{taskId,title,reason} }
// Counts and the "next" pick are computed deterministically here; Gemini only writes
// the short headline + one-line reason (with a graceful local fallback).
app.post("/api/generate-briefing", async (req, res) => {
  const { tasks, profile } = req.body;
  const { long: todayLong } = getTodayInfo();

  const activeTasks = (tasks || []).filter((t: any) => t.status !== "done" && t.status !== "dismissed");

  // Deterministic stats.
  const stats = {
    urgent: activeTasks.filter((t: any) => t.riskLevel === "high").length,
    ready: activeTasks.filter((t: any) => t.status === "action_ready" || t.status === "awaiting_approval").length,
    stalled: activeTasks.filter((t: any) => (t.snoozeCount || 0) >= 3).length,
  };

  // Recommended next action: highest priority active task (tie-break: earliest deadline).
  const ranked = [...activeTasks].sort((a: any, b: any) => {
    const pd = (b.priorityScore || 0) - (a.priorityScore || 0);
    if (pd !== 0) return pd;
    const at = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const bt = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return at - bt;
  });
  const nextTask = ranked[0] || null;

  const fallbackHeadline = activeTasks.length === 0
    ? "All clear — nothing pending today."
    : `${stats.ready} prepared, ${stats.urgent} urgent — start with "${nextTask?.title || "your top task"}".`;
  const fallbackReason = nextTask
    ? `Highest priority${nextTask.deadline ? ` and due ${nextTask.deadline}` : ""}.`
    : "";

  const buildPayload = (headline: string, reason: string) => ({
    headline,
    stats,
    next: nextTask ? { taskId: nextTask.id, title: nextTask.title, reason } : null,
  });

  if (!isRealKey || !nextTask) {
    return res.json(buildPayload(fallbackHeadline, fallbackReason));
  }

  try {
    const summaryOfTasks = ranked
      .slice(0, 8)
      .map((t: any) => `- ${t.title} (Category: ${t.category}, Deadline: ${t.deadline || "none"}, Priority: ${t.priorityScore}, Risk: ${t.riskLevel})`)
      .join("\n");

    const prompt = `You are Momentum's concise Chief of Staff. Today is ${todayLong}.
User: ${profile?.name || "User"} (${profile?.role || "Professional"}).

Stats — urgent(high-risk): ${stats.urgent}, prepared/ready: ${stats.ready}, stalled(snoozed 3x+): ${stats.stalled}.
Recommended next task: "${nextTask.title}" (deadline ${nextTask.deadline || "none"}, risk ${nextTask.riskLevel}).
Active tasks:
${summaryOfTasks || "None."}

Return JSON only:
- "headline": ONE short, calm, motivating sentence, MAX 20 words. No lists. May reference the urgent count or the next task.
- "reason": ONE short clause (max 12 words) on WHY to start the recommended next task now.`;

    const response = await callGeminiWithRetry({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headline: { type: Type.STRING },
            reason: { type: Type.STRING },
          },
          required: ["headline", "reason"],
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini API");
    const data = JSON.parse(text.trim());
    return res.json(buildPayload(data.headline?.trim() || fallbackHeadline, data.reason?.trim() || fallbackReason));

  } catch (error: any) {
    console.error("[generate-briefing] Gemini call failed; using deterministic fallback.", error?.message || error);
    return res.json(buildPayload(fallbackHeadline, fallbackReason));
  }
});

// 4. Health / status — lets the UI (and uptime checks) know whether live AI is
// actually reachable or whether we're silently running on the local simulation.
// By default this is CHEAP (no Gemini call) so it's safe to use as a liveness probe.
// Pass ?deep=1 to actually ping Gemini and confirm the key/model work end-to-end.
app.get("/api/health", async (req, res) => {
  // `email` tells the client whether real sending is configured (without leaking the key).
  if (!isRealKey) {
    return res.json({ status: "ok", mode: "simulation", model: GEMINI_MODEL, email: isResendConfigured, reason: "No GEMINI_API_KEY configured." });
  }
  if (req.query.deep !== "1") {
    // Configured but unverified: report capability without spending a token.
    return res.json({ status: "ok", mode: "live-capable", model: GEMINI_MODEL, email: isResendConfigured });
  }
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: "ping",
    });
    const live = Boolean(response?.text);
    return res.json({ status: "ok", mode: live ? "live" : "simulation", model: GEMINI_MODEL, email: isResendConfigured });
  } catch (error: any) {
    // Key/model is configured but the call failed — report it so it isn't masked.
    return res.json({ status: "ok", mode: "simulation", model: GEMINI_MODEL, email: isResendConfigured, reason: error?.message || "Gemini call failed." });
  }
});

// FEATURE 1: Real email sending via Resend (https://resend.com), with graceful
// simulation fallback if no key is configured or the send fails. Mirrors the
// isReal/try-catch pattern used for Gemini so the demo never hard-fails on stage.
app.post("/api/send-email", async (req, res) => {
  const { to, subject, body, replyTo } = req.body || {};
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "to, subject and body are required" });
  }

  // No provider configured → honest simulation. The app continues as if sent.
  if (!isResendConfigured) {
    console.warn(`[send-email] No RESEND_API_KEY configured — SIMULATING send to ${to} ("${subject}").`);
    return res.json({ ok: true, simulated: true });
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        text: body,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // Provider rejected the send (bad domain/key/etc.) — degrade to simulation
      // rather than failing the user-facing action.
      console.error(`[send-email] Resend returned ${resp.status}:`, data);
      return res.json({ ok: true, simulated: true });
    }

    console.log(`[send-email] Sent to ${to} via Resend (id: ${data?.id}).`);
    return res.json({ ok: true, id: data?.id });
  } catch (err: any) {
    console.error("[send-email] Send failed; simulating instead.", err?.message || err);
    return res.json({ ok: true, simulated: true });
  }
});

// Serve frontend assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Lazy import so production deploys that prune devDependencies never require vite.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Error-handling middleware must be registered AFTER all routes so it can catch
  // errors thrown from any of them (including the static / SPA fallback). Returns
  // JSON rather than Express's default HTML page for these API-first endpoints.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
      return res.status(400).json({ error: "Invalid JSON in request body" });
    }
    console.error("[Unhandled server error]", err);
    return res.status(500).json({ error: "Internal server error" });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT} [mode: ${isRealKey ? "live-capable" : "simulation"}, model: ${GEMINI_MODEL}]`);
  });
}

startServer();
