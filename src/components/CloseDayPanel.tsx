import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, Loader2, ShieldAlert, Sparkles, X, Mail, Calendar, FileText, ListTodo, Search, ExternalLink } from "lucide-react";

export type CloseStepStatus = "pending" | "running" | "done" | "held";

export interface CloseStep {
  id: string;
  label: string;
  status: CloseStepStatus;
  reason?: string;
  toolType?: string;
}

export interface CloseReceipt {
  secs: string;
  emails: number;
  events: number;
  docs: number;
  others: number;
  held: number;
  ranTotal: number;
}

const toolIcon = (toolType?: string) => {
  switch (toolType) {
    case "draft_message": return Mail;
    case "schedule_event": return Calendar;
    case "generate_document": return FileText;
    case "research_decide": return Search;
    case "prefill_link": return ExternalLink;
    case "breakdown_first_step": return ListTodo;
    default: return Sparkles;
  }
};

interface Props {
  open: boolean;
  running: boolean;
  steps: CloseStep[];
  receipt: CloseReceipt | null;
  onClose: () => void;
}

export default function CloseDayPanel({ open, running, steps, receipt, onClose }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-teal-400/15 rounded-lg border border-teal-400/25 text-teal-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Closing your day</h3>
                  <p className="text-xxs text-slate-400 font-mono uppercase tracking-wider">
                    {running ? "Executing your prepared stack…" : receipt ? "Run complete" : "Preparing…"}
                  </p>
                </div>
              </div>
              {!running && (
                <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors" title="Close">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Steps */}
            <div className="p-5 space-y-2 max-h-[55vh] overflow-y-auto">
              {steps.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6">Nothing prepared to run right now.</p>
              ) : (
                steps.map((step) => {
                  const Icon = toolIcon(step.toolType);
                  return (
                    <div
                      key={step.id}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                        step.status === "held"
                          ? "bg-amber-50/70 border-amber-200"
                          : step.status === "done"
                          ? "bg-emerald-50/60 border-emerald-100"
                          : step.status === "running"
                          ? "bg-teal-50/60 border-teal-200"
                          : "bg-slate-50 border-slate-100"
                      }`}
                    >
                      <div className={`p-1.5 rounded-lg shrink-0 ${
                        step.status === "held" ? "bg-amber-100 text-amber-700" : "bg-white border border-slate-100 text-slate-500"
                      }`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${step.status === "held" ? "text-amber-900" : "text-slate-700"}`}>
                          {step.label}
                        </p>
                        {step.status === "held" && step.reason && (
                          <p className="text-xxs text-amber-700 font-semibold mt-0.5">{step.reason}</p>
                        )}
                      </div>
                      <div className="shrink-0 pt-0.5">
                        {step.status === "running" && <Loader2 className="w-4 h-4 text-teal-600 animate-spin" />}
                        {step.status === "done" && <Check className="w-4 h-4 text-emerald-600" />}
                        {step.status === "held" && <ShieldAlert className="w-4 h-4 text-amber-600" />}
                        {step.status === "pending" && <span className="block w-2 h-2 rounded-full bg-slate-300" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Receipt */}
            <AnimatePresence>
              {receipt && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="border-t border-slate-100 bg-slate-50/70 px-5 py-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span className="text-sm font-bold text-slate-800">
                      Closed {receipt.ranTotal} action{receipt.ranTotal === 1 ? "" : "s"} in {receipt.secs}s
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {[
                      receipt.emails > 0 ? `${receipt.emails} email${receipt.emails === 1 ? "" : "s"} sent` : null,
                      receipt.events > 0 ? `${receipt.events} event${receipt.events === 1 ? "" : "s"} created` : null,
                      receipt.docs > 0 ? `${receipt.docs} doc${receipt.docs === 1 ? "" : "s"} drafted` : null,
                      receipt.others > 0 ? `${receipt.others} other${receipt.others === 1 ? "" : "s"} executed` : null,
                    ].filter(Boolean).join(", ") || "No auto-run actions"}
                    {receipt.held > 0 && (
                      <span className="text-amber-700 font-semibold"> · {receipt.held} held for approval</span>
                    )}
                  </p>
                  <button
                    onClick={onClose}
                    className="mt-3 w-full px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition-colors"
                  >
                    Done
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
