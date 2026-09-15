import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const runCli = (args) =>
  new Promise((resolve, reject) => {
    const runner = `
      globalThis.fetch = async (url, init) => {
        process.stdout.write("CAPTURE:" + JSON.stringify({
          url,
          body: init.body ? JSON.parse(init.body) : null
        }) + "\\n");
        return new Response(JSON.stringify({
          success: true,
          activity_id: "activity-1",
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
