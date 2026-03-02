# Google Chat Server

This package implements the Cloud Run service and Pub/Sub architecture that acts
as the "Switchboard" between Google Chat and local Gemini Actus agents.

## Architecture

1.  **Cloud Run Service** (`packages/google-chat-server`):
    - `webhook` (`/webhook`): Receives HTTP Webhooks from Google Chat. Validates
      the user in Firestore and publishes messages to the `chat-ingress` Pub/Sub
      topic.
    - `register` (`/register`): Receives an authenticated registration request
      from the CLI. It creates a uniquely filtered Pub/Sub subscription for the
      user, grants them IAM access, and marks them as paired in Firestore.
    - `egress` (`/egress`): An HTTP endpoint triggered by a Pub/Sub Push
      Subscription on the `chat-egress` topic. It receives replies from the
      local agents and posts them back to Google Chat.

2.  **Local Gateway** (part of `packages/cli`):
    - Runs on the user's machine via `gemini-actus connect-chat`.
    - Authenticates the user and calls the `/register` endpoint on the Cloud Run
      service.
    - Starts a Pub/Sub client listening to their unique pull subscription.
    - Starts an in-process Agent Server (`@google/gemini-actus-a2a-server`) to
      execute tasks.

## Deployment to Google Cloud

Prerequisites:

- Google Cloud Project with Cloud Run, Pub/Sub, and Firestore APIs enabled.
- `gcloud` CLI installed and authenticated as the developer.

### 1. Initialize Firestore Database

The server uses Firestore to persist user pairing statuses. If your GCP project
does not already have a default Firestore database, create one:

```bash
gcloud firestore databases create --project=$PROJECT_ID --location=us-central1 --type=firestore-native
```

### 2. Deploy Script

We have provided a deployment script that will automatically create the Pub/Sub
topics, deploy the Cloud Run service, and configure the Push Subscription for
egress. Run this script from the `packages/google-chat-server` directory:

```bash
./scripts/deploy.sh
```

The script will prompt you for your `Project ID` and `Region`. It will output
the `Register Endpoint URL` and `Webhook URL` at the end. Share the Register URL
with your users and configure your Google Chat Bot with the Webhook URL.

### 3. Required IAM Permissions for Cloud Run

By default, Cloud Run uses the Compute Engine default service account. For the
server to correctly provision resources and route messages, its service account
**must** have the following IAM roles in your GCP project:

- **Pub/Sub Admin (`roles/pubsub.admin`)**: Required to create subscriptions and
  modify IAM policies for new users during `/register`.
- **Cloud Datastore User (`roles/datastore.user`)**: Required to read/write
  pairing status to Firestore.

If your project restricts public Cloud Run invocations, you must also explicitly
grant the **Google Chat API** permission to invoke your webhook.

To grant all these permissions, you can run:

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Grant Pub/Sub Admin and Datastore User to the Cloud Run service account
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/pubsub.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/datastore.user"

# Allow the Google Chat API to invoke the Cloud Run Webhook
gcloud run services add-iam-policy-binding google-chat-server \
  --region us-central1 \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-gsuiteaddons.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

### 4. Configuring the Google Chat API

1. Open the [Google Cloud Console](https://console.cloud.google.com).
2. Ensure you are in the correct Project (`$PROJECT_ID`).
3. Search for **"Google Chat API"** and click **Enable**.
4. Once enabled, click **Manage** -> **Configuration**.
5. Under **App Information**:
   - Provide an **App name** (e.g., "Gemini Actus Agent").
   - Provide an **Avatar URL** (any image URL).
   - Provide a **Description**.
6. Under **Interactive features**:
   - Check **Receive 1:1 messages** and **Join spaces and group conversations**.
   - Under **Connection settings**, select **App URL**.
   - Paste the **Webhook URL** returned by the deploy script into the App URL
     field (e.g., `https://google-chat-server-...run.app/webhook`).
7. Under **Visibility**:
   - Make the application available to specific people or your entire workspace,
     as needed.
8. Click **Save**.

Your Google Chat bot is now live and waiting for webhooks.

## Running the Local Agent & Pairing

To pair your local agent with the Google Chat bot, you don't need to request a
pairing code manually. Instead, the CLI automatically registers your Google
Identity with the server.

1.  **Authenticate**: Ensure you are logged into Google Cloud locally with the
    exact Google Account you will use to send messages in Google Chat:

    ```bash
    gcloud auth login
    ```

2.  **Connect & Register**: Run the command in your terminal using the
    Developer's Project ID and Register URL:

    ```bash
    # If running from source
    node packages/cli/dist/index.js connect-chat --server <DEVELOPER_REGISTER_URL> --project <DEVELOPER_PROJECT_ID>

    # If installed globally
    gemini-actus connect-chat --server <DEVELOPER_REGISTER_URL> --project <DEVELOPER_PROJECT_ID>
    ```

    _What happens here:_ The CLI fetches your ID token and calls the `/register`
    endpoint on the Cloud Run server. The server automatically provisions a
    uniquely filtered Pub/Sub subscription for your email address, grants your
    account IAM access to it, and marks you as "paired" in its Firestore
    database.

3.  **Start Chatting**:
    - Open Google Chat and find the bot you configured.
    - Send it a message. The `webhook` endpoint will identify your email, check
      Firestore to confirm you are paired, and instantly route the message to
      your uniquely filtered Pub/Sub subscription.
    - Your local agent will receive the message securely, process it, and reply
      back to the chat thread.

## Tenant Isolation & Security

This architecture uses Pub/Sub server-side filtering to guarantee message
isolation between users.

- Each user gets their own subscription (e.g., `chat-ingress-sub-userA`).
- The subscription is created with a filter:
  `attributes.target_user_email = "userA@email.com"`.
- The webhook guarantees the `target_user_email` attribute matches the Google
  Chat sender.
- IAM permissions are applied at the subscription level, meaning `userA` can
  only read from their own subscription and cannot read other users' messages on
  the `chat-ingress` topic.

## Troubleshooting

### Authentication Failed

Ensure the user running `gemini-actus connect-chat` is authenticated with
`gcloud auth login` and that their Google Identity can generate a valid ID
token.

### Cannot Receive Messages

- Verify the user's email is correctly logged as `paired: true` in Firestore
  under the `agents` collection.
- Verify the user's Pub/Sub subscription exists in the Developer GCP project and
  has the correct `attributes.target_user_email` filter.
- Ensure the user's account has the `roles/pubsub.subscriber` role on their
  specific subscription.

### Egress Fails

The `egress` Cloud Function uses the Google Chat API to reply. Ensure the Cloud
Function's service account has the necessary permissions (e.g.,
`roles/chat.bot`) or scopes to post messages back to the space.
