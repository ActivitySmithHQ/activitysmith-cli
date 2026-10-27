#!/usr/bin/env node

import { Command, InvalidArgumentError, Option } from "commander";
import { loadMetadata } from "./metadata.js";
import {
  API_KEYS_SCOPE,
  DEFAULT_API_RESOURCE,
  LOGIN_SCOPES,
  credentialsPath,
  getAccessToken,
  hasScope,
  login,
  logout,
  readCredentials,
} from "./auth.js";
import ActivitySmith from "activitysmith";
import { createRequire } from "module";
import { readFile } from "fs/promises";
import { resolve } from "path";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("activitysmith-cli")
  .description("CLI for ActivitySmith API")
  .version(version)
  .option(
    "--api-key <key>",
    "ActivitySmith API key (defaults to ACTIVITYSMITH_API_KEY, then the sign-in from auth login)"
  )
  .option("--json", "Output JSON");

const parseIntegerOption = (label) => (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError(`${label} must be an integer`);
  }
  return parsed;
};

const parseBadgeCountArgument = (value) => {
  const badge = parseIntegerOption("badge")(value);
  if (badge < 0 || badge > 2147483647) {
    throw new InvalidArgumentError(
      "badge must be an integer between 0 and 2147483647"
    );
  }
  return badge;
};

const parseNumberOption = (label) => (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new InvalidArgumentError(`${label} must be a number`);
  }
  return parsed;
};

const parseBooleanOption = (label) => (value) => {
  if (typeof value !== "string") {
    throw new InvalidArgumentError(`${label} must be true or false`);
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw new InvalidArgumentError(`${label} must be true or false`);
};

const parseChannelsOption = (value) => {
  if (typeof value !== "string") {
    throw new InvalidArgumentError("channels must be a comma-separated string");
  }

  const channels = value
    .split(",")
    .map((channel) => channel.trim())
    .filter((channel) => channel.length > 0);

  if (channels.length === 0) {
    throw new InvalidArgumentError("channels must contain at least one channel slug");
  }

  return channels;
};

const parseTagsOption = (value, previous = []) => {
  if (typeof value !== "string") {
    throw new InvalidArgumentError("tags must be a comma-separated string");
  }

  const tags = value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  if (tags.length === 0) {
    throw new InvalidArgumentError("tags must contain at least one tag");
  }

  return [...previous, ...tags];
};

const parseMetricValueArgument = (value) => {
  if (typeof value !== "string") {
    throw new InvalidArgumentError("value must be a string or number");
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new InvalidArgumentError("value cannot be empty");
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string" || typeof parsed === "number") {
      return parsed;
    }
    throw new InvalidArgumentError("value must be a string or number");
  } catch (error) {
    if (error instanceof InvalidArgumentError) {
      throw error;
    }
    return value;
  }
};

const normalizeHttpsUrl = (value, label) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use https`);
  }

  return parsed.toString();
};

const normalizeUrlWithSchemes = (value, label, schemes) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  const allowedProtocols = schemes.map((scheme) => `${scheme}:`);
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`${label} must use ${schemes.join(" or ")}`);
  }

  return parsed.toString();
};

const normalizeActionUrl = (value, label, type, push = false) => {
  if (type === "open_url") {
    if (push) return normalizeOpenUrl(value, label);
    const normalized = typeof value === "string" ? value.trim().replace(/^x-safari-https:\/\//i, "https://") : value;
    return normalizeUrlWithSchemes(normalized, label, ["http", "https", "shortcuts"]);
  }

  return normalizeHttpsUrl(value, label);
};

const normalizeOpenUrl = (value, label) => {
  if (typeof value !== "string") throw new Error(`${label} must be a string URL`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error(`${label} must be a valid external URL of at most 2048 characters`);
  }
  let parsed;
  try { parsed = new URL(trimmed); } catch { throw new Error(`${label} must be a valid external URL`); }
  const blocked = ["about:", "activitysmith:", "app-prefs:", "blob:", "data:", "file:", "itms-services:", "javascript:", "prefs:"];
  if (blocked.includes(parsed.protocol.toLowerCase())) throw new Error(`${label} uses a blocked URL scheme`);
  return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : trimmed;
};

const addContentStateOptions = (command, { includeAutoDismiss, includeAutoDismissSeconds } = {}) => {
  command
    .option("--content-state <json>", "Content state as JSON string")
    .option("--content-state-file <path>", "Content state JSON file path")
    .option("--metrics <json>", "Content state metrics as JSON array")
    .option("--metrics-file <path>", "Content state metrics JSON file path")
    .option("--title <title>", "Content state title")
    .option("--subtitle <subtitle>", "Content state subtitle")
    .option("--type <type>", "Content state type")
    .option("--message <message>", "Alert message")
    .option("--icon-symbol <symbol>", "SF Symbol name")
    .option("--icon-color <color>", "Icon color")
    .option("--badge-title <title>", "Badge title")
    .option("--badge-color <color>", "Badge color")
    .option(
      "--number-of-steps <number>",
      "Content state number of steps",
      parseIntegerOption("number-of-steps")
    )
    .option(
      "--current-step <number>",
      "Content state current step",
      parseIntegerOption("current-step")
    )
    .option(
      "--percentage <number>",
      "Content state percentage",
      parseNumberOption("percentage")
    )
    .option(
      "--value <value>",
      "Formatted Value readout, or numeric progress value"
    )
    .option(
      "--upper-limit <number>",
      "Content state upper limit",
      parseNumberOption("upper-limit")
    )
    .option(
      "--duration-seconds <number>",
      "Timer duration in seconds",
      parseNumberOption("duration-seconds")
    )
    .option(
      "--counts-down <boolean>",
      "Set to false for an elapsed timer",
      parseBooleanOption("counts-down")
    )
    .option("--color <color>", "Content state color")
    .option("--step-color <color>", "Content state step color");

  if (includeAutoDismiss) {
    command.option(
      "--auto-dismiss-minutes <number>",
      "Auto dismiss minutes for ended activity",
      parseIntegerOption("auto-dismiss-minutes")
    );
  }

  if (includeAutoDismissSeconds) {
    command.option(
      "--auto-dismiss-seconds <number>",
      "Auto dismiss seconds for ended stream (takes precedence over minutes)",
      parseIntegerOption("auto-dismiss-seconds")
    );
  }

  return command;
};

const addLiveActivityActionOptions = (command) =>
  command
    .option("--action <json>", "Live Activity action as JSON object")
    .option("--action-file <path>", "Live Activity action JSON file path")
    .option(
      "--secondary-action <json>",
      "Secondary Live Activity action as JSON object"
    )
    .option(
      "--secondary-action-file <path>",
      "Secondary Live Activity action JSON file path"
    );

// Precedence: --api-key, then ACTIVITYSMITH_API_KEY, then the sign-in saved by `auth login`.
const credentialSource = (options) => {
  if (options.apiKey) return "--api-key";
  if (process.env.ACTIVITYSMITH_API_KEY) return "ACTIVITYSMITH_API_KEY";
  return readCredentials() ? "auth login" : null;
};

const createClient = (apiKey) =>
  new ActivitySmith({
    apiKey,
    sdk: { name: "cli", version },
  });

const assertPlainObject = (value, label) => {
  const isPlainObject =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]";

  if (!isPlainObject) {
    throw new Error(`${label} must be a JSON object`);
  }
};

const parseJsonString = (value, label) => {
  try {
    const parsed = JSON.parse(value);
    assertPlainObject(parsed, label);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${label} must be valid JSON`);
    }
    throw error;
  }
};

const readJsonFile = async (filePath, label) => {
  const resolvedPath = resolve(process.cwd(), filePath);
  let text = "";

  try {
    text = await readFile(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(`${label} could not be read at ${resolvedPath}`);
  }

  try {
    const parsed = JSON.parse(text);
    assertPlainObject(parsed, label);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${label} must contain valid JSON`);
    }
    throw error;
  }
};

const parseJsonArrayString = (value, label) => {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array`);
  }

  return parsed;
};

const readJsonArrayFile = async (filePath, label) => {
  const resolvedPath = resolve(process.cwd(), filePath);
  let text = "";

  try {
    text = await readFile(resolvedPath, "utf8");
  } catch {
    throw new Error(`${label} could not be read at ${resolvedPath}`);
  }

  return parseJsonArrayString(text, label);
};

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const hasOwn = (object, key) =>
  Object.prototype.hasOwnProperty.call(object, key);

const liveActivityColors = new Set([
  "blue",
  "cyan",
  "gray",
  "green",
  "lime",
  "magenta",
  "orange",
  "purple",
  "red",
  "yellow",
]);

const liveActivityColorList = [...liveActivityColors].join(", ");

const validateContentState = (contentState, mode) => {
  const normalizedType =
    typeof contentState.type === "string" ? contentState.type.trim() : undefined;

  if (!isNonEmptyString(contentState.title)) {
    throw new Error("contentState.title is required");
  }

  if (
    normalizedType !== undefined &&
    normalizedType !== "segmented_progress" &&
    normalizedType !== "progress" &&
    normalizedType !== "metrics" &&
    normalizedType !== "stats" &&
    normalizedType !== "alert" &&
    normalizedType !== "timer" &&
    normalizedType !== "value"
  ) {
    throw new Error(
      "contentState.type must be one of: segmented_progress, progress, metrics, stats, alert, timer, value"
    );
  }

  const hasMessage = hasOwn(contentState, "message");
  const hasIcon = hasOwn(contentState, "icon");
  const hasBadge = hasOwn(contentState, "badge");
  const hasNumberOfSteps = hasOwn(contentState, "numberOfSteps");
  const hasCurrentStep = hasOwn(contentState, "currentStep");
  const hasPercentage = hasOwn(contentState, "percentage");
  const hasValue = hasOwn(contentState, "value");
  const hasUpperLimit = hasOwn(contentState, "upperLimit");
  const hasStepColor = hasOwn(contentState, "stepColor");
  const hasMetrics = hasOwn(contentState, "metrics");
  const hasDurationSeconds = hasOwn(contentState, "durationSeconds");
  const hasCountsDown = hasOwn(contentState, "countsDown");
  const hasTimerFields = hasDurationSeconds || hasCountsDown;

  for (const key of ["autoDismissSeconds", "auto_dismiss_seconds"]) {
    if (hasOwn(contentState, key) &&
        (!Number.isInteger(contentState[key]) || contentState[key] < 0)) {
      throw new Error(`contentState.${key} must be a non-negative integer`);
    }
  }

  if (normalizedType !== "value" && hasValue !== hasUpperLimit) {
    throw new Error(
      "contentState.value and contentState.upperLimit must be provided together"
    );
  }

  if (hasNumberOfSteps && contentState.numberOfSteps < 1) {
    throw new Error("contentState.numberOfSteps must be at least 1");
  }

  if (hasCurrentStep && contentState.currentStep < 1) {
    throw new Error("contentState.currentStep must be at least 1");
  }

  if (
    hasPercentage &&
    (contentState.percentage < 0 || contentState.percentage > 100)
  ) {
    throw new Error("contentState.percentage must be between 0 and 100");
  }

  if (hasUpperLimit && contentState.upperLimit <= 0) {
    throw new Error("contentState.upperLimit must be greater than 0");
  }

  if (hasDurationSeconds && contentState.durationSeconds <= 0) {
    throw new Error("contentState.durationSeconds must be greater than 0");
  }

  if (hasCountsDown && typeof contentState.countsDown !== "boolean") {
    throw new Error("contentState.countsDown must be true or false");
  }

  const hasSegmentedFields = hasNumberOfSteps || hasCurrentStep || hasStepColor;
  const hasProgressFields = hasPercentage || (hasValue && normalizedType !== "value") || hasUpperLimit;
  const hasAlertFields = hasMessage || hasIcon || hasBadge;

  if (hasIcon) {
    assertPlainObject(contentState.icon, "contentState.icon");
    if (!isNonEmptyString(contentState.icon.symbol)) {
      throw new Error("contentState.icon.symbol is required");
    }
    if (contentState.icon.color !== undefined) {
      if (!isNonEmptyString(contentState.icon.color)) {
        throw new Error("contentState.icon.color must be a string");
      }
      if (!liveActivityColors.has(contentState.icon.color.trim())) {
        throw new Error(
          `contentState.icon.color must be one of: ${liveActivityColorList}`
        );
      }
    }
  }

  if (hasBadge) {
    assertPlainObject(contentState.badge, "contentState.badge");
    if (!isNonEmptyString(contentState.badge.title)) {
      throw new Error("contentState.badge.title is required");
    }
    if (contentState.badge.color !== undefined) {
      if (!isNonEmptyString(contentState.badge.color)) {
        throw new Error("contentState.badge.color must be a string");
      }
      if (!liveActivityColors.has(contentState.badge.color.trim())) {
        throw new Error(
          `contentState.badge.color must be one of: ${liveActivityColorList}`
        );
      }
    }
  }

  if (hasSegmentedFields && hasProgressFields) {
    throw new Error(
      "Do not mix segmented_progress fields with progress fields in the same contentState"
    );
  }

  if (hasMetrics && (hasSegmentedFields || hasProgressFields)) {
    throw new Error(
      "Do not mix metrics fields with segmented_progress or progress fields in the same contentState"
    );
  }

  if (
    hasMessage &&
    (hasMetrics || hasSegmentedFields || hasProgressFields || hasStepColor)
  ) {
    throw new Error(
      "Do not mix alert fields with metrics, segmented_progress, or progress fields in the same contentState"
    );
  }

  if (hasMetrics) {
    if (!Array.isArray(contentState.metrics) || contentState.metrics.length === 0) {
      throw new Error("contentState.metrics must be a non-empty array");
    }

    if (normalizedType === "stats" && contentState.metrics.length > 8) {
      throw new Error("stats contentState.metrics supports up to 8 items");
    }

    contentState.metrics.forEach((metric, index) => {
      assertPlainObject(metric, `contentState.metrics[${index}]`);
      if (!isNonEmptyString(metric.label)) {
        throw new Error(`contentState.metrics[${index}].label is required`);
      }
      if (normalizedType === "stats") {
        if (!Number.isFinite(metric.value) && !isNonEmptyString(metric.value)) {
          throw new Error(
            `contentState.metrics[${index}].value must be a number or non-empty string`
          );
        }
      } else if (!Number.isFinite(metric.value)) {
        throw new Error(
          `contentState.metrics[${index}].value must be a number. Use contentState.type=stats for string values`
        );
      }
      if (metric.unit !== undefined && typeof metric.unit !== "string") {
        throw new Error(`contentState.metrics[${index}].unit must be a string`);
      }
      if (metric.color !== undefined) {
        if (!isNonEmptyString(metric.color)) {
          throw new Error(`contentState.metrics[${index}].color must be a string`);
        }
        if (!liveActivityColors.has(metric.color.trim())) {
          throw new Error(
            `contentState.metrics[${index}].color must be one of: ${liveActivityColorList}`
          );
        }
      }
    });
  }

  if (normalizedType === "value") {
    if (!hasValue || !(typeof contentState.value === "string" || Number.isFinite(contentState.value))) {
      throw new Error("Value requires contentState.value as a string or finite number");
    }
    if (hasProgressFields || hasSegmentedFields || hasMetrics || hasTimerFields || hasMessage) {
      throw new Error("Do not mix Value with other Live Activity type fields");
    }
    return;
  }

  const effectiveType = normalizedType;

  if (mode === "start" || mode === "stream") {
    if (!effectiveType) {
      throw new Error(`contentState.type is required for activity ${mode}`);
    }

    if (effectiveType === "segmented_progress") {
      if (!hasNumberOfSteps || !hasCurrentStep) {
        throw new Error(
          "segmented_progress start requires contentState.numberOfSteps and contentState.currentStep"
        );
      }
      return;
    }

    if (effectiveType === "metrics" || effectiveType === "stats") {
      if (!hasMetrics) {
        throw new Error(`${effectiveType} ${mode} requires contentState.metrics`);
      }
      return;
    }

    if (effectiveType === "alert") {
      if (!isNonEmptyString(contentState.message)) {
        throw new Error(`alert ${mode} requires contentState.message`);
      }
      return;
    }

    if (effectiveType === "timer") {
      if (mode === "start" && !hasDurationSeconds && contentState.countsDown !== false) {
        throw new Error(
          `timer ${mode} requires contentState.durationSeconds, or contentState.countsDown=false`
        );
      }
      return;
    }

    if (!hasPercentage && !hasValue) {
      throw new Error(
        `progress ${mode} requires contentState.percentage, or contentState.value with contentState.upperLimit`
      );
    }
    return;
  }

  if (effectiveType === "segmented_progress") {
    if (!hasCurrentStep) {
      throw new Error(
        `segmented_progress ${mode} requires contentState.currentStep`
      );
    }
    return;
  }

  if (effectiveType === "progress") {
    if (!hasPercentage && !hasValue) {
      throw new Error(
        `progress ${mode} requires contentState.percentage, or contentState.value with contentState.upperLimit`
      );
    }
    return;
  }

  if (effectiveType === "metrics" || effectiveType === "stats") {
    if (!hasMetrics) {
      throw new Error(`${effectiveType} ${mode} requires contentState.metrics`);
    }
    return;
  }

  if (effectiveType === "alert") {
    if (!isNonEmptyString(contentState.message)) {
      throw new Error(`alert ${mode} requires contentState.message`);
    }
    return;
  }

  if (effectiveType === "timer") {
    return;
  }

  if (
    !hasSegmentedFields &&
    !hasProgressFields &&
    !hasMetrics &&
    !hasAlertFields &&
    !hasTimerFields
  ) {
    throw new Error(
      `contentState for activity ${mode} must include metrics, segmented_progress fields, progress fields, alert fields, or timer fields`
    );
  }

  if (hasMetrics) {
    return;
  }

  if (hasSegmentedFields && !hasCurrentStep) {
    throw new Error(
      `segmented_progress ${mode} requires contentState.currentStep`
    );
  }

  if (hasProgressFields && !hasPercentage && !hasValue) {
    throw new Error(
      `progress ${mode} requires contentState.percentage, or contentState.value with contentState.upperLimit`
    );
  }

  if (hasAlertFields && !isNonEmptyString(contentState.message)) {
    throw new Error(`alert ${mode} requires contentState.message`);
  }
};

const parseAction = (value, label, push = false) => {
  assertPlainObject(value, label);

  if (typeof value.title !== "string" || value.title.trim().length === 0) {
    throw new Error(`${label}.title is required`);
  }

  if (typeof value.type !== "string") {
    throw new Error(`${label}.type is required`);
  }

  const normalizedType = value.type.trim();
  if (normalizedType !== "open_url" && normalizedType !== "webhook") {
    throw new Error(`${label}.type must be one of: open_url, webhook`);
  }

  const action = {
    title: value.title.trim(),
    type: normalizedType,
    url: normalizeActionUrl(value.url, `${label}.url`, normalizedType, push),
  };

  if (value.method !== undefined) {
    if (typeof value.method !== "string") {
      throw new Error(`${label}.method must be a string`);
    }
    const normalizedMethod = value.method.trim().toUpperCase();
    if (normalizedMethod !== "GET" && normalizedMethod !== "POST") {
      throw new Error(`${label}.method must be one of: GET, POST`);
    }
    action.method = normalizedMethod;
  }

  if (value.body !== undefined) {
    assertPlainObject(value.body, `${label}.body`);
    action.body = value.body;
  }

  if (normalizedType === "open_url" && (value.method !== undefined || value.body !== undefined)) {
    throw new Error(`${label} with type=open_url cannot include method or body`);
  }

  return action;
};

const parsePushAction = (value, index) => parseAction(value, `actions[${index}]`, true);

const loadPushActions = async (options) => {
  if (options.actions && options.actionsFile) {
    throw new Error("Provide either --actions or --actions-file, not both.");
  }

  let actions;
  if (options.actionsFile) {
    actions = await readJsonArrayFile(options.actionsFile, "actions-file");
  }

  if (options.actions) {
    actions = parseJsonArrayString(options.actions, "actions");
  }

  if (actions === undefined) {
    return undefined;
  }

  if (actions.length === 0) {
    throw new Error("actions must contain at least one action");
  }

  if (actions.length > 4) {
    throw new Error("actions can contain at most 4 actions");
  }

  return actions.map(parsePushAction);
};

const loadLiveActivityAction = async (options) => {
  if (options.action && options.actionFile) {
    throw new Error("Provide either --action or --action-file, not both.");
  }

  let action;
  if (options.actionFile) {
    action = await readJsonFile(options.actionFile, "action-file");
  }

  if (options.action) {
    action = parseJsonString(options.action, "action");
  }

  if (action === undefined) {
    return undefined;
  }

  return parseAction(action, "action");
};

const loadLiveActivitySecondaryAction = async (options) => {
  if (options.secondaryAction && options.secondaryActionFile) {
    throw new Error(
      "Provide either --secondary-action or --secondary-action-file, not both."
    );
  }

  let action;
  if (options.secondaryActionFile) {
    action = await readJsonFile(
      options.secondaryActionFile,
      "secondary-action-file"
    );
  }

  if (options.secondaryAction) {
    action = parseJsonString(options.secondaryAction, "secondary-action");
  }

  if (action === undefined) {
    return undefined;
  }

  return parseAction(action, "secondary_action");
};

const validatePushMediaOptions = ({ media, actions }) => {
  if (media === undefined || actions === undefined) {
    return;
  }

  if (actions.length > 0) {
    throw new Error("media cannot be combined with actions");
  }
};

const buildContentStateFromOptions = (options) => {
  const contentState = {};

  if (options.title !== undefined) {
    contentState.title = options.title;
  }

  if (options.subtitle !== undefined) {
    contentState.subtitle = options.subtitle;
  }

  if (options.type !== undefined) {
    contentState.type = options.type;
  }

  if (options.message !== undefined) {
    contentState.message = options.message;
  }

  if (options.iconSymbol !== undefined || options.iconColor !== undefined) {
    contentState.icon = {};
    if (options.iconSymbol !== undefined) {
      contentState.icon.symbol = options.iconSymbol;
    }
    if (options.iconColor !== undefined) {
      contentState.icon.color = options.iconColor;
    }
  }

  if (options.badgeTitle !== undefined || options.badgeColor !== undefined) {
    contentState.badge = {};
    if (options.badgeTitle !== undefined) {
      contentState.badge.title = options.badgeTitle;
    }
    if (options.badgeColor !== undefined) {
      contentState.badge.color = options.badgeColor;
    }
  }

  if (options.numberOfSteps !== undefined) {
    contentState.numberOfSteps = options.numberOfSteps;
  }

  if (options.currentStep !== undefined) {
    contentState.currentStep = options.currentStep;
  }

  if (options.percentage !== undefined) {
    contentState.percentage = options.percentage;
  }

  if (options.value !== undefined) {
    contentState.value = options.type === "value"
      ? options.value
      : parseNumberOption("value")(options.value);
  }

  if (options.upperLimit !== undefined) {
    contentState.upperLimit = options.upperLimit;
  }

  if (options.durationSeconds !== undefined) {
    contentState.durationSeconds = options.durationSeconds;
  }

  if (options.countsDown !== undefined) {
    contentState.countsDown = options.countsDown;
  }

  if (options.color !== undefined) {
    contentState.color = options.color;
  }

  if (options.stepColor !== undefined) {
    contentState.stepColor = options.stepColor;
  }

  if (options.autoDismissSeconds !== undefined) {
    contentState.autoDismissSeconds = options.autoDismissSeconds;
  }

  if (options.autoDismissMinutes !== undefined) {
    contentState.autoDismissMinutes = options.autoDismissMinutes;
  }

  return contentState;
};

const loadMetrics = async (options) => {
  if (options.metrics && options.metricsFile) {
    throw new Error("Provide either --metrics or --metrics-file, not both.");
  }

  if (options.metricsFile) {
    return readJsonArrayFile(options.metricsFile, "metrics-file");
  }

  if (options.metrics) {
    return parseJsonArrayString(options.metrics, "metrics");
  }

  return undefined;
};

const toApiContentState = (contentState) => {
  const keyMap = {
    numberOfSteps: "number_of_steps",
    currentStep: "current_step",
    upperLimit: "upper_limit",
    stepColor: "step_color",
    autoDismissMinutes: "auto_dismiss_minutes",
    autoDismissSeconds: "auto_dismiss_seconds",
    durationSeconds: "duration_seconds",
    countsDown: "counts_down",
  };

  const mapped = {};
  for (const [key, value] of Object.entries(contentState)) {
    if (value === undefined) {
      continue;
    }
    if (keyMap[key]) {
      mapped[keyMap[key]] = value;
    } else {
      mapped[key] = value;
    }
  }
  return mapped;
};

const toApiLiveActivityStartRequest = (
  contentState,
  action,
  secondaryAction
) => {
  const request = {
    content_state: toApiContentState(contentState),
  };

  if (action !== undefined) {
    request.action = action;
  }

  if (secondaryAction !== undefined) {
    request.secondary_action = secondaryAction;
  }

  return request;
};

const withTargetChannels = (request, channels) => {
  if (!channels || channels.length === 0) {
    return request;
  }

  return {
    ...request,
    target: {
      channels,
    },
  };
};

const withTags = (request, tags, metadata) => {
  if (metadata !== undefined) request = { ...request, metadata };
  if (tags === undefined) {
    return request;
  }

  return {
    ...request,
    tags,
  };
};

const toApiLiveActivityUpdateRequest = (
  activityId,
  contentState,
  action,
  secondaryAction
) => {
  const request = {
    activity_id: activityId,
    content_state: toApiContentState(contentState),
  };

  if (action !== undefined) {
    request.action = action;
  }

  if (secondaryAction !== undefined) {
    request.secondary_action = secondaryAction;
  }

  return request;
};

const toApiLiveActivityEndRequest = (
  activityId,
  contentState,
  action,
  secondaryAction
) => {
  const request = {
    activity_id: activityId,
    content_state: toApiContentState(contentState),
  };

  if (action !== undefined) {
    request.action = action;
  }

  if (secondaryAction !== undefined) {
    request.secondary_action = secondaryAction;
  }

  return request;
};

const toApiLiveActivityStreamRequest = (
  contentState,
  action,
  secondaryAction
) => {
  const request = {
    content_state: toApiContentState(contentState),
  };

  if (action !== undefined) {
    request.action = action;
  }

  if (secondaryAction !== undefined) {
    request.secondary_action = secondaryAction;
  }

  return request;
};

const toApiLiveActivityStreamDeleteRequest = (
  contentState,
  action,
  secondaryAction
) => {
  const request = {};

  if (contentState !== undefined) {
    request.content_state = toApiContentState(contentState);
  }

  if (action !== undefined) {
    request.action = action;
  }

  if (secondaryAction !== undefined) {
    request.secondary_action = secondaryAction;
  }

  return request;
};

const loadContentState = async (options, mode) => {
  let contentState = {};

  if (options.contentStateFile) {
    const fromFile = await readJsonFile(
      options.contentStateFile,
      "content-state-file"
    );
    contentState = { ...contentState, ...fromFile };
  }

  if (options.contentState) {
    const fromString = parseJsonString(
      options.contentState,
      "content-state"
    );
    contentState = { ...contentState, ...fromString };
  }

  const fromFlags = buildContentStateFromOptions(options);
  contentState = { ...contentState, ...fromFlags };

  const metrics = await loadMetrics(options);
  if (metrics !== undefined) {
    contentState.metrics = metrics;
  }

  if (Object.keys(contentState).length === 0) {
    throw new Error(
      "contentState is required. Provide --content-state, --content-state-file, or field flags."
    );
  }

  validateContentState(contentState, mode);

  return contentState;
};

const loadOptionalContentState = async (options, mode) => {
  let contentState = {};

  if (options.contentStateFile) {
    const fromFile = await readJsonFile(
      options.contentStateFile,
      "content-state-file"
    );
    contentState = { ...contentState, ...fromFile };
  }

  if (options.contentState) {
    const fromString = parseJsonString(
      options.contentState,
      "content-state"
    );
    contentState = { ...contentState, ...fromString };
  }

  const fromFlags = buildContentStateFromOptions(options);
  contentState = { ...contentState, ...fromFlags };

  const metrics = await loadMetrics(options);
  if (metrics !== undefined) {
    contentState.metrics = metrics;
  }

  if (Object.keys(contentState).length === 0) {
    return undefined;
  }

  validateContentState(contentState, mode);
  return contentState;
};

const formatError = (error) => {
  if (!error) {
    return "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message || "Unknown error";
  }

  return "Unknown error";
};

const tryParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readErrorResponse = async (response) => {
  if (!response || typeof response.text !== "function") {
    return null;
  }

  try {
    const target = typeof response.clone === "function" ? response.clone() : response;
    const text = await target.text();
    return text || null;
  } catch {
    return null;
  }
};

const buildErrorDetails = async (error) => {
  const details = {
    message: formatError(error),
  };

  if (error?.response) {
    details.status = error.response.status;
    details.statusText = error.response.statusText;
    details.url = error.response.url;

    const responseText = await readErrorResponse(error.response);
    if (responseText) {
      details.responseBody = tryParseJson(responseText) ?? responseText;
    }
  }

  if (error?.cause instanceof Error) {
    details.cause = error.cause.message || String(error.cause);
  }

  return details;
};

// Set when a command authenticates with the browser sign-in rather than an API key.
let usingSignIn = false;

const handleError = async (error, options, exitCode = 1) => {
  const details = await buildErrorDetails(error);
  // Disconnecting the CLI in the web app rejects its token at once, before it expires.
  if (usingSignIn && details.status === 401) {
    details.message =
      "Your ActivitySmith sign-in was disconnected or expired. Run activitysmith auth login to sign in again.";
  }

  if (options?.json) {
    console.log(JSON.stringify({ error: details }, null, 2));
  } else {
    console.error(details.message);
    if (details.status) {
      console.error(`Status: ${details.status} ${details.statusText || ""}`.trim());
    }
    if (details.url) {
      console.error(`URL: ${details.url}`);
    }
    if (details.responseBody) {
      const responseText =
        typeof details.responseBody === "string"
          ? details.responseBody
          : JSON.stringify(details.responseBody, null, 2);
      const maxLength = 2000;
      const trimmed =
        responseText.length > maxLength
          ? `${responseText.slice(0, maxLength)}... (truncated)`
          : responseText;
      console.error(`Response: ${trimmed}`);
    }
    if (details.cause) {
      console.error(`Cause: ${details.cause}`);
    }
  }

  process.exit(exitCode);
};

// Returns the API key, or a current access token from the saved sign-in. The REST API accepts
// either as a Bearer token.
const requireApiKey = async (options) => {
  const configuredKey = options.apiKey || process.env.ACTIVITYSMITH_API_KEY;
  const apiKey = configuredKey || (await getAccessToken());
  usingSignIn = !configuredKey && Boolean(apiKey);
  if (!apiKey) {
    throw new Error(
      "Missing API key. Run activitysmith auth login, provide --api-key, or set ACTIVITYSMITH_API_KEY."
    );
  }
  return apiKey;
};

const outputResult = (payload, options, lines) => {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  lines.filter(Boolean).forEach((line) => console.log(line));
};

program
  .command("push")
  .description("Send a push notification, or replace one you already sent")
  .requiredOption("--title <title>", "Push title")
  .option(
    "--replace <notification-id>",
    "Silently replace a sent push notification, using the notification ID from its send output"
  )
  .option("--message <message>", "Push message")
  .option("--subtitle <subtitle>", "Push subtitle")
  .option(
    "--media <url>",
    "HTTPS URL for image, audio, or video shown when the notification is expanded"
  )
  .option("--icon <url>", "HTTPS image URL for the notification icon, such as a logo or avatar")
  .addOption(
    new Option("--interruption-level <level>", "Notification interruption level").choices([
      "passive",
      "active",
      "time-sensitive",
    ])
  )
  .option("--redirection <url>", "HTTPS or shortcuts:// URL opened when notification is tapped")
  .option("--actions <json>", "Actions JSON array (max 4)")
  .option("--actions-file <path>", "Path to actions JSON array file")
  .option(
    "--channels <channels>",
    "Comma-separated channel slugs (optional)",
    parseChannelsOption
  )
  .option(
    "--tags <tags>",
    "Comma-separated tags for organizing history (repeatable)",
    parseTagsOption
  )
  .option("--metadata <json>", "Metadata JSON object shown in ActivitySmith details")
    .option("--metadata-file <path>", "Path to a Metadata JSON object file")
    .action(async (options) => {
    const globalOptions = program.opts();

    try {
      const apiKey = await requireApiKey(globalOptions);
      const client = createClient(apiKey);
      const actions = await loadPushActions(options);
      validatePushMediaOptions({
        media: options.media,
        actions,
      });
      if (options.replace !== undefined) {
        if (options.channels !== undefined || options.interruptionLevel !== undefined) {
          throw new Error(
            "--channels and --interruption-level cannot be combined with --replace. Replacements go to the original recipients and arrive silently."
          );
        }
        if (options.replace.trim() === "") {
          throw new Error("--replace requires the notification ID from the original push output.");
        }
      }

      const pushNotificationRequest = withTargetChannels(
        {
          title: options.title,
          message: options.message,
          subtitle: options.subtitle,
          media:
            options.media !== undefined
              ? normalizeHttpsUrl(options.media, "media")
              : undefined,
          icon:
            options.icon !== undefined
              ? normalizeHttpsUrl(options.icon, "icon")
              : undefined,
          interruption_level: options.interruptionLevel,
          redirection:
            options.redirection !== undefined
              ? normalizeOpenUrl(options.redirection, "redirection")
              : undefined,
          actions,
          tags: options.tags,
          metadata: await loadMetadata(options),
        },
        options.channels
      );

      const isReplacement = options.replace !== undefined;
      const response = isReplacement
        ? await client.notifications.replace(options.replace.trim(), pushNotificationRequest)
        : await client.notifications.sendPushNotification({
            pushNotificationRequest,
          });
      const devicesNotified = response?.devices_notified ?? response?.devicesNotified;
      const notificationId = response?.notification_id ?? response?.notificationId;

      outputResult(response, globalOptions, [
        isReplacement ? "Push replaced." : "Push sent.",
        response?.success !== undefined
          ? `Success: ${response.success}`
          : null,
        devicesNotified !== undefined
          ? `Devices notified: ${devicesNotified}`
          : null,
        notificationId ? `Notification ID: ${notificationId}` : null,
      ]);
    } catch (error) {
      await handleError(error, globalOptions);
    }
  });

program
  .command("badge")
  .alias("badge-count")
  .description("Set App Icon Badge Count; pass 0 to clear it")
  .argument(
    "<value>",
    "App Icon Badge Count; pass 0 to clear it",
    parseBadgeCountArgument
  )
  .option(
    "--channels <channels>",
    "Comma-separated channel slugs (optional)",
    parseChannelsOption
  )
  .action(async (value, options) => {
    const globalOptions = program.opts();

    try {
      const apiKey = await requireApiKey(globalOptions);
      const client = createClient(apiKey);
      const response = await client.badgeCount(
        value,
        options.channels ? { channels: options.channels } : undefined
      );

      outputResult(response, globalOptions, [
        value === 0
          ? "App Icon Badge Count cleared."
          : "App Icon Badge Count updated.",
        response?.badge !== undefined ? `Badge: ${response.badge}` : null,
        response?.devicesUpdated !== undefined || response?.devicesNotified !== undefined
          ? `Devices updated: ${response.devicesUpdated ?? response.devicesNotified}`
          : null,
      ]);
    } catch (error) {
      await handleError(error, globalOptions);
    }
  });

const metricsCommand = program
  .command("metrics")
  .alias("metric")
  .description("Update widget metric values");

metricsCommand
  .command("update")
  .description("Update a widget metric value")
  .argument("<metric-key>", "Metric key")
  .argument("<value>", "Metric value")
  .action(async (metricKey, rawValue) => {
    const globalOptions = program.opts();

    try {
      const apiKey = await requireApiKey(globalOptions);
      const client = createClient(apiKey);
      const value = parseMetricValueArgument(rawValue);
      const response = await client.metrics.update(metricKey, value);

      outputResult(response, globalOptions, ["Metric value updated."]);
    } catch (error) {
      await handleError(error, globalOptions);
    }
  });

const activityCommand = program
  .command("activity")
  .description("Start, update, and end Live Activities");

addLiveActivityActionOptions(addContentStateOptions(
  activityCommand
    .command("stream")
    .description("Send a stateless Live Activity stream update")
    .addHelpText(
      "after",
      "\niOS limits how often a Live Activity can update. Short bursts are fine, but avoid updating the same Live Activity more often than every couple of minutes for long periods.\n"
    )
    .argument("<stream-key>", "Stable stream key")
    .option(
      "--channels <channels>",
      "Comma-separated channel slugs (optional)",
      parseChannelsOption
    )
    .option(
      "--tags <tags>",
      "Comma-separated tags for organizing history (repeatable)",
      parseTagsOption
    )
    .option("--clear-tags", "Remove all Tags from this stream")
    .option("--metadata <json>", "Metadata JSON object shown in ActivitySmith details")
    .option("--metadata-file <path>", "Path to a Metadata JSON object file")
    .action(async (streamKey, options) => {
      const globalOptions = program.opts();

      try {
        if (options.clearTags && options.tags !== undefined) {
          throw new Error("Use either --tags or --clear-tags, not both.");
        }
        const apiKey = await requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadContentState(options, "stream");
        const action = await loadLiveActivityAction(options);
        const secondaryAction = await loadLiveActivitySecondaryAction(options);

        const response = await client.liveActivities.stream(
          streamKey,
          withTags(
            withTargetChannels(
              toApiLiveActivityStreamRequest(
                contentState,
                action,
                secondaryAction
              ),
              options.channels
            ),
            options.clearTags ? [] : options.tags,
            await loadMetadata(options)
          )
        );

        const activityId = response?.activityId ?? response?.activity_id;
        const operation = response?.operation;
        outputResult(response, globalOptions, [
          "Live Activity stream reconciled.",
          streamKey ? `Stream key: ${streamKey}` : null,
          operation ? `Operation: ${operation}` : null,
          activityId ? `Activity ID: ${activityId}` : null,
        ]);
      } catch (error) {
        await handleError(error, globalOptions);
      }
    })
));

addLiveActivityActionOptions(addContentStateOptions(
  activityCommand
    .command("start")
    .description("Start a Live Activity")
    .option(
      "--channels <channels>",
      "Comma-separated channel slugs (optional)",
      parseChannelsOption
    )
    .option(
      "--tags <tags>",
      "Comma-separated tags for organizing history (repeatable)",
      parseTagsOption
    )
    .option("--metadata <json>", "Metadata JSON object shown in ActivitySmith details")
    .option("--metadata-file <path>", "Path to a Metadata JSON object file")
    .action(async (options) => {
      const globalOptions = program.opts();

      try {
        const apiKey = await requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadContentState(options, "start");
        const action = await loadLiveActivityAction(options);
        const secondaryAction = await loadLiveActivitySecondaryAction(options);

        const response = await client.liveActivities.startLiveActivity({
          liveActivityStartRequest: withTags(
            withTargetChannels(
              toApiLiveActivityStartRequest(
                contentState,
                action,
                secondaryAction
              ),
              options.channels
            ),
            options.tags,
            await loadMetadata(options)
          ),
        });

        const activityId = response?.activityId ?? response?.activity_id;
        outputResult(response, globalOptions, [
          "Live Activity started.",
          activityId ? `Activity ID: ${activityId}` : null,
        ]);
      } catch (error) {
        await handleError(error, globalOptions);
      }
    })
));

addLiveActivityActionOptions(addContentStateOptions(
  activityCommand
    .command("update")
    .description("Update a Live Activity")
    .requiredOption("--activity-id <id>", "Live Activity ID")
    .option("--tags <tags>", "Replace Tags for this Live Activity (repeatable)", parseTagsOption)
    .option("--clear-tags", "Remove all Tags from this Live Activity")
    .option("--metadata <json>", "Metadata JSON object shown in ActivitySmith details")
    .option("--metadata-file <path>", "Path to a Metadata JSON object file")
    .action(async (options) => {
      const globalOptions = program.opts();

      try {
        if (options.clearTags && options.tags !== undefined) {
          throw new Error("Use either --tags or --clear-tags, not both.");
        }
        const apiKey = await requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadContentState(options, "update");
        const action = await loadLiveActivityAction(options);
        const secondaryAction = await loadLiveActivitySecondaryAction(options);

        const response = await client.liveActivities.updateLiveActivity({
          liveActivityUpdateRequest: withTags(toApiLiveActivityUpdateRequest(
            options.activityId,
            contentState,
            action,
            secondaryAction
          ), options.clearTags ? [] : options.tags, await loadMetadata(options)),
        });

        outputResult(response, globalOptions, [
          "Live Activity updated.",
          options.activityId ? `Activity ID: ${options.activityId}` : null,
        ]);
      } catch (error) {
        await handleError(error, globalOptions);
      }
    })
));

addLiveActivityActionOptions(addContentStateOptions(
  activityCommand
    .command("end")
    .description("End a Live Activity")
    .requiredOption("--activity-id <id>", "Live Activity ID")
    .option("--tags <tags>", "Replace Tags for this Live Activity (repeatable)", parseTagsOption)
    .option("--clear-tags", "Remove all Tags from this Live Activity")
    .option("--metadata <json>", "Metadata JSON object shown in ActivitySmith details")
    .option("--metadata-file <path>", "Path to a Metadata JSON object file")
    .action(async (options) => {
      const globalOptions = program.opts();

      try {
        if (options.clearTags && options.tags !== undefined) {
          throw new Error("Use either --tags or --clear-tags, not both.");
        }
        const apiKey = await requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadContentState(options, "end");
        const action = await loadLiveActivityAction(options);
        const secondaryAction = await loadLiveActivitySecondaryAction(options);

        const response = await client.liveActivities.endLiveActivity({
          liveActivityEndRequest: withTags(toApiLiveActivityEndRequest(
            options.activityId,
            contentState,
            action,
            secondaryAction
          ), options.clearTags ? [] : options.tags, await loadMetadata(options)),
        });

        outputResult(response, globalOptions, [
          "Live Activity ended.",
          options.activityId ? `Activity ID: ${options.activityId}` : null,
        ]);
      } catch (error) {
        await handleError(error, globalOptions);
      }
    }),
  { includeAutoDismiss: true }
));

addLiveActivityActionOptions(addContentStateOptions(
  activityCommand
    .command("end-stream")
    .description("End a stateless Live Activity stream")
    .argument("<stream-key>", "Stable stream key")
    .option("--tags <tags>", "Comma-separated Tags", parseTagsOption)
    .option("--clear-tags", "Clear existing Tags")
    .option("--metadata <json>", "Metadata as a JSON object")
    .option("--metadata-file <path>", "Metadata JSON file path")
    .action(async (streamKey, options) => {
      const globalOptions = program.opts();

      try {
        if (options.clearTags && options.tags !== undefined) throw new Error("Provide either --tags or --clear-tags, not both.");
        const tags = options.clearTags ? [] : options.tags;
        const metadata = await loadMetadata(options);
        const apiKey = await requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadOptionalContentState(options, "end");
        const action = await loadLiveActivityAction(options);
        const secondaryAction = await loadLiveActivitySecondaryAction(options);

        const request =
          contentState !== undefined ||
          action !== undefined ||
          secondaryAction !== undefined || tags !== undefined || metadata !== undefined
            ? toApiLiveActivityStreamDeleteRequest(
                contentState,
                action,
                secondaryAction
              )
            : undefined;

        if (tags !== undefined) request.tags = tags;
        if (metadata !== undefined) request.metadata = metadata;
        const response = await client.liveActivities.endStream(streamKey, request);

        const activityId = response?.activityId ?? response?.activity_id;
        const operation = response?.operation;
        outputResult(response, globalOptions, [
          "Live Activity stream ended.",
          streamKey ? `Stream key: ${streamKey}` : null,
          operation ? `Operation: ${operation}` : null,
          activityId ? `Activity ID: ${activityId}` : null,
        ]);
      } catch (error) {
        await handleError(error, globalOptions);
      }
    }),
  { includeAutoDismiss: true, includeAutoDismissSeconds: true }
));

const APP_STORE_URL = "https://apps.apple.com/us/app/activitysmith/id6752254835";

// Account endpoints the generated SDK does not cover. Same API and SDK header as the SDK client, so
// errors print the same way and usage shows the CLI version.
const apiRequest = async (path, { token, method = "GET", body } = {}) => {
  const response = await fetch(`${DEFAULT_API_RESOURCE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-ActivitySmith-SDK": `cli-v${version}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.response = response;
    throw error;
  }
  return response.json();
};

const describeDevice = (device) => {
  const name = device.device_name || device.device_type || "Device";
  const system = [device.system_name, device.system_version].filter(Boolean).join(" ");
  const details = [system, device.is_active ? "active" : "inactive", device.user_email].filter(Boolean);
  return `- ${name} (${details.join(", ")}) ID: ${device.device_id}`;
};

const devicesCommand = program
  .command("devices")
  .description("List the iPhones and iPads paired to your account");

devicesCommand
  .command("list", { isDefault: true })
  .description("List paired devices, active ones first")
  .option("--include-inactive", "Also list devices that can no longer receive deliveries")
  .action(async (options) => {
    const globalOptions = program.opts();

    try {
      const token = await requireApiKey(globalOptions);
      const query = options.includeInactive ? "?include_inactive=true" : "";
      const result = await apiRequest(`/account/devices${query}`, { token });
      const devices = Array.isArray(result.devices) ? result.devices : [];
      const active = devices.filter((device) => device.is_active).length;
      outputResult(
        result,
        globalOptions,
        devices.length === 0
          ? [
              "No paired devices.",
              "Install ActivitySmith from the App Store, sign in with this account, and allow notifications:",
              APP_STORE_URL,
            ]
          : [
              `${devices.length} ${devices.length === 1 ? "device" : "devices"}, ${active} active:`,
              ...devices.map(describeDevice),
              result.meta?.has_more ? "More devices exist. Use --json to see the meta.next_offset value." : null,
            ]
      );
    } catch (error) {
      await handleError(error, globalOptions);
    }
  });

const keysCommand = program
  .command("keys")
  .description("Create API keys for CI, servers, and scripts");

keysCommand
  .command("create")
  .description(
    "Create an API key with the browser sign-in. The first time, approve API key access in the browser"
  )
  .requiredOption("--name <name>", 'Key name, such as "GitHub Actions"')
  .option("--channels <slugs>", "Comma-separated channel slugs. The key reaches only these Channels")
  .option("--raw", "Print only the key on standard output, for piping it into a secret store")
  .action(async (options) => {
    const globalOptions = program.opts();

    try {
      // API keys cannot create keys, so this always uses the browser sign-in, even when an API key is set.
      let stored = null;
      try {
        stored = readCredentials();
      } catch {
        // An unreadable sign-in is replaced by the login below.
      }
      if (!hasScope(stored, API_KEYS_SCOPE)) {
        console.error("Approve API key access in the browser so the CLI can create API keys.");
        await login({ scope: `${LOGIN_SCOPES} ${API_KEYS_SCOPE}` });
      }
      const token = await getAccessToken();
      usingSignIn = true;
      const channels = String(options.channels ?? "")
        .split(",")
        .map((slug) => slug.trim())
        .filter(Boolean);
      const result = await apiRequest("/account/api-keys", {
        token,
        method: "POST",
        body: { name: options.name, ...(channels.length > 0 ? { channels } : {}) },
      });
      const key = result.api_key?.key;
      if (!key) {
        throw new Error("The API did not return a key. Run the command again.");
      }

      if (options.raw) {
        process.stdout.write(`${key}\n`);
        console.error(`Created API key "${result.api_key.name}". Store it as a secret and never commit it.`);
        return;
      }
      outputResult(result, globalOptions, [
        `Created API key "${result.api_key.name}".`,
        `Key: ${key}`,
        "This is the only time the key is shown. Store it as a secret named ACTIVITYSMITH_API_KEY and never commit it.",
      ]);
    } catch (error) {
      await handleError(error, globalOptions);
    }
  });

// Approvals. Agents ask the user for approval before an action the user wants to approve, such as
// sending an email or deploying, and go ahead only when this exits 0.
const APPROVAL_SCOPE_TYPES = ["working_directory", "repository", "project", "environment", "customer", "account", "resource"];
const APPROVAL_COLORS = ["lime", "green", "cyan", "blue", "purple", "magenta", "red", "orange", "yellow", "gray"];
// Each request waits at most this long on the server, then the CLI asks again.
const APPROVAL_POLL_SECONDS = 45;
const APPROVAL_EXIT = { approved: 0, not_approved: 1, error: 2, pending: 3 };

const parseApprovalScope = (value) => {
  const separator = value.indexOf(":");
  const type = separator > 0 ? value.slice(0, separator).trim() : "";
  const scopeValue = separator > 0 ? value.slice(separator + 1).trim() : "";
  if (!APPROVAL_SCOPE_TYPES.includes(type) || !scopeValue) {
    throw new InvalidArgumentError(
      `scope must be <type>:<value>, where type is one of ${APPROVAL_SCOPE_TYPES.join(", ")}`
    );
  }
  return { type, value: scopeValue };
};

const parseApprovalColor = (value) => {
  if (!APPROVAL_COLORS.includes(value)) {
    throw new InvalidArgumentError(`color must be one of ${APPROVAL_COLORS.join(", ")}`);
  }
  return value;
};

const parsePositiveSeconds = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("timeout must be a whole number of seconds, 1 or more");
  }
  return parsed;
};

const APPROVAL_RESULT_LINES = {
  approved: "Approved.",
  rejected: "Rejected. Do not continue with the action.",
  timed_out: "Timed out. No decision within 30 minutes. Do not continue with the action.",
  cancelled: "Cancelled. Do not continue with the action.",
};

// Waits until the approval is decided, or until `timeoutSeconds` pass, then prints the result and exits.
const waitForApproval = async (approvalId, token, timeoutSeconds, globalOptions) => {
  const deadline = timeoutSeconds ? Date.now() + timeoutSeconds * 1000 : Number.POSITIVE_INFINITY;
  let result;
  while (true) {
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    const wait = Math.max(1, Math.min(APPROVAL_POLL_SECONDS, remaining));
    const startedAt = Date.now();
    result = await apiRequest(`/approvals/${encodeURIComponent(approvalId)}?wait=${wait}`, { token });
    if (result.approval?.status !== "pending" || Date.now() >= deadline) break;
    // The server normally holds the request until it decides or the wait ends; never ask again in a tight loop.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1000 - (Date.now() - startedAt))));
  }

  const status = result.approval?.status;
  if (status === "pending") {
    outputResult(result, globalOptions, [
      `Still pending. Approval ID: ${approvalId}`,
      `Run activitysmith approval wait ${approvalId} to keep waiting.`,
    ]);
    process.exit(APPROVAL_EXIT.pending);
  }
  outputResult(result, globalOptions, [APPROVAL_RESULT_LINES[status] ?? `Status: ${status}`]);
  process.exit(status === "approved" ? APPROVAL_EXIT.approved : APPROVAL_EXIT.not_approved);
};

const approvalCommand = program
  .command("approval")
  .description("Let your agents ask for your approval on your iPhone before they act")
  .addHelpText(
    "after",
    `
Exit codes for request and wait:
  0  Approved. Continue with the action.
  1  Rejected, timed out, or cancelled. Do not continue.
  2  The request failed, for example no paired device.
  3  Still pending after --timeout or with --no-wait. Run approval wait with the approval ID.`
  );

approvalCommand
  .command("request")
  .description("Send an approval request with two buttons to the iPhone and wait for the decision")
  .argument("<question>", 'The decision to make, such as "Send the pricing update email to 214 customers?"')
  .option("--details <text>", "Short context that helps decide")
  .option("--approve-label <label>", "Approve button title, a concrete verb such as Send or Deploy", "Approve")
  .option("--reject-label <label>", "Reject button title, such as Cancel or Don't Send", "Reject")
  .option("--command <command>", "The exact command waiting for approval. Do not shorten or rewrite it")
  .option("--tool <name>", "Name of the operation waiting for approval (default: shell with --command)")
  .option(
    "--scope <type:value>",
    `Where the action applies, such as environment:production. Types: ${APPROVAL_SCOPE_TYPES.join(", ")} (default: working_directory:<current directory> with --command)`,
    parseApprovalScope
  )
  .addOption(
    new Option("--delivery <surface>", "Live Activity, Push Notification, or auto: a Live Activity with a Push Notification fallback")
      .choices(["auto", "live_activity", "push_notification"])
      .default("auto")
  )
  .option("--color <color>", "Live Activity color (default: blue)", parseApprovalColor)
  .option("--icon <symbol>", "SF Symbol for the Live Activity (default: sparkles)")
  .option("--badge <title>", "Short Live Activity badge such as Email or Deploy (default: Agent)")
  .option("--channels <slugs>", "Comma-separated channel slugs. Omit to ask on every paired device")
  .option("--timeout <seconds>", "Stop waiting after this many seconds and exit 3 if still pending", parsePositiveSeconds)
  .option("--no-wait", "Send the request, print the approval ID, and exit without waiting")
  .action(async (question, options) => {
    const globalOptions = program.opts();

    try {
      const token = await requireApiKey(globalOptions);
      const tool = options.tool ?? (options.command ? "shell" : undefined);
      if (options.command && !tool) throw new Error("Provide --tool with --command.");
      const scope = options.scope ?? (options.command ? { type: "working_directory", value: process.cwd() } : undefined);
      const appearance = {
        ...(options.color ? { color: options.color } : {}),
        ...(options.icon ? { icon: { symbol: options.icon } } : {}),
        ...(options.badge ? { badge: { title: options.badge } } : {}),
      };
      const channels = String(options.channels ?? "")
        .split(",")
        .map((slug) => slug.trim())
        .filter(Boolean);

      const result = await apiRequest("/approvals", {
        token,
        method: "POST",
        body: {
          question,
          ...(options.details ? { details: options.details } : {}),
          ...(tool ? { execution_context: { tool, ...(options.command ? { command: options.command } : {}) } } : {}),
          ...(scope ? { scope } : {}),
          delivery: options.delivery,
          approve_label: options.approveLabel,
          reject_label: options.rejectLabel,
          ...(Object.keys(appearance).length > 0 ? { appearance } : {}),
          ...(channels.length > 0 ? { target_channel_slugs: channels } : {}),
        },
      });
      const approvalId = result.approval?.id;
      if (!approvalId) throw new Error("The API did not return an approval ID. Run the command again.");

      if (options.wait === false) {
        outputResult(result, globalOptions, [
          `Approval requested. Approval ID: ${approvalId}`,
          `Run activitysmith approval wait ${approvalId} to wait for the decision.`,
        ]);
        process.exit(APPROVAL_EXIT.pending);
      }
      if (!globalOptions.json) {
        console.error(`Approval requested. Waiting for the decision on the iPhone. Approval ID: ${approvalId}`);
      }
      await waitForApproval(approvalId, token, options.timeout, globalOptions);
    } catch (error) {
      await handleError(error, globalOptions, APPROVAL_EXIT.error);
    }
  });

approvalCommand
  .command("wait")
  .description("Wait for the decision on an approval request")
  .argument("<approval-id>", "Approval ID from approval request")
  .option("--timeout <seconds>", "Stop waiting after this many seconds and exit 3 if still pending", parsePositiveSeconds)
  .action(async (approvalId, options) => {
    const globalOptions = program.opts();

    try {
      const token = await requireApiKey(globalOptions);
      await waitForApproval(approvalId, token, options.timeout, globalOptions);
    } catch (error) {
      await handleError(error, globalOptions, APPROVAL_EXIT.error);
    }
  });

approvalCommand
  .command("get")
  .description("Show the current state of an approval request without waiting")
  .argument("<approval-id>", "Approval ID from approval request")
  .action(async (approvalId) => {
    const globalOptions = program.opts();

    try {
      const token = await requireApiKey(globalOptions);
      const result = await apiRequest(`/approvals/${encodeURIComponent(approvalId)}`, { token });
      const status = result.approval?.status;
      outputResult(result, globalOptions, [
        status === "pending" ? "Pending." : (APPROVAL_RESULT_LINES[status] ?? `Status: ${status}`),
        `Approval ID: ${approvalId}`,
        result.approval?.question ? `Question: ${result.approval.question}` : null,
      ]);
    } catch (error) {
      await handleError(error, globalOptions, APPROVAL_EXIT.error);
    }
  });

approvalCommand
  .command("cancel")
  .description("Withdraw a pending approval request that is no longer needed")
  .argument("<approval-id>", "Approval ID from approval request")
  .action(async (approvalId) => {
    const globalOptions = program.opts();

    try {
      const token = await requireApiKey(globalOptions);
      const result = await apiRequest(`/approvals/${encodeURIComponent(approvalId)}/cancel`, { token, method: "POST" });
      const status = result.approval?.status;
      outputResult(result, globalOptions, [
        status === "cancelled"
          ? "Approval request cancelled. It can no longer be approved."
          : `Not cancelled: the request is already ${String(status).replace("_", " ")}.`,
        `Approval ID: ${approvalId}`,
      ]);
    } catch (error) {
      await handleError(error, globalOptions, APPROVAL_EXIT.error);
    }
  });

const authCommand = program
  .command("auth")
  .description("Sign in through the browser and manage the saved sign-in");

authCommand
  .command("login")
  .description("Sign in through the browser so commands work without an API key")
  .option("--no-browser", "Print the sign-in URL instead of opening a browser")
  .action(async (options) => {
    const globalOptions = program.opts();

    try {
      await login({ noBrowser: options.browser === false });
      outputResult(
        { signed_in: true, credentials_path: credentialsPath() },
        globalOptions,
        [
          "Signed in to ActivitySmith.",
          `Saved to: ${credentialsPath()}`,
          process.env.ACTIVITYSMITH_API_KEY
            ? "Note: ACTIVITYSMITH_API_KEY is set and takes precedence over the sign-in."
            : null,
        ]
      );
    } catch (error) {
      await handleError(error, globalOptions);
    }
  });

authCommand
  .command("logout")
  .description("Sign out and disconnect the CLI from your account")
  .action(async () => {
    const globalOptions = program.opts();

    try {
      const result = await logout();
      const lines = !result.signedIn
        ? ["Not signed in."]
        : result.revoked
          ? ["Signed out. The CLI is disconnected from your ActivitySmith account."]
          : [
              "Signed out on this machine.",
              'If "ActivitySmith CLI" is still listed under AI Agents at https://activitysmith.com/app/ai-agents, select Disconnect there.',
            ];
      outputResult({ signed_out: result.signedIn, disconnected: result.revoked }, globalOptions, lines);
    } catch (error) {
      await handleError(error, globalOptions);
    }
  });

authCommand
  .command("status")
  .description("Show how the CLI authenticates, without printing secrets")
  .action(async () => {
    const globalOptions = program.opts();

    try {
      const source = credentialSource(globalOptions);
      const stored = readCredentials();
      const payload = {
        signed_in: Boolean(stored),
        auth_source: source,
        signed_in_at: stored?.signed_in_at ?? null,
        credentials_path: credentialsPath(),
      };
      const sourceLine =
        source === "auth login"
          ? "Using the browser sign-in from activitysmith auth login."
          : source
            ? `Using the API key from ${source}.`
            : "Not signed in. Run activitysmith auth login.";
      outputResult(payload, globalOptions, [
        sourceLine,
        stored && source !== "auth login" ? "A browser sign-in is also saved, but the API key takes precedence." : null,
        stored ? `Signed in: ${stored.signed_in_at}` : null,
        stored ? `Saved to: ${credentialsPath()}` : null,
      ]);
    } catch (error) {
      await handleError(error, globalOptions);
    }
  });

program.showHelpAfterError(true);
program.parseAsync(process.argv);
