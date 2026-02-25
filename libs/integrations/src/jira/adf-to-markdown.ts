interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
}

type AttachmentMap = Map<string, { url: string; mimeType: string }>;

export function adfToMarkdown(adf: unknown, attachments?: AttachmentMap): string {
  if (!adf || typeof adf !== "object") return "";
  const doc = adf as AdfNode;
  if (doc.type !== "doc" || !doc.content) return "";
  return convertNodes(doc.content, 0, attachments).trim();
}

function convertNodes(nodes: AdfNode[], listDepth = 0, attachments?: AttachmentMap): string {
  return nodes.map((node) => convertNode(node, listDepth, attachments)).join("");
}

function convertNode(node: AdfNode, listDepth: number, attachments?: AttachmentMap): string {
  switch (node.type) {
    case "paragraph":
      return convertInline(node.content, attachments) + "\n\n";

    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const prefix = "#".repeat(Math.min(level, 6));
      return `${prefix} ${convertInline(node.content, attachments)}\n\n`;
    }

    case "text":
      return applyMarks(node.text ?? "", node.marks);

    case "hardBreak":
      return "\n";

    case "rule":
      return "---\n\n";

    case "codeBlock": {
      const lang = (node.attrs?.language as string) ?? "";
      const code = node.content?.map((c) => c.text ?? "").join("") ?? "";
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }

    case "blockquote": {
      const inner = convertNodes(node.content ?? [], listDepth, attachments)
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return inner + "\n\n";
    }

    case "bulletList":
      return (
        (node.content ?? [])
          .map((item) => convertListItem(item, listDepth, "- ", attachments))
          .join("") + (listDepth === 0 ? "\n" : "")
      );

    case "orderedList":
      return (
        (node.content ?? [])
          .map((item, i) => convertListItem(item, listDepth, `${i + 1}. `, attachments))
          .join("") + (listDepth === 0 ? "\n" : "")
      );

    case "listItem": {
      // Handled by bulletList/orderedList via convertListItem
      return convertNodes(node.content ?? [], listDepth, attachments);
    }

    case "mention": {
      const name = (node.attrs?.text as string) ?? (node.attrs?.displayName as string) ?? "someone";
      return `@${name.replace(/^@/, "")}`;
    }

    case "mediaSingle":
    case "mediaGroup":
      return (node.content ?? [])
        .map((child) => convertNode(child, listDepth, attachments))
        .join("");

    case "media": {
      // Try multiple attributes to find the attachment: alt, __fileName, filename, id
      const candidates = [
        node.attrs?.alt as string,
        node.attrs?.__fileName as string,
        node.attrs?.filename as string,
        node.attrs?.id as string,
      ].filter(Boolean) as string[];
      const displayName = candidates[0] ?? "file";
      let att: { url: string; mimeType: string } | undefined;
      for (const key of candidates) {
        att = attachments?.get(key);
        if (att) break;
      }
      if (att) {
        const proxyUrl = `/api/jira/attachment?url=${encodeURIComponent(att.url)}`;
        if (att.mimeType.startsWith("image/")) {
          return `![${displayName}](${proxyUrl})\n\n`;
        }
        return `[${displayName}](${proxyUrl})\n\n`;
      }
      return `[attachment: ${displayName}]`;
    }

    case "inlineCard": {
      const url = (node.attrs?.url as string) ?? "";
      return url ? `[${url}](${url})` : "";
    }

    default:
      // Unknown node — recurse into children if present
      if (node.content) {
        return convertNodes(node.content, listDepth, attachments);
      }
      return "";
  }
}

function convertListItem(
  item: AdfNode,
  depth: number,
  prefix: string,
  attachments?: AttachmentMap,
): string {
  const indent = "  ".repeat(depth);
  const inner = convertNodes(item.content ?? [], depth + 1, attachments).replace(/\n\n$/, "\n");
  // First line gets the bullet/number, subsequent lines get indented
  const lines = inner.split("\n");
  return (
    lines
      .map((line, i) => {
        if (i === 0) return `${indent}${prefix}${line}`;
        if (line.trim() === "") return "";
        return `${indent}  ${line}`;
      })
      .filter((line, i, arr) => !(i === arr.length - 1 && line === ""))
      .join("\n") + "\n"
  );
}

function convertInline(nodes?: AdfNode[], attachments?: AttachmentMap): string {
  if (!nodes) return "";
  return nodes.map((n) => convertNode(n, 0, attachments)).join("");
}

function applyMarks(text: string, marks?: AdfNode["marks"]): string {
  if (!marks || marks.length === 0) return text;

  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "strong":
        result = `**${result}**`;
        break;
      case "em":
        result = `*${result}*`;
        break;
      case "code":
        result = `\`${result}\``;
        break;
      case "strike":
        result = `~~${result}~~`;
        break;
      case "link": {
        const href = (mark.attrs?.href as string) ?? "";
        result = `[${result}](${href})`;
        break;
      }
    }
  }
  return result;
}
