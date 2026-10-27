import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

export const DEFAULT_ISSUER = "https://activitysmith.com";
// OAuth resource indicator for the REST API the CLI calls. Tokens issued for it work only there.
export const DEFAULT_API_RESOURCE = "https://activitysmith.com/api";
export const CLIENT_NAME = "ActivitySmith CLI";
// OAuth Client ID Metadata Document hosted on activitysmith.com. It registers the portless
// loopback callback http://127.0.0.1/callback, so any free port works per login, and the
// approval screen recognizes this exact client_id as the ActivitySmith CLI.
export const CLIENT_ID = "https://activitysmith.com/.well-known/oauth-client/activitysmith-cli.json";
// Sending Push Notifications, Live Activities, badges, and widget values. Nothing else.
export const LOGIN_SCOPES = "mcp:write";
// Asked for only by `activitysmith keys create`, which signs in again so the user approves it in the browser.
export const API_KEYS_SCOPE = "api_keys:write";

export const hasScope = (credentials, scope) => String(credentials?.scope ?? "").split(/\s+/).includes(scope);
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
// Refresh a little early so a token does not expire mid-request.
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
const LOCK_WAIT_MS = 15 * 1000;
const LOCK_STALE_MS = 30 * 1000;
const LOCK_POLL_MS = 50;

export const credentialsPath = (env = process.env) => {
  if (env.ACTIVITYSMITH_CONFIG_DIR) return join(env.ACTIVITYSMITH_CONFIG_DIR, "credentials.json");
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "activitysmith", "credentials.json");
};

export const readCredentials = (path = credentialsPath()) => {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.refresh_token === "string" && parsed.refresh_token ? parsed : null;
  } catch {
    throw new Error(`Stored credentials at ${path} are not valid JSON. Run activitysmith auth logout, then sign in again.`);
  }
};

// Written to a temporary file and renamed into place, so a parallel command never reads half a file.
export const writeCredentials = (credentials, path = credentialsPath()) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
};

export const deleteCredentials = (path = credentialsPath()) => {
  rmSync(path, { force: true });
};

const base64Url = (buffer) => buffer.toString("base64url");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const createPkcePair = () => {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

const readJsonResponse = async (response, label) => {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Fall through with the raw text for the error message.
  }
  if (!response.ok) {
    const detail = body?.error_description || body?.error || text || response.statusText;
    const error = new Error(`${label} failed (${response.status}): ${detail}`);
    error.oauthError = body?.error;
    throw error;
  }
  return body;
};

export const discoverOAuthServer = async ({ issuer, fetchImpl }) => {
  const response = await fetchImpl(`${issuer}/.well-known/oauth-authorization-server`);
  const metadata = await readJsonResponse(response, "OAuth discovery");
  for (const field of ["authorization_endpoint", "token_endpoint"]) {
    if (typeof metadata?.[field] !== "string") {
      throw new Error(`OAuth discovery response is missing ${field}`);
    }
  }
  return metadata;
};

export const buildAuthorizeUrl = ({ authorizationEndpoint, redirectUri, challenge, state, resource, scope = LOGIN_SCOPES }) => {
  const url = new URL(authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  }).toString();
  return url.toString();
};

const requestToken = async ({ tokenEndpoint, fetchImpl, params }) => {
  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const token = await readJsonResponse(response, "Token request");
  if (typeof token?.access_token !== "string" || typeof token?.refresh_token !== "string") {
    throw new Error("Token response did not include an access token and a refresh token");
  }
  return token;
};

// RFC 7009. Best effort: if the server cannot be reached, the token expires on its own.
const revokeRefreshToken = async ({ revocationEndpoint, fetchImpl, clientId, refreshToken }) => {
  if (!revocationEndpoint || !refreshToken || !clientId) return false;
  try {
    const response = await fetchImpl(revocationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token", client_id: clientId }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const tokenCredentials = (token, now) => ({
  access_token: token.access_token,
  access_token_expires_at: new Date(now + Number(token.expires_in || 3600) * 1000).toISOString(),
  refresh_token: token.refresh_token,
  scope: token.scope ?? LOGIN_SCOPES,
});

const callbackPage = (title, message) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#fff;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:28rem;padding:1.5rem;text-align:center}p{color:#a1a1aa}</style>
</head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

const parseCallback = (url, expectedState) => {
  const params = url.searchParams;
  if (params.get("state") !== expectedState) {
    return { error: new Error("The sign-in response did not match this login attempt. Run activitysmith auth login again.") };
  }
  const oauthError = params.get("error");
  if (oauthError) {
    const message = oauthError === "access_denied"
      ? "Sign-in was cancelled in the browser."
      : `Sign-in failed: ${params.get("error_description") || oauthError}`;
    return { error: new Error(message) };
  }
  const code = params.get("code");
  if (!code) return { error: new Error("The sign-in response did not include an authorization code.") };
  return { code };
};

// Listens on 127.0.0.1 for the OAuth redirect. Where the browser runs on another machine,
// the user can paste the address it ends up on instead (see promptForPastedCallback).
const startCallbackServer = async ({ state }) => {
  let settle;
  const result = new Promise((resolve) => {
    settle = resolve;
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    const outcome = parseCallback(url, state);
    const [title, message] = outcome.error
      ? ["Sign-in failed", `${outcome.error.message} You can close this tab.`]
      : ["You're signed in", "The ActivitySmith CLI is ready. You can close this tab and return to your terminal."];
    res.writeHead(outcome.error ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" }).end(callbackPage(title, message));
    settle(outcome);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    redirectUri: `http://127.0.0.1:${server.address().port}/callback`,
    result,
    settle,
    close: () => server.close(),
  };
};

const promptForPastedCallback = ({ input, state, settle }) => {
  const rl = createInterface({ input, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      return;
    }
    if (url.searchParams.has("code") || url.searchParams.has("error")) settle(parseCallback(url, state));
  });
  return () => rl.close();
};

export const openBrowser = (url) =>
  new Promise((resolve) => {
    const [command, args] =
      process.platform === "darwin"
        ? ["open", [url]]
        : process.platform === "win32"
          ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
          : ["xdg-open", [url]];
    if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      resolve(false);
      return;
    }
    try {
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });

/**
 * Signs in through the browser and saves the OAuth tokens. A previous sign-in on this machine is
 * revoked once the new one is saved, so repeated logins do not pile up connections.
 */
export const login = async ({
  issuer = DEFAULT_ISSUER,
  resource = DEFAULT_API_RESOURCE,
  path = credentialsPath(),
  fetchImpl = globalThis.fetch,
  launchBrowser = openBrowser,
  noBrowser = false,
  input = process.stdin,
  log = (line) => console.error(line),
  now = Date.now,
  timeoutMs = LOGIN_TIMEOUT_MS,
  scope = LOGIN_SCOPES,
} = {}) => {
  let previous = null;
  try {
    previous = readCredentials(path);
  } catch {
    // An unreadable file is replaced by this login.
  }
  const metadata = await discoverOAuthServer({ issuer, fetchImpl });
  const { verifier, challenge } = createPkcePair();
  const state = base64Url(randomBytes(16));
  const callback = await startCallbackServer({ state });
  const stopPrompt = input?.isTTY ? promptForPastedCallback({ input, state, settle: callback.settle }) : () => {};
  let timer;
  try {
    const authorizeUrl = buildAuthorizeUrl({
      authorizationEndpoint: metadata.authorization_endpoint,
      redirectUri: callback.redirectUri,
      challenge,
      state,
      resource,
      scope,
    });
    const opened = noBrowser ? false : await launchBrowser(authorizeUrl);
    log(opened ? "Opened your browser to sign in to ActivitySmith." : "Open this URL in a browser to sign in to ActivitySmith:");
    log(opened ? `If it did not open, visit: ${authorizeUrl}` : authorizeUrl);
    if (input?.isTTY) {
      log("If the browser is on another machine, paste the address it lands on after you approve.");
    }
    log("Waiting for approval...");

    const outcome = await Promise.race([
      callback.result,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out waiting for browser sign-in. Run activitysmith auth login again.")), timeoutMs);
      }),
    ]);
    if (outcome.error) throw outcome.error;

    const token = await requestToken({
      tokenEndpoint: metadata.token_endpoint,
      fetchImpl,
      params: {
        grant_type: "authorization_code",
        code: outcome.code,
        client_id: CLIENT_ID,
        redirect_uri: callback.redirectUri,
        code_verifier: verifier,
        resource,
      },
    });

    const credentials = {
      client_id: CLIENT_ID,
      issuer,
      resource,
      token_endpoint: metadata.token_endpoint,
      revocation_endpoint: metadata.revocation_endpoint ?? null,
      ...tokenCredentials(token, now()),
      signed_in_at: new Date(now()).toISOString(),
    };
    writeCredentials(credentials, path);

    if (previous?.refresh_token && previous.refresh_token !== credentials.refresh_token) {
      await revokeRefreshToken({
        revocationEndpoint: previous.revocation_endpoint ?? metadata.revocation_endpoint,
        fetchImpl,
        clientId: previous.client_id,
        refreshToken: previous.refresh_token,
      });
    }

    return { credentials };
  } finally {
    clearTimeout(timer);
    stopPrompt();
    callback.close();
  }
};

// Several CLI commands can run at once, for example from a coding agent. Refreshing rotates the
// refresh token, so only one process may refresh at a time; the others wait and reuse its result.
const acquireLock = async (lockPath) => {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(lockPath, "wx", 0o600));
      return () => rmSync(lockPath, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    try {
      if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
        rmSync(lockPath, { force: true });
        continue;
      }
    } catch {
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for another ActivitySmith command to refresh the sign-in. Delete ${lockPath} if no other command is running.`);
    }
    await sleep(LOCK_POLL_MS);
  }
};

const isFresh = (credentials, now) =>
  typeof credentials?.access_token === "string" &&
  Date.parse(credentials.access_token_expires_at) - ACCESS_TOKEN_REFRESH_MARGIN_MS > now;

/**
 * Returns a valid access token from the saved sign-in, refreshing it when it is about to expire.
 * Returns null when this machine is not signed in.
 */
export const getAccessToken = async ({ path = credentialsPath(), fetchImpl = globalThis.fetch, now = Date.now } = {}) => {
  const current = readCredentials(path);
  if (!current) return null;
  if (isFresh(current, now())) return current.access_token;

  const release = await acquireLock(`${path}.lock`);
  try {
    // Another command may have refreshed while this one waited for the lock.
    const latest = readCredentials(path);
    if (!latest) return null;
    if (isFresh(latest, now())) return latest.access_token;

    let token;
    try {
      token = await requestToken({
        tokenEndpoint: latest.token_endpoint,
        fetchImpl,
        params: {
          grant_type: "refresh_token",
          refresh_token: latest.refresh_token,
          client_id: latest.client_id,
          resource: latest.resource,
        },
      });
    } catch (error) {
      if (error.oauthError === "invalid_grant") {
        throw new Error("Your ActivitySmith sign-in expired or was disconnected. Run activitysmith auth login to sign in again.");
      }
      throw error;
    }
    writeCredentials({ ...latest, ...tokenCredentials(token, now()) }, path);
    return token.access_token;
  } finally {
    release();
  }
};

/**
 * Revokes the saved sign-in so the CLI leaves the account's AI Agents list, then removes the local
 * credentials either way.
 */
export const logout = async ({ path = credentialsPath(), fetchImpl = globalThis.fetch } = {}) => {
  let credentials = null;
  try {
    credentials = readCredentials(path);
  } catch {
    deleteCredentials(path);
    return { signedIn: true, revoked: false };
  }
  if (!credentials) return { signedIn: false, revoked: false };

  let revocationEndpoint = credentials.revocation_endpoint;
  if (!revocationEndpoint) {
    try {
      revocationEndpoint = (await discoverOAuthServer({ issuer: credentials.issuer || DEFAULT_ISSUER, fetchImpl })).revocation_endpoint;
    } catch {
      revocationEndpoint = null;
    }
  }
  const revoked = await revokeRefreshToken({
    revocationEndpoint,
    fetchImpl,
    clientId: credentials.client_id,
    refreshToken: credentials.refresh_token,
  });
  deleteCredentials(path);
  return { signedIn: true, revoked };
};
