import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CLIENT_ID, credentialsPath, getAccessToken, login, logout, readCredentials } from '../src/auth.js';

const ISSUER = 'https://auth.test';
const API = 'https://auth.test/api';
const NOW = Date.parse('2026-10-24T12:00:00.000Z');

const tempDir = async t => {
  const directory = await mkdtemp(join(tmpdir(), 'activitysmith-auth-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const form = call => Object.fromEntries(new URLSearchParams(call.body));

// A fake ActivitySmith authorization server that records every request.
const fakeServer = ({refreshError = null, revokeStatus = 200, tokenDelayMs = 0} = {}) => {
  const calls = [];
  let issued = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({url, method: init.method || 'GET', body: init.body});
    if (url === `${ISSUER}/.well-known/oauth-authorization-server`) {
      return json({
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        token_endpoint: `${ISSUER}/oauth/token`,
        revocation_endpoint: `${ISSUER}/api/oauth/revoke`,
      });
    }
    if (url === `${ISSUER}/oauth/token`) {
      if (tokenDelayMs) await new Promise(resolve => setTimeout(resolve, tokenDelayMs));
      if (refreshError && form({body: init.body}).grant_type === 'refresh_token') return json({error: refreshError}, 400);
      issued += 1;
      return json({access_token: `access-${issued}`, refresh_token: `refresh-${issued}`, expires_in: 3600, scope: 'mcp:write'});
    }
    if (url === `${ISSUER}/api/oauth/revoke`) return new Response(null, {status: revokeStatus});
    return json({error: 'unexpected'}, 500);
  };
  const of = suffix => calls.filter(call => call.url.endsWith(suffix));
  return {calls, fetchImpl, of};
};

// Plays the browser: follows the authorize URL straight to the loopback callback.
const approveInBrowser = (params = {}) => async authorizeUrl => {
  const url = new URL(authorizeUrl);
  const callback = new URL(url.searchParams.get('redirect_uri'));
  callback.searchParams.set('state', params.state ?? url.searchParams.get('state'));
  for (const [key, value] of Object.entries(params.query ?? {code: 'code-1'})) callback.searchParams.set(key, value);
  setImmediate(() => fetch(callback).catch(() => {}));
  return true;
};

const loginOptions = (path, server, extra = {}) => ({
  issuer: ISSUER, resource: API, path, fetchImpl: server.fetchImpl, log: () => {}, now: () => NOW,
  launchBrowser: approveInBrowser(), ...extra,
});

const savedSignIn = (overrides = {}) => ({
  client_id: CLIENT_ID,
  issuer: ISSUER,
  resource: API,
  token_endpoint: `${ISSUER}/oauth/token`,
  revocation_endpoint: `${ISSUER}/api/oauth/revoke`,
  access_token: 'access-old',
  access_token_expires_at: new Date(NOW + 30 * 60 * 1000).toISOString(),
  refresh_token: 'refresh-old',
  scope: 'mcp:write',
  signed_in_at: '2026-10-24T10:00:00.000Z',
  ...overrides,
});

test('login asks for send access to the REST API with PKCE and saves a private token file', async t => {
  const path = join(await tempDir(t), 'credentials.json');
  const server = fakeServer();
  let authorizeUrl;
  const {credentials} = await login(loginOptions(path, server, {
    launchBrowser: async url => { authorizeUrl = new URL(url); return approveInBrowser()(url); },
  }));

  assert.equal(authorizeUrl.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(authorizeUrl.searchParams.get('scope'), 'mcp:write');
  assert.equal(authorizeUrl.searchParams.get('resource'), API);
  assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authorizeUrl.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);

  const exchange = form(server.of('/oauth/token')[0]);
  assert.equal(exchange.grant_type, 'authorization_code');
  assert.equal(exchange.client_id, CLIENT_ID);
  assert.equal(exchange.resource, API);
  assert.equal(exchange.redirect_uri, authorizeUrl.searchParams.get('redirect_uri'));
  assert.ok(exchange.code_verifier.length >= 43);

  assert.equal(credentials.access_token, 'access-1');
  assert.equal(credentials.refresh_token, 'refresh-1');
  assert.equal(credentials.access_token_expires_at, '2026-10-24T13:00:00.000Z');
  assert.equal(credentials.revocation_endpoint, `${ISSUER}/api/oauth/revoke`);
  assert.deepEqual(readCredentials(path), credentials);
  assert.deepEqual(server.of('/oauth/revoke'), []);
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('login again revokes the previous sign-in', async t => {
  const path = join(await tempDir(t), 'credentials.json');
  await writeFile(path, JSON.stringify(savedSignIn()));
  const server = fakeServer();
  await login(loginOptions(path, server));

  assert.deepEqual(server.of('/oauth/revoke').map(form), [{token: 'refresh-old', token_type_hint: 'refresh_token', client_id: CLIENT_ID}]);
  assert.equal(readCredentials(path).refresh_token, 'refresh-1');
});

test('login rejects a cancelled approval and a mismatched state', async t => {
  const path = join(await tempDir(t), 'credentials.json');
  await assert.rejects(login(loginOptions(path, fakeServer(), {launchBrowser: approveInBrowser({query: {error: 'access_denied'}})})), /cancelled/);
  await assert.rejects(login(loginOptions(path, fakeServer(), {launchBrowser: approveInBrowser({state: 'forged'})})), /did not match/);
  assert.equal(readCredentials(path), null);
});

test('login prints the URL when no browser opens and times out cleanly', async t => {
  const path = join(await tempDir(t), 'credentials.json');
  const lines = [];
  await assert.rejects(
    login(loginOptions(path, fakeServer(), {noBrowser: true, log: line => lines.push(line), timeoutMs: 50})),
    /Timed out/,
  );
  assert.equal(lines[0], 'Open this URL in a browser to sign in to ActivitySmith:');
  assert.match(lines[1], /^https:\/\/auth\.test\/oauth\/authorize\?/);
});

test('getAccessToken reuses a current token and refreshes one about to expire', async t => {
  const path = join(await tempDir(t), 'credentials.json');
  const server = fakeServer();
  assert.equal(await getAccessToken({path, fetchImpl: server.fetchImpl, now: () => NOW}), null);

  await writeFile(path, JSON.stringify(savedSignIn()));
  assert.equal(await getAccessToken({path, fetchImpl: server.fetchImpl, now: () => NOW}), 'access-old');
  assert.deepEqual(server.calls, []);

  await writeFile(path, JSON.stringify(savedSignIn({access_token_expires_at: new Date(NOW + 30 * 1000).toISOString()})));
  assert.equal(await getAccessToken({path, fetchImpl: server.fetchImpl, now: () => NOW}), 'access-1');
  assert.deepEqual(form(server.of('/oauth/token')[0]), {grant_type: 'refresh_token', refresh_token: 'refresh-old', client_id: CLIENT_ID, resource: API});
  const saved = readCredentials(path);
  assert.equal(saved.refresh_token, 'refresh-1');
  assert.equal(saved.signed_in_at, '2026-10-24T10:00:00.000Z');
});

test('parallel commands share one refresh instead of signing each other out', async t => {
  const path = join(await tempDir(t), 'credentials.json');
  await writeFile(path, JSON.stringify(savedSignIn({access_token_expires_at: new Date(NOW - 1000).toISOString()})));
  const server = fakeServer({tokenDelayMs: 100});
  const tokens = await Promise.all(Array.from({length: 5}, () => getAccessToken({path, fetchImpl: server.fetchImpl, now: () => NOW})));

  assert.deepEqual(tokens, Array(5).fill('access-1'));
  assert.equal(server.of('/oauth/token').length, 1);
  assert.equal(readCredentials(path).refresh_token, 'refresh-1');
});

test('getAccessToken explains a revoked or expired sign-in', async t => {
  const path = join(await tempDir(t), 'credentials.json');
  await writeFile(path, JSON.stringify(savedSignIn({access_token_expires_at: new Date(NOW - 1000).toISOString()})));
  await assert.rejects(
    getAccessToken({path, fetchImpl: fakeServer({refreshError: 'invalid_grant'}).fetchImpl, now: () => NOW}),
    /expired or was disconnected\. Run activitysmith auth login/,
  );
});

test('logout revokes the sign-in and removes the file, even when revocation fails', async t => {
  const path = join(await tempDir(t), 'credentials.json');
  await writeFile(path, JSON.stringify(savedSignIn()));
  const server = fakeServer();
  assert.deepEqual(await logout({path, fetchImpl: server.fetchImpl}), {signedIn: true, revoked: true});
  assert.deepEqual(server.of('/oauth/revoke').map(form), [{token: 'refresh-old', token_type_hint: 'refresh_token', client_id: CLIENT_ID}]);
  assert.equal(readCredentials(path), null);

  await writeFile(path, JSON.stringify(savedSignIn()));
  assert.deepEqual(await logout({path, fetchImpl: fakeServer({revokeStatus: 503}).fetchImpl}), {signedIn: true, revoked: false});
  assert.equal(readCredentials(path), null);

  assert.deepEqual(await logout({path, fetchImpl: server.fetchImpl}), {signedIn: false, revoked: false});
});

test('credentials path defaults', () => {
  assert.equal(credentialsPath({ACTIVITYSMITH_CONFIG_DIR: '/tmp/as'}), join('/tmp/as', 'credentials.json'));
  assert.equal(credentialsPath({XDG_CONFIG_HOME: '/xdg'}), join('/xdg', 'activitysmith', 'credentials.json'));
});

// Runs the CLI with fetch replaced, recording the Authorization header the API receives.
// CLI_TEST_STATUS makes the API answer with that status instead of success.
const runCli = (args, env) => new Promise((resolve, reject) => {
  const runner = `
    globalThis.fetch = async (url, init) => {
      const headers = new Headers(init?.headers);
      process.stdout.write("AUTH:" + headers.get("authorization") + "\\n");
      const status = Number(process.env.CLI_TEST_STATUS || 200);
      const body = status === 200 ? {success: true, notification_id: "pn-1", devices_notified: 1} : {error: "Invalid access token", code: "invalid_token"};
      return new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});
    };
    process.argv = ["node", "activitysmith", ...JSON.parse(process.env.CLI_TEST_ARGS)];
    await import("./src/cli.js");
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', runner], {
    env: {...process.env, ACTIVITYSMITH_API_KEY: '', CLI_TEST_ARGS: JSON.stringify(args), ...env},
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => resolve({code, stdout, stderr, auth: stdout.split('\n').find(line => line.startsWith('AUTH:'))?.slice(5)}));
});

test('commands use --api-key, then ACTIVITYSMITH_API_KEY, then the saved sign-in', async t => {
  const directory = await tempDir(t);
  const env = {ACTIVITYSMITH_CONFIG_DIR: directory};

  const missing = await runCli(['push', '--title', 'Hi'], env);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /Run activitysmith auth login/);
  assert.equal(JSON.parse((await runCli(['--json', 'auth', 'status'], env)).stdout).auth_source, null);

  await writeFile(join(directory, 'credentials.json'), JSON.stringify(savedSignIn({access_token_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()})));
  const signedIn = await runCli(['push', '--title', 'Hi'], env);
  assert.equal(signedIn.code, 0, signedIn.stderr);
  assert.equal(signedIn.auth, 'Bearer access-old');
  const status = await runCli(['auth', 'status'], env);
  assert.match(status.stdout, /Using the browser sign-in from activitysmith auth login\./);
  assert.doesNotMatch(status.stdout, /access-old|refresh-old/);

  assert.equal((await runCli(['push', '--title', 'Hi'], {...env, ACTIVITYSMITH_API_KEY: 'ask_env'})).auth, 'Bearer ask_env');
  assert.equal((await runCli(['--api-key', 'ask_flag', 'push', '--title', 'Hi'], {...env, ACTIVITYSMITH_API_KEY: 'ask_env'})).auth, 'Bearer ask_flag');
  assert.equal(JSON.parse((await runCli(['--json', 'auth', 'status'], {...env, ACTIVITYSMITH_API_KEY: 'ask_env'})).stdout).auth_source, 'ACTIVITYSMITH_API_KEY');
});

test('a disconnected sign-in tells the user to sign in again, while API key errors stay as they are', async t => {
  const directory = await tempDir(t);
  const env = {ACTIVITYSMITH_CONFIG_DIR: directory, CLI_TEST_STATUS: '401'};
  await writeFile(join(directory, 'credentials.json'), JSON.stringify(savedSignIn({access_token_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()})));

  const signedIn = await runCli(['push', '--title', 'Hi'], env);
  assert.equal(signedIn.code, 1);
  assert.match(signedIn.stderr, /^Your ActivitySmith sign-in was disconnected or expired\. Run activitysmith auth login/);

  const withKey = await runCli(['push', '--title', 'Hi'], {...env, ACTIVITYSMITH_API_KEY: 'ask_env'});
  assert.equal(withKey.code, 1);
  assert.doesNotMatch(withKey.stderr, /sign-in was disconnected/);
});
