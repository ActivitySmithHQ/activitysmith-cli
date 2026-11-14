import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

// Limits from the backend approval review contract (backend docs/approval-review.md).
export const APPROVAL_LIMITS = {
  minOptions: 2,
  maxOptions: 4,
  optionLabel: 80,
  maxTopFiles: 2,
  topFileName: 500,
  maxFilesChanged: 1_000_000,
  maxChangedLines: 1_000_000_000,
  maxLinks: 5,
  linkTitle: 120,
  linkUrl: 2000,
  maxScreenshots: 5,
  screenshotTitle: 60,
  screenshotBytes: 2 * 1024 * 1024,
};

const OPTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_OPTION_IDS = ["a", "b", "c", "d"];

// --option "left=Keep the left layout" or --option "Keep the left layout" (ID a, b, c, d by position).
export const parseOptionArgument = (value) => {
  const separator = value.indexOf("=");
  const id = separator > 0 ? value.slice(0, separator).trim() : "";
  if (separator > 0 && OPTION_ID_PATTERN.test(id)) {
    return { id, label: value.slice(separator + 1).trim() };
  }
  return { id: null, label: value.trim() };
};

export const buildApprovalOptions = (entries, { recommended, screenshots = {} } = {}) => {
  if (entries.length === 0) {
    if (recommended) throw new Error("--recommended needs --option.");
    if (Object.keys(screenshots).length > 0) throw new Error("--option-screenshot needs --option.");
    return undefined;
  }
  if (entries.length < APPROVAL_LIMITS.minOptions || entries.length > APPROVAL_LIMITS.maxOptions) {
    throw new Error(`Give 2 to 4 --option values, not ${entries.length}.`);
  }
  const options = entries.map((entry, index) => ({ id: entry.id ?? DEFAULT_OPTION_IDS[index], label: entry.label }));
  const ids = new Set();
  for (const option of options) {
    if (!option.label) throw new Error(`Option ${option.id} needs a label.`);
    if (option.label.length > APPROVAL_LIMITS.optionLabel) {
      throw new Error(`Option ${option.id} label is longer than ${APPROVAL_LIMITS.optionLabel} characters.`);
    }
    if (ids.has(option.id)) throw new Error(`Option ID ${option.id} is used twice.`);
    ids.add(option.id);
  }
  if (recommended && !ids.has(recommended)) {
    throw new Error(`--recommended ${recommended} is not one of the option IDs: ${[...ids].join(", ")}.`);
  }
  for (const id of Object.keys(screenshots)) {
    if (!ids.has(id)) throw new Error(`--option-screenshot ${id} is not one of the option IDs: ${[...ids].join(", ")}.`);
  }
  return options.map((option) => (option.id === recommended ? { ...option, recommended: true } : option));
};

// --option-screenshot "left=shots/left.png"
export const parseOptionScreenshotArgument = (value) => {
  const separator = value.indexOf("=");
  const id = separator > 0 ? value.slice(0, separator).trim() : "";
  const path = separator > 0 ? value.slice(separator + 1).trim() : "";
  if (!id || !path) throw new Error("--option-screenshot must be <option-id>=<file>.");
  return { id, path };
};

// --screenshot "shots/after.png" or --screenshot "shots/after.png=New settings page"
export const parseScreenshotArgument = (value) => {
  const separator = value.indexOf("=");
  const path = (separator > 0 ? value.slice(0, separator) : value).trim();
  const title = separator > 0 ? value.slice(separator + 1).trim() : "";
  if (!path) throw new Error("--screenshot needs a file path.");
  if (title.length > APPROVAL_LIMITS.screenshotTitle) {
    throw new Error(`Screenshot title "${title}" is longer than ${APPROVAL_LIMITS.screenshotTitle} characters.`);
  }
  return { path, ...(title ? { title } : {}) };
};

// --change "src/app.ts:12:3" (path, lines added, lines removed). Paths may contain colons.
export const parseChangeArgument = (value) => {
  const match = /^(.+):(\d+):(\d+)$/.exec(value.trim());
  if (!match || !match[1].trim()) throw new Error(`--change must be <path>:<added>:<removed>, such as src/app.ts:12:3. Got "${value}".`);
  return { path: match[1].trim(), added: Number(match[2]), removed: Number(match[3]) };
};

// --link "Pull request=https://github.com/acme/app/pull/42" or --link "https://...".
export const parseLinkArgument = (value) => {
  const trimmed = value.trim();
  const separator = trimmed.indexOf("=https://");
  const title = separator > 0 ? trimmed.slice(0, separator).trim() : "";
  const url = separator > 0 ? trimmed.slice(separator + 1).trim() : trimmed;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`--link must be <title>=<https URL> or an https URL. Got "${value}".`);
  }
  if (parsed.protocol !== "https:") throw new Error(`Links must use https. Got "${url}".`);
  if (url.length > APPROVAL_LIMITS.linkUrl) throw new Error(`Link URL is longer than ${APPROVAL_LIMITS.linkUrl} characters.`);
  if (title.length > APPROVAL_LIMITS.linkTitle) throw new Error(`Link title is longer than ${APPROVAL_LIMITS.linkTitle} characters.`);
  return { title: title || url.slice(0, APPROVAL_LIMITS.linkTitle), url };
};

// Parses `git diff --numstat -z --no-renames`. Binary files report "-" and count as 0 lines.
export const parseGitNumstat = (output) =>
  output
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const [added, removed, ...pathParts] = record.split("\t");
      return {
        path: pathParts.join("\t").replace(/^\n+/, ""),
        added: Number.parseInt(added, 10) || 0,
        removed: Number.parseInt(removed, 10) || 0,
      };
    })
    .filter((file) => file.path);

const execFileAsync = promisify(execFile);

// File changes from git: the uncommitted changes against HEAD, or a range such as main...HEAD.
export const readGitChanges = async (range, { cwd = process.cwd() } = {}) => {
  const args = ["diff", "--numstat", "-z", "--no-renames", typeof range === "string" && range ? range : "HEAD"];
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    return parseGitNumstat(stdout);
  } catch (error) {
    const reason = String(error.stderr || error.message || "").trim().split("\n")[0];
    throw new Error(`Could not read changes with git ${args.join(" ")}: ${reason}`);
  }
};

// The name the review screen shows: the last path component.
export const changedFileName = (path) => {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  const name = trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || trimmed;
  return name.slice(0, APPROVAL_LIMITS.topFileName);
};

// Reduces changed files to what the review screen shows: the file count, the line totals, and the
// names of the 2 most changed files (added plus removed). Returns undefined when nothing changed.
export const buildApprovalChanges = (files) => {
  const changed = files.filter((file) => file.path && file.path.trim());
  if (changed.length === 0) return undefined;
  // Array sort is stable, so files with the same line count keep their order.
  const topFiles = [...changed]
    .sort((a, b) => b.added + b.removed - (a.added + a.removed))
    .slice(0, APPROVAL_LIMITS.maxTopFiles)
    .map((file) => changedFileName(file.path));
  return {
    files_changed: Math.min(APPROVAL_LIMITS.maxFilesChanged, changed.length),
    lines_added: Math.min(APPROVAL_LIMITS.maxChangedLines, changed.reduce((total, file) => total + file.added, 0)),
    lines_removed: Math.min(APPROVAL_LIMITS.maxChangedLines, changed.reduce((total, file) => total + file.removed, 0)),
    top_files: topFiles,
  };
};

// Reads the type from the file signature, as the API does, so a renamed file fails before upload.
export const detectImageType = (data) => {
  if (data.length > 8 && data[0] === 0x89 && data.subarray(1, 4).toString("ascii") === "PNG") return "image/png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length > 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
};

export const readScreenshotFile = async (path) => {
  let data;
  try {
    data = await readFile(path);
  } catch (error) {
    throw new Error(`Could not read screenshot ${path}: ${error.code === "ENOENT" ? "no such file" : error.message}`);
  }
  const contentType = detectImageType(data);
  if (!contentType) throw new Error(`Screenshot ${path} is not a PNG, JPEG, or WebP image.`);
  if (data.length > APPROVAL_LIMITS.screenshotBytes) {
    throw new Error(`Screenshot ${path} is ${(data.length / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`);
  }
  return { data, contentType };
};

// One line for each final status. Exit codes are in APPROVAL_EXIT in cli.js.
export const approvalResultLines = (approval) => {
  switch (approval?.status) {
    case "approved":
      return ["Approved."];
    case "rejected":
      return ["Rejected. Do not continue with the action."];
    case "replied":
      return [
        "Replied. Read the reply and follow it. Do not run the original action unless the reply says to.",
        "Reply:",
        approval.reply ?? "",
      ];
    case "chosen": {
      const option = approval.selected_option ?? approval.options?.find((item) => item.id === approval.selected_option_id);
      return [
        `Chosen: ${option?.label ?? approval.selected_option_id}`,
        `Option ID: ${approval.selected_option_id}`,
        "Do the chosen option.",
      ];
    }
    case "timed_out":
      return ["Timed out. No decision within 30 minutes. Do not continue with the action."];
    case "cancelled":
      return ["Cancelled. Do not continue with the action."];
    case "pending":
      return ["Pending."];
    default:
      return [`Status: ${approval?.status}`];
  }
};
