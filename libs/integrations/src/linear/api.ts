import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

import type {
  LinearCredentials,
  LinearProjectConfig,
  LinearIssueSummary,
  LinearIssueDetail,
  LinearTaskData,
} from "./types";

const LINEAR_API = "https://api.linear.app/graphql";

async function graphql<T>(
  creds: LinearCredentials,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: creds.apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Linear API error: ${resp.status} ${body}`);
  }

  const json = (await resp.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
  }
  if (!json.data) {
    throw new Error("Linear API returned no data");
  }
  return json.data;
}

export async function testConnection(
  creds: LinearCredentials,
): Promise<{ id: string; name: string; email: string }> {
  const data = await graphql<{ viewer: { id: string; name: string; email: string } }>(
    creds,
    `query { viewer { id name email } }`,
  );
  return data.viewer;
}

export async function fetchIssues(
  creds: LinearCredentials,
  teamKey?: string,
  query?: string,
): Promise<LinearIssueSummary[]> {
  let filter =
    "assignee: { isMe: { eq: true } }, completedAt: { null: true }, canceledAt: { null: true }";
  if (teamKey) {
    filter += `, team: { key: { eq: "${teamKey}" } }`;
  }

  const searchQuery = query
    ? `query IssueSearch($query: String!) {
        issueSearch(query: $query, filter: { ${filter} }, orderBy: updatedAt, first: 50) {
          nodes {
            identifier
            title
            state { name type color }
            priority
            assignee { name }
            updatedAt
            labels { nodes { name color } }
            url
          }
        }
      }`
    : `query Issues {
        issues(filter: { ${filter} }, orderBy: updatedAt, first: 50) {
          nodes {
            identifier
            title
            state { name type color }
            priority
            assignee { name }
            updatedAt
            labels { nodes { name color } }
            url
          }
        }
      }`;

  const data = await graphql<{
    issues?: { nodes: RawIssueNode[] };
    issueSearch?: { nodes: RawIssueNode[] };
  }>(creds, searchQuery, query ? { query } : undefined);

  const nodes = data.issueSearch?.nodes ?? data.issues?.nodes ?? [];
  return nodes.map(mapIssueSummary);
}

interface RawIssueNode {
  identifier: string;
  title: string;
  state: { name: string; type: string; color: string };
  priority: number;
  assignee: { name: string } | null;
  updatedAt: string;
  labels: { nodes: Array<{ name: string; color: string }> };
  url: string;
}

function mapIssueSummary(node: RawIssueNode): LinearIssueSummary {
  return {
    identifier: node.identifier,
    title: node.title,
    state: node.state,
    priority: node.priority,
    assignee: node.assignee?.name ?? null,
    updatedAt: node.updatedAt,
    labels: node.labels.nodes,
    url: node.url,
  };
}

export async function fetchIssue(
  identifier: string,
  creds: LinearCredentials,
): Promise<LinearIssueDetail> {
  // Parse "ENG-123" into team key "ENG" and number 123
  const match = identifier.match(/^([A-Za-z]+)-(\d+)$/);
  if (!match) {
    throw new Error(
      `Invalid Linear identifier format: "${identifier}". Expected format like ENG-123.`,
    );
  }
  const teamKey = match[1].toUpperCase();
  const issueNumber = parseInt(match[2], 10);

  const data = await graphql<{
    issues: {
      nodes: Array<{
        identifier: string;
        title: string;
        description: string | null;
        state: { name: string; type: string; color: string };
        priority: number;
        assignee: { name: string } | null;
        createdAt: string;
        updatedAt: string;
        labels: { nodes: Array<{ name: string; color: string }> };
        url: string;
        comments: {
          nodes: Array<{
            user: { name: string } | null;
            body: string;
            createdAt: string;
          }>;
        };
        attachments: {
          nodes: Array<{
            title: string;
            subtitle: string | null;
            url: string;
            sourceType: string | null;
          }>;
        };
      }>;
    };
  }>(
    creds,
    `query IssueDetail($teamKey: String!, $number: Float!) {
      issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }, first: 1) {
        nodes {
          identifier
          title
          description
          state { name type color }
          priority
          assignee { name }
          createdAt
          updatedAt
          labels { nodes { name color } }
          url
          comments(orderBy: createdAt, first: 50) {
            nodes {
              user { name }
              body
              createdAt
            }
          }
          attachments(first: 50) {
            nodes {
              title
              subtitle
              url
              sourceType
            }
          }
        }
      }
    }`,
    { teamKey, number: issueNumber },
  );

  const node = data.issues.nodes[0];
  if (!node) {
    throw new Error(`Issue ${identifier} not found`);
  }

  return {
    identifier: node.identifier,
    title: node.title,
    description: node.description,
    state: node.state,
    priority: node.priority,
    assignee: node.assignee?.name ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    labels: node.labels.nodes,
    url: node.url,
    comments: node.comments.nodes.map((c) => ({
      author: c.user?.name ?? "Unknown",
      body: c.body,
      createdAt: c.createdAt,
    })),
    attachments: node.attachments.nodes,
  };
}

export function resolveIdentifier(id: string, config: LinearProjectConfig): string {
  if (id.includes("-")) return id.toUpperCase();

  if (!config.defaultTeamKey) {
    throw new Error(
      `Issue ID "${id}" has no team prefix and no defaultTeamKey is configured.\n` +
        `Either use the full identifier (e.g. ENG-${id}) or set defaultTeamKey in Linear settings.`,
    );
  }

  return `${config.defaultTeamKey}-${id}`;
}

export function saveTaskData(taskData: LinearTaskData, tasksDir: string): void {
  // Write to issues/linear/<IDENTIFIER>/issue.json
  const issueDir = path.join(path.dirname(tasksDir), "issues", "linear", taskData.identifier);
  mkdirSync(issueDir, { recursive: true });
  writeFileSync(path.join(issueDir, "issue.json"), JSON.stringify(taskData, null, 2) + "\n");

  // Create empty notes.json if it doesn't exist
  const notesPath = path.join(issueDir, "notes.json");
  if (!existsSync(notesPath)) {
    writeFileSync(
      notesPath,
      JSON.stringify(
        {
          linkedWorktreeId: null,
          personal: null,
          aiContext: null,
        },
        null,
        2,
      ) + "\n",
    );
  }
}
