# Security

Report security issues privately to the maintainers through GitHub's security
advisory workflow. Do not open a public issue containing API keys, request
headers, private URLs, account data, or generated signed URLs.

The MCP server never exposes the stored GPTProto API key. MCP credentials are
kept separately under `~/.config/gptproto-mcp` or supplied through the MCP
process environment. It accepts only
relative paths present in the reviewed GPTProto client contract and rejects
cross-origin polling URLs. Raw provider responses are opt-in, and local files
are blocked unless the user explicitly enables `GPTPROTO_MCP_ALLOW_FILE_UPLOADS`
for the MCP process. Error tools do not return complete upstream error bodies by
default.

Asynchronous task recovery metadata is stored locally in
`~/.config/gptproto-mcp/tasks.json` with mode `600`. It may contain task IDs,
model IDs, caller-supplied labels, timestamps, statuses, polling paths, and
completed result URLs. It does not store API keys, prompts, complete request
bodies, headers, or uploaded file content.
