#!/bin/bash
# @license
# Copyright 2025 Google LLC
# SPDX-License-Identifier: Apache-2.0

set -e

# Configuration
read -p "Enter your Google Cloud Project ID (default: $(gcloud config get-value project 2>/dev/null)): " INPUT_PROJECT_ID
PROJECT_ID=${INPUT_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}

if [ -z "$PROJECT_ID" ]; then
    echo "Error: Google Cloud Project ID is required."
    exit 1
fi

read -p "Enter your Google Cloud Region (default: us-central1): " INPUT_REGION
REGION=${INPUT_REGION:-us-central1}

echo "Google Chat Server Deployment Script"
echo "Deploying to project: $PROJECT_ID in region: $REGION"

gcloud config set project "$PROJECT_ID" > /dev/null 2>&1

# 1. Create Pub/Sub Topics if they don't exist
echo "Creating Pub/Sub topics..."
gcloud pubsub topics create chat-ingress || true
gcloud pubsub topics create chat-egress || true

# 2. Deploy Cloud Run Service
echo "Deploying Google Chat Server to Cloud Run..."
gcloud run deploy google-chat-server \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=$PROJECT_ID

# 3. Get the URL
SERVICE_URL=$(gcloud run services describe google-chat-server --region $REGION --format 'value(status.url)')

echo "Service URL: $SERVICE_URL"

# 4. Create Pub/Sub Push Subscription for Egress
echo "Creating/Updating Pub/Sub Push Subscription for Egress..."
gcloud pubsub subscriptions create chat-egress-push-sub \
  --topic chat-egress \
  --push-endpoint "$SERVICE_URL/egress" || \
gcloud pubsub subscriptions modify-push-config chat-egress-push-sub \
  --push-endpoint "$SERVICE_URL/egress"

echo "Deployment complete!"
echo "Note: Ensure your Cloud Run Service Account has permissions for Pub/Sub and Firestore."
echo "Register Endpoint URL: $SERVICE_URL/register"
echo "Webhook URL (for Google Chat API): $SERVICE_URL/webhook"
