#!/bin/bash
# Copyright 2026 Google LLC
# SPDX-License-Identifier: Apache-2.0

set -e

# --- 1. Environment Validation ---
command -v node >/dev/null 2>&1 || { echo >&2 "Error: node is required but it's not installed. Aborting."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo >&2 "Error: npm is required but it's not installed. Aborting."; exit 1; }
command -v gcloud >/dev/null 2>&1 || { echo >&2 "Error: gcloud CLI is required for authentication but it's not installed. Aborting."; exit 1; }

# --- 2. Argument Parsing ---
SERVER=""
PROJECT=""

print_usage() {
  echo "Usage: $0 [options]"
  echo "Options:"
  echo "  --server <URL>     The URL of the Google Chat Cloud Function (register endpoint)"
  echo "  --project <ID>     The Developer GCP Project ID"
  echo "  --help             Display this help message"
  exit 0
}

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --server) SERVER="$2"; shift ;;
    --project) PROJECT="$2"; shift ;;
    --help|-h) print_usage ;;
    *) echo "Unknown parameter passed: $1"; exit 1 ;;
  esac
  shift
done

# --- 3. Interactive Prompts ---
if [ -z "$SERVER" ]; then
  read -p "Please enter your Server URL (DEVELOPER_REGISTER_URL): " SERVER
fi

if [ -z "$PROJECT" ]; then
  # Try to infer default project
  DEFAULT_PROJECT=$(gcloud config get-value project 2>/dev/null)
  if [ -n "$DEFAULT_PROJECT" ] && [ "$DEFAULT_PROJECT" != "(unset)" ]; then
    read -p "Please enter your Developer GCP Project ID [$DEFAULT_PROJECT]: " PROJECT
    PROJECT=${PROJECT:-$DEFAULT_PROJECT}
  else
    read -p "Please enter your Developer GCP Project ID: " PROJECT
  fi
fi

if [ -z "$SERVER" ] || [ -z "$PROJECT" ]; then
  echo "Error: Both Server URL and Project ID are required."
  exit 1
fi

echo "====================================="
echo "Configuration Setup:"
echo "Server:  $SERVER"
echo "Project: $PROJECT"
echo "====================================="

# --- 4. Google Cloud Auth Validation ---
echo "Checking Google Cloud authentication..."
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  echo "Application Default Credentials not found or invalid."
  echo "Running 'gcloud auth application-default login' to authenticate..."
  gcloud auth application-default login
else
  echo "Google Cloud authentication verified."
fi

# --- 5. Build Process ---
echo "Installing dependencies..."
npm install --silent

echo "Building project..."
npm run build

# --- 6. Run Local Agent ---
echo "Starting local agent..."
# Run the compiled JS directly to avoid environment conflicts with dev scripts
node packages/cli/dist/index.js connect-chat --server "$SERVER" --project "$PROJECT"
