# Google Chat Server

This package implements the Cloud Run service that acts as the "Switchboard"
between Google Chat and local Gemini Actus agents.

## Architecture

1.  **Cloud Run Server** (`packages/google-chat-server`):
    - Receives HTTP Webhooks from Google Chat (`/webhook`).
    - Hosting a WebSocket server for local agents to connect.
    - Manages pairing codes and routing messages between Chat and Local Agents.
    - Protected by Cloud Run IAM (requires `Authorization: Bearer ID_TOKEN` for
      WebSocket handshake).

2.  **Local Gateway** (part of `packages/cli`):
    - Runs on the user's machine via `gemini-actus connect-chat`.
    - Connects to the Cloud Run WebSocket.
    - Starts an in-process Agent Server (`@google/gemini-actus-a2a-server`) to
      execute tasks.

## Deployment to Cloud Run

Prerequisites:

- Google Cloud Project with Cloud Run API enabled.
- `gcloud` CLI installed and authenticated.

### 1. Build the Package

From the monorepo root:

```bash
npm run build --workspace=@google/gemini-actus-chat-server
```

### 2. Deploy

Deploy the service using `gcloud`. Note that we allow unauthenticated
invocations for the HTTP webhook (Google Chat needs to reach it), but the
WebSocket endpoint enforces IAM via the application logic if needed (currently
relies on `roles/run.invoker` if you lock it down, but for public Chat bots,
"Allow unauthenticated" is often required for the webhook).

_Note: In this specific implementation, we used `--allow-unauthenticated` to
ensure Google Chat can hit the webhook, but the WebSocket client in the CLI is
configured to send an OIDC token to support authenticated scenarios if you
choose to enable IAM._

```bash
gcloud run deploy gemini-chat-server \
  --source packages/google-chat-server \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=your-project-id
```

## Running the Local Agent

To pair your local agent with the Google Chat bot:

1.  **Initiate Pairing**:
    - Send `/pair` to the Google Chat bot.
    - It will reply with a command: `Run gemini-actus connect-chat <code>`.

2.  **Connect**:
    - Run the command in your terminal:

      ```bash
      # If running from source
      node packages/cli/dist/index.js connect-chat <code> --server <YOUR_CLOUD_RUN_URL>

      # If installed globally
      gemini-actus connect-chat <code> --server <YOUR_CLOUD_RUN_URL>
      ```

3.  **Usage**:
    - Send messages to the bot in Google Chat.
    - The local agent will process them and reply.

## Troubleshooting

### WebSocket 403 Forbidden

If the CLI fails to connect with "Unexpected server response: 403":

- Ensure your user account has `roles/run.invoker` on the Cloud Run service.
- The CLI attempts to fetch an OIDC ID token automatically. If it fails, it
  falls back to `gcloud auth print-identity-token`.
- Run `gcloud auth login` to ensure you present valid credentials.

### Agent Connection Refused

If the bot says "Error communicating with Agent" or logs `ECONNREFUSED`:

- The CLI is responsible for starting the local A2A agent server.
- Ensure `packages/cli` has been built with the
  `@google/gemini-actus-a2a-server` dependency.
- The `connect-chat` command should log "Agent Server running on port ...".

### "Command not found"

If `gemini-actus` is not found, ensuring you have run `npm run build` in
`packages/cli` and `npm link` (or use the full path to `dist/index.js`).
