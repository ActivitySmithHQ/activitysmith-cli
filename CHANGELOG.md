## 1.17.0

Adds approvals. Your agents can now ask for your approval before they act, such as sending an email or deploying. `activitysmith approval request` shows the request on your iPhone and waits for your answer. It exits with code 0 only when you approve, so the agent continues only after that. `approval wait`, `approval get`, and `approval cancel` work with a request you already sent.

## 1.16.0

Adds two commands so a coding agent can finish setup on its own. `activitysmith devices list` shows the iPhones and iPads paired to your account, and points to the App Store when none is paired. `activitysmith keys create` creates an API key for CI, servers, and scripts with the browser sign-in; the first time, it asks you to approve API key access in the browser. Add `--raw` to print only the key, so it can go straight into a secret store.

## 1.15.0

Adds browser sign-in. Run `activitysmith auth login`, approve access in your browser, and commands work without an API key. `activitysmith auth status` shows how the CLI authenticates, and `activitysmith auth logout` disconnects it from your account. `--api-key` and `ACTIVITYSMITH_API_KEY` still work and take precedence, so CI pipelines can keep using API keys.

## 1.14.0

Adds the ability to replace a Push Notification you already sent with a new one.

## 1.13.0

Adds custom icons and interruption levels for Push Notifications. Set `--icon` to show a service logo or avatar on the notification, and `--interruption-level` to deliver it as `passive`, `active`, or `time-sensitive`.

## 1.12.0

Adds the new `value` Live Activity type.

## 1.11.0

This version adds support for Metadata and iOS deep links, and expands Tags support when updating or ending Live Activities.

## 1.10.0

### New Features

- **New Feature: Tags** — Organize and filter your Push Notification and Live Activity history using one or more tags.

## 1.9.0

### New Features

- **New Feature: App Icon Badge Count** - Show MRR, user counts, stock prices, and more on your ActivitySmith app icon.
