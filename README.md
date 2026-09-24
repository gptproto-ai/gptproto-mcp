# GPTProto MCP

An open-source local MCP server that gives compatible AI hosts tools for GPTProto
model discovery, live pricing, documented native API requests, custom generation,
and asynchronous task polling. It connects directly to GPTProto's public APIs,
contains no private service code, and embeds no model catalog.

Its public API behavior mirrors GPTProto CLI: the same method, path, native JSON,
multipart fields, headers, query parameters, provider/model normalization, result
extraction, contract-review gate, and asynchronous task semantics are exposed as
MCP tool inputs. The MCP does not execute or depend on the CLI package.

```text
AI host -> GPTProto MCP -> GPTProto public API
```

## Prerequisites

Get an API key at https://gptproto.com/?s=gh_gptproto_mcp.

Never paste a real API key into an AI chat. Configure the MCP in your own
terminal. Store it in the MCP's protected configuration file using hidden
terminal input, so the value is not written into shell history:

```bash
mkdir -p ~/.config/gptproto-mcp
chmod 700 ~/.config/gptproto-mcp
printf 'GPTProto API Key: '
IFS= read -r -s GPTPROTO_MCP_KEY
printf '\n'
printf '%s\n' "$GPTPROTO_MCP_KEY" > ~/.config/gptproto-mcp/key
unset GPTPROTO_MCP_KEY
chmod 600 ~/.config/gptproto-mcp/key
```

Managed environments may instead inject `GPTPROTO_API_KEY` directly into the
MCP process without storing it in a chat or checked-in configuration file.

The default API origin is `https://gptproto.com`. A managed environment may set
`GPTPROTO_API_BASE_URL`, or store a custom origin in
`~/.config/gptproto-mcp/base-url`.

## Install from npm

The server is published to npm as `@gptproto-ai/mcp`:

```bash
npm install -g @gptproto-ai/mcp
gptproto-mcp
```

For a one-off run without a global installation, use `npx --yes @gptproto-ai/mcp`.

## Install from GitHub

The repository includes the reviewed build output so installation from GitHub
does not depend on development-only compiler packages. You can verify the
server locally with:

```bash
npm install -g https://github.com/gptproto-ai/gptproto-mcp/archive/refs/heads/main.tar.gz
gptproto-mcp
```

The second command starts a `stdio` MCP server and waits for an MCP host. It is
normal for it to print nothing when launched by itself. Press `Ctrl+C` to stop
it. For a one-off run without a global installation, use:

```bash
npx --yes --package=github:gptproto-ai/gptproto-mcp gptproto-mcp
```

## Configure an MCP host

```json
{
  "mcpServers": {
    "gptproto": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=github:gptproto-ai/gptproto-mcp",
        "gptproto-mcp"
      ]
    }
  }
}
```

This is a local `stdio` MCP server for hosts such as Codex, Claude Desktop,
Claude Code, Cursor, and VS Code. Cloud-only chat products that cannot launch a
local process need a separately deployed Streamable HTTP MCP service and
per-user authentication.

On Windows, `npx` needs a shell wrapper. Use `"command": "cmd"` with
`"args": ["/c", "npx", "--yes", "@gptproto-ai/mcp"]`.

## Tools

| Tool | Purpose |
| --- | --- |
| `gptproto_status` | Check configuration without exposing the API key |
| `gptproto_models_list` | List live models by broad capability |
| `gptproto_model_describe` | Read one model's live paths, native parameters, enums, and polling contract |
| `gptproto_pricing` | Query one model, search the full public price catalog, or sort a capability by starting price |
| `gptproto_request` | Call a documented official-compatible or GPTProto route |
| `gptproto_custom_create` | Submit GPTProto image, video, audio, 3D, or utility tasks |
| `gptproto_tasks_list` | Recover recent local asynchronous task IDs after an interrupted call |
| `gptproto_task_get` | Read an existing task |
| `gptproto_task_wait` | Poll an existing task without resubmitting it |

The first release exposes the current GPTProto public API capabilities:

| Capability | MCP tool |
| --- | --- |
| Configuration check | `gptproto_status` |
| Model list | `gptproto_models_list` |
| Model parameters and interface description | `gptproto_model_describe` |
| Live pricing | `gptproto_pricing` |
| Native documented request | `gptproto_request` |
| Custom task creation | `gptproto_custom_create` |
| Task recovery, query, and polling | `gptproto_tasks_list`, `gptproto_task_get`, `gptproto_task_wait` |

Credential writes remain local terminal operations; MCP tools never accept or
return an API key and never update installed software.

The intended workflow is:

```text
models_list -> pricing (when cost matters) -> model_describe
            -> request/custom_create
            -> MCP saves task_id, polls internally, returns final result
```

`gptproto_request` is the MCP equivalent of `gptproto request`. Pass the native
request object as `body`, multipart values as `form` and `files`, and any
documented `headers` or `query` values unchanged. Repeated form and query values
can be passed as string arrays. Official-compatible `model` fields lose the
provider prefix; GPTProto custom routes retain `provider/model`, exactly as in
the CLI.

Normal output also follows the CLI: text interfaces return extracted text,
media interfaces return final URLs, audio or image binary responses use native
MCP content blocks, and other interfaces return their original JSON. Set
`output_json: true` to bypass extraction. When `stream: true`, the MCP consumes
the native SSE response and returns the assembled final text because an MCP tool
call has one final result rather than terminal-style token output.

For asynchronous creation, the MCP saves the returned `task_id` locally before
it starts polling. The MCP then owns the polling loop for up to 600 seconds and
returns the final extracted text or media URLs; neither the user nor the AI host
has to issue repeated status checks. The final structured result also includes
the exact `task_id`. When the MCP host requests standard progress notifications,
the server sends the task ID and status on every poll; compatible hosts can use
those heartbeats to keep a long-running tool call alive.

The default polling cadence becomes faster as the task ages: every 10 seconds
for the first minute, every 8 seconds from one to three minutes, and every 5
seconds after three minutes until the 600-second limit. A terminal result is
returned immediately after the poll that observes it. Progress notifications
follow the same cadence, avoiding noisy two-second status updates.

If the creation response is interrupted before the host receives the ID,
`gptproto_tasks_list` can recover recent tasks by model, resource, label, time,
and status. The protected local registry is
`~/.config/gptproto-mcp/tasks.json`; it stores no API key, prompt, complete
request body, or uploaded file content. Because standard MCP calls do not carry
a portable conversation ID, this registry is a recovery mechanism rather than
a guaranteed conversation-to-task mapping. Never resubmit a generation merely
because the current conversation lost the ID.

If an MCP host disconnects before the automatic wait returns, the task ID and
latest observed status remain in the local registry. `gptproto_task_get` performs
one recovery check, while `gptproto_task_wait` resumes MCP-owned polling for up
to 600 seconds. Neither recovery tool resubmits the billable generation.

The default timeout for each outbound GPTProto HTTP request is 600 seconds.
`GPTPROTO_TIMEOUT_MS` can be set by managed deployments when a different value
is required.

Pricing is read at call time from GPTProto's public model catalog. It is not
bundled into the MCP package, so price changes do not require an MCP update.
Use the pricing tool's `mode` field when a broad capability is not specific
enough, for example `text-to-image`, `image-to-video`, or `image-edit`.

Model pricing is selection metadata. The MCP still calls
`gptproto_model_describe` before a generation because catalog presence does not
guarantee route compatibility or account channel availability. Prices with
different billing units are not directly comparable.

## Safety boundaries

- API keys are read from MCP-specific configuration and are never returned by
  an MCP tool.
- Custom API origins are not returned by status or error tools.
- Requests are limited to relative routes in the public MCP route manifest;
  arbitrary origins and unlisted routes are rejected.
- Polling URLs must remain on the configured GPTProto origin.
- Generation can incur charges. Agents are instructed not to retry a failed
  generation or switch models without user approval.
- Asynchronous task IDs are persisted before automatic polling. Task recovery
  metadata is kept in a mode-`600` local file and excludes prompts and complete
  request bodies.
- Local file uploads are disabled by default. The user must both select the file
  explicitly and enable `GPTPROTO_MCP_ALLOW_FILE_UPLOADS=true` for the MCP
  process.
- Original provider JSON is opt-in through `output_json`; normal results return
  extracted text or media URLs.

## FAQ

### Which MCP hosts can run this server?

Any host that can launch a local `stdio` process: Claude Desktop, Claude Code,
Codex, Cursor, VS Code, and Windsurf. Cloud-only chat products that cannot run a
local process need a separately deployed Streamable HTTP service with per-user
authentication.

### Does the server bundle model prices?

No. Pricing is read from GPTProto's public model catalog at call time, so a
price change never requires an MCP update. A standalone, machine-readable
snapshot of the same catalog lives in
[llm-api-pricing](https://github.com/gptprototeam-star/llm-api-pricing).

### What does it cost?

The server is MIT-licensed and free to run. Model calls are billed by GPTProto
at the rates the pricing tool returns.

## Development

```bash
npm install
npm test
npm pack --dry-run
```

## License

MIT

---

Maintained by [gptproto](https://gptproto.com/?s=gh_gptproto_mcp)
