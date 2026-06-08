#!/usr/bin/env node

import { Command, InvalidArgumentError } from "commander";
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
    "ActivitySmith API key (defaults to ACTIVITYSMITH_API_KEY)"
  )
  .option("--json", "Output JSON");

const parseIntegerOption = (label) => (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError(`${label} must be an integer`);
  }
  return parsed;
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

const normalizeActionUrl = (value, label, type) => {
  if (type === "open_url") {
    return normalizeUrlWithSchemes(value, label, ["https", "shortcuts"]);
  }

  return normalizeHttpsUrl(value, label);
};

const normalizeOpenUrl = (value, label) =>
  normalizeUrlWithSchemes(value, label, ["https", "shortcuts"]);

const addContentStateOptions = (command, { includeAutoDismiss } = {}) => {
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
      "--value <number>",
      "Content state value",
      parseNumberOption("value")
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

  return command;
};

const addLiveActivityActionOptions = (command) =>
  command
    .option("--action <json>", "Live Activity action as JSON object")
    .option("--action-file <path>", "Live Activity action JSON file path");

const getApiKey = (options) =>
  options.apiKey || process.env.ACTIVITYSMITH_API_KEY;

const createClient = (apiKey) => new ActivitySmith({ apiKey });

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
    normalizedType !== "timer"
  ) {
    throw new Error(
      "contentState.type must be one of: segmented_progress, progress, metrics, stats, alert, timer"
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

  if (hasValue !== hasUpperLimit) {
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
  const hasProgressFields = hasPercentage || hasValue || hasUpperLimit;
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
    hasAlertFields &&
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
      if (!hasDurationSeconds && contentState.countsDown !== false) {
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

const parseAction = (value, label) => {
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
    url: normalizeActionUrl(value.url, `${label}.url`, normalizedType),
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

const parsePushAction = (value, index) => parseAction(value, `actions[${index}]`);

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
    contentState.value = options.value;
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

const toApiLiveActivityStartRequest = (contentState, action) => {
  const request = {
    content_state: toApiContentState(contentState),
  };

  if (action !== undefined) {
    request.action = action;
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

const toApiLiveActivityUpdateRequest = (activityId, contentState, action) => {
  const request = {
    activity_id: activityId,
    content_state: toApiContentState(contentState),
  };

  if (action !== undefined) {
    request.action = action;
  }

  return request;
};

const toApiLiveActivityEndRequest = (activityId, contentState, action) => {
  const request = {
    activity_id: activityId,
    content_state: toApiContentState(contentState),
  };

  if (action !== undefined) {
    request.action = action;
  }

  return request;
};

const toApiLiveActivityStreamRequest = (contentState, action) => {
  const request = {
    content_state: toApiContentState(contentState),
  };

  if (action !== undefined) {
    request.action = action;
  }

  return request;
};

const toApiLiveActivityStreamDeleteRequest = (contentState, action) => {
  const request = {};

  if (contentState !== undefined) {
    request.content_state = toApiContentState(contentState);
  }

  if (action !== undefined) {
    request.action = action;
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

const handleError = async (error, options) => {
  const details = await buildErrorDetails(error);

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

  process.exit(1);
};

const requireApiKey = (options) => {
  const apiKey = getApiKey(options);
  if (!apiKey) {
    throw new Error(
      "Missing API key. Provide --api-key or set ACTIVITYSMITH_API_KEY."
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
  .description("Send a push notification")
  .requiredOption("--title <title>", "Push title")
  .option("--message <message>", "Push message")
  .option("--subtitle <subtitle>", "Push subtitle")
  .option(
    "--media <url>",
    "HTTPS URL for image, audio, or video shown when the notification is expanded"
  )
  .option("--redirection <url>", "HTTPS or shortcuts:// URL opened when notification is tapped")
  .option("--actions <json>", "Actions JSON array (max 4)")
  .option("--actions-file <path>", "Path to actions JSON array file")
  .option(
    "--channels <channels>",
    "Comma-separated channel slugs (optional)",
    parseChannelsOption
  )
  .action(async (options) => {
    const globalOptions = program.opts();

    try {
      const apiKey = requireApiKey(globalOptions);
      const client = createClient(apiKey);
      const actions = await loadPushActions(options);
      validatePushMediaOptions({
        media: options.media,
        actions,
      });

      const pushNotificationRequest = withTargetChannels(
        {
          title: options.title,
          message: options.message,
          subtitle: options.subtitle,
          media:
            options.media !== undefined
              ? normalizeHttpsUrl(options.media, "media")
              : undefined,
          redirection:
            options.redirection !== undefined
              ? normalizeOpenUrl(options.redirection, "redirection")
              : undefined,
          actions,
        },
        options.channels
      );

      const response = await client.notifications.sendPushNotification({
        pushNotificationRequest,
      });

      outputResult(response, globalOptions, [
        "Push sent.",
        response?.success !== undefined
          ? `Success: ${response.success}`
          : null,
        response?.devicesNotified !== undefined
          ? `Devices notified: ${response.devicesNotified}`
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
      const apiKey = requireApiKey(globalOptions);
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
  .description("Manage Live Activities");

addLiveActivityActionOptions(addContentStateOptions(
  activityCommand
    .command("stream")
    .description("Send a stateless Live Activity stream update")
    .argument("<stream-key>", "Stable stream key")
    .option(
      "--channels <channels>",
      "Comma-separated channel slugs (optional)",
      parseChannelsOption
    )
    .action(async (streamKey, options) => {
      const globalOptions = program.opts();

      try {
        const apiKey = requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadContentState(options, "stream");
        const action = await loadLiveActivityAction(options);

        const response = await client.liveActivities.stream(
          streamKey,
          withTargetChannels(
            toApiLiveActivityStreamRequest(contentState, action),
            options.channels
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
    .action(async (options) => {
      const globalOptions = program.opts();

      try {
        const apiKey = requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadContentState(options, "start");
        const action = await loadLiveActivityAction(options);

        const response = await client.liveActivities.startLiveActivity({
          liveActivityStartRequest: withTargetChannels(
            toApiLiveActivityStartRequest(contentState, action),
            options.channels
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
    .action(async (options) => {
      const globalOptions = program.opts();

      try {
        const apiKey = requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadContentState(options, "update");
        const action = await loadLiveActivityAction(options);

        const response = await client.liveActivities.updateLiveActivity({
          liveActivityUpdateRequest: toApiLiveActivityUpdateRequest(
            options.activityId,
            contentState,
            action
          ),
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
    .action(async (options) => {
      const globalOptions = program.opts();

      try {
        const apiKey = requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadContentState(options, "end");
        const action = await loadLiveActivityAction(options);

        const response = await client.liveActivities.endLiveActivity({
          liveActivityEndRequest: toApiLiveActivityEndRequest(
            options.activityId,
            contentState,
            action
          ),
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
    .action(async (streamKey, options) => {
      const globalOptions = program.opts();

      try {
        const apiKey = requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadOptionalContentState(options, "end");
        const action = await loadLiveActivityAction(options);

        const request =
          contentState !== undefined || action !== undefined
            ? toApiLiveActivityStreamDeleteRequest(contentState, action)
            : undefined;

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
  { includeAutoDismiss: true }
));

program.showHelpAfterError(true);
program.parseAsync(process.argv);
