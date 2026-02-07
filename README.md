# Gemini Actus

## 🚀 Quick Start

### 0. Prerequisites

You need **Node.js 20+** and **npm**.

- **Verify installation**:
  ```bash
  node -v && npm -v
  ```
- **Install (if missing)**:
  - **Mac/Linux**: We recommend using [nvm](https://github.com/nvm-sh/nvm):
    ```bash
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    nvm install 20
    ```
  - **Windows**: Download from [nodejs.org](https://nodejs.org/)

### 1. Setup

```bash
npm install && npm run build
```

### 2. Run

| Mode                                     | Command                      | Description                                               |
| :--------------------------------------- | :--------------------------- | :-------------------------------------------------------- |
| **Terminal with Yolo Mode(Recommended)** | `npm run start -- --yolo`    | Fully automated execution (no confirmation prompts).      |
| **Terminal**                             | `npm run start`              | Default interactive CLI mode.                             |
| **Web UI**                               | `npm run start -- web --dev` | Launches backend (port 3333) & frontend (localhost:3000). |

#### Run Separately (Development)

To run the backend and frontend independently:

1.  **Backend**: `npm run start -- web`
2.  **Frontend**: `cd packages/web && npm run dev`

### 3. Verify

Before submitting PRs, run the full validation suite:

```bash
npm run preflight
```
