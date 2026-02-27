#!/bin/bash
# Copyright 2026 Google LLC
# SPDX-License-Identifier: Apache-2.0

set -e

echo "Starting Google Chat App configuration..."

# 1. Get current project
PROJECT_ID=$1
if [ -z "$PROJECT_ID" ]; then
  DETECTED_PROJECT=$(gcloud config get-value project 2>/dev/null)
  
  if [ -n "$DETECTED_PROJECT" ] && [ "$DETECTED_PROJECT" != "(unset)" ]; then
    read -p "Detected Google Cloud Project: $DETECTED_PROJECT. Do you want to use this project? [Y/n]: " CONFIRM_PROJECT
    if [[ "$CONFIRM_PROJECT" =~ ^[Nn] ]]; then
      read -p "Please enter your Google Cloud Project ID: " PROJECT_ID
    else
      PROJECT_ID=$DETECTED_PROJECT
    fi
  fi
fi

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" == "(unset)" ]; then
  echo "No default Google Cloud project found."
  read -p "Please enter your Google Cloud Project ID: " PROJECT_ID
fi

if [ -z "$PROJECT_ID" ]; then
  echo "Error: Project ID is required."
  exit 1
fi

# Set the project for subsequent gcloud commands
gcloud config set project "$PROJECT_ID" >/dev/null 2>&1
echo "Using project: $PROJECT_ID"

# 2. Enable necessary APIs
echo "Enabling Google Chat API and Cloud Pub/Sub API..."
gcloud services enable chat.googleapis.com pubsub.googleapis.com
echo "APIs enabled successfully."

# 3. Create Pub/Sub topic
TOPIC_NAME="gemini-actus-claw"
echo "Creating Pub/Sub topic: $TOPIC_NAME..."
# Check if topic already exists to avoid errors on re-runs
if gcloud pubsub topics describe "$TOPIC_NAME" &> /dev/null; then
  echo "Topic $TOPIC_NAME already exists."
else
  gcloud pubsub topics create "$TOPIC_NAME"
  echo "Topic created."
fi

# 4. Grant IAM permission
echo "Granting pubsub.publisher role to chat-api-push@system.gserviceaccount.com..."
gcloud pubsub topics add-iam-policy-binding "$TOPIC_NAME" \
  --member="serviceAccount:chat-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

echo ""
echo "========================================="
echo "Configuration complete!"
echo "Topic name: projects/$PROJECT_ID/topics/$TOPIC_NAME"
echo "========================================="
echo ""
echo "Configure the Chat app for Pub/Sub:"
echo "1. Go to Google Chat API Configuration: https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat?project=$PROJECT_ID"
echo ""
echo -e "\033[1;31m‼️ CRITICAL: Clear 'Build this Chat app as a Google Workspace add-on'. A dialog opens asking you to confirm. In the dialog, click 'Disable'.\033[0m"
echo ""
echo "2. In 'App name', enter 'Quickstart App'."
echo "3. In 'Avatar URL', enter 'https://developers.google.com/chat/images/quickstart-app-avatar.png'."
echo "4. In 'Description', enter 'Quickstart app'."
echo "5. Under 'Functionality', select 'Join spaces and group conversations'."
echo "6. Under 'Connection settings', select 'Cloud Pub/Sub' and paste the name of the Pub/Sub topic to be:"
echo "   projects/$PROJECT_ID/topics/$TOPIC_NAME"
echo "7. Under 'Visibility', select 'Make this Google Chat app available to specific people and groups in your domain' and enter your email address."
echo "8. Under 'Logs', select 'Log errors to Logging'."
echo "9. Click 'Save'."
