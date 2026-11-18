# Extension Store

Extension Store backend for dynamic module management. Downloads ALL modules from the Modules repository at startup, serves them via API, and checks for changes every minute.

## How It Works

1. **Startup**: Clones the entire Modules repo (`git clone`) to `/tmp/ExtensionStoreCache/modules-repo` — ALL modules are downloaded locally
2. **Display**: Serves module list via REST API from the locally cached repo
3. **Periodic Sync**: Every 60 seconds, fetches changes from the remote repo (`git fetch` + `git reset --hard`) and detects new/removed/updated modules

## Features

- **Pre-download All Modules**: Full repo cloned at startup so every module is immediately available
- **Auto Refresh**: Checks repo every minute for new, changed, or removed modules
- **Module Download**: Download individual modules as ZIP archives
- **Change Detection**: `/modules/check` reports exactly which modules are new or removed
- **Git-based Sync**: Uses `git fetch` + `git reset` for reliable, atomic repo updates

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/modules` | List all available modules |
| GET | `/modules/:id` | Get module details |
| POST | `/modules/:id/download` | Download module as ZIP |
| GET | `/modules/check` | Check for new/changed modules |
| GET | `/health` | Health check |

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3333` | Server port |
| `CHECK_INTERVAL` | `60000` | Milliseconds between repo checks |

## Setup

```bash
cd extension-store
npm install
npm start
```

## Usage

```bash
# List all modules
curl http://localhost:3333/modules

# Get module details
curl http://localhost:3333/modules/my-module

# Download a module
curl -X POST http://localhost:3333/modules/my-module/download

# Check for new modules
curl http://localhost:3333/modules/check
```

## Module Source

Modules are sourced from:
`https://forgejo.tail233080.ts.net/Nico_and_Luna_Swiss_GmbH/Modules.git`

The repo is cloned to `/tmp/ExtensionStoreCache/modules-repo` and all modules live under the `modules/` subdirectory.