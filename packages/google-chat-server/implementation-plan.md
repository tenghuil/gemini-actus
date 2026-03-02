# Objective

Refactor the Google Chat Server and local gateway architecture to use a Cloud
Run Service, Pub/Sub, and Firestore instead of long-lived WebSockets. The Cloud
Run service will act as a stateless switchboard routing messages to
user-specific Pub/Sub subscriptions, enabling a more robust, scalable, and
secure pairing experience.

## Setup Process

**For the Developer:**

1. The developer runs the `scripts/deploy.sh` script to create the
   `chat-ingress` and `chat-egress` Pub/Sub topics, deploy the Express app to a
   Cloud Run service (`google-chat-server`), and configure a Pub/Sub Push
   Subscription on `chat-egress` that triggers the service's `/egress` endpoint.
2. The developer configures a Google Chat Bot in Google Workspace to point to
   the `/webhook` URL of the newly deployed Cloud Run service.
3. The developer shares the Register URL (`<CLOUD_RUN_URL>/register`) with their
   users.

**For the User:**

1. The user installs the `gemini-actus` CLI.
2. The user authenticates with their own Google account using
   `gcloud auth login`.
3. The user runs the setup command:
   `gemini-actus chat connect --server <DEVELOPER_REGISTER_URL> --project <DEVELOPER_PROJECT_ID>`.
4. Behind the scenes, the CLI fetches an ID token for the user and calls the
   `/register` endpoint on the developer's server.
5. The developer's server automatically provisions a unique Pub/Sub subscription
   for that user and grants their Google account IAM access to read from it and
   write to the egress topic.

## Pairing Process

1. Once the user has run the setup command, their email is recorded as "paired"
   in the developer's Firestore database.
2. When the user sends a message to the bot in Google Chat, the `/webhook`
   endpoint receives the message and identifies the sender's email.
3. The server checks Firestore. If the user is paired, it routes the message to
   the `chat-ingress` topic with a custom attribute
   `target_user_email=<user-email>`.
4. The user's local agent, which is listening to its uniquely filtered Pub/Sub
   subscription, receives the message, processes it, and publishes the reply to
   the `chat-egress` topic.
5. A Pub/Sub Push Subscription triggers the `/egress` endpoint on the Cloud Run
   service, which forwards the reply back to the specific Google Chat thread
   using the Chat API.

## Security & Tenant Isolation (Ensuring User A cannot see User B's messages)

To guarantee message privacy between users:

1. **Unique Subscriptions with Filters:** During registration, a unique Pub/Sub
   subscription is created for the user (e.g., `chat-ingress-sub-userA`). This
   subscription is created with a strict Pub/Sub filter:
   `attributes.target_user_email = "userA@email.com"`.
2. **Subscription-Level IAM:** The IAM policy for this specific subscription is
   modified to grant `roles/pubsub.subscriber` _only_ to `user:userA@email.com`.
   Users are NOT granted subscriber access at the topic level.
3. **Ingress Filtering:** Since the `/webhook` endpoint always uses the
   authenticated Google Chat sender's email as the `target_user_email` attribute
   when publishing to the shared `chat-ingress` topic, Pub/Sub's server-side
   filtering ensures that User A's subscription only ever receives User A's
   messages.
4. **Egress Isolation:** For replies, local agents publish to a shared
   `chat-egress` topic. The `/egress` endpoint uses the Google Chat API (via the
   bot's credentials) to reply back to the exact thread the message originated
   from, which is inherently tied to the sender in Google Chat.

# Key Files

- `packages/google-chat-server/package.json`: Updated to use `express`,
  `@google-cloud/pubsub`, `@google-cloud/firestore`.
- `packages/google-chat-server/src/index.ts`: The main Express application
  exposing `/webhook`, `/register`, and `/egress` endpoints.
- `packages/google-chat-server/src/firestore.ts`: Utility for reading/writing
  agent pairing status in Firestore.
- `packages/google-chat-server/src/pubsub.ts`: Utility for managing Pub/Sub
  topics and IAM bindings for users.
- `packages/google-chat-server/scripts/deploy.sh`: Script to deploy the Cloud
  Run service, create Pub/Sub topics, and configure the Push Subscription.
- `packages/cli/src/commands/connectChat.ts`: CLI command to authenticate the
  user, register them on the developer server, and start the local Gateway
  Client.
- `packages/google-chat-gateway/src/client.ts`: Pub/Sub client that listens to
  the uniquely filtered subscription and publishes replies to the egress topic.
