import assert from "node:assert/strict";
import test from "node:test";
import { approvalResultLines, buildApprovalChanges, changedFileName, parseGitNumstat, parseLinkArgument, parseOptionArgument } from "../src/approvals.js";

test("parseGitNumstat reads binary files as zero lines and keeps tabs in paths", () => {
  assert.deepEqual(parseGitNumstat("3\t1\tsrc/app.ts\0-\t-\tlogo.png\0" + "2\t0\tdocs/a\tb.md\0"), [
    { path: "src/app.ts", added: 3, removed: 1 },
    { path: "logo.png", added: 0, removed: 0 },
    { path: "docs/a\tb.md", added: 2, removed: 0 },
  ]);
  assert.deepEqual(parseGitNumstat(""), []);
});

test("buildApprovalChanges sends only the counts and the 2 most changed file names", () => {
  const files = [
    { path: "docs/readme.md", added: 1, removed: 0 },
    { path: "src/billing/seatCount.ts", added: 40, removed: 12 },
    { path: "assets/logo.png", added: 0, removed: 0 },
    { path: "src/api/routes.ts", added: 5, removed: 5 },
    { path: "C:\\build\\out.js", added: 10, removed: 0 },
  ];
  assert.deepEqual(buildApprovalChanges(files), {
    files_changed: 5,
    lines_added: 56,
    lines_removed: 17,
    top_files: ["seatCount.ts", "routes.ts"],
  });
  assert.deepEqual(buildApprovalChanges([{ path: "a/one.ts", added: 2, removed: 0 }]), {
    files_changed: 1,
    lines_added: 2,
    lines_removed: 0,
    top_files: ["one.ts"],
  });
  assert.equal(buildApprovalChanges([]), undefined);
});

test("changedFileName keeps only the last path component", () => {
  assert.equal(changedFileName("src/app.ts"), "app.ts");
  assert.equal(changedFileName("C:\\build\\out.js"), "out.js");
  assert.equal(changedFileName("Makefile"), "Makefile");
  assert.equal(changedFileName("vendor/lib/"), "lib");
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
