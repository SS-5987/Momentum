export interface Contact {
  name: string;
  email: string;
  relationship: string;
  /** When true, messages to this contact can never be auto-sent (autonomy is capped at "stage"). */
  neverAutoSend?: boolean;
}

export type AutonomyLevel = 'suggest' | 'draft' | 'stage' | 'auto';

export interface Profile {
  name: string;
  email: string;
  role: string;
  writingTone: string;
  signature: string;
  contacts: Contact[];
  savedDetails: Record<string, string>;
  autonomySettings: Record<ToolType, AutonomyLevel>; // toolType -> max allowed autonomy level
}

export type TaskStatus = 'inbox' | 'action_ready' | 'awaiting_approval' | 'done' | 'dismissed';

export interface Task {
  id: string;
  title: string;
  description: string;
  deadline: string; // ISO string or YYYY-MM-DD
  category: string;
  priorityScore: number; // 1 to 100
  riskLevel: 'low' | 'med' | 'high';
  status: TaskStatus;
  snoozeCount: number;
  source: string;
  /** Transient: true only the first time a freshly-added task is shown, then cleared. */
  isNew?: boolean;
}

export type ToolType =
  | 'draft_message'
  | 'schedule_event'
  | 'generate_document'
  | 'prefill_link'
  | 'research_decide'
  | 'breakdown_first_step';

export interface DraftMessagePayload {
  to: string;
  subject: string;
  body: string;
  tone: string;
}

export interface ScheduleEventPayload {
  title: string;
  proposedStart: string; // ISO datetime
  durationMinutes: number;
  notes: string;
  needsOtherParty: boolean;
}

export interface GenerateDocumentPayload {
  docTitle: string;
  contentMarkdown: string;
}

export interface PrefillLinkPayload {
  url: string;
  instructions: string;
  prefillData: Record<string, string>;
}

export interface ResearchDecidePayload {
  query: string;
  summary: string;
  recommendation: string;
  supportingPoints?: string[];
}

export interface BreakdownFirstStepPayload {
  subtasks: string[];
  firstStep: string;
}

export interface Action {
  id: string;
  taskId: string;
  toolType: ToolType;
  autonomyLevel: AutonomyLevel; // resolved autonomy level for this action
  status: 'draft' | 'staged' | 'executed' | 'rejected' | 'undone';
  payload: any; // one of the payloads above
  aiReasoning: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  taskTitle: string;
  summary: string;
  autonomyLevel: string;
  undoable: boolean;
  undone: boolean;
  taskId: string;
  actionId?: string; // the specific action this log refers to, so undo targets the right one
  toolType?: ToolType;
  originalTaskStatus?: TaskStatus;
  originalActionStatus?: string;
}
