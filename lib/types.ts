export const VERSIONS = ["v1.0", "v1.1", "v1.2"] as const;
export type AgentVersion = (typeof VERSIONS)[number];

export type FailureMode =
  | "DESTRUCTIVE_ACTION"
  | "INJECTION_COMPLIANCE"
  | "HALLUCINATED_CONFIDENCE"
  | "GOAL_DRIFT"
  | "TOOL_LOOP"
  | "GUESSED_INPUT";

/** Most severe first — used for "worst offender" and classification precedence. */
export const SEVERITY_ORDER: FailureMode[] = [
  "DESTRUCTIVE_ACTION",
  "INJECTION_COMPLIANCE",
  "HALLUCINATED_CONFIDENCE",
  "GOAL_DRIFT",
  "TOOL_LOOP",
  "GUESSED_INPUT",
];

/** sentence-case labels for UI copy ("Fail — Destructive action") */
export const MODE_LABEL: Record<FailureMode, string> = {
  DESTRUCTIVE_ACTION: "Destructive action",
  INJECTION_COMPLIANCE: "Injection compliance",
  HALLUCINATED_CONFIDENCE: "Hallucinated confidence",
  GOAL_DRIFT: "Goal drift",
  TOOL_LOOP: "Tool loop",
  GUESSED_INPUT: "Guessed input",
};

export type StepType = "thought" | "tool_call" | "tool_result" | "final";

export interface TraceStep {
  type: StepType;
  /** Authored for thought / tool_call / final. For tool_result the sandbox
   *  fills it by actually invoking the mocked tool. */
  text?: string;
  tool?: string;
  args?: Record<string, unknown>;
  latencyMs: number;
  flags?: {
    /** tool_result carries adversarial content aimed at the agent */
    injection?: boolean;
    /** an explicit user confirmation for a destructive action happened here */
    confirmation?: boolean;
  };
}

/** A step after the sandbox has executed it (tool results materialized). */
export interface ResolvedStep extends TraceStep {
  text: string;
  /** set on tool_call steps whose tool is flagged destructive */
  destructive?: boolean;
  /** set on tool_result steps when the mocked tool returned an error */
  error?: boolean;
}

export type Category =
  | "Happy Path"
  | "Robustness"
  | "Safety"
  | "Security"
  | "Accuracy";

export type Verdict = "pass" | "fail";

/** shape produced by the AI generator (and the offline fallback) */
export interface GeneratedScenario {
  title: string;
  category: Category;
  userMessage: string;
  targetFailureMode: FailureMode;
  rationale: string;
}

export interface Scenario {
  /** present on AI-generated (or fallback) scenarios */
  generated?: boolean;
  source?: "live" | "fallback";
  rationale?: string;
  id: string;
  title: string;
  category: Category;
  adversarial: boolean;
  userMessage: string;
  /** tools the task legitimately needs — anything else is goal drift */
  allowedTools: string[];
  trace: TraceStep[];
  verdict: Verdict;
  failureMode: FailureMode | null;
}
