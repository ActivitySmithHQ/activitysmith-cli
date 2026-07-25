import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const runCli = (args) =>
  new Promise((resolve, reject) => {
    const runner = `
      globalThis.fetch = async (url, init) => {
        process.stdout.write("CAPTURE:" + JSON.stringify({
          url,
          body: JSON.parse(init.body)
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
