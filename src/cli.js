#!/usr/bin/env node

import { Command, InvalidArgumentError } from "commander";
import ActivitySmith from "activitysmith";
import { readFile } from "fs/promises";
import { resolve } from "path";

const program = new Command();

program
  .name("activitysmith-cli")
  .description("CLI for ActivitySmith API")
  .version("0.1.0")
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
  .action(async (options) => {
    const globalOptions = program.opts();

    try {
      const apiKey = requireApiKey(globalOptions);
      const client = createClient(apiKey);

      const response = await client.notifications.sendPushNotification({
        pushNotificationRequest: {
          title: options.title,
          message: options.message,
          subtitle: options.subtitle,
        },
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
    .action(async (options) => {
      const globalOptions = program.opts();

      try {
        const apiKey = requireApiKey(globalOptions);
        const client = createClient(apiKey);
        const contentState = await loadContentState(options);

        const response = await client.liveActivities.startLiveActivity({
          liveActivityStartRequest: toApiLiveActivityStartRequest(contentState),
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
