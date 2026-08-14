import { z } from 'zod';

/**
 * Eval assertion — a single check against agent output or transcript.
 *
 * Types:
 * - `contains`: output must contain a string (case-insensitive)
 * - `not_contains`: output must NOT contain a string
 * - `regex`: output must match a regex pattern
 * - `tool_used`: agent must have called a specific tool (checks transcript.toolCalls)
 * - `tool_not_used`: agent must NOT have called a specific tool
 * - `files_modified`: agent must have modified specific files
 * - `structure`: output must match a structural pattern (e.g., has <summary> tag)
 * - `references_read`: output indicates the agent read a references/ file.
 *   Requires `referenceContent` (content unique to the reference file).
 * - `agent_routed`: a specific agent must have been invoked (checks transcript.agentInvocations)
 * - `subagent_count`: number of unique agents invoked must be within a range
 * - `background_task_completed`: a background task must have completed and reconciled
 * - `state_check`: verify environment state after the eval (outcome verification)
 * - `transcript_analysis`: check transcript metrics (turns, tokens, tool calls)
 */
export const AssertionSchema = z.object({
  type: z.enum([
    'contains',
    'not_contains',
    'regex',
    'tool_used',
    'tool_not_used',
    'files_modified',
    'structure',
    'references_read',
    'agent_routed',
    'subagent_count',
    'background_task_completed',
    'state_check',
    'transcript_analysis',
  ]),
  value: z.string(),
  description: z.string(),
  /** Required for references_read: unique content from the reference file */
  referenceContent: z.union([z.string(), z.array(z.string())]).optional(),
  /** Weight for partial credit scoring (default: 1) */
  weight: z.number().default(1).optional(),
});
export type Assertion = z.infer<typeof AssertionSchema>;

/**
 * Reference solution for validating graders.
 * A known working output that passes all graders.
 */
export const ReferenceSolutionSchema = z.object({
  /** The reference output text */
  output: z.string(),
  /** How to compare against reference */
  matchType: z.enum(['exact', 'contains', 'semantic']),
  /** For semantic similarity: minimum similarity threshold (0-1) */
  threshold: z.number().optional(),
});
export type ReferenceSolution = z.infer<typeof ReferenceSolutionSchema>;

export const EvalCaseSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  agent: z.string().default('orchestrator'),
  description: z.string().optional(),
  assertions: z.array(AssertionSchema).default([]),
  tags: z.array(z.string()).default([]),
  /** Reference solution for validating graders */
  referenceSolution: ReferenceSolutionSchema.optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

/**
 * Eval suite — a collection of eval cases for a skill or behavior.
 */
export const EvalSuiteSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string().default('1.0.0'),
  evals: z.array(EvalCaseSchema),
  /** Capability evals start at low pass rate; regression evals target ~100% */
  category: z.enum(['capability', 'regression']).default('capability').optional(),
});
export type EvalSuite = z.infer<typeof EvalSuiteSchema>;

/**
 * Transcript — complete record of an agent trial.
 */
export interface Transcript {
  /** All messages in the session */
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    toolCalls?: Array<{
      name: string;
      args: unknown;
      result?: unknown;
    }>;
    timestamp?: number;
  }>;
  /** Token usage summary */
  tokens?: {
    input: number;
    output: number;
    reasoning?: number;
    cache?: { read: number; write: number };
  };
  /** Number of tool calls made */
  toolCallCount?: number;
  /** Number of turns (user-assistant exchanges) */
  turnCount?: number;
  /** Agents that handled this session, observed via subagent.session.created */
  agentInvocations?: Array<{
    agent: string;
    sessionId?: string;
    timestamp?: number;
  }>;
  /** Models used, observed via fallback events */
  modelSwitches?: Array<{
    from: string;
    to: string;
    reason?: string;
  }>;
}

/**
 * Result of running a single eval case.
 */
export interface EvalResult {
  evalId: string;
  prompt: string;
  passed: boolean;
  /** Number of output samples evaluated */
  runs: number;
  /** Fraction of runs where all assertions passed (0-1) */
  passRate: number;
  /** pass@k: 1 if at least one run passed, 0 otherwise */
  passAtK: number;
  /** pass^k: 1 if all runs passed, 0 otherwise */
  passKk: number;
  /** Weighted average of assertion scores (0-1) for partial credit */
  partialScore?: number;
  assertions: Array<{
    assertion: Assertion;
    passed: boolean;
    passRate?: number;
    evidence?: string;
    /** Individual assertion score for partial credit (0-1) */
    score?: number;
  }>;
  output?: string;
  /** Full transcript of the agent's execution */
  transcript?: Transcript;
  durationMs?: number;
  error?: string;
}

/**
 * Summary of running an entire eval suite.
 */
export interface EvalSuiteResult {
  suiteName: string;
  totalEvals: number;
  passed: number;
  failed: number;
  skipped: number;
  /** pass@k across the suite: proportion of evals where at least one run passed */
  passAtK: number;
  /** pass^k across the suite: proportion of evals where all runs passed */
  passK: number;
  /** Average partial score across all evals */
  avgPartialScore?: number;
  results: EvalResult[];
  durationMs: number;
  timestamp: string;
}
