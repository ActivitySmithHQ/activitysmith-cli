// The coding agent running the CLI, read from the environment it sets for its shell commands.
// Requests send it as X-ActivitySmith-Agent, so Push Notifications and approvals show the agent's
// name and icon, such as "Claude Code needs your approval", instead of the CLI's own sign-in name.
// The API accepts only the ids below and ignores anything else.

// AI_AGENT is the shared convention ("claude-code_2-1-321_agent"); check it by prefix.
const AI_AGENT_PREFIXES = [
  ["claude-code", "claude-code"],
  ["codex", "codex"],
  ["cursor", "cursor"],
];

/** Environment variables this reads, so tests can clear them. */
export const AGENT_ENV_VARS = [
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CLAUDE_CODE_IS_COWORK",
  "CODEX_THREAD_ID",
  "CODEX_SANDBOX",
  "CODEX_CI",
  "CURSOR_AGENT",
  "CURSOR_EXTENSION_HOST_ROLE",
  "CURSOR_TRACE_ID",
];

export function detectAgent(env = process.env) {
  // Cowork runs Claude Code, so it is checked before AI_AGENT names Claude Code.
  if ((env.CLAUDECODE || env.CLAUDE_CODE) && env.CLAUDE_CODE_IS_COWORK) return "claude-cowork";

  const aiAgent = String(env.AI_AGENT ?? "").trim().toLowerCase();
  const fromAiAgent = AI_AGENT_PREFIXES.find(([prefix]) => aiAgent.startsWith(prefix));
  if (fromAiAgent) return fromAiAgent[1];

  if (env.CLAUDECODE || env.CLAUDE_CODE) return "claude-code";
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX || env.CODEX_CI) return "codex";
  if (env.CURSOR_AGENT || env.CURSOR_EXTENSION_HOST_ROLE === "agent-exec") return "cursor";
  // Every terminal in Cursor sets this, so it comes last: Claude Code or Codex running inside
  // Cursor's terminal is still that agent.
  if (env.CURSOR_TRACE_ID) return "cursor";
  return null;
}

export const AGENT_HEADER = "X-ActivitySmith-Agent";

export function agentHeaders(env = process.env) {
  const agent = detectAgent(env);
  return agent ? { [AGENT_HEADER]: agent } : {};
}
