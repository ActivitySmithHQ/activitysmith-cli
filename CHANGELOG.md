## Unreleased

- Support Push Notification app deep links and final Tags/Metadata when ending a managed Live Activity stream.

- Add Metadata to Push Notifications and Live Activity start, update, end, and stream requests, including empty-object clearing.

- Add `--tags` and `--clear-tags` to legacy `activity update` and `activity end`.

- Add `--clear-tags` to stream updates; reject combining it with `--tags`.
- Allow icons and badges alongside metrics and progress fields.
- Add `--auto-dismiss-seconds` to `activity end-stream` and support `autoDismissSeconds` in content-state JSON.
- Allow timer stream updates without a duration so the existing timer continues.

## 1.10.0

### New Features

- **New Feature: Tags** — Organize and filter your Push Notification and Live Activity history using one or more tags.

## 1.9.0

### New Features

- **New Feature: App Icon Badge Count** - Show MRR, user counts, stock prices, and more on your ActivitySmith app icon.
