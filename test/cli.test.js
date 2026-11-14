import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { AGENT_ENV_VARS, detectAgent } from "../src/agent.js";

const runCli = (args) =>
  new Promise((resolve, reject) => {
    const runner = `
      globalThis.fetch = async (url, init) => {
        process.stdout.write("CAPTURE:" + JSON.stringify({
          url,
          method: init.method,
          body: init.body ? JSON.parse(init.body) : null
        }) + "\\n");
        return new Response(JSON.stringify({
          success: true,
          activity_id: "activity-1",
          notification_id: "pn-1",
          devices_notified: 1,
          operation: "started"
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      };
      process.argv = ["node", "activitysmith", ...JSON.parse(process.env.CLI_TEST_ARGS)];
      await import("./src/cli.js");
    `;

    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", runner],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CLI_TEST_ARGS: JSON.stringify([
            "--api-key",
            "test",
            "--json",
            ...args,
          ]),
        },
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const capture = stdout
        .split("\n")
        .find((line) => line.startsWith("CAPTURE:"));

      resolve({
        code,
        stdout,
        stderr,
        request: capture ? JSON.parse(capture.slice("CAPTURE:".length)) : null,
      });
    });
  });

test("push accepts comma-separated and repeated tags", async () => {
  const result = await runCli([
    "push",
    "--title",
    "Import complete",
    "--tags",
    "user:382,billing",
    "--tags",
    "customer-import",
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.request.body.tags, [
    "user:382",
    "billing",
    "customer-import",
  ]);
});

test("Live Activity start includes tags", async () => {
  const result = await runCli([
    "activity",
    "start",
    "--title",
    "Customer import",
    "--type",
    "progress",
    "--percentage",
    "20",
    "--tags",
    "user:382,customer-import",
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.request.body.tags, ["user:382", "customer-import"]);
});

test("Live Activity start sends an empty title but requires the field", async () => {
  const flags = await runCli(["activity", "start", "--title", "", "--type", "value", "--value", "1"]);
  assert.equal(flags.code, 0, flags.stderr);
  assert.equal(flags.request.body.content_state.title, "");

  const json = await runCli(["activity", "start", "--content-state", '{"type":"value","title":"","value":"1"}']);
  assert.equal(json.code, 0, json.stderr);
  assert.equal(json.request.body.content_state.title, "");

  const missing = await runCli(["activity", "start", "--content-state", '{"type":"value","value":"1"}']);
  assert.notEqual(missing.code, 0);
  assert.match(missing.stdout, /contentState.title is required/);
  assert.equal(missing.request, null);
});

test("Live Activity stream includes tags", async () => {
  const result = await runCli([
    "activity",
    "stream",
    "customer-import",
    "--title",
    "Customer import",
    "--type",
    "progress",
    "--percentage",
    "60",
    "--tags",
    "user:382,customer-import",
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.request.body.tags, ["user:382", "customer-import"]);
});

test("tags rejects an empty list", async () => {
  const result = await runCli([
    "push",
    "--title",
    "Import complete",
    "--tags",
    ",,",
  ]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /tags must contain at least one tag/);
  assert.equal(result.request, null);
});

for (const [type, fields] of Object.entries({
  metrics: { metrics: [{ label: "CPU", value: 20 }] },
  stats: { metrics: [{ label: "Status", value: "Healthy" }] },
  progress: { percentage: 20 },
  segmented_progress: { numberOfSteps: 3, currentStep: 1 },
  timer: { durationSeconds: 60 },
  alert: { message: "Recovered" },
})) {
  test(`${type} accepts icons and badges`, async () => {
    const state = { title: "Status", type, ...fields,
      icon: { symbol: "server.rack", color: "blue" },
      badge: { title: "Production", color: "green" } };
    const result = await runCli(["activity", "stream", "status", "--content-state", JSON.stringify(state)]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.request.body.content_state.icon, state.icon);
    assert.deepEqual(result.request.body.content_state.badge, state.badge);
  });
}

for (const seconds of [0, 30]) {
  for (const form of ["flag", "camel", "snake"]) {
    test(`stream dismissal seconds ${seconds} via ${form}`, async () => {
      const state = { title: "Finished", type: "timer" };
      const args = ["activity", "end-stream", "job"];
      if (form === "flag") args.push("--auto-dismiss-seconds", String(seconds));
      else state[form === "camel" ? "autoDismissSeconds" : "auto_dismiss_seconds"] = seconds;
      state.autoDismissMinutes = 5;
      args.push("--content-state", JSON.stringify(state));
      const result = await runCli(args);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.request.body.content_state.auto_dismiss_seconds, seconds);
      assert.equal(result.request.body.content_state.auto_dismiss_minutes, 5);
      assert.equal(result.request.body.content_state.autoDismissSeconds, undefined);
    });
  }
}

for (const mode of ["stream", "update"]) {
  test(`timer ${mode} preserves duration when omitted`, async () => {
    const args = ["activity", mode];
    if (mode === "stream") args.push("job");
    else args.push("--activity-id", "activity-1");
    args.push("--title", "Still working", "--type", "timer");
    const result = await runCli(args);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.request.body.content_state.duration_seconds, undefined);
    assert.equal(result.request.body.content_state.counts_down, undefined);
  });
}

test("new countdown still requires a duration", async () => {
  const result = await runCli(["activity", "start", "--title", "Job", "--type", "timer"]);
  assert.notEqual(result.code, 0);
  assert.equal(result.request, null);
});

test("rejects negative dismissal seconds before sending", async () => {
  const result = await runCli(["activity", "end-stream", "job", "--title", "Done",
    "--type", "timer", "--auto-dismiss-seconds", "-1"]);
  assert.notEqual(result.code, 0);
  assert.equal(result.request, null);
});

test("icons still validate their symbol", async () => {
  const result = await runCli(["activity", "stream", "job", "--content-state",
    JSON.stringify({title: "Job", type: "progress", percentage: 20, icon: {color: "blue"}})]);
  assert.notEqual(result.code, 0);
  assert.equal(result.request, null);
});

const streamTagArgs = ["activity", "stream", "job", "--title", "Job", "--type", "progress", "--percentage", "50"];

test("clear-tags sends an explicit empty array", async () => {
  const result = await runCli([...streamTagArgs, "--clear-tags"]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.request.body.tags, []);
});

test("omitting tag options preserves existing stream tags", async () => {
  const result = await runCli(streamTagArgs);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(Object.hasOwn(result.request.body, "tags"), false);
});

for (const options of [["--tags", "billing", "--clear-tags"], ["--clear-tags", "--tags", "billing"]]) {
  test(`conflicting tag options fail before sending: ${options.join(" ")}`, async () => {
    const result = await runCli([...streamTagArgs, ...options]);
    assert.notEqual(result.code, 0);
    assert.equal(result.request, null);
    assert.match(result.stdout + result.stderr, /Use either --tags or --clear-tags/);
  });
}

test("clear-tags is unavailable for new Push Notifications", async () => {
  const result = await runCli(["push", "--title", "Done", "--clear-tags"]);
  assert.notEqual(result.code, 0);
  assert.equal(result.request, null);
});

for (const operation of ["update", "end"]) {
  const args = ["activity", operation, "--activity-id", "test-id", "--title", "Job", "--type", "progress", "--percentage", "50"];
  for (const [flags, tags] of [[[], undefined], [["--tags", "billing,production"], ["billing", "production"]], [["--clear-tags"], []]]) {
    test(`${operation} preserves, replaces or clears Tags: ${flags.join(" ")}`, async () => {
      const result = await runCli([...args, ...flags]);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.deepEqual(result.request.body.tags, tags);
      assert.equal(Object.hasOwn(result.request.body, "tags"), tags !== undefined);
    });
  }
  test(`${operation} rejects conflicting Tags flags before sending`, async () => {
    const result = await runCli([...args, "--tags", "billing", "--clear-tags"]);
    assert.notEqual(result.code, 0);
    assert.equal(result.request, null);
  });
}


for (const args of [
  ["push", "--title", "Job"],
  ["activity", "start", "--title", "Job", "--type", "progress", "--percentage", "50"],
  ["activity", "stream", "job", "--title", "Job", "--type", "progress", "--percentage", "50"],
  ...["update", "end"].map(op => ["activity", op, "--activity-id", "a", "--title", "Job", "--percentage", "50"]),
]) {
  for (const metadata of [{}, {order: "382", ready: false, count: 0, empty: "", ratio: 1.25}]) {
    test(`${args.slice(0, 2).join(" ")} serializes Metadata ${JSON.stringify(metadata)}`, async () => {
      const result = await runCli([...args, "--metadata", JSON.stringify(metadata)]);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.deepEqual(result.request.body.metadata, metadata);
      assert.equal(result.request.body.content_state?.metadata, undefined);
    });
  }
}
for (const metadata of ["null", "[]", '{"nested":{}}', '{"value":null}', '{"__proto__":"bad"}']) {
  test(`invalid Metadata rejected before sending: ${metadata}`, async () => {
    const result = await runCli(["push", "--title", "Job", "--metadata", metadata]);
    assert.notEqual(result.code, 0);
    assert.equal(result.request, null);
  });
}


for (const url of ["http://example.com", "https://example.com", "shortcuts://run-shortcut?name=Test", "spotify://", "spotify:track:123", "custom-app://item/42?q=a%20b", "x-safari-https://example.com"]) {
  test(`Push Notification accepts external destination ${url}`, async () => {
    const action = {title:"Open", type:"open_url", url};
    const result = await runCli(["push", "--title", "Job", "--redirection", url, "--actions", JSON.stringify([action])]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const expected = /^https?:/.test(url) ? new URL(url).toString() : url;
    assert.equal(result.request.body.redirection, expected);
    assert.equal(result.request.body.actions[0].url, expected);
  });
}
for (const url of ["javascript:alert(1)", "file:///tmp/file", "activitysmith://internal", "data:text/plain,test", "spotify://a\nb"]) {
  test(`Push Notification rejects blocked destination ${url}`, async () => {
    const result = await runCli(["push", "--title", "Job", "--redirection", url]);
    assert.notEqual(result.code, 0); assert.equal(result.request, null);
  });
}
for (const [type,url,valid] of [["open_url","http://example.com",true], ["open_url","x-safari-https://example.com",true], ["open_url","spotify://",false], ["webhook","http://example.com",false], ["webhook","spotify://",false]]) {
  test(`Live Activity ${type} URL policy ${url}`, async () => {
    const result = await runCli([...streamTagArgs, "--action", JSON.stringify({title:"Open",type,url})]);
    assert.equal(result.code === 0, valid, result.stdout + result.stderr);
  });
}
for (const flags of [[], ["--tags","finished", "--metadata",'{"ready":false,"count":0}'], ["--clear-tags","--metadata","{}"]]) {
  test(`end-stream history fields ${flags.join(" ")}`, async () => {
    const result = await runCli(["activity","end-stream","job",...flags]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    if (flags[0] === "--clear-tags") { assert.deepEqual(result.request.body.tags, []); assert.deepEqual(result.request.body.metadata, {}); }
    if (flags[0] === "--tags") { assert.deepEqual(result.request.body.tags, ["finished"]); assert.deepEqual(result.request.body.metadata, {ready:false,count:0}); }
  });
}
test("end-stream rejects conflicting Tags flags", async () => {
  const result = await runCli(["activity","end-stream","job","--tags","finished","--clear-tags"]);
  assert.notEqual(result.code,0); assert.equal(result.request,null);
});

for (const value of ['$1,240', '0007', '', 0, -12.75]) {
  test(`Value preserves ${JSON.stringify(value)} through JSON`, async () => {
    const result = await runCli(['activity', 'stream', 'revenue', '--content-state', JSON.stringify({title:'Revenue', type:'value', value})]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.request.body.content_state.value, value);
  });
}
for (const value of ['$1,240', '0007', '0']) {
  test(`Value flag preserves ${value}`, async () => {
    const result = await runCli(['activity', 'stream', 'revenue', '--title', 'Revenue', '--type', 'value', '--value', value]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.request.body.content_state.value, value);
  });
}
for (const value of [undefined, null, true, {}, []]) {
  test(`Value rejects ${JSON.stringify(value)}`, async () => {
    const result = await runCli(['activity', 'stream', 'revenue', '--content-state', JSON.stringify({title:'Revenue', type:'value', value})]);
    assert.notEqual(result.code, 0);
    assert.equal(result.request, null);
  });
}

for (const level of ['passive', 'active', 'time-sensitive']) {
  test(`push serializes icon and ${level} interruption level`, async () => {
    const result = await runCli(['push', '--title', 'GitHub', '--subtitle', 'Build status', '--icon', 'https://example.com/github.png', '--interruption-level', level, '--channels', 'ops']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.request.body.icon, 'https://example.com/github.png');
    assert.equal(result.request.body.interruption_level, level);
    assert.equal(result.request.body.subtitle, 'Build status');
    assert.deepEqual(result.request.body.target, {channels: ['ops']});
  });
}

test('push omits icon and interruption level by default', async () => {
  const result = await runCli(['push', '--title', 'Test']);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!Object.hasOwn(result.request.body, 'icon'));
  assert.ok(!Object.hasOwn(result.request.body, 'interruption_level'));
});

test('push rejects invalid interruption levels and non-HTTPS icons before transport', async () => {
  for (const args of [['--interruption-level', 'critical'], ['--interruption-level', 'timeSensitive'], ['--interruption-level', 'default'], ['--icon', 'http://example.com/icon.png']]) {
    const result = await runCli(['push', '--title', 'Test', ...args]);
    assert.notEqual(result.code, 0);
    assert.equal(result.request, null);
  }
});

test("push --replace silently replaces a sent push notification", async () => {
  const result = await runCli([
    "push",
    "--replace",
    "pn-1",
    "--title",
    "Answered from desk",
    "--message",
    "No input needed",
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.request.method, "PUT");
  assert.match(result.request.url, /\/push-notification\/pn-1$/);
  assert.deepEqual(result.request.body, {
    title: "Answered from desk",
    message: "No input needed",
  });
});

test("push --replace rejects options that only apply to new sends", async () => {
  for (const extra of [["--channels", "ops"], ["--interruption-level", "passive"]]) {
    const result = await runCli(["push", "--replace", "pn-1", "--title", "Done", ...extra]);

    assert.notEqual(result.code, 0);
    assert.match(result.stdout + result.stderr, /cannot be combined with --replace/);
    assert.equal(result.request, null);
  }
});

test("push dismiss clears a sent push notification", async () => {
  const result = await runCli(["push", "dismiss", "pn-1"]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.request.method, "POST");
  assert.match(result.request.url, /\/push-notification\/pn-1\/dismiss$/);
});

test("push dismiss needs a notification ID and no title", async () => {
  const missing = await runCli(["push", "dismiss"]);
  assert.notEqual(missing.code, 0);
  assert.equal(missing.request, null);
});

test("push still requires a title when sending", async () => {
  const result = await runCli(["push", "--message", "No title"]);
  assert.notEqual(result.code, 0);
  assert.match(result.stdout + result.stderr, /--title/);
  assert.equal(result.request, null);
});

// Runs the CLI with a fake API that answers every request with `response` and records the requests.
// Tests run inside coding agents too; clear their markers so requests stay predictable.
const cliUrl = new URL("../src/cli.js", import.meta.url).href;
const withoutAgentEnv = (env) => Object.fromEntries(Object.entries(env).filter(([key]) => !AGENT_ENV_VARS.includes(key)));

// `routes` maps a URL path suffix to its response; other requests get `response`.
const runCliWithApi = (args, { response, routes = {}, env = {}, cwd = process.cwd() }) =>
  new Promise((resolve, reject) => {
    const runner = `
      const routes = JSON.parse(process.env.CLI_TEST_ROUTES);
      globalThis.fetch = async (url, init) => {
        const raw = init.body && typeof init.body !== "string";
        process.stdout.write("CAPTURE:" + JSON.stringify({
          url,
          method: init.method,
          headers: init.headers,
          body: raw ? { bytes: init.body.length } : init.body ? JSON.parse(init.body) : null
        }) + "\\n");
        const route = Object.keys(routes).find((suffix) => new URL(url).pathname.endsWith(suffix));
        const body = route ? JSON.stringify(routes[route]) : process.env.CLI_TEST_RESPONSE;
        return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
      };
      process.argv = ["node", "activitysmith", ...JSON.parse(process.env.CLI_TEST_ARGS)];
      await import(${JSON.stringify(cliUrl)});
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", runner], {
      cwd,
      env: {
        ...withoutAgentEnv(process.env),
        ...env,
        CLI_TEST_ARGS: JSON.stringify(args),
        CLI_TEST_RESPONSE: JSON.stringify(response),
        CLI_TEST_ROUTES: JSON.stringify(routes),
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const lines = stdout.split("\n");
      const requests = lines.filter((line) => line.startsWith("CAPTURE:")).map((line) => JSON.parse(line.slice("CAPTURE:".length)));
      const output = lines.filter((line) => line && !line.startsWith("CAPTURE:")).join("\n");
      resolve({ code, stdout: output, stderr, requests });
    });
  });

const signedInConfigDir = async (scope) => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "activitysmith-cli-test-"));
  await writeFile(join(dir, "credentials.json"), JSON.stringify({
    client_id: "https://activitysmith.com/.well-known/oauth-client/activitysmith-cli.json",
    issuer: "https://activitysmith.com",
    resource: "https://activitysmith.com/api",
    token_endpoint: "https://activitysmith.com/oauth/token",
    access_token: "signed-in-token",
    access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    refresh_token: "refresh",
    scope,
    signed_in_at: new Date().toISOString(),
  }));
  return dir;
};

test("devices list reads the paired devices and points to the App Store when there are none", async () => {
  const empty = await runCliWithApi(["--api-key", "test", "devices", "list"], {
    response: { devices: [], meta: { total: 0, limit: 100, offset: 0, has_more: false, next_offset: null, include_inactive: false } },
  });
  assert.equal(empty.code, 0, empty.stderr);
  assert.equal(empty.requests[0].url, "https://activitysmith.com/api/account/devices");
  assert.equal(empty.requests[0].method, "GET");
  assert.equal(empty.requests[0].headers.Authorization, "Bearer test");
  assert.match(empty.requests[0].headers["X-ActivitySmith-SDK"], /^cli-v/);
  assert.match(empty.stdout, /No paired devices/);
  assert.match(empty.stdout, /apps\.apple\.com/);

  const paired = await runCliWithApi(["--api-key", "test", "devices", "--include-inactive"], {
    response: {
      devices: [{ user_email: "you@example.com", device_id: "dev-1", device_type: "ios", is_active: true, device_name: "Adam's iPhone", system_name: "iOS", system_version: "27.0" }],
      meta: { total: 1, limit: 100, offset: 0, has_more: false, next_offset: null, include_inactive: true },
    },
  });
  assert.equal(paired.requests[0].url, "https://activitysmith.com/api/account/devices?include_inactive=true");
  assert.match(paired.stdout, /1 device, 1 active/);
  assert.match(paired.stdout, /Adam's iPhone \(iOS 27\.0, active, you@example\.com\) ID: dev-1/);
});

test("keys create uses the browser sign-in and can print only the key", async () => {
  const dir = await signedInConfigDir("mcp:write api_keys:write");
  const response = { api_key: { public_id: "pub", name: "GitHub Actions", key: "ask_secret", prefix: "ask_secret", scope_mode: "channels", channel_slugs: ["ops"] } };
  const raw = await runCliWithApi(["keys", "create", "--name", "GitHub Actions", "--channels", "ops, alerts", "--raw"], {
    response,
    env: { ACTIVITYSMITH_CONFIG_DIR: dir, ACTIVITYSMITH_API_KEY: "ask_ignored" },
  });
  assert.equal(raw.code, 0, raw.stderr);
  assert.equal(raw.requests[0].url, "https://activitysmith.com/api/account/api-keys");
  assert.equal(raw.requests[0].method, "POST");
  // API keys cannot create keys: the sign-in is used even when ACTIVITYSMITH_API_KEY is set.
  assert.equal(raw.requests[0].headers.Authorization, "Bearer signed-in-token");
  assert.deepEqual(raw.requests[0].body, { name: "GitHub Actions", channels: ["ops", "alerts"] });
  assert.equal(raw.stdout, "ask_secret");
  assert.match(raw.stderr, /Created API key "GitHub Actions"/);

  const shown = await runCliWithApi(["keys", "create", "--name", "GitHub Actions"], { response, env: { ACTIVITYSMITH_CONFIG_DIR: dir } });
  assert.match(shown.stdout, /Key: ask_secret/);
  assert.match(shown.stdout, /only time the key is shown/);
});

const approvalResponse = (status) => ({
  approval: { id: "apr_1", question: "Send the email?", status, expires_at: "2026-10-27T12:30:00.000Z" },
  message: "",
});

test("approval request sends the question and context, then exits 0 when approved", async () => {
  const result = await runCliWithApi(
    [
      "--api-key", "test", "approval", "request", "Send the pricing update email to 214 customers?",
      "--details", "Draft: pricing-update.md", "--approve-label", "Send", "--reject-label", "Don't Send",
      "--command", "node scripts/send-pricing-email.js", "--badge", "Email", "--channels", "ops, founders",
    ],
    { response: approvalResponse("approved") }
  );
  assert.equal(result.code, 0, result.stderr);
  const [create, wait] = result.requests;
  assert.equal(create.url, "https://activitysmith.com/api/approvals");
  assert.equal(create.method, "POST");
  assert.equal(create.headers.Authorization, "Bearer test");
  assert.deepEqual(create.body, {
    question: "Send the pricing update email to 214 customers?",
    details: "Draft: pricing-update.md",
    execution_context: { tool: "shell", command: "node scripts/send-pricing-email.js" },
    scope: { type: "working_directory", value: process.cwd() },
    approve_label: "Send",
    reject_label: "Don't Send",
    target_channel_slugs: ["ops", "founders"],
  });
  assert.match(result.stderr, /Ignoring --badge: approvals are always Push Notifications/);
  assert.equal(wait.url, "https://activitysmith.com/api/approvals/apr_1?wait=45");
  assert.equal(wait.method, "GET");
  assert.match(result.stderr, /Waiting for the decision on the iPhone\. Approval ID: apr_1/);
  assert.equal(result.stdout, "Approved.");
});

test("approval request names the coding agent that runs the CLI", async () => {
  const fromClaudeCode = await runCliWithApi(["--api-key", "test", "approval", "request", "Deploy?"], {
    response: approvalResponse("approved"),
    env: { CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-321_agent" },
  });
  assert.equal(fromClaudeCode.code, 0, fromClaudeCode.stderr);
  assert.equal(fromClaudeCode.requests[0].headers["X-ActivitySmith-Agent"], "claude-code");
  assert.equal("agent" in fromClaudeCode.requests[0].body, false);

  const fromTerminal = await runCliWithApi(["--api-key", "test", "approval", "request", "Deploy?"], {
    response: approvalResponse("approved"),
  });
  assert.equal("X-ActivitySmith-Agent" in fromTerminal.requests[0].headers, false);
});

test("push and push --replace name the coding agent that runs the CLI", async () => {
  const response = { success: true, notification_id: "pn_1", devices_notified: 1 };
  const env = { CODEX_THREAD_ID: "thread-1" };
  for (const extra of [[], ["--replace", "pn_1"]]) {
    const result = await runCliWithApi(["--api-key", "test", "push", "--title", "Done", ...extra], { response, env });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.requests[0].headers["X-ActivitySmith-Agent"], "codex");
    assert.equal(result.requests[0].headers.Authorization, "Bearer test");
    assert.match(result.requests[0].headers["X-ActivitySmith-SDK"], /^cli-v/);
  }

  const fromTerminal = await runCliWithApi(["--api-key", "test", "push", "--title", "Done"], { response });
  assert.equal("X-ActivitySmith-Agent" in fromTerminal.requests[0].headers, false);
});

test("detectAgent reads the markers each agent sets", () => {
  assert.equal(detectAgent({}), null);
  assert.equal(detectAgent({ AI_AGENT: "claude-code_2-1-321_agent" }), "claude-code");
  assert.equal(detectAgent({ CLAUDECODE: "1" }), "claude-code");
  assert.equal(detectAgent({ CLAUDECODE: "1", CLAUDE_CODE_IS_COWORK: "1", AI_AGENT: "claude-code_2_agent" }), "claude-cowork");
  assert.equal(detectAgent({ CODEX_THREAD_ID: "t1" }), "codex");
  assert.equal(detectAgent({ CODEX_SANDBOX: "seatbelt" }), "codex");
  assert.equal(detectAgent({ CURSOR_AGENT: "1" }), "cursor");
  assert.equal(detectAgent({ CURSOR_TRACE_ID: "abc" }), "cursor");
  // An agent running inside Cursor's terminal is still that agent.
  assert.equal(detectAgent({ CURSOR_TRACE_ID: "abc", CLAUDECODE: "1" }), "claude-code");
  assert.equal(detectAgent({ CURSOR_TRACE_ID: "abc", CODEX_THREAD_ID: "t1" }), "codex");
  assert.equal(detectAgent({ AI_AGENT: "something-new" }), null);
});

test("approval request exits 1 when the request is rejected, timed out, or cancelled", async () => {
  for (const [status, line] of [["rejected", /^Rejected\./], ["timed_out", /^Timed out\./], ["cancelled", /^Cancelled\./]]) {
    const result = await runCliWithApi(["--api-key", "test", "approval", "request", "Deploy?"], { response: approvalResponse(status) });
    assert.equal(result.code, 1, status);
    assert.match(result.stdout, line);
    assert.deepEqual(result.requests[0].body, { question: "Deploy?", approve_label: "Approve", reject_label: "Reject" });
  }
});

test("approval request exits 3 while still pending after --timeout or with --no-wait", async () => {
  const timedOut = await runCliWithApi(["--api-key", "test", "approval", "request", "Deploy?", "--timeout", "1"], { response: approvalResponse("pending") });
  assert.equal(timedOut.code, 3, timedOut.stderr);
  assert.equal(timedOut.requests[1].url, "https://activitysmith.com/api/approvals/apr_1?wait=1");
  assert.match(timedOut.stdout, /Still pending\. Approval ID: apr_1/);
  assert.match(timedOut.stdout, /activitysmith approval wait apr_1/);

  const noWait = await runCliWithApi(["--api-key", "test", "approval", "request", "Deploy?", "--no-wait"], { response: approvalResponse("pending") });
  assert.equal(noWait.code, 3);
  assert.equal(noWait.requests.length, 1);
  assert.match(noWait.stdout, /Approval requested\. Approval ID: apr_1/);
});

test("approval request validates options before sending", async () => {
  for (const extra of [
    ["--scope", "planet:mars"],
    ["--timeout", "0"],
    ["--option", "Only one"],
    ["--option", "A", "--option", "B", "--option", "C", "--option", "D", "--option", "E"],
    ["--option", "x=A", "--option", "x=B"],
    ["--option", "A", "--option", "B", "--recommended", "z"],
    ["--recommended", "a"],
    ["--option", "A", "--option", "B", "--option-screenshot", "z=shot.png"],
    ["--option", "A", "--option", "B", "--option-screenshot", "a"],
    ["--option", `a=${"x".repeat(81)}`, "--option", "b"],
    ["--link", "Docs=http://example.com"],
    ["--link", "not a url"],
    ["--change", "src/app.ts:12"],
    ["--screenshot", "missing.png"],
    Array.from({ length: 6 }, (_, i) => ["--link", `https://example.com/${i}`]).flat(),
  ]) {
    const result = await runCliWithApi(["--api-key", "test", "approval", "request", "Deploy?", ...extra], { response: approvalResponse("approved") });
    assert.equal(result.code, 2, extra.join(" "));
    assert.equal(result.requests.length, 0, extra.join(" "));
  }
  // Deprecated appearance flags are accepted, ignored, and never sent.
  const scoped = await runCliWithApi(
    ["--api-key", "test", "approval", "request", "Deploy?", "--scope", "environment:production", "--color", "teal", "--delivery", "live_activity", "--icon", "bolt"],
    { response: approvalResponse("approved") }
  );
  assert.equal(scoped.code, 0, scoped.stderr);
  assert.deepEqual(scoped.requests[0].body.scope, { type: "environment", value: "production" });
  assert.equal("appearance" in scoped.requests[0].body, false);
  assert.equal("delivery" in scoped.requests[0].body, false);
  assert.match(scoped.stderr, /Ignoring --delivery, --color, --icon/);
});

test("approval request prints the reply and exits 4", async () => {
  const response = { approval: { ...approvalResponse("replied").approval, reply: "Send it tomorrow at 9 instead.\nSkip the EU list." } };
  for (const command of [["request", "Send the email?"], ["wait", "apr_1"]]) {
    const result = await runCliWithApi(["--api-key", "test", "approval", ...command], { response });
    assert.equal(result.code, 4, result.stderr);
    assert.equal(
      result.stdout,
      "Replied. Read the reply and follow it. Do not run the original action unless the reply says to.\nReply:\nSend it tomorrow at 9 instead.\nSkip the EU list."
    );
  }
  const json = await runCliWithApi(["--api-key", "test", "--json", "approval", "wait", "apr_1"], { response });
  assert.equal(json.code, 4);
  assert.equal(JSON.parse(json.stdout).approval.reply, "Send it tomorrow at 9 instead.\nSkip the EU list.");
});

test("approval request sends options and prints the chosen option with exit 5", async () => {
  const options = [
    { id: "left", label: "Keep the left layout" },
    { id: "right", label: "Use the right layout", recommended: true },
  ];
  const chosen = {
    approval: { ...approvalResponse("chosen").approval, options, selected_option_id: "right", selected_option: options[1] },
  };
  const result = await runCliWithApi(
    ["--api-key", "test", "approval", "request", "Which layout?", "--option", "left=Keep the left layout", "--option", "right=Use the right layout", "--recommended", "right"],
    { response: chosen }
  );
  assert.equal(result.code, 5, result.stderr);
  assert.deepEqual(result.requests[0].body.options, options);
  assert.equal(result.stdout, "Chosen: Use the right layout\nOption ID: right\nDo the chosen option.");

  const defaultIds = await runCliWithApi(
    ["--api-key", "test", "approval", "request", "Retry?", "--option", "Retry the failed jobs", "--option", "Skip them", "--option", "Stop the run"],
    { response: chosen }
  );
  assert.deepEqual(defaultIds.requests[0].body.options.map((option) => option.id), ["a", "b", "c"]);

  const got = await runCliWithApi(["--api-key", "test", "approval", "get", "apr_1"], { response: chosen });
  assert.equal(got.code, 0);
  assert.match(got.stdout, /^Chosen: Use the right layout\nOption ID: right/);
});

test("approval request uploads screenshots once and references their IDs", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "activitysmith-cli-shots-"));
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
  await writeFile(join(dir, "left.png"), png);
  await writeFile(join(dir, "right.jpg"), jpeg);
  await writeFile(join(dir, "fake.png"), "not an image");
  await writeFile(join(dir, "big.png"), Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]));

  const result = await runCliWithApi(
    [
      "--api-key", "test", "approval", "request", "Which layout?",
      "--screenshot", "left.png=Left layout",
      "--option", "left=Left", "--option", "right=Right",
      "--option-screenshot", "left=left.png", "--option-screenshot", "right=right.jpg",
    ],
    { cwd: dir, response: approvalResponse("approved"), routes: { "/approvals/screenshots": { screenshot: { id: "scr_1" } } } }
  );
  assert.equal(result.code, 0, result.stderr);
  const uploads = result.requests.filter((request) => request.url.endsWith("/approvals/screenshots"));
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].headers["Content-Type"], "image/png");
  assert.equal(uploads[0].body.bytes, png.length);
  assert.equal(uploads[1].headers["Content-Type"], "image/jpeg");
  const create = result.requests.find((request) => request.url.endsWith("/approvals"));
  assert.deepEqual(create.body.screenshots, [{ id: "scr_1", title: "Left layout" }, { id: "scr_1" }]);
  assert.deepEqual(create.body.options, [
    { id: "left", label: "Left", screenshot_id: "scr_1" },
    { id: "right", label: "Right", screenshot_id: "scr_1" },
  ]);

  for (const file of ["fake.png", "big.png"]) {
    const rejected = await runCliWithApi(["--api-key", "test", "approval", "request", "Ship?", "--screenshot", file], {
      cwd: dir,
      response: approvalResponse("approved"),
    });
    assert.equal(rejected.code, 2, file);
    assert.equal(rejected.requests.length, 0, file);
  }
});

test("approval request sends changes from git and --change, and links", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { execFileSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "activitysmith-cli-git-"));
  const git = (...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: dir });
  git("init", "-q");
  await writeFile(join(dir, "app.ts"), "one\ntwo\nthree\n");
  git("add", ".");
  git("commit", "-qm", "init");
  await writeFile(join(dir, "app.ts"), "one\n2\nthree\nfour\n");
  await writeFile(join(dir, "new file.md"), "hello\n");
  git("add", "new file.md");

  const result = await runCliWithApi(
    [
      "--api-key", "test", "approval", "request", "Commit these changes?", "--git-changes",
      "--change", "C:/build/out.js:3:0",
      "--link", "Pull request=https://github.com/acme/app/pull/42?tab=files",
      "--link", "https://staging.example.com",
    ],
    { cwd: dir, response: approvalResponse("approved") }
  );
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.requests[0].body.changes, {
    files: [
      { path: "app.ts", added: 2, removed: 1 },
      { path: "new file.md", added: 1, removed: 0 },
      { path: "C:/build/out.js", added: 3, removed: 0 },
    ],
  });
  assert.deepEqual(result.requests[0].body.links, [
    { title: "Pull request", url: "https://github.com/acme/app/pull/42?tab=files" },
    { title: "https://staging.example.com", url: "https://staging.example.com" },
  ]);

  const outside = await runCliWithApi(["--api-key", "test", "approval", "request", "Ship?", "--git-changes", "main...nope"], {
    cwd: dir,
    response: approvalResponse("approved"),
  });
  assert.equal(outside.code, 2);
  assert.equal(outside.requests.length, 0);
  assert.match(outside.stderr, /Could not read changes with git/);
});

test("approval wait, get, and cancel use the approval ID", async () => {
  const waited = await runCliWithApi(["--api-key", "test", "approval", "wait", "apr_1"], { response: approvalResponse("approved") });
  assert.equal(waited.code, 0);
  assert.equal(waited.requests[0].url, "https://activitysmith.com/api/approvals/apr_1?wait=45");

  const got = await runCliWithApi(["--api-key", "test", "approval", "get", "apr_1"], { response: approvalResponse("pending") });
  assert.equal(got.code, 0);
  assert.equal(got.requests[0].url, "https://activitysmith.com/api/approvals/apr_1");
  assert.match(got.stdout, /^Pending\./);

  const cancelled = await runCliWithApi(["--api-key", "test", "approval", "cancel", "apr_1"], { response: approvalResponse("cancelled") });
  assert.equal(cancelled.code, 0);
  assert.equal(cancelled.requests[0].url, "https://activitysmith.com/api/approvals/apr_1/cancel");
  assert.equal(cancelled.requests[0].method, "POST");
  assert.match(cancelled.stdout, /cancelled\. It can no longer be approved/);
});

test("metrics update sends only the value", async () => {
  const result = await runCli(["metrics", "update", "mrr", "42.5"]);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.request.method, "POST");
  assert.match(result.request.url, /\/metrics\/mrr\/value$/);
  assert.deepEqual(result.request.body, { value: 42.5 });
});

test("metrics update rejects Metadata options before sending", async () => {
  for (const extra of [["--metadata", "{}"], ["--metadata-file", "metadata.json"]]) {
    const result = await runCli(["metrics", "update", "mrr", "42", ...extra]);

    assert.notEqual(result.code, 0);
    assert.match(result.stdout + result.stderr, /unknown option/);
    assert.equal(result.request, null);
  }
});

test("metrics create sends the metric definition", async () => {
  const result = await runCli([
    "metrics",
    "create",
    "mrr",
    "--label",
    "MRR",
    "--format",
    "currency",
    "--currency-code",
    "USD",
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.request.method, "PUT");
  assert.equal(result.request.url, "https://activitysmith.com/api/metrics/mrr");
  assert.deepEqual(result.request.body, {
    label: "MRR",
    format: "currency",
    currency_code: "USD",
  });
});

test("metrics create without options uses the API defaults", async () => {
  const result = await runCli(["metrics", "create", "deploy.success_rate"]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.request.method, "PUT");
  assert.equal(result.request.url, "https://activitysmith.com/api/metrics/deploy.success_rate");
  assert.equal(result.request.body, null);
});
