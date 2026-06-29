/**
 * Strip leaked A2UI component JSON out of the agent's visible chat text.
 *
 * The dashboard is supposed to render exclusively via the generate_a2ui
 * tool call's side effect (see one_search_agent's system prompt), never
 * by writing JSON into the chat reply. In practice it still leaks
 * sometimes: the A2UI generation subagent runs its own nested
 * model.astream() call (see ag_ui_langgraph's a2ui_tool.py), and AG-UI's
 * generic event translator can't distinguish that inner subagent's
 * token stream from the outer agent's reply - both surface as the same
 * TEXT_MESSAGE_CONTENT events. We can't fix that at the wire-protocol
 * level from the frontend, so this scans the rendered text for
 * component-JSON-shaped blocks and removes them before display.
 *
 * Three shapes are recognized: the real catalog shape
 * (`{"id": ..., "component": "KPICard", ...}`), an ad-hoc shape the
 * model sometimes fabricates instead of actually calling the tool
 * (`{"type": "KPICard", "data": {...}}` or similar), and the forced
 * tool-call's own argument shape (`{"intent": "create", ...}` - see
 * agent.py's force_dashboard_call) which leaks the same way: any nested
 * model call's token stream (including this isolated forcing call)
 * surfaces as the same TEXT_MESSAGE_CONTENT events as the outer agent's
 * reply, with no way to distinguish them at the wire-protocol level.
 */
export function stripLeakedComponentJson(text: string): string {
  let result = "";
  let i = 0;
  // Matched on the KEY only (not requiring the value or its closing
  // quote) so a still-streaming, not-yet-complete token is caught
  // immediately rather than flashing on screen until a later delta
  // happens to finish closing the string. "component"/"type"/"intent"
  // are distinctive enough keys that this rarely false-positives on
  // legitimate prose.
  const leakedKeyRe = /"(?:component|type|intent)"\s*:/;

  while (i < text.length) {
    if (text[i] === "{") {
      const lookahead = text.slice(i, i + 300);
      const looksLikeComponent =
        leakedKeyRe.test(lookahead) || /"id"\s*:\s*"root"/.test(lookahead);

      if (looksLikeComponent) {
        let depth = 0;
        let j = i;
        for (; j < text.length; j++) {
          if (text[j] === "{") depth++;
          else if (text[j] === "}") {
            depth--;
            if (depth === 0) {
              j++;
              break;
            }
          }
        }
        // depth !== 0 means the block hasn't fully streamed in yet -
        // suppress the remainder until it closes on a later delta.
        i = j;
        continue;
      }
    }
    result += text[i];
    i++;
  }

  result = result
    .replace(/```json\s*```/g, "")
    .replace(/```\s*```/g, "")
    // A heading like "### Dashboard" or "**Dashboard**" that introduced
    // a now-stripped block, left dangling with nothing under it.
    .replace(/(^|\n)\s*#{1,6}\s*Dashboard\s*$/gim, "")
    .replace(/(^|\n)\s*\*\*Dashboard\*\*:?\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return stripRecordListing(stripDownloadLinkLines(truncateDuplicateSummary(result)));
}

/**
 * Despite an explicit system-prompt rule against it, the model
 * sometimes still spells out individual vulnerability records in text
 * (a markdown table, a numbered list, a per-record "Vulnerability ID:
 * ... Hostname: ..." breakdown, often grouped under per-OS/per-app
 * headers) - especially when the user explicitly asks to "list them
 * out", which the model tends to treat as overriding the system
 * prompt. That data belongs exclusively in the results table that
 * renders automatically below the text. Truncate everything from the
 * first sign of a per-record dump onward, then walk back over any
 * now-dangling heading/group-label lines left with nothing under them.
 */
function stripRecordListing(text: string): string {
  const marker = /Vulnerability ID\s*:|VULN-\d{4,}/i;
  const lines = text.split("\n");
  const idx = lines.findIndex((line) => marker.test(line));
  if (idx === -1) return text;

  let cut = idx;
  const isDanglingHeading = (line: string) =>
    /^\s*$/.test(line) || // blank
    /^\s*#{1,6}\s*.*$/.test(line) || // markdown heading
    /^\s*[-*]?\s*\*\*[^*]+\*\*:?\s*$/.test(line) || // bold-only line, e.g. "- **Windows Server 2019**"
    /^\s*\d+\.\s*\*\*[^*]+\*\*:?\s*$/.test(line) || // numbered bold-only line
    /^[A-Za-z][^:]*:\s*$/.test(line); // plain "Some Heading:" line
  while (cut > 0 && isDanglingHeading(lines[cut - 1])) {
    cut--;
  }

  return lines.slice(0, cut).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Despite the system prompt forbidding it, the model occasionally still
 * writes a sentence like "you can download the results [here](...)"
 * duplicating the dashboard's own DownloadCard widget. Drop any line
 * containing a markdown link to the export endpoint.
 */
function stripDownloadLinkLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/\[[^\]]*\]\([^)]*\/downloads\/[^)]*\.csv\)/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * When generate_a2ui fails, the model sometimes restates its entire
 * Executive Summary/Insights/Filters & Download text a second time
 * (plus a short "the dashboard failed" apology) instead of ending its
 * turn silently, despite an explicit instruction not to. Deterministic
 * fix: if "Executive Summary" appears twice, keep only the first
 * occurrence - the content is identical either way, so nothing is lost.
 */
function truncateDuplicateSummary(text: string): string {
  const marker = "Executive Summary";
  const first = text.indexOf(marker);
  if (first === -1) return text;
  const second = text.indexOf(marker, first + marker.length);
  if (second === -1) return text;

  // Trim back past whatever transition sentence ("Now I'll generate the
  // dashboard...failed...") precedes the duplicate.
  return text.slice(0, second).trimEnd().replace(/[^\n]*$/, "").trim();
}
