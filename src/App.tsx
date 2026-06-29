import React, { useState, useEffect, useRef, useMemo } from "react";
import { Task, Action, ActivityLogEntry, Profile, ToolType } from "./types";
import { StorageEngine, getPriorityLevel, compareTasksByDeadline } from "./utils/storage";
import ActionCard from "./components/ActionCard";
import VoiceInputButton from "./components/VoiceInputButton";
import CloseDayPanel, { CloseStep, CloseReceipt } from "./components/CloseDayPanel";
import { downloadIcs } from "./utils/ics";
import { useBgm, BGM_TRACKS, BgmMode, autoTrackKey } from "./hooks/useBgm";
import { 
  Sun, 
  ListTodo, 
  History, 
  Settings as SettingsIcon, 
  Sparkles, 
  Plus, 
  Check, 
  RotateCcw, 
  User, 
  HelpCircle, 
  Layers, 
  TrendingUp, 
  Trash2, 
  PlusCircle, 
  ShieldAlert,
  Inbox,
  Clock,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Sliders,
  CheckCircle2,
  Mail,
  Calendar,
  FileText,
  Search,
  Zap,
  Music,
  Volume2,
  VolumeX,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const BRIEFING_CACHE_KEY = "clearpath_briefing_cache";
const todayISO = () => new Date().toISOString().split("T")[0];

// Human-readable deadline. Parsed in UTC to match the YYYY-MM-DD (UTC-midnight)
// deadline strings used throughout the app, avoiding off-by-one in other timezones.
const formatDeadline = (dateStr: string): string => {
  if (!dateStr) return "No deadline";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

// Compact, structured briefing returned by /api/generate-briefing.
interface BriefingData {
  headline: string;
  stats: { urgent: number; ready: number; stalled: number };
  next: { taskId: string; title: string; reason: string } | null;
}

// Returns today's cached briefing payload, or null if absent/stale (so a returning
// user never sees yesterday's briefing).
const readFreshBriefing = (): BriefingData | null => {
  try {
    const raw = localStorage.getItem(BRIEFING_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.date === todayISO() && parsed.payload && typeof parsed.payload.headline === "string") {
      return parsed.payload as BriefingData;
    }
  } catch { /* ignore corrupt/legacy cache */ }
  return null;
};

// Helper to get day label for grouping logs
const getDayLabel = (timestamp: string): string => {
  try {
    const d = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) {
      return "Today";
    } else if (d.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    } else {
      return d.toLocaleDateString("en-US", { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    }
  } catch {
    return "Earlier";
  }
};

// Grouping logs by day label
const groupLogsByDay = (logsList: ActivityLogEntry[]) => {
  const groups: { [key: string]: ActivityLogEntry[] } = {};
  
  // Sort logs by timestamp descending so newer items come first
  const sortedLogs = [...logsList].sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  sortedLogs.forEach(log => {
    const dayLabel = getDayLabel(log.timestamp);
    if (!groups[dayLabel]) {
      groups[dayLabel] = [];
    }
    groups[dayLabel].push(log);
  });

  return groups;
};

// Retrieve tool type for a log entry
const getLogToolType = (log: ActivityLogEntry, actionsList: Action[]): ToolType | undefined => {
  if (log.toolType) return log.toolType;
  const assocAction = actionsList.find(a => a.taskId === log.taskId);
  if (assocAction) return assocAction.toolType;
  
  // Parse from summary text
  const match = log.summary.match(/\[([a-z_]+)\]/);
  if (match) {
    const parsed = match[1] as ToolType;
    const validTools: ToolType[] = ["draft_message", "schedule_event", "generate_document", "prefill_link", "research_decide", "breakdown_first_step"];
    if (validTools.includes(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

// Retrieve tool visual metadata
const getLogToolMeta = (toolType?: ToolType) => {
  switch (toolType) {
    case "draft_message":
      return { icon: Mail, label: "Draft Message", color: "text-emerald-600 bg-emerald-50 border-emerald-100" };
    case "schedule_event":
      return { icon: Calendar, label: "Schedule Event", color: "text-blue-600 bg-blue-50 border-blue-100" };
    case "generate_document":
      return { icon: FileText, label: "Generate Document", color: "text-purple-600 bg-purple-50 border-purple-100" };
    case "prefill_link":
      return { icon: ExternalLink, label: "Smart Link", color: "text-amber-600 bg-amber-50 border-amber-100" };
    case "research_decide":
      return { icon: Search, label: "Research & Decide", color: "text-cyan-600 bg-cyan-50 border-cyan-100" };
    case "breakdown_first_step":
      return { icon: ListTodo, label: "Action Breakdown", color: "text-rose-600 bg-rose-50 border-rose-100" };
    default:
      return { icon: CheckCircle2, label: "System Action", color: "text-slate-600 bg-slate-50 border-slate-100" };
  }
};

// Style mapping for autonomy levels
const getAutonomyBadgeStyle = (level: string) => {
  switch (level?.toLowerCase()) {
    case "auto":
      return "bg-emerald-50 text-emerald-700 border-emerald-100";
    case "stage":
      return "bg-amber-50 text-amber-700 border-amber-100";
    case "draft":
    case "manual":
    default:
      return "bg-slate-50 text-slate-700 border-slate-100";
  }
};

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<"briefing" | "tasks" | "queue" | "activity" | "settings">("briefing");

  // State loaded from localStorage
  const [profile, setProfile] = useState<Profile>(defaultProfileState());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);

  // Page States
  const [morningBriefing, setMorningBriefing] = useState<BriefingData | null>(null);
  const [loadingBriefing, setLoadingBriefing] = useState<boolean>(false);
  const [runningAgent, setRunningAgent] = useState<boolean>(false);
  const [agentToast, setAgentToast] = useState<string | null>(null);
  const [newTaskInput, setNewTaskInput] = useState<string>("");
  const [newTaskDesc, setNewTaskDesc] = useState<string>("");
  const [parsingTask, setParsingTask] = useState<boolean>(false);
  const [preparingTaskId, setPreparingTaskId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Email send state. `emailLive` is fetched from /api/health (no key ever exposed).
  const [emailLive, setEmailLive] = useState<boolean>(false);
  const [sendingActionId, setSendingActionId] = useState<string | null>(null);

  // Background music engine (plays on loop from app open; settings in the Settings tab).
  const bgm = useBgm();

  // "Close my Day" stepped-execution panel state.
  const [closeOpen, setCloseOpen] = useState<boolean>(false);
  const [closeRunning, setCloseRunning] = useState<boolean>(false);
  const [closeSteps, setCloseSteps] = useState<CloseStep[]>([]);
  const [closeReceipt, setCloseReceipt] = useState<CloseReceipt | null>(null);

  // Suggested Prompts
  const suggestedPrompts = [
    "Write a quick follow-up to Sarah Jenkins about internship files",
    "Book a database study review slot on Friday at 4pm",
    "Review standard outline for marketing launch campaign",
    "Pay subscription bill"
  ];

  // Load Initial State (guarded so StrictMode's double-invoke in dev doesn't
  // fire duplicate agent runs / briefing API calls).
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    // Reset persisted collections if the stored schema is older than the code's.
    StorageEngine.ensureSchema();

    // Force seeding by reading
    const prof = StorageEngine.getProfile();
    const t = StorageEngine.getTasks();
    const act = StorageEngine.getActions();
    const l = StorageEngine.getLogs();

    setProfile(prof);
    setTasks(t);
    setActions(act);
    setLogs(l);

    // Show today's cached briefing immediately if we have one. runAgent(true) will
    // only (re)generate the briefing when the cache is stale, avoiding a redundant
    // Gemini call on every load.
    const fresh = readFreshBriefing();
    if (fresh) setMorningBriefing(fresh);

    // Trigger Agent Run on App Load to auto-prepare/refresh priorities
    runAgent(true);

    // Discover whether real email sending is configured (server-side only).
    fetch("/api/health")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && typeof d.email === "boolean") setEmailLive(d.email); })
      .catch(() => { /* leave as simulated */ });
  }, []);

  // Auto-dismiss the agent run summary toast.
  useEffect(() => {
    if (!agentToast) return;
    const id = setTimeout(() => setAgentToast(null), 5000);
    return () => clearTimeout(id);
  }, [agentToast]);

  // Clear the "New" highlight a few seconds after newly-added tasks first render,
  // and persist it, so the accent only ever shows once per task.
  useEffect(() => {
    if (!tasks.some(t => t.isNew)) return;
    const id = setTimeout(() => {
      StorageEngine.clearNewFlags();
      setTasks(StorageEngine.getTasks());
    }, 4500);
    return () => clearTimeout(id);
  }, [tasks]);

  function defaultProfileState(): Profile {
    return {
      name: "Alex Mercer",
      email: "alex.mercer@gmail.com",
      role: "Software Engineering Intern",
      writingTone: "Concise & professional, ending with an elegant signature",
      signature: "Best, Alex Mercer",
      contacts: [],
      savedDetails: {},
      autonomySettings: {
        draft_message: "stage",
        schedule_event: "stage",
        generate_document: "draft",
        prefill_link: "stage",
        research_decide: "draft",
        breakdown_first_step: "draft"
      }
    };
  }

  // Refresh data helpers
  const refreshAllStates = () => {
    setTasks(StorageEngine.getTasks());
    setActions(StorageEngine.getActions());
    setLogs(StorageEngine.getLogs());
    setProfile(StorageEngine.getProfile());
  };

  // Run Agent to auto-schedule/prepare top & high risk tasks and shrink snoozed ones
  async function runAgent(forceOnLoad = false) {
    if (runningAgent) return;
    setRunningAgent(true);
    try {
      const currentTasks = StorageEngine.getTasks();
      const currentProfile = StorageEngine.getProfile();
      const openTasks = currentTasks.filter(t => t.status !== "done" && t.status !== "dismissed");

      // Sort open tasks by priority score descending
      const sortedOpen = [...openTasks].sort((a, b) => b.priorityScore - a.priorityScore);

      // Top tasks (top 3) and all high-risk tasks
      const topTasks = sortedOpen.slice(0, 3);
      const highRiskTasks = sortedOpen.filter(t => t.riskLevel === "high");

      // Combine target tasks (using Map to keep unique)
      const targetTasksMap = new Map<string, Task>();
      topTasks.forEach(t => targetTasksMap.set(t.id, t));
      highRiskTasks.forEach(t => targetTasksMap.set(t.id, t));

      // Also ensure procrastinated ones with snoozeCount >= 3 are prepared as breakdown_first_step
      const highSnoozedTasks = openTasks.filter(t => (t.snoozeCount || 0) >= 3);
      highSnoozedTasks.forEach(t => targetTasksMap.set(t.id, t));

      const actionsList = StorageEngine.getActions();

      // Track what the agent actually did so we can report it (fix: "Run Agent" was a
      // silent no-op when everything was already prepared).
      let preparedCount = 0;
      let reshrankCount = 0;

      for (const [id, t] of targetTasksMap.entries()) {
        const existingAction = actionsList.find(a => a.taskId === t.id);
        const isSnoozedProcrastinated = (t.snoozeCount || 0) >= 3;
        const needsBreakdownRegen = isSnoozedProcrastinated && (!existingAction || existingAction.toolType !== "breakdown_first_step");

        // If the task does not have an action yet, OR has snoozeCount >= 3 but hasn't been shrunken/regenerated
        if (t.status === "inbox" || needsBreakdownRegen) {
          const forceToolType = isSnoozedProcrastinated ? ("breakdown_first_step" as ToolType) : undefined;
          await StorageEngine.prepareTask(t.id, forceToolType);
          if (t.status === "inbox") preparedCount++;
          else reshrankCount++;
        }
      }

      // Synchronize states
      const refreshedTasks = StorageEngine.getTasks();
      setTasks(refreshedTasks);
      setActions(StorageEngine.getActions());
      setLogs(StorageEngine.getLogs());
      setProfile(StorageEngine.getProfile());

      // Build a human summary of the run and surface it as a transient toast (only on
      // an explicit "Run agent now" — not the silent on-load run).
      if (!forceOnLoad) {
        const highRiskCount = highRiskTasks.length;
        const parts: string[] = [];
        if (preparedCount > 0) parts.push(`Prepared ${preparedCount} action${preparedCount === 1 ? "" : "s"}`);
        if (reshrankCount > 0) parts.push(`re-shrank ${reshrankCount} stalled task${reshrankCount === 1 ? "" : "s"}`);
        if (highRiskCount > 0) parts.push(`flagged ${highRiskCount} high-risk`);
        if (parts.length === 0) {
          const readyNow = refreshedTasks.filter(t => t.status === "action_ready" || t.status === "awaiting_approval").length;
          setAgentToast(`Everything's already prepared — ${readyNow} action${readyNow === 1 ? "" : "s"} ready.`);
        } else {
          // Sentence-case the joined summary.
          const joined = parts.join(", ");
          setAgentToast(joined.charAt(0).toUpperCase() + joined.slice(1) + ".");
        }
      }

      // Regenerate the morning briefing only when needed: always on an explicit
      // "Run agent now" (forceOnLoad=false), but on initial load skip it if today's
      // briefing is already cached. Saves a Gemini call on every page load.
      if (!forceOnLoad || !readFreshBriefing()) {
        await generateMorningBriefing(refreshedTasks, currentProfile);
      }

    } catch (err) {
      console.log("Agent run completed with standard status.", err);
    } finally {
      setRunningAgent(false);
    }
  };

  // Build a deterministic briefing payload locally (used as a fallback when the
  // server/Gemini call fails), mirroring the server's structured shape.
  function buildLocalBriefing(currentTasks: Task[]): BriefingData {
    const active = currentTasks.filter(t => t.status !== "done" && t.status !== "dismissed");
    const stats = {
      urgent: active.filter(t => t.riskLevel === "high").length,
      ready: active.filter(t => t.status === "action_ready" || t.status === "awaiting_approval").length,
      stalled: active.filter(t => (t.snoozeCount || 0) >= 3).length,
    };
    const next = [...active].sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))[0];
    const headline = active.length === 0
      ? "All clear — nothing pending today."
      : `${stats.ready} prepared, ${stats.urgent} urgent — start with "${next?.title || "your top task"}".`;
    return {
      headline,
      stats,
      next: next ? { taskId: next.id, title: next.title, reason: next.deadline ? `Highest priority, due ${next.deadline}.` : "Highest priority." } : null,
    };
  }

  // Generate Daily Morning Briefing (compact structured payload).
  async function generateMorningBriefing(currentTasks: Task[], currentProfile: Profile) {
    setLoadingBriefing(true);
    try {
      const res = await fetch("/api/generate-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: currentTasks, profile: currentProfile })
      });
      if (res.ok) {
        const data: BriefingData = await res.json();
        setMorningBriefing(data);
        localStorage.setItem(BRIEFING_CACHE_KEY, JSON.stringify({ date: todayISO(), payload: data }));
      } else {
        throw new Error("Briefing request failed");
      }
    } catch (err) {
      console.log("Briefing fallback active.", err);
      setMorningBriefing(buildLocalBriefing(currentTasks));
    } finally {
      setLoadingBriefing(false);
    }
  };

  // Trigger Action Preparation
  const handlePrepareAction = async (taskId: string) => {
    setPreparingTaskId(taskId);
    try {
      await StorageEngine.prepareTask(taskId);
      refreshAllStates();
    } catch (err) {
      console.log("Failed preparing action (utilizing fallback action creation).", err);
    } finally {
      setPreparingTaskId(null);
    }
  };

  // Re-run research_decide action with Google Search grounding
  const handleReRunResearch = async (taskId: string) => {
    setPreparingTaskId(taskId);
    try {
      await StorageEngine.prepareTask(taskId, "research_decide" as ToolType);
      refreshAllStates();
    } catch (err) {
      console.log("Failed re-running research with Google Search grounding.", err);
    } finally {
      setPreparingTaskId(null);
    }
  };

  // Add Task with NL Parsing
  const handleAddTask = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTaskInput.trim()) return;

    setParsingTask(true);
    try {
      // Add task triggers server-side AI parsing
      const createdTask = await StorageEngine.addTask(newTaskInput, newTaskDesc);
      
      // Auto-Prepare action plan immediately for maximum user delight!
      await StorageEngine.prepareTask(createdTask.id);
      
      setNewTaskInput("");
      setNewTaskDesc("");
      refreshAllStates();

      // Regenerate briefing to reflect new task
      const updatedTasks = StorageEngine.getTasks();
      const updatedProfile = StorageEngine.getProfile();
      generateMorningBriefing(updatedTasks, updatedProfile);

      // Redirect to home if added from tasks tab
      setActiveTab("briefing");
    } catch (err) {
      console.log("Failed adding task (using fallback parsing).", err);
    } finally {
      setParsingTask(false);
    }
  };

  // Action executed
  const handleExecuteAction = (actionId: string, executionType: 'simulated' | 'mailto' | 'ics') => {
    StorageEngine.executeAction(actionId, executionType);
    refreshAllStates();
    // Note: the briefing is not regenerated here. It refreshes on load, on
    // "Refresh Briefing", on "Run agent", and when a task is added — avoiding a
    // full Gemini call on every approve/dismiss/stage/undo.
  };

  // FEATURE 1: real email send through the backend (which falls back to simulation
  // if no provider/key). Reused by the card's "Approve & Send" and by "Close my Day".
  // Always records the execution in the Activity log (Undo-able).
  async function sendEmailAndExecute(action: Action): Promise<{ simulated: boolean; id?: string }> {
    let result: { simulated: boolean; id?: string } = { simulated: true };
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: action.payload?.to,
          subject: action.payload?.subject,
          body: action.payload?.body,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        result = { simulated: !!d.simulated, id: d.id };
      }
    } catch {
      // Network failure → keep simulated:true so the action still completes.
    }
    StorageEngine.executeAction(action.id, "email", { id: result.id, simulated: result.simulated });
    return result;
  }

  // Single-card "Approve & Send" with optimistic in-flight state.
  const handleSendEmail = async (action: Action) => {
    setSendingActionId(action.id);
    try {
      await sendEmailAndExecute(action);
    } finally {
      setSendingActionId(null);
      refreshAllStates();
    }
  };

  // Whether an action must be HELD for manual approval during Close my Day:
  // high-risk tasks, or messages to a never-auto-send contact. Returns the reason or null.
  const classifyHeld = (task: Task, action: Action, prof: Profile): string | null => {
    if (task.riskLevel === "high") return "High-risk — needs your review before it runs.";
    if (action.toolType === "draft_message") {
      const recipient = String(action.payload?.to || "").toLowerCase();
      const matched = prof.contacts?.find(c =>
        c.name.toLowerCase() === recipient ||
        c.email.toLowerCase() === recipient ||
        recipient.includes(c.email.toLowerCase()) ||
        recipient.includes(c.name.toLowerCase())
      );
      if (matched?.neverAutoSend) return `"${matched.name}" is marked never-auto-send.`;
    }
    return null;
  };

  // Phase-aware step label for the Close my Day panel.
  const closeLabel = (task: Task, action: Action, phase: "pending" | "running" | "done"): string => {
    const to = action.payload?.to;
    const v = (pending: string, running: string, done: string) =>
      phase === "running" ? running : phase === "done" ? done : pending;
    switch (action.toolType) {
      case "draft_message":
        return v(`Send email to ${to}`, `Sending email to ${to}…`, `Sent email to ${to}`);
      case "schedule_event":
        return v(`Add "${action.payload?.title}" to calendar`, `Adding "${action.payload?.title}" to calendar…`, `Added "${action.payload?.title}" to calendar`);
      case "generate_document":
        return v(`Draft ${action.payload?.docTitle}`, `Drafting ${action.payload?.docTitle}…`, `Drafted ${action.payload?.docTitle}`);
      case "research_decide":
        return v(`Finalize research for "${task.title}"`, `Finalizing research for "${task.title}"…`, `Research recommendation ready`);
      case "prefill_link":
        return v(`Prepare payment link`, `Preparing payment link…`, `Payment link prepared`);
      default:
        return v(`Start "${task.title}"`, `Starting "${task.title}"…`, `Started "${task.title}"`);
    }
  };

  // Dismiss Action
  const handleRejectAction = (actionId: string) => {
    StorageEngine.rejectAction(actionId);
    refreshAllStates();
  };

  // Snooze Action
  const handleSnoozeAction = (actionId: string) => {
    StorageEngine.snoozeAction(actionId);
    refreshAllStates();
  };

  // Stage Action (manually promote Draft to Staged status)
  const handleStageAction = (actionId: string) => {
    StorageEngine.stageAction(actionId);
    refreshAllStates();
  };

  // Edit action inline
  const handleUpdateActionPayload = (actionId: string, updatedPayload: any) => {
    StorageEngine.updateActionPayload(actionId, updatedPayload);
    refreshAllStates();
  };

  // Undo log action
  const handleUndoActivity = (logId: string) => {
    StorageEngine.undoActivity(logId);
    refreshAllStates();
  };

  // Settings profile save. Persists immediately but does NOT regenerate the
  // briefing — otherwise every keystroke in a settings field fires a Gemini call.
  const handleSaveProfile = (updatedProfile: Profile) => {
    StorageEngine.saveProfile(updatedProfile);
    setProfile(updatedProfile);
  };

  // "Start: <task>" from the briefing strip — open the briefing and scroll to that
  // task's prepared card (if it's in the stack).
  const handleStartNext = (taskId: string) => {
    setActiveTab("briefing");
    setSelectedTaskId(taskId);
    setTimeout(() => {
      const el = document.getElementById(`briefing-card-${taskId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  };

  // Today's briefing stack: ALL tasks prepared for today — both 'draft' actions
  // (action_ready) and 'staged' actions awaiting approval (awaiting_approval), so the
  // briefing is the single home for everything prepared. Sorted by earliest deadline.
  const preparedTasksWithActions = useMemo(() => {
    const pick = (t: Task): Action | undefined => {
      if (t.status === "action_ready") return actions.find(a => a.taskId === t.id && a.status === "draft");
      if (t.status === "awaiting_approval") return actions.find(a => a.taskId === t.id && a.status === "staged");
      return undefined;
    };
    return tasks
      .map(t => ({ task: t, action: pick(t) }))
      .filter(item => item.action !== undefined)
      .sort((a, b) => compareTasksByDeadline(a.task, b.task)) as { task: Task; action: Action }[];
  }, [tasks, actions]);

  // Sidebar/badge counts, memoized to avoid re-filtering the task list on every render.
  const inboxCount = useMemo(() => tasks.filter(t => t.status === "inbox").length, [tasks]);
  const stagedCount = useMemo(() => actions.filter(act => act.status === "staged").length, [actions]);
  const highRiskActive = useMemo(
    () => tasks.filter(t => t.status !== "done" && t.status !== "dismissed" && t.riskLevel === "high"),
    [tasks]
  );
  const snoozedActive = useMemo(
    () => tasks.filter(t => t.status !== "done" && t.status !== "dismissed" && (t.snoozeCount || 0) >= 3),
    [tasks]
  );
  // Master list, sorted by earliest deadline (shared comparator) without mutating state.
  const sortedTasks = useMemo(() => [...tasks].sort(compareTasksByDeadline), [tasks]);

  // Staged actions for the Approval Queue, ordered by their task's earliest deadline.
  const stagedQueue = useMemo(() => {
    return actions
      .filter(a => a.status === "staged")
      .map(a => ({ action: a, task: tasks.find(t => t.id === a.taskId) }))
      .filter(item => item.task !== undefined)
      .sort((a, b) => compareTasksByDeadline(a.task as Task, b.task as Task)) as { action: Action; task: Task }[];
  }, [actions, tasks]);

  // Briefing strip data: prefer the server payload; fall back to live local counts
  // so the strip always shows numbers even before the briefing resolves.
  const briefingStats = morningBriefing?.stats ?? {
    urgent: highRiskActive.length,
    ready: preparedTasksWithActions.length,
    stalled: snoozedActive.length,
  };
  const briefingNext = morningBriefing?.next ?? null;

  // FEATURE 3: "Close my Day" — execute the prepared/approved stack in sequence with a
  // live stepped panel, auto-running safe actions and HOLDING high-risk / never-auto-send
  // ones (the autonomy thesis, made visible). Everything that runs is logged + Undo-able.
  const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  async function handleCloseDay() {
    if (closeRunning) return;
    const prof = StorageEngine.getProfile();

    // Snapshot the current prepared stack; skip 'suggest' (advice-only) actions.
    const planned = preparedTasksWithActions
      .filter(({ action }) => action.autonomyLevel !== "suggest")
      .map(({ task, action }) => ({
        task,
        action,
        held: classifyHeld(task, action, prof),
      }));

    setCloseSteps(planned.map(p => ({
      id: p.action.id,
      label: closeLabel(p.task, p.action, "pending"),
      status: p.held ? "held" : "pending",
      reason: p.held || undefined,
      toolType: p.action.toolType,
    })));
    setCloseReceipt(null);
    setCloseOpen(true);
    setCloseRunning(true);

    const patch = (id: string, next: Partial<CloseStep>) =>
      setCloseSteps(prev => prev.map(s => (s.id === id ? { ...s, ...next } : s)));

    const t0 = performance.now();
    let emails = 0, events = 0, docs = 0, others = 0, held = 0;

    for (const p of planned) {
      if (p.held) { held++; continue; }

      patch(p.action.id, { status: "running", label: closeLabel(p.task, p.action, "running") });
      await delay(450 + Math.floor(Math.random() * 250)); // watchable cadence

      let doneLabel = closeLabel(p.task, p.action, "done");
      try {
        if (p.action.toolType === "draft_message") {
          const r = await sendEmailAndExecute(p.action);
          doneLabel = r.simulated ? `Simulated send to ${p.action.payload?.to}` : `Sent email to ${p.action.payload?.to}`;
          emails++;
        } else if (p.action.toolType === "schedule_event") {
          downloadIcs({
            title: p.action.payload?.title,
            start: p.action.payload?.proposedStart,
            durationMinutes: p.action.payload?.durationMinutes,
            notes: p.action.payload?.notes,
          });
          StorageEngine.executeAction(p.action.id, "ics");
          events++;
        } else if (p.action.toolType === "generate_document") {
          StorageEngine.executeAction(p.action.id, "simulated");
          docs++;
        } else {
          StorageEngine.executeAction(p.action.id, "simulated");
          others++;
        }
      } catch {
        // sendEmailAndExecute already swallows errors; this guards the sync paths.
      }
      patch(p.action.id, { status: "done", label: doneLabel });
    }

    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    setCloseReceipt({ secs, emails, events, docs, others, held, ranTotal: emails + events + docs + others });
    setCloseRunning(false);
    refreshAllStates();
  }

  const closeDayRunnableCount = preparedTasksWithActions.filter(({ action }) => action.autonomyLevel !== "suggest").length;

  // Priority Score helper colors
  const getPriorityColor = (score: number) => {
    if (score >= 80) return "text-rose-700 bg-rose-50 border-rose-100";
    if (score >= 50) return "text-amber-700 bg-amber-50 border-amber-100";
    return "text-slate-600 bg-slate-50 border-slate-100";
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col md:flex-row antialiased">
      {/* Close my Day stepped-execution panel */}
      <CloseDayPanel
        open={closeOpen}
        running={closeRunning}
        steps={closeSteps}
        receipt={closeReceipt}
        onClose={() => { setCloseOpen(false); setCloseSteps([]); setCloseReceipt(null); }}
      />

      {/* Agent run summary toast (transient) */}
      <AnimatePresence>
        {agentToast && (
          <motion.div
            key="agent-toast"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            onClick={() => setAgentToast(null)}
            className="fixed bottom-6 right-6 z-50 max-w-sm bg-slate-900 text-white rounded-xl shadow-2xl border border-slate-700 px-4 py-3 flex items-start gap-3 cursor-pointer"
            title="Dismiss"
          >
            <div className="p-1.5 bg-teal-400/15 rounded-lg text-teal-400 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <span className="text-xxs font-bold uppercase tracking-wider text-teal-400 block">Agent run complete</span>
              <p className="text-sm font-medium text-slate-100">{agentToast}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 1. SIDEBAR NAVIGATION */}
      <aside className="w-full md:w-64 bg-slate-900 text-white shrink-0 flex flex-col border-r border-slate-800 shadow-xl relative z-10">
        {/* Brand Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-teal-500 rounded-xl shadow-md shadow-teal-500/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white leading-tight">Momentum</h1>
              <span className="text-slate-500 text-xs font-mono">AI COMPANION</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => bgm.setEnabled(!bgm.enabled)}
              title={bgm.enabled ? "Mute background music" : "Play background music"}
              className={`p-1.5 rounded-lg border transition-colors ${
                bgm.enabled
                  ? "bg-teal-500/10 text-teal-400 border-teal-500/20"
                  : "bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300"
              }`}
            >
              {bgm.enabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
            <span className="px-2 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-mono text-xxs font-bold uppercase">
              LIVE
            </span>
          </div>
        </div>

        {/* User Mini Card */}
        <div className="px-6 py-4 border-b border-slate-800/60 bg-slate-950/40 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-teal-500/10 border border-teal-400/20 text-teal-400 flex items-center justify-center font-bold">
            {profile.name?.charAt(0) || "U"}
          </div>
          <div className="overflow-hidden">
            <h4 className="text-sm font-semibold truncate text-slate-200">{profile.name}</h4>
            <span className="text-xxs text-slate-400 font-medium block truncate">{profile.role}</span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="p-4 flex-1 space-y-1.5">
          <button 
            onClick={() => setActiveTab("briefing")}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
              activeTab === "briefing" 
                ? "bg-teal-500 text-slate-950 shadow-md shadow-teal-500/10" 
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <Sun className="w-4.5 h-4.5" />
              <span>Today's Briefing</span>
            </div>
            {preparedTasksWithActions.length > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-xxs font-bold ${
                activeTab === "briefing" ? "bg-slate-950 text-teal-400" : "bg-teal-500/10 text-teal-400"
              }`}>
                {preparedTasksWithActions.length}
              </span>
            )}
          </button>

          <button 
            onClick={() => setActiveTab("tasks")}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
              activeTab === "tasks" 
                ? "bg-teal-500 text-slate-950 shadow-md shadow-teal-500/10" 
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <ListTodo className="w-4.5 h-4.5" />
              <span>My Tasks</span>
            </div>
            {inboxCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xxs bg-amber-500/10 text-amber-400 font-bold">
                {inboxCount} inbox
              </span>
            )}
          </button>

          <button 
            onClick={() => setActiveTab("queue")}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
              activeTab === "queue" 
                ? "bg-teal-500 text-slate-950 shadow-md shadow-teal-500/10" 
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <Layers className="w-4.5 h-4.5" />
              <span>Approval Queue</span>
            </div>
            {stagedCount > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-xxs font-bold ${
                activeTab === "queue" ? "bg-slate-950 text-teal-400" : "bg-teal-500/10 text-teal-400"
              }`}>
                {stagedCount}
              </span>
            )}
          </button>

          <button 
            onClick={() => setActiveTab("activity")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
              activeTab === "activity" 
                ? "bg-teal-500 text-slate-950 shadow-md shadow-teal-500/10" 
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <History className="w-4.5 h-4.5" />
            <span>Activity Log</span>
          </button>

          <button 
            onClick={() => setActiveTab("settings")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
              activeTab === "settings" 
                ? "bg-teal-500 text-slate-950 shadow-md shadow-teal-500/10" 
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <SettingsIcon className="w-4.5 h-4.5" />
            <span>Profile & Settings</span>
          </button>
        </nav>

        {/* Footer info */}
        <div className="p-4 border-t border-slate-800/50 text-slate-500 text-xxs font-mono space-y-1">
          <p>UTC DATE: {new Date().toISOString().split("T")[0]}</p>
          <p>ENVIRONMENT: SANDBOXED</p>
        </div>
      </aside>

      {/* 2. MAIN CONTAINER AREA */}
      <main className="flex-1 overflow-y-auto max-w-7xl mx-auto w-full p-4 md:p-8 space-y-8">
        <AnimatePresence mode="wait">
          {/* ======================================= */}
          {/* TAB 1: TODAY'S BRIEFING (FLAGSHIP VIEW) */}
          {/* ======================================= */}
          {activeTab === "briefing" && (
            <motion.div
              key="briefing-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Header Greeting */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Today's Flight Briefing</h2>
                  <p className="text-slate-500 text-sm mt-1">
                    Your prepared next steps ready for instant authorization.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
                  <button
                    onClick={handleCloseDay}
                    disabled={closeRunning || closeDayRunnableCount === 0}
                    title={closeDayRunnableCount === 0 ? "Nothing prepared to run yet" : "Execute your prepared stack — safe actions auto-run, sensitive ones are held"}
                    className="px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-sm"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Close my Day{closeDayRunnableCount > 0 ? ` (${closeDayRunnableCount})` : ""}
                  </button>
                  <button
                    onClick={() => runAgent()}
                    disabled={runningAgent || loadingBriefing}
                    className="px-3.5 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-xs"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${runningAgent ? "animate-spin text-teal-200" : ""}`} />
                    {runningAgent ? "Agent Scanning..." : "Run agent now"}
                  </button>
                  <button 
                    onClick={() => generateMorningBriefing(tasks, profile)}
                    disabled={loadingBriefing}
                    className="px-3.5 py-2 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingBriefing ? "animate-spin text-teal-600" : ""}`} />
                    Refresh Briefing
                  </button>
                </div>
              </div>

              {/* Compact AI Briefing Strip: one-line headline + clickable stats + Start */}
              <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl px-5 py-4 shadow-md border border-slate-800">
                {loadingBriefing && !morningBriefing ? (
                  <div className="flex items-center gap-3 py-1">
                    <div className="h-3 bg-slate-700 rounded-full w-2/5 animate-pulse" />
                    <div className="h-3 bg-slate-700 rounded-full w-1/5 animate-pulse" />
                  </div>
                ) : (
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Headline */}
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2 bg-teal-400/10 rounded-lg border border-teal-400/20 text-teal-400 shrink-0">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xxs font-mono text-teal-400 font-bold uppercase tracking-widest block">AI Briefing</span>
                        <p className="text-sm font-medium text-slate-100 leading-snug">
                          {morningBriefing?.headline || "Analyzing your day…"}
                        </p>
                      </div>
                    </div>

                    {/* Stats + primary Start action */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        onClick={() => setActiveTab("tasks")}
                        title="View urgent (high-risk) tasks"
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/15 text-rose-300 border border-rose-500/25 hover:bg-rose-500/25 transition-colors"
                      >
                        {briefingStats.urgent} urgent
                      </button>
                      <button
                        onClick={() => setActiveTab("briefing")}
                        title="Prepared actions ready in your stack"
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-teal-500/15 text-teal-300 border border-teal-500/25 hover:bg-teal-500/25 transition-colors"
                      >
                        {briefingStats.ready} ready
                      </button>
                      <button
                        onClick={() => setActiveTab("briefing")}
                        title="Stalled tasks (snoozed 3+ times)"
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 transition-colors"
                      >
                        {briefingStats.stalled} stalled
                      </button>
                      {briefingNext && (
                        <button
                          onClick={() => handleStartNext(briefingNext.taskId)}
                          title={briefingNext.reason}
                          className="ml-1 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-teal-500 text-slate-950 hover:bg-teal-400 transition-colors flex items-center gap-1.5 max-w-[260px]"
                        >
                          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">Start: {briefingNext.title}</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Context-Aware Nudges Feed */}
              {snoozedActive.length > 0 && (
                <div className="bg-amber-50/60 border border-amber-200/50 rounded-2xl p-5 space-y-3 shadow-xs">
                  <div className="flex items-center gap-2 text-amber-800">
                    <div className="p-1.5 bg-amber-100 rounded-lg text-amber-700">
                      <Sparkles className="w-4 h-4 animate-pulse" />
                    </div>
                    <h4 className="text-sm font-bold text-amber-950">Focus Nudges</h4>
                  </div>
                  
                  <div className="divide-y divide-amber-200/30">
                    {snoozedActive
                      .map(task => {
                        const action = actions.find(a => a.taskId === task.id);
                        return (
                          <div key={task.id} className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="space-y-1 flex-1">
                              <p className="text-sm font-bold text-slate-800">
                                ⏳ "{task.title}"
                              </p>
                              <p className="text-xs text-slate-600 leading-normal">
                                You've put this off {task.snoozeCount} times — I made it a 5-minute version.
                              </p>
                              <p className="text-xxs font-semibold text-slate-500 flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                Deadline: <span className="text-slate-700">{formatDeadline(task.deadline)}</span>
                              </p>
                              {action && action.payload?.firstStep && (
                                <p className="text-xs italic text-amber-800 font-semibold pl-2.5 border-l-2 border-amber-400 mt-1">
                                  First Action Step: "{action.payload.firstStep}"
                                </p>
                              )}
                            </div>
                            <button
                              onClick={async () => {
                                const act = actions.find(a => a.taskId === task.id);
                                if (act) {
                                  handleExecuteAction(act.id, 'simulated');
                                } else {
                                  const res = await StorageEngine.prepareTask(task.id, "breakdown_first_step" as ToolType);
                                  refreshAllStates();
                                  handleExecuteAction(res.action.id, 'simulated');
                                }
                              }}
                              className="self-start sm:self-center px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition-colors shadow-xs shrink-0"
                            >
                              Start?
                            </button>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Natural Language Easy-Add Task Box on Dashboard */}
              <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-xs">
                <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-1.5">
                  <PlusCircle className="w-4 h-4 text-teal-600" /> Need something else prepared?
                </h4>
                <form onSubmit={handleAddTask} className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      placeholder="e.g. Reply to Prof. Lee about database project extension tomorrow morning..."
                      value={newTaskInput}
                      onChange={(e) => setNewTaskInput(e.target.value)}
                      disabled={parsingTask}
                      className="flex-1 bg-slate-50 border border-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:bg-white disabled:opacity-50"
                    />
                    <VoiceInputButton
                      onTranscript={(text) => setNewTaskInput(text)}
                      disabled={parsingTask}
                    />
                    <button
                      type="submit"
                      disabled={parsingTask || !newTaskInput.trim()}
                      className="px-4 py-2.5 bg-slate-900 text-white font-semibold text-sm rounded-xl hover:bg-slate-800 transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {parsingTask ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin text-teal-400" />
                          Preparing...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4.5 h-4.5" />
                          Plan
                        </>
                      )}
                    </button>
                  </div>
                  
                  {/* Suggestions Carousel */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-xxs text-slate-400 font-semibold uppercase tracking-wider mr-1.5">🎙️ Tap Speak or pick a suggestion:</span>
                    {suggestedPrompts.map((p, idx) => (
                      <button
                        type="button"
                        key={idx}
                        onClick={() => setNewTaskInput(p)}
                        className="text-xxs bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1 rounded-md transition-colors"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </form>
              </div>

              {/* Prepared Cards List */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="text-base font-bold text-slate-800">
                    Prepared Action Stack ({preparedTasksWithActions.length})
                  </h3>
                  <span className="text-xs text-slate-500 italic">
                    Approve to execute immediately
                  </span>
                </div>

                {preparedTasksWithActions.length === 0 ? (
                  <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-12 text-center max-w-lg mx-auto">
                    <CheckCircle2 className="w-12 h-12 text-teal-500 mx-auto mb-3" />
                    <h4 className="text-base font-bold text-slate-800">All caught up — great momentum!</h4>
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                      All prepared next steps have been processed or approved. You can add a new natural language task or view the Tasks tab to prepare older items.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-6">
                    {preparedTasksWithActions.map(({ task, action }) => (
                      <div
                        key={action.id}
                        id={`briefing-card-${task.id}`}
                        className={task.isNew ? "rounded-2xl ring-2 ring-teal-400/70 ring-offset-2 ring-offset-slate-50" : ""}
                      >
                        <ActionCard
                          action={action}
                          task={task}
                          onExecute={handleExecuteAction}
                          onReject={handleRejectAction}
                          onSnooze={handleSnoozeAction}
                          onUpdatePayload={handleUpdateActionPayload}
                          onStage={handleStageAction}
                          onReRun={handleReRunResearch}
                          isReRunning={preparingTaskId === action.taskId}
                          onSendEmail={handleSendEmail}
                          emailLive={emailLive}
                          isSending={sendingActionId === action.id}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ======================================= */}
          {/* TAB 2: MY TASKS (FULL TASK INVENTORY) */}
          {/* ======================================= */}
          {activeTab === "tasks" && (
            <motion.div
              key="tasks-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Master Task Catalog</h2>
                  <p className="text-slate-500 text-sm mt-1">
                    Complete task pipeline, sorted by computed priority.
                  </p>
                </div>
              </div>

              {/* Add Master Task Panel */}
              <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-xs">
                <form onSubmit={handleAddTask} className="space-y-3">
                  <h3 className="text-sm font-bold text-slate-800">Quick-Launch Natural Language Task</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <input 
                        type="text"
                        required
                        placeholder="What do you need done? (e.g. Email David to review the code patch by Friday)"
                        value={newTaskInput}
                        onChange={(e) => setNewTaskInput(e.target.value)}
                        disabled={parsingTask}
                        className="w-full bg-slate-50 border border-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:bg-white"
                      />
                    </div>
                    <div>
                      <input 
                        type="text"
                        placeholder="Add secondary notes (optional)"
                        value={newTaskDesc}
                        onChange={(e) => setNewTaskDesc(e.target.value)}
                        disabled={parsingTask}
                        className="w-full bg-slate-50 border border-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:bg-white"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <VoiceInputButton
                      onTranscript={(text) => setNewTaskInput(text)}
                      disabled={parsingTask}
                    />
                    <button
                      type="submit"
                      disabled={parsingTask || !newTaskInput.trim()}
                      className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {parsingTask ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-400" />
                          AI Parsing...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          Add & Prepare AI Action
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* Master List */}
              <div className="bg-white border border-slate-100 rounded-2xl shadow-xs overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">Pipeline Inventory ({tasks.length})</span>
                  <div className="flex items-center gap-4 text-xs text-slate-400 font-medium">
                    <div className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-teal-500" /> Ready
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Pending AI
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-300" /> Done
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {sortedTasks
                    .map((task) => {
                      const isPrepared = task.status === "action_ready";
                      const isDone = task.status === "done";
                      const isDismissed = task.status === "dismissed";
                      const taskAction = actions.find(a => a.taskId === task.id && a.status === "draft");

                      return (
                        <div
                          key={task.id}
                          className={`p-5 transition-all ${
                            task.isNew ? "bg-teal-50/60 border-l-2 border-teal-400" :
                            selectedTaskId === task.id ? "bg-slate-50" : "hover:bg-slate-50/50"
                          } ${isDone || isDismissed ? "opacity-60" : ""}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-4">
                            {/* Main Title / Metadata */}
                            <div className="space-y-1 flex-1 min-w-[280px]">
                              <div className="flex items-center gap-2">
                                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                  isDone ? "bg-slate-300" : isPrepared ? "bg-teal-500" : "bg-amber-400"
                                }`} />
                                <h4 className={`text-sm font-bold text-slate-800 ${isDone ? "line-through text-slate-400" : ""}`}>
                                  {task.title}
                                </h4>
                                {task.isNew && (
                                  <span className="px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 border border-teal-200 text-xxs font-extrabold uppercase tracking-wide">
                                    New
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 leading-normal pl-4.5">
                                {task.description || "No description provided."}
                              </p>
                              
                              {/* Metadata tags */}
                              <div className="flex flex-wrap items-center gap-3 pl-4.5 pt-1.5 text-xxs font-medium text-slate-400">
                                <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                                  {task.category}
                                </span>
                                <span>Source: {task.source}</span>
                                {task.snoozeCount > 0 && (
                                  <span className="text-amber-600 font-semibold">
                                    Snoozed {task.snoozeCount}x
                                  </span>
                                )}
                              </div>
                              {/* Final deadline */}
                              <div className="flex items-center gap-1 pl-4.5 pt-1 text-xxs font-semibold text-slate-500">
                                <Clock className="w-3 h-3 text-slate-400" />
                                Deadline: <span className="text-slate-700">{formatDeadline(task.deadline)}</span>
                              </div>
                            </div>

                            {/* Priority, Risk badge and buttons */}
                            <div className="flex items-center gap-2.5">
                              {/* Priority Badge */}
                              <span className={`px-2.5 py-1 rounded-xl text-xxs font-bold uppercase border flex items-center gap-1 shadow-xxs ${
                                getPriorityLevel(task.priorityScore) === 'High'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : getPriorityLevel(task.priorityScore) === 'Med'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-slate-50 text-slate-600 border-slate-200'
                              }`}>
                                ⭐ {getPriorityLevel(task.priorityScore)} ({task.priorityScore})
                              </span>

                              {/* Risk Badge (Red / Amber / Green) */}
                              <span className={`px-2.5 py-1 rounded-xl text-xxs font-bold uppercase border flex items-center gap-1 shadow-xxs ${
                                task.riskLevel === 'high' 
                                  ? 'bg-rose-500/10 text-rose-600 border-rose-200' 
                                  : task.riskLevel === 'med' 
                                  ? 'bg-amber-500/10 text-amber-600 border-amber-200' 
                                  : 'bg-emerald-500/10 text-emerald-600 border-emerald-200'
                              }`}>
                                ⚠️ {task.riskLevel} Risk
                              </span>

                              {/* Action Trigger Buttons */}
                              <div className="w-36 flex justify-end shrink-0">
                                {isDone ? (
                                  <div className="flex flex-col items-end gap-1.5 pr-2">
                                    <span className="text-xs font-semibold text-slate-400 flex items-center gap-1">
                                      <Check className="w-4 h-4 text-emerald-500" /> Completed
                                    </span>
                                    {(() => {
                                      const associatedLog = logs.find(l => l.taskId === task.id && l.undoable && !l.undone);
                                      if (associatedLog) {
                                        return (
                                          <button
                                            onClick={() => handleUndoActivity(associatedLog.id)}
                                            className="px-2 py-1 border border-slate-200 hover:border-teal-500 hover:bg-slate-50 text-slate-500 hover:text-teal-700 text-xxs font-bold rounded-lg flex items-center gap-1 transition-all bg-white shadow-xxs cursor-pointer"
                                            title="Undo action execution and restore task"
                                          >
                                            <RotateCcw className="w-3 h-3 text-slate-400" /> Undo
                                          </button>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </div>
                                ) : isDismissed ? (
                                  <span className="text-xs font-semibold text-slate-400 pr-2">Dismissed</span>
                                ) : isPrepared ? (
                                  <button
                                    onClick={() => {
                                      setSelectedTaskId(selectedTaskId === task.id ? null : task.id);
                                      setActiveTab("briefing");
                                    }}
                                    className="px-3 py-1.5 bg-teal-50 text-teal-700 hover:bg-teal-100 rounded-lg text-xs font-bold border border-teal-100 flex items-center gap-1 transition-all"
                                  >
                                    View Action Card <ChevronRight className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handlePrepareAction(task.id)}
                                    disabled={preparingTaskId === task.id}
                                    className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                                  >
                                    {preparingTaskId === task.id ? (
                                      <>
                                        <RefreshCw className="w-3 h-3 animate-spin text-teal-400" />
                                        Planning...
                                      </>
                                    ) : (
                                      <>
                                        <Sparkles className="w-3.5 h-3.5 text-teal-400 animate-pulse" />
                                        Prepare Action
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Sub Action card drawer if prepared and expanded */}
                          <AnimatePresence>
                            {selectedTaskId === task.id && taskAction && (
                              <motion.div 
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden mt-4 pt-4 border-t border-slate-100"
                              >
                                <ActionCard 
                                  action={taskAction}
                                  task={task}
                                  onExecute={handleExecuteAction}
                                  onReject={handleRejectAction}
                                  onSnooze={handleSnoozeAction}
                                  onUpdatePayload={handleUpdateActionPayload}
                                  onStage={handleStageAction}
                                  onReRun={handleReRunResearch}
                                  isReRunning={preparingTaskId === taskAction.taskId}
                                  onSendEmail={handleSendEmail}
                                  emailLive={emailLive}
                                  isSending={sendingActionId === taskAction.id}
                                />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                </div>
              </div>
            </motion.div>
          )}

          {/* ======================================= */}
          {/* TAB 2.5: APPROVAL QUEUE                 */}
          {/* ======================================= */}
          {activeTab === "queue" && (
            <motion.div
              key="queue-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div>
                <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Approval Queue</h2>
                <p className="text-slate-500 text-sm mt-1">
                  Staged actions ready for one-click authorization and execution.
                </p>
              </div>

              {stagedQueue.length === 0 ? (
                <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center max-w-lg mx-auto space-y-4">
                  <div className="w-16 h-16 bg-emerald-50 border border-emerald-100 rounded-full flex items-center justify-center mx-auto text-emerald-600">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-slate-800">Queue is Empty!</h3>
                    <p className="text-slate-500 text-xs">
                      No staged actions are currently waiting for your manual authorization.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6">
                  {stagedQueue.map(({ action, task }) => (
                    <ActionCard
                      key={action.id}
                      action={action}
                      task={task}
                      onExecute={handleExecuteAction}
                      onReject={handleRejectAction}
                      onSnooze={handleSnoozeAction}
                      onUpdatePayload={handleUpdateActionPayload}
                      onStage={handleStageAction}
                      onReRun={handleReRunResearch}
                      isReRunning={preparingTaskId === action.taskId}
                      onSendEmail={handleSendEmail}
                      emailLive={emailLive}
                      isSending={sendingActionId === action.id}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ======================================= */}
          {/* TAB 3: ACTIVITY LOG (AUDIT RAIL) */}
          {/* ======================================= */}
          {activeTab === "activity" && (
            <motion.div
              key="activity-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Header */}
              <div>
                <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Audit Trail & Action Logs</h2>
                <p className="text-slate-500 text-sm mt-1">
                  Chronological record of autonomous agent operations and your explicit approvals.
                </p>
              </div>

              {/* Audit Rail Logs list */}
              <div className="space-y-6">
                {logs.length === 0 ? (
                  <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center text-slate-400 text-sm shadow-xs">
                    No activity recorded yet.
                  </div>
                ) : (
                  (() => {
                    const grouped = groupLogsByDay(logs);
                    return Object.entries(grouped).map(([day, dayLogs]) => (
                      <div key={day} className="space-y-3">
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">{day}</h3>
                          <div className="h-px bg-slate-100 flex-1" />
                          <span className="text-xxs font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                            {dayLogs.length} {dayLogs.length === 1 ? 'event' : 'events'}
                          </span>
                        </div>
                        <div className="bg-white border border-slate-100 rounded-2xl shadow-xs overflow-hidden divide-y divide-slate-100">
                          {dayLogs.map((log) => {
                            const logDate = new Date(log.timestamp).toLocaleTimeString("en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit"
                            });
                            const tType = getLogToolType(log, actions);
                            const meta = getLogToolMeta(tType);
                            const IconComp = meta.icon;

                            return (
                              <div 
                                key={log.id} 
                                className={`p-4 flex flex-wrap items-center justify-between gap-4 transition-colors ${
                                  log.undone ? "bg-slate-50/50 opacity-60" : "hover:bg-slate-50/20"
                                }`}
                              >
                                <div className="flex items-start gap-4 flex-1 min-w-0">
                                  {/* Custom Tool-Type Icon */}
                                  <div className={`p-2.5 rounded-xl shrink-0 border ${meta.color} shadow-xxs`}>
                                    <IconComp className="w-4.5 h-4.5" />
                                  </div>

                                  {/* Message Details */}
                                  <div className="space-y-1.5 flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h4 className={`text-sm font-bold text-slate-800 ${log.undone ? "line-through text-slate-400" : ""}`}>
                                        {log.taskTitle}
                                      </h4>
                                      <span className="text-xxs text-slate-400 font-mono bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">
                                        {logDate}
                                      </span>
                                    </div>
                                    <p className="text-xs text-slate-600 leading-normal font-medium">
                                      {log.summary}
                                    </p>
                                    <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                      <span className={`text-xxs px-2 py-0.5 rounded-full font-bold border ${getAutonomyBadgeStyle(log.autonomyLevel)}`}>
                                        Autonomy: {log.autonomyLevel}
                                      </span>
                                      {tType && (
                                        <span className="text-xxs px-2 py-0.5 rounded-full font-bold border border-slate-200 bg-slate-50 text-slate-500">
                                          {meta.label}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Undo Action Container */}
                                <div className="flex items-center gap-2 shrink-0">
                                  {log.undoable && !log.undone && (
                                    <button
                                      onClick={() => handleUndoActivity(log.id)}
                                      className="px-3 py-1.5 border border-slate-200 hover:border-teal-500 hover:bg-slate-50 text-slate-600 hover:text-teal-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all bg-white shadow-xxs cursor-pointer"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" /> Undo
                                    </button>
                                  )}
                                  {log.undone && (
                                    <span className="text-xs font-semibold text-slate-400 bg-slate-100 border border-slate-200/50 px-2 py-1 rounded-lg italic shrink-0">
                                      Undone
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()
                )}
              </div>
            </motion.div>
          )}

          {/* ======================================= */}
          {/* TAB 4: SETTINGS (PROFILE & AUTONOMY) */}
          {/* ======================================= */}
          {activeTab === "settings" && (
            <motion.div
              key="settings-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 max-w-4xl"
            >
              <div>
                <h2 className="text-2xl font-bold text-slate-800 tracking-tight">System Settings</h2>
                <p className="text-slate-500 text-sm mt-1">
                  Manage your personal context profile, reference metadata, and AI automation permissions.
                </p>
              </div>

              {/* Sound / Background Music Card */}
              <div className="bg-white border border-slate-100 rounded-2xl shadow-xs p-6 space-y-4">
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                    <Music className="w-4.5 h-4.5 text-teal-600" /> Ambient Sound
                  </h3>
                  <button
                    onClick={() => bgm.setEnabled(!bgm.enabled)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border transition-all ${
                      bgm.enabled
                        ? "bg-teal-50 text-teal-700 border-teal-200"
                        : "bg-slate-50 text-slate-500 border-slate-200"
                    }`}
                  >
                    {bgm.enabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                    {bgm.enabled ? "On" : "Off"}
                  </button>
                </div>

                <p className="text-xs text-slate-400">
                  Looping background music to keep you in flow. Choose a track, or let it follow the time of day.
                </p>

                {/* Track / mode picker */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {([
                    { mode: "first_breath" as BgmMode, title: BGM_TRACKS.first_breath.label, desc: "Soft & hopeful (default)" },
                    { mode: "where_morning" as BgmMode, title: BGM_TRACKS.where_morning.label, desc: "Bright & uplifting" },
                    { mode: "stillness" as BgmMode, title: BGM_TRACKS.stillness.label, desc: "Calm & quiet" },
                    { mode: "automatic" as BgmMode, title: "Automatic", desc: "Morning track 4:30am–7pm, then evening track" },
                  ]).map((opt) => {
                    const active = bgm.mode === opt.mode;
                    return (
                      <button
                        key={opt.mode}
                        onClick={() => bgm.setMode(opt.mode)}
                        disabled={!bgm.enabled}
                        className={`text-left p-3 rounded-xl border transition-all disabled:opacity-50 ${
                          active
                            ? "bg-teal-50 border-teal-300 ring-1 ring-teal-300"
                            : "bg-slate-50/60 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <span className={`text-xs font-bold block ${active ? "text-teal-800" : "text-slate-700"}`}>
                          {opt.title}
                        </span>
                        <span className="text-xxs text-slate-400 block leading-tight mt-0.5">{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Automatic mode current-track hint */}
                {bgm.mode === "automatic" && (
                  <p className="text-xxs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                    Automatic is active — currently playing <strong className="text-slate-700">{BGM_TRACKS[autoTrackKey()].label}</strong> for this time of day.
                  </p>
                )}

                {/* Volume */}
                <div className="flex items-center gap-3 pt-1">
                  <VolumeX className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={bgm.volume}
                    disabled={!bgm.enabled}
                    onChange={(e) => bgm.setVolume(parseFloat(e.target.value))}
                    className="flex-1 accent-teal-600 disabled:opacity-50"
                    aria-label="Background music volume"
                  />
                  <Volume2 className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-xxs font-mono font-bold text-slate-500 w-9 text-right">{Math.round(bgm.volume * 100)}%</span>
                </div>

                {/* Now-playing / blocked status */}
                <div className="flex items-center gap-2 text-xxs font-medium">
                  {bgm.enabled && bgm.blocked ? (
                    <span className="text-amber-600 font-semibold flex items-center gap-1">
                      <Music className="w-3.5 h-3.5" /> Click anywhere to start the music (your browser blocks autoplay).
                    </span>
                  ) : bgm.enabled && bgm.isPlaying ? (
                    <span className="text-teal-600 font-semibold flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
                      Now playing: {BGM_TRACKS[bgm.currentKey].label}
                    </span>
                  ) : (
                    <span className="text-slate-400 flex items-center gap-1">
                      <VolumeX className="w-3.5 h-3.5" /> Music is off.
                    </span>
                  )}
                </div>
              </div>

              {/* Profile Config Card */}
              <div className="bg-white border border-slate-100 rounded-2xl shadow-xs p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 pb-2.5 border-b border-slate-100">
                  <User className="w-4.5 h-4.5 text-teal-600" /> Executive Profile Context
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Your Full Name</label>
                    <input 
                      type="text" 
                      value={profile.name}
                      onChange={(e) => handleSaveProfile({ ...profile, name: e.target.value })}
                      className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Email Address</label>
                    <input 
                      type="email" 
                      value={profile.email}
                      onChange={(e) => handleSaveProfile({ ...profile, email: e.target.value })}
                      className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Professional Role</label>
                    <input 
                      type="text" 
                      value={profile.role}
                      onChange={(e) => handleSaveProfile({ ...profile, role: e.target.value })}
                      className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Preferred Writing Tone</label>
                    <input 
                      type="text" 
                      value={profile.writingTone}
                      onChange={(e) => handleSaveProfile({ ...profile, writingTone: e.target.value })}
                      className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Email Sign-Off Signature</label>
                  <textarea 
                    rows={2}
                    value={profile.signature}
                    onChange={(e) => handleSaveProfile({ ...profile, signature: e.target.value })}
                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:bg-white font-mono"
                  />
                </div>
              </div>

              {/* Autonomy settings slider config */}
              <div className="bg-white border border-slate-100 rounded-2xl shadow-xs p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 pb-2.5 border-b border-slate-100">
                  <Sliders className="w-4.5 h-4.5 text-teal-600" /> Autonomy & Delegation matrix
                </h3>
                <p className="text-xs text-slate-400">
                  Configure the authorization requirement for each preparation tool type.
                </p>

                {/* Level legend: each autonomy stage with a hover one-liner (the 'i' icon). */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-xxs font-semibold text-slate-400 uppercase tracking-wider mr-1">Levels:</span>
                  {[
                    { level: "suggest", blurb: "Advice only — points out the next step but never prepares or runs anything." },
                    { level: "draft", blurb: "Prepares a draft for you to review; you stage and approve it manually." },
                    { level: "stage", blurb: "Prepares and queues the action in your Approval Queue for one-click approval." },
                    { level: "auto", blurb: "Fully autonomous — prepares and executes the action without asking." },
                  ].map(({ level, blurb }) => (
                    <span
                      key={level}
                      className="group relative inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 cursor-help"
                    >
                      <span className="text-xxs font-bold capitalize text-slate-600">{level}</span>
                      <Info className="w-3 h-3 text-slate-400" />
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 z-20 hidden group-hover:block bg-slate-900 text-white text-xxs font-medium leading-snug rounded-lg px-2.5 py-2 shadow-lg"
                      >
                        {blurb}
                        <span className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 w-2 h-2 rotate-45 bg-slate-900" />
                      </span>
                    </span>
                  ))}
                </div>

                <div className="space-y-4 pt-2">
                  {[
                    { type: "draft_message", label: "Draft Message", desc: "Crafting outgoing emails, slack messages, and advisor requests" },
                    { type: "schedule_event", label: "Schedule Event", desc: "Calendar block planning, scheduling reviews and meetings" },
                    { type: "generate_document", label: "Generate Document", desc: "Drafting outlines, assignments, and reports" },
                    { type: "prefill_link", label: "Smart Prefill Link", desc: "External billing checkouts and secure web portal deep-linking" },
                    { type: "research_decide", label: "Research & Decide", desc: "Comparative search matrixes and tech purchasing decisions" },
                    { type: "breakdown_first_step", label: "Action Breakdown", desc: "Breaking massive complex items into stupidly small 5-min start tasks" }
                  ].map((item) => {
                    const currentLevel = profile.autonomySettings[item.type] || "draft";

                    return (
                      <div key={item.type} className="flex flex-wrap items-center justify-between gap-4 p-4 border border-slate-100 rounded-xl bg-slate-50/50">
                        <div className="space-y-0.5 max-w-md">
                          <span className="text-xs font-bold text-slate-800 block">{item.label}</span>
                          <span className="text-xxs text-slate-400 block leading-normal">{item.desc}</span>
                        </div>
                        <div className="flex gap-1.5 sm:gap-2">
                          {["suggest", "draft", "stage", "auto"].map((level) => (
                            <button
                              type="button"
                              key={level}
                              onClick={() => {
                                const updatedSettings = { ...profile.autonomySettings, [item.type]: level as any };
                                handleSaveProfile({ ...profile, autonomySettings: updatedSettings });
                              }}
                              className={`px-2.5 py-1.5 rounded-lg text-xxs sm:text-xs font-bold capitalize transition-all ${
                                currentLevel === level 
                                  ? level === 'auto'
                                    ? "bg-purple-600 text-white shadow-xs"
                                    : level === 'stage'
                                    ? "bg-indigo-600 text-white shadow-xs"
                                    : level === 'draft'
                                    ? "bg-amber-500 text-white shadow-xs"
                                    : "bg-slate-700 text-white shadow-xs"
                                  : "bg-white text-slate-500 border border-slate-100 hover:bg-slate-50"
                              }`}
                            >
                              {level}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Contacts directory directory */}
              <div className="bg-white border border-slate-100 rounded-2xl shadow-xs p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 pb-2.5 border-b border-slate-100">
                  <User className="w-4.5 h-4.5 text-teal-600" /> Contacts & VIPs Directory
                </h3>
                <p className="text-xs text-slate-400">
                  Provide relationship directories so drafted messages automatically use their correct emails and contextual roles.
                </p>

                <div className="space-y-2.5 max-h-60 overflow-y-auto pt-2">
                  {profile.contacts?.map((contact, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
                      <div className="flex-1 min-w-0 mr-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-slate-800 truncate">{contact.name}</span>
                          {contact.neverAutoSend && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-50 border border-rose-100 text-rose-600 font-extrabold text-xxs flex items-center gap-0.5 shrink-0">
                              🛡️ No Auto-Send
                            </span>
                          )}
                        </div>
                        <span className="text-xxs text-slate-400 font-medium block truncate">
                          {contact.email} • <strong className="text-slate-500 font-semibold">{contact.relationship}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Autonomy Capping Toggle Button */}
                        <button
                          onClick={() => {
                            const updatedContacts = profile.contacts.map((c, i) => 
                              i === idx ? { ...c, neverAutoSend: !c.neverAutoSend } : c
                            );
                            handleSaveProfile({ ...profile, contacts: updatedContacts });
                          }}
                          className={`px-2 py-1 text-xxs font-bold rounded-lg border transition-all cursor-pointer ${
                            contact.neverAutoSend 
                              ? "bg-rose-50 text-rose-700 border-rose-200" 
                              : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                          }`}
                          title="Restrict autonomy level of messages to this contact to prevent automatic sending"
                        >
                          {contact.neverAutoSend ? "Capped" : "Cap Autonomy"}
                        </button>

                        <button
                          onClick={() => {
                            const updatedContacts = profile.contacts.filter((_, i) => i !== idx);
                            handleSaveProfile({ ...profile, contacts: updatedContacts });
                          }}
                          className="text-slate-400 hover:text-rose-600 transition-colors p-1.5 cursor-pointer"
                          title="Delete Contact"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  
                  {(!profile.contacts || profile.contacts.length === 0) && (
                    <div className="text-center py-4 text-xs text-slate-400">
                      No contacts added yet. Add one below to customize drafts.
                    </div>
                  )}
                </div>

                {/* Add contact mini form */}
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const name = (form.elements.namedItem("cName") as HTMLInputElement).value;
                    const email = (form.elements.namedItem("cEmail") as HTMLInputElement).value;
                    const rel = (form.elements.namedItem("cRel") as HTMLInputElement).value;
                    const neverAutoSend = (form.elements.namedItem("cNeverAutoSend") as HTMLInputElement).checked;
                    if (!name || !email) return;

                    const newContacts = [...(profile.contacts || []), { name, email, relationship: rel, neverAutoSend }];
                    handleSaveProfile({ ...profile, contacts: newContacts });
                    form.reset();
                  }}
                  className="space-y-3 pt-3 border-t border-slate-100"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input type="text" name="cName" placeholder="Name" required className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:bg-white" />
                    <input type="email" name="cEmail" placeholder="Email" required className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:bg-white" />
                    <input type="text" name="cRel" placeholder="Relationship" className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:bg-white" />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 p-2 border border-slate-100 rounded-xl">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 font-medium">
                      <input 
                        type="checkbox" 
                        name="cNeverAutoSend" 
                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" 
                      />
                      <span>🛡️ Mark as <strong className="text-rose-600">Never Auto-Send</strong> (Max autonomy stage)</span>
                    </label>
                    <button type="submit" className="bg-slate-900 text-white rounded-lg text-xs font-bold px-4 py-2 hover:bg-slate-800 transition-colors shadow-xxs cursor-pointer">
                      Add VIP Contact
                    </button>
                  </div>
                </form>
              </div>

              {/* Saved metadata details card */}
              <div className="bg-white border border-slate-100 rounded-2xl shadow-xs p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 pb-2.5 border-b border-slate-100">
                  <ShieldAlert className="w-4.5 h-4.5 text-teal-600" /> Saved Reference Identifiers
                </h3>
                <p className="text-xs text-slate-400">
                  Saved key-values like utility invoice account numbers, project IDs, or customer numbers. Gemini uses these to auto-complete drafts and Smart Links.
                </p>

                <div className="space-y-2 pt-1">
                  {Object.entries(profile.savedDetails || {}).map(([key, val], idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl font-mono text-xs text-slate-700">
                      <div>
                        <strong className="text-slate-500 font-semibold">{key}:</strong> {val}
                      </div>
                      <button
                        onClick={() => {
                          const updatedDetails = { ...profile.savedDetails };
                          delete updatedDetails[key];
                          handleSaveProfile({ ...profile, savedDetails: updatedDetails });
                        }}
                        className="text-slate-400 hover:text-rose-600 transition-colors p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {Object.keys(profile.savedDetails || {}).length === 0 && (
                    <div className="text-center py-4 text-xs text-slate-400">
                      No reference keys added yet.
                    </div>
                  )}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const key = (form.elements.namedItem("refKey") as HTMLInputElement).value;
                    const val = (form.elements.namedItem("refVal") as HTMLInputElement).value;
                    if (!key || !val) return;

                    const updatedDetails = { ...profile.savedDetails, [key]: val };
                    handleSaveProfile({ ...profile, savedDetails: updatedDetails });
                    form.reset();
                  }}
                  className="flex gap-2 pt-2 border-t border-slate-100"
                >
                  <input type="text" name="refKey" placeholder="e.g., Student ID" required className="text-xs bg-slate-50 border border-slate-200 rounded p-2 flex-1" />
                  <input type="text" name="refVal" placeholder="e.g., SID-88210" required className="text-xs bg-slate-50 border border-slate-200 rounded p-2 flex-1" />
                  <button type="submit" className="bg-slate-900 text-white rounded text-xs font-bold px-4 py-2 hover:bg-slate-800 transition-colors">
                    Add
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
