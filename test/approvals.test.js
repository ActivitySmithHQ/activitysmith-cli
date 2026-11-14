import assert from "node:assert/strict";
import test from "node:test";
import { approvalResultLines, buildApprovalChanges, parseGitNumstat, parseLinkArgument, parseOptionArgument } from "../src/approvals.js";

test("parseGitNumstat reads binary files as zero lines and keeps tabs in paths", () => {
  assert.deepEqual(parseGitNumstat("3\t1\tsrc/app.ts\0-\t-\tlogo.png\0" + "2\t0\tdocs/a\tb.md\0"), [
    { path: "src/app.ts", added: 3, removed: 1 },
    { path: "logo.png", added: 0, removed: 0 },
    { path: "docs/a\tb.md", added: 2, removed: 0 },
  ]);
  assert.deepEqual(parseGitNumstat(""), []);
});

test("buildApprovalChanges keeps the 200 most changed files", () => {
  const files = Array.from({ length: 205 }, (_, i) => ({ path: `f${i}`, added: i, removed: 0 }));
  const { changes, omitted } = buildApprovalChanges(files);
  assert.equal(changes.files.length, 200);
  assert.equal(omitted, 5);
  assert.equal(changes.files.some((file) => file.path === "f0"), false);
  assert.deepEqual(buildApprovalChanges([]), { changes: undefined, omitted: 0 });
});

test("parseOptionArgument takes an ID only when it is a valid one", () => {
  assert.deepEqual(parseOptionArgument("left=Keep left"), { id: "left", label: "Keep left" });
  assert.deepEqual(parseOptionArgument("Set x = 2"), { id: null, label: "Set x = 2" });
  assert.deepEqual(parseOptionArgument("Retry"), { id: null, label: "Retry" });
});

test("parseLinkArgument splits the title at the https URL", () => {
  assert.deepEqual(parseLinkArgument("a=b=https://x.dev/?q=1"), { title: "a=b", url: "https://x.dev/?q=1" });
  assert.throws(() => parseLinkArgument("ftp://x.dev"));
});

test("approvalResultLines falls back to the option ID", () => {
  assert.deepEqual(approvalResultLines({ status: "chosen", selected_option_id: "b", selected_option: null, options: [] }), [
    "Chosen: b",
    "Option ID: b",
    "Do the chosen option.",
  ]);
});
