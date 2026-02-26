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

const addContentStateOptions = (command, { includeAutoDismiss } = {}) => {
  command
    .option("--content-state <json>", "Content state as JSON string")
    .option("--content-state-file <path>", "Content state JSON file path")
    .option("--title <title>", "Content state title")
    .option("--subtitle <subtitle>", "Content state subtitle")
    .option("--type <type>", "Content state type")
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

const parsePushAction = (value, index) => {
  const label = `actions[${index}]`;
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
    url: normalizeHttpsUrl(value.url, `${label}.url`),
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

  if (options.numberOfSteps !== undefined) {
    contentState.numberOfSteps = options.numberOfSteps;
  }

  if (options.currentStep !== undefined) {
    contentState.currentStep = options.currentStep;
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

const toApiContentState = (contentState) => {
  const keyMap = {
    numberOfSteps: "number_of_steps",
    currentStep: "current_step",
    stepColor: "step_color",
    autoDismissMinutes: "auto_dismiss_minutes",
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

const toApiLiveActivityStartRequest = (contentState) => ({
  content_state: toApiContentState(contentState),
});

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

const toApiLiveActivityUpdateRequest = (activityId, contentState) => ({
  activity_id: activityId,
  content_state: toApiContentState(contentState),
});

const toApiLiveActivityEndRequest = (activityId, contentState) => ({
  activity_id: activityId,
  content_state: toApiContentState(contentState),
});

const loadContentState = async (options) => {
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

  if (Object.keys(contentState).length === 0) {
    throw new Error(
      "contentState is required. Provide --content-state, --content-state-file, or field flags."
    );
  }

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
  .option("--redirection <url>", "HTTPS URL opened when notification is tapped")
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

      const pushNotificationRequest = withTargetChannels(
        {
          title: options.title,
          message: options.message,
          subtitle: options.subtitle,
          redirection:
            options.redirection !== undefined
              ? normalizeHttpsUrl(options.redirection, "redirection")
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
        response?.timestamp ? `Timestamp: ${response.timestamp}` : null,
      ]);
    } catch (error) {
      await handleError(error, globalOptions);
    }
  });

const activityCommand = program
  .command("activity")
  .description("Manage Live Activities");

addContentStateOptions(
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
        const contentState = await loadContentState(options);

        const response = await client.liveActivities.startLiveActivity({
          liveActivityStartRequest: withTargetChannels(
            toApiLiveActivityStartRequest(contentState),
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
);

addContentStateOptions(
  activityCommand
    .command("update")
    .description("Update a Live Activity")
    .requiredOption("--activity-id <id>", "Live Activity ID")
    .action(async (options) => {
      const globalOptions = program.opts();

      try {
        const apiKey = requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadContentState(options);

        const response = await client.liveActivities.updateLiveActivity({
          liveActivityUpdateRequest: toApiLiveActivityUpdateRequest(
            options.activityId,
            contentState
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
);

addContentStateOptions(
  activityCommand
    .command("end")
    .description("End a Live Activity")
    .requiredOption("--activity-id <id>", "Live Activity ID")
    .action(async (options) => {
      const globalOptions = program.opts();

      try {
        const apiKey = requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadContentState(options);

        const response = await client.liveActivities.endLiveActivity({
          liveActivityEndRequest: toApiLiveActivityEndRequest(
            options.activityId,
            contentState
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
);

program.showHelpAfterError(true);
program.parseAsync(process.argv);
