/**
 * Retrospective Store Tool - Manages feedback storage and retrieval for cross-session learning.
 * 
 * Storage: {project}/.gyoshu/retrospectives/feedback.jsonl
 * Actions: append, list, query, top, stats
 * 
 * @module retrospective-store
 */

import { tool } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  getRetrospectivesDir,
  getRetrospectivesFeedbackPath,
  ensureDirSync,
} from "../lib/paths";

interface RetrospectiveFeedback {
  id: string;
  timestamp: string;
  task_context: string;
  observation: string;
  learning: string;
  recommendation: string;
  impact_score: number;
  tags: string[];
  source_session_id?: string;
  run_id?: string;
  dedupe_key: string;
}

interface StoreIndex {
  lastUpdated: string;
  count: number;
  tagHistogram: Record<string, number>;
}

function getRetroDir(): string {
  return getRetrospectivesDir();
}

function getFeedbackFile(): string {
  return getRetrospectivesFeedbackPath();
}

function getIndexPath(): string {
  return path.join(getRetroDir(), "index.json");
}

function ensureRetroDir(): void {
  ensureDirSync(getRetroDir());
}

function generateDedupeKey(taskContext: string, learning: string): string {
  const content = `${taskContext}:${learning}`;
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function generateId(): string {
  return `fb_${crypto.randomUUID().slice(0, 8)}`;
}

function loadAllFeedback(): RetrospectiveFeedback[] {
  const filePath = getFeedbackFile();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(l => l.trim());
  const feedback: RetrospectiveFeedback[] = [];
  
  for (const line of lines) {
    try {
      feedback.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }
  
  return feedback;
}

function appendFeedback(feedback: RetrospectiveFeedback): void {
  ensureRetroDir();
  const filePath = getFeedbackFile();
  fs.appendFileSync(filePath, JSON.stringify(feedback) + "\n");
  updateIndex(feedback);
}

function loadIndex(): StoreIndex {
  const indexPath = getIndexPath();
  if (!fs.existsSync(indexPath)) {
    return {
      lastUpdated: new Date().toISOString(),
      count: 0,
      tagHistogram: {},
    };
  }
  
  try {
    return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  } catch {
    return {
      lastUpdated: new Date().toISOString(),
      count: 0,
      tagHistogram: {},
    };
  }
}

function saveIndex(index: StoreIndex): void {
  ensureRetroDir();
  fs.writeFileSync(getIndexPath(), JSON.stringify(index, null, 2));
}

function updateIndex(feedback: RetrospectiveFeedback): void {
  const index = loadIndex();
  index.lastUpdated = new Date().toISOString();
  index.count += 1;
  
  for (const tag of feedback.tags) {
    index.tagHistogram[tag] = (index.tagHistogram[tag] || 0) + 1;
  }
  
  saveIndex(index);
}

function calculateRecencyWeight(timestamp: string): number {
  const now = Date.now();
  const feedbackTime = new Date(timestamp).getTime();
  const daysSince = (now - feedbackTime) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - daysSince / 30);
}

function calculateScore(feedback: RetrospectiveFeedback): number {
  const recency = calculateRecencyWeight(feedback.timestamp);
  return feedback.impact_score * 0.7 + recency * 0.3;
}

function matchesQuery(feedback: RetrospectiveFeedback, query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return (
    feedback.task_context.toLowerCase().includes(lowerQuery) ||
    feedback.observation.toLowerCase().includes(lowerQuery) ||
    feedback.learning.toLowerCase().includes(lowerQuery) ||
    feedback.recommendation.toLowerCase().includes(lowerQuery) ||
    feedback.tags.some(t => t.toLowerCase().includes(lowerQuery))
  );
}

export default tool({
  name: "retrospective-store",
  description:
    "Manage retrospective feedback for cross-session learning. " +
    "Actions: append (add feedback), list (get recent), query (search), top (ranked), stats (counts).",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["append", "list", "query", "top", "stats"],
        description:
          "append: Add new feedback, " +
          "list: Get recent feedback, " +
          "query: Search feedback by text, " +
          "top: Get top-ranked feedback, " +
          "stats: Get storage statistics",
      },
      feedback: {
        type: "object",
        description: "Feedback record for append action",
        properties: {
          task_context: { type: "string", description: "Brief task description" },
          observation: { type: "string", description: "What happened" },
          learning: { type: "string", description: "Key takeaway" },
          recommendation: { type: "string", description: "How to improve" },
          impact_score: { type: "number", description: "Importance 0-1" },
          tags: { type: "array", items: { type: "string" }, description: "Categories" },
          source_session_id: { type: "string", description: "Session ID" },
          run_id: { type: "string", description: "Cycle/run ID" },
        },
        required: ["task_context", "observation", "learning", "recommendation"],
      },
      query: {
        type: "string",
        description: "Search text for query action",
      },
      limit: {
        type: "number",
        description: "Maximum results to return (default: 10)",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Filter by tags",
      },
      since: {
        type: "string",
        description: "ISO timestamp to filter from",
      },
    },
    required: ["action"],
  },

  async execute(args: {
    action: "append" | "list" | "query" | "top" | "stats";
    feedback?: {
      task_context: string;
      observation: string;
      learning: string;
      recommendation: string;
      impact_score?: number;
      tags?: string[];
      source_session_id?: string;
      run_id?: string;
    };
    query?: string;
    limit?: number;
    tags?: string[];
    since?: string;
  }) {
    const { action, limit = 10 } = args;

    try {
      switch (action) {
        case "append": {
          if (!args.feedback) {
            return JSON.stringify({
              success: false,
              error: "feedback object required for append action",
            });
          }

          const feedback: RetrospectiveFeedback = {
            id: generateId(),
            timestamp: new Date().toISOString(),
            task_context: args.feedback.task_context,
            observation: args.feedback.observation,
            learning: args.feedback.learning,
            recommendation: args.feedback.recommendation,
            impact_score: Math.max(0, Math.min(1, args.feedback.impact_score ?? 0.5)),
            tags: args.feedback.tags ?? [],
            source_session_id: args.feedback.source_session_id,
            run_id: args.feedback.run_id,
            dedupe_key: generateDedupeKey(
              args.feedback.task_context,
              args.feedback.learning
            ),
          };

          appendFeedback(feedback);

          return JSON.stringify({
            success: true,
            feedback_id: feedback.id,
            dedupe_key: feedback.dedupe_key,
          });
        }

        case "list": {
          let allFeedback = loadAllFeedback();

          if (args.since) {
            const sinceTime = new Date(args.since).getTime();
            allFeedback = allFeedback.filter(
              f => new Date(f.timestamp).getTime() >= sinceTime
            );
          }

          if (args.tags?.length) {
            allFeedback = allFeedback.filter(f =>
              args.tags!.some(t => f.tags.includes(t))
            );
          }

          allFeedback.sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );

          return JSON.stringify({
            success: true,
            count: Math.min(limit, allFeedback.length),
            total: allFeedback.length,
            feedback: allFeedback.slice(0, limit),
          });
        }

        case "query": {
          if (!args.query) {
            return JSON.stringify({
              success: false,
              error: "query string required for query action",
            });
          }

          let allFeedback = loadAllFeedback();
          const matches = allFeedback.filter(f => matchesQuery(f, args.query!));
          matches.sort((a, b) => calculateScore(b) - calculateScore(a));

          return JSON.stringify({
            success: true,
            query: args.query,
            count: Math.min(limit, matches.length),
            total_matches: matches.length,
            feedback: matches.slice(0, limit),
          });
        }

        case "top": {
          let allFeedback = loadAllFeedback();

          if (args.tags?.length) {
            allFeedback = allFeedback.filter(f =>
              args.tags!.some(t => f.tags.includes(t))
            );
          }

          const scored = allFeedback.map(f => ({
            feedback: f,
            score: calculateScore(f),
          }));

          scored.sort((a, b) => b.score - a.score);

          const seenKeys = new Set<string>();
          const dedupedTop: Array<{ feedback: RetrospectiveFeedback; score: number }> = [];

          for (const item of scored) {
            if (!seenKeys.has(item.feedback.dedupe_key)) {
              seenKeys.add(item.feedback.dedupe_key);
              dedupedTop.push(item);
              if (dedupedTop.length >= limit) break;
            }
          }

          return JSON.stringify({
            success: true,
            count: dedupedTop.length,
            feedback: dedupedTop.map(item => ({
              ...item.feedback,
              _score: Math.round(item.score * 100) / 100,
            })),
          });
        }

        case "stats": {
          const index = loadIndex();
          const topTags = Object.entries(index.tagHistogram)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

          return JSON.stringify({
            success: true,
            last_updated: index.lastUpdated,
            total_feedback: index.count,
            top_tags: Object.fromEntries(topTags),
          });
        }

        default:
          return JSON.stringify({
            success: false,
            error: `Unknown action: ${action}`,
          });
      }
    } catch (e) {
      return JSON.stringify({
        success: false,
        error: (e as Error).message,
      });
    }
  },
});
