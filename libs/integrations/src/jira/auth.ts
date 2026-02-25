import { createServer } from "http";
import { execFile as execFileCb } from "child_process";

import { log } from "@openkit/shared/logger";
import type { JiraCredentials, JiraOAuthCredentials } from "./types";
import { saveJiraCredentials } from "./credentials";

export function getApiBase(creds: JiraCredentials): string {
  if (creds.authMethod === "oauth") {
    return `https://api.atlassian.com/ex/jira/${creds.oauth.cloudId}/rest/api/3`;
  }
  const base = creds.apiToken.baseUrl.replace(/\/$/, "");
  return `${base}/rest/api/3`;
}

export async function getAuthHeaders(
  creds: JiraCredentials,
  configDir: string,
): Promise<Record<string, string>> {
  if (creds.authMethod === "api-token") {
    const encoded = Buffer.from(`${creds.apiToken.email}:${creds.apiToken.token}`).toString(
      "base64",
    );
    return {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/json",
    };
  }

  // OAuth — check if token needs refresh
  if (Date.now() >= creds.oauth.expiresAt - 60_000) {
    await refreshOAuthToken(creds, configDir);
  }

  return {
    Authorization: `Bearer ${creds.oauth.accessToken}`,
    "Content-Type": "application/json",
  };
}

async function refreshOAuthToken(creds: JiraOAuthCredentials, configDir: string): Promise<void> {
  const resp = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: creds.oauth.clientId,
      client_secret: creds.oauth.clientSecret,
      refresh_token: creds.oauth.refreshToken,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to refresh OAuth token: ${resp.status} ${body}`);
  }

  const data = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  creds.oauth.accessToken = data.access_token;
  creds.oauth.refreshToken = data.refresh_token;
  creds.oauth.expiresAt = Date.now() + data.expires_in * 1000;

  saveJiraCredentials(configDir, creds);
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  execFileCb(cmd, [url], () => {
    // Ignore errors — user can copy the URL manually
  });
}

export async function runOAuthFlow(
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error || !code) {
        res.writeHead(400);
        res.end("Authorization failed. You can close this tab.");
        server.close();
        reject(new Error(`OAuth error: ${error ?? "no code received"}`));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body><h2>Connected to Jira!</h2><p>You can close this tab and return to the terminal.</p></body></html>",
      );

      // Exchange code for tokens
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://localhost:${port}/callback`;

      fetch("https://auth.atlassian.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      })
        .then(async (tokenResp) => {
          if (!tokenResp.ok) {
            const body = await tokenResp.text();
            throw new Error(`Token exchange failed: ${tokenResp.status} ${body}`);
          }
          return tokenResp.json() as Promise<{
            access_token: string;
            refresh_token: string;
            expires_in: number;
          }>;
        })
        .then((tokenData) => {
          server.close();
          resolve({
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresIn: tokenData.expires_in,
          });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });

    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://localhost:${port}/callback`;
      const scopes = "read:jira-work offline_access";
      const authUrl =
        `https://auth.atlassian.com/authorize?audience=api.atlassian.com` +
        `&client_id=${clientId}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&prompt=consent`;

      log.info("Opening browser for Jira authorization...");
      log.plain(`If the browser doesn't open, visit:\n  ${authUrl}\n`);
      openBrowser(authUrl);
    });

    // Timeout after 5 minutes
    setTimeout(
      () => {
        server.close();
        reject(new Error("OAuth flow timed out (5 minutes)"));
      },
      5 * 60 * 1000,
    );
  });
}

export async function discoverCloudId(
  accessToken: string,
): Promise<{ cloudId: string; siteUrl: string }> {
  const resp = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    throw new Error(`Failed to discover cloud resources: ${resp.status}`);
  }

  const resources = (await resp.json()) as Array<{ id: string; url: string; name: string }>;

  if (resources.length === 0) {
    throw new Error("No accessible Jira sites found for this account");
  }

  if (resources.length === 1) {
    return { cloudId: resources[0].id, siteUrl: resources[0].url };
  }

  // Multiple sites — list them and pick the first, user can reconfigure
  log.info("Multiple Jira sites found:");
  resources.forEach((r, i) => log.plain(`  ${i + 1}. ${r.name} (${r.url})`));
  log.info(`Using: ${resources[0].name}`);

  return { cloudId: resources[0].id, siteUrl: resources[0].url };
}

export async function testConnection(creds: JiraCredentials, configDir: string): Promise<string> {
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);

  const resp = await fetch(`${base}/myself`, { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Connection test failed: ${resp.status} ${body}`);
  }

  const user = (await resp.json()) as { displayName: string; emailAddress: string };
  return `${user.displayName} (${user.emailAddress})`;
}
