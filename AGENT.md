# Agent Guide — nrzStore

This is the maintainer guide for the **nrzStore** community app store for umbrelOS. Follow it and
an app that ships from this repo installs, starts, shows an icon, and survives updates.

Everything in here is written from what actually works in this store. Where umbrelOS behaviour is
counter-intuitive, the reason is spelled out so the next change does not reintroduce the bug.

## Contents

1. [Store identity](#1-store-identity)
2. [Repo layout](#2-repo-layout)
3. [The three rules that break releases](#3-the-three-rules-that-break-releases)
4. [Adding an app](#4-adding-an-app)
5. [Icons and images](#5-icons-and-images) — read this before shipping any app
6. [umbrel-app.yml reference](#6-umbrel-appyml-reference)
7. [docker-compose.yml reference](#7-docker-composeyml-reference)
8. [Images and registries](#8-images-and-registries)
9. [Data, secrets and environment](#9-data-secrets-and-environment)
10. [Optional files](#10-optional-files)
11. [Releasing an update](#11-releasing-an-update)
12. [Preflight checklist](#12-preflight-checklist)
13. [Validation commands](#13-validation-commands)
14. [Pitfalls we already hit](#14-pitfalls-we-already-hit)
15. [Apps in this store](#15-apps-in-this-store)
16. [Credentials](#16-credentials)

## 1. Store identity

| Field | Value |
|-------|-------|
| Store ID | `nrz` |
| Store name | `nrzStore` |
| Git remote | `http://100.78.107.162:8390/nicorenezweers/nrzStore.git` |
| Operator | Nico Rene Zweers (`nicorenezweers`) |

### Two stores: public and private

The nrz apps are split over two stores that share the store ID `nrz` (umbrelOS only accepts app
IDs that start with `<store-id>-`, and the app IDs must never change):

| Store | Repo | Contains |
|-------|------|----------|
| `nrzStore` (public) | nrzGit `nicorenezweers/nrzStore`, publicly listed → `https://git.zweers.ch/nicorenezweers/nrzStore` (nrzGit mirrors listed repos to GitHub) | apps whose source repo is **publicly listed on git.zweers.ch** (the source of truth; GitHub is only a slower mirror) |
| `nrzPrivatStore` | nrzGit `nicorenezweers/nrzPrivatStore` (not on GitHub) | every other app |

The rule is public listing on git.zweers.ch: when an app's repository becomes publicly listed there, move its
directory from nrzPrivatStore to nrzStore (bump both store versions, rewrite `icon:`/`submission:`
URLs to the target store and set `"store"` in the app's `nrzStore.json`). Never move an app into the public store before its repo is public. In the public store every
`icon:`, `repo:`, `support:`, `website:`, `submission:` and gallery URL uses `https://git.zweers.ch/nicorenezweers/…`
(never the Tailscale address or GitHub). Public apps may depend on `nrz-git`,
which lives in nrzPrivatStore; umbrelOS resolves dependencies by app ID across stores.

`umbrel-app-store.yml` is three lines and every one of them matters:

```yaml
id: "nrz"
name: "nrzStore"
version: "3.8.1"
```

**`version` is the store version, not an app version.** umbrelOS compares it against the version it
has cached and only re-clones the repo when it changed. Touch anything in the repo without bumping
it and the user installs yesterday's app. Bump it in the same commit as the app change.

App IDs must start with the store ID and be lowercase kebab-case:

- ✅ `nrz-nrzdns`, `nrz-factorio`
- ❌ `sparkles-anything` (old prefix), `nrz/hello-world` (slashes break parsing), `nrzDNS`

**The directory name must equal the app ID.** umbrelOS derives `${APP_DATA_DIR}`, the container
names, the update path, and the dependency contract from it. Never rename a directory after the app
has shipped — ship a new app ID instead.

## 2. Repo layout

```
nrzStore/
├── .gitignore                  # /.DS_Store, *.tar.gz
├── AGENT.md                    # this file
├── README.md                   # user-facing store documentation
├── umbrel-app-store.yml        # store identity + store version
└── <app-id>/
    ├── umbrel-app.yml          # REQUIRED — app manifest
    ├── docker-compose.yml      # REQUIRED — the app's containers
    ├── icon.png                # REQUIRED — 256x256, see section 5
    ├── settings.yml            # optional — store-wide app settings
    ├── exports.sh              # optional — variables for other apps / generated secrets
    ├── app-gateway.json        # optional — extra app-gateway config
    ├── *.template             # optional — rendered with envsubst on install
    ├── hooks/                  # optional — lifecycle scripts
    └── data/.gitkeep           # optional — empty bind-mount source dirs
```

Do not add an app to the repo root; every app lives in its own `<app-id>/` directory.

## 3. The three rules that break releases

Every one of these has cost us a release here. Check them before every push.

### 3.1 Bump the app version *and* the store version

`nrz-nrzdns/umbrel-app.yml` `version:` and `umbrel-app-store.yml` `version:` are two different
counters and both must move. Miss the app version and umbrelOS sees "already installed, nothing to
do". Miss the store version and it never fetches the commit that contains the fix.

### 3.2 The icon must be a URL

`icon:` in the manifest is loaded by umbrelOS as a URL. A bare filename (`icon: icon.png`) resolves
against nothing and the app shows up with a blank icon. See [section 5](#5-icons-and-images).

### 3.3 Never ship a build context

Umbrel pulls prebuilt images; it does not build. `build:` in `docker-compose.yml` is ignored or
fails, and if the image name only exists on your machine, install dies with
`pull access denied` or `manifest unknown`. The image must be pullable from the device, for the
device's architecture. See [section 8](#8-images-and-registries).

## 4. Adding an app

1. Pick the app ID: `nrz-` + the product name in kebab-case. Check that no directory already uses it.
2. Create the directory and write the two required files:
   - `<app-id>/umbrel-app.yml` — copy the template in [section 6](#6-umbrel-appyml-reference) and fill
     every field. Empty is fine (`""`, `[]`), missing is not.
   - `<app-id>/docker-compose.yml` — see [section 7](#7-docker-composeyml-reference).
3. Add `<app-id>/icon.png` (256x256) and point `icon:` at a reachable URL
   ([section 5](#5-icons-and-images)).
4. Check the port is free: manifest `port` and every published host port share the host port space,
   and umbrelOS itself owns `80`, `443` and `2000`. `3456` is umbrelOS's own app-proxy port and must
   never be used as a manifest port.
5. Wire `app_proxy` if the app has a web UI: `APP_HOST: <app-id>_<service>_1`, `APP_PORT:` the real
   internal listen port.
6. Persist everything under `${APP_DATA_DIR}/data/...`. Nothing the user would miss may live only in
   the container filesystem.
7. Run the [preflight checklist](#12-preflight-checklist).
8. Bump the store version, commit, push:

```bash
git add <app-id> umbrel-app-store.yml
git commit -m "nrz-<app> <version>: <short German summary>"
git push origin main
```

Commit message style in this repo: `nrz-nrzdns 1.0.9: Quellcode entfernen, nur Image aus der
Registry`, `Store 3.8.0: ... entfernt`. App ID, version, then a short German sentence. Plain ASCII
in commit messages (no umlauts, no em dashes) — some of the older commits were typed on a machine
without them.

## 5. Icons and images

### What umbrelOS does with `icon:`

The manifest value is used directly as the image source in the UI. That means:

- **Absolute URL required.** `icon: icon.png` does not work. Neither does a relative path or a
  GitHub "blob" page URL.
- **The file must be a real PNG.** A JPEG renamed to `.png`, or a URL that answers
  `Content-Type: image/jpeg`, is not what the store expects. The dimension check in
  [section 13](#13-validation-commands) only reads a true PNG header, so it fails loudly on a
  renamed JPEG instead of pretending to pass.
- **256x256, square, no rounded corners.** umbrelOS applies the rounding itself via CSS; a
  pre-rounded icon gets double-rounded and looks smaller than its neighbours.
- **Plain HTTP is fine here, with one condition.** This store serves the raw file over HTTP on port
  8101, which works because umbrelOS serves its own UI over HTTP. Reach the same UI over HTTPS and
  the browser blocks the HTTP image as mixed content. In that case put the icon behind HTTPS.

### How to get the URL in this store

The icon file is committed in the repo and served by the same Forgejo instance that hosts the store:

```
http://<forgejo-host>:8101/nicorenezweers/nrzStore/raw/branch/main/<app-id>/icon.png
```

`<forgejo-host>` is whatever the store remote points at — read it, do not guess:

```bash
git remote get-url origin
```

The working example today:

```yaml
icon: http://100.78.107.162:8101/nicorenezweers/nrzStore/raw/branch/main/nrz-nrzdns/icon.png
```

That is a Tailscale address, which brings three constraints:

- **The browser loads the icon, not the Umbrel device.** The URL has to resolve from whatever the
  user is browsing from. A Tailscale IP only works for clients inside the tailnet. For a publicly
  visible store, host the file somewhere public instead: your own web server, or
  `https://raw.githubusercontent.com/<user>/<repo>/<branch>/<app-id>/icon.png`.
- **Tailscale IPs move.** When the address changes, every `icon:` in the repo is stale. Prefer a
  stable name (Tailscale MagicDNS, a DNS record) over a raw `100.x` address, and after any host
  change check them all:
  ```bash
  grep -rn "^icon:" */umbrel-app.yml
  ```
- **The file has to be pushed before the URL resolves.** A raw URL to a commit that does not exist
  yet returns 404. Push, then test.

### Free image hosts are not a plan

The nrzDNS icon lived on `i.ibb.co` from 1.0.4 to 1.0.8 and the link was dead by 1.0.9, which is
exactly how the app ended up with a broken logo. Do not use anonymous image hosts for store assets.
Self-host the file, or use a versioned raw URL in a repo you control.

### Verifying an icon before you push

```bash
# 1. real PNG, 256x256?
python3 -c "import struct,sys; d=open(sys.argv[1],'rb').read(33); print('%dx%d' % struct.unpack('>II', d[16:24]))" nrz-nrzdns/icon.png

# 2. after pushing: does the URL answer with a PNG?
curl -sI -o /dev/null -w "%{http_code} %{content_type}\n" \
  "http://100.78.107.162:8101/nicorenezweers/nrzStore/raw/branch/main/nrz-nrzdns/icon.png"
# 200 image/png
```

If the URL is public, also open it from a phone that is not on the tailnet. That is the only way to
know the user will see a logo.

### Gallery images

`gallery: []` is valid and normal for this store — the store has no screenshots. If you add them,
use absolute URLs, not filenames, for the same reason the icon needs a URL. Committing large
screenshots bloats the repo for every install; there is no reason to do it here.

### Other images in the repo

`webcam-viewer.png` in `nrz-webcam-stream` is app content, not a store asset — it is served by the
app itself. Assets the app needs at runtime belong in the image, not in the store repo, unless they
are rendered from a `*.template`.

## 6. umbrel-app.yml reference

Field order used in this store, with what each field has to get right:

```yaml
manifestVersion: 1              # framework compat, not the app version. See note below.
id: nrz-nrzdns                  # MUST equal the directory name
category: Networking            # store taxonomy: Networking, Files, Social, Finance, ...
name: nrzDNS                    # display name, the product name users know
version: "1.0.10"               # quoted, semver. Bump on every release.
tagline: DNS-Server mit ...      # one line, shown under the name
icon: http://.../icon.png       # absolute URL to a 256x256 PNG — section 5
port: 8080                      # host-facing app_proxy port, unique in the store
path: ""                        # appended to the app URL, "" = app root
description: >-                 # store copy, Markdown, German
  ...
releaseNotes: >-                # what changed in THIS version
  ...
developer: nrz
website: https://...            # developer links here
submitter: nrz
submission: https://...         # store repo URL
repo: https://...               # source repo
support: https://.../issues
dependencies: []                # other Umbrel apps, by app ID
defaultUsername: ""             # shown to the user if non-empty
defaultPassword: ""
gallery: []
```

Field notes that matter:

- **`manifestVersion`** is umbrelOS framework compatibility, not the app version. Everything in this
  store uses `1`. The official Umbrel docs ask for `1.1` when an app uses hooks, and this store's
  hook apps shipped on `1` and ran; if a hook ever does not fire, bumping `manifestVersion` to `1.1`
  is the first thing to try.
- **`port`** is the host-facing port in the app URL, `http://<device>.local:<port>`, and it belongs
  to the generated `app_proxy`. It is *not* the container's internal port — that one goes into
  `app_proxy.environment.APP_PORT` — and it is not `3456`, umbrelOS's global app-proxy port.
  `nrz-nrzdns` uses `port: 8080` and `APP_PORT: 8080` only because the dashboard happens to listen on
  8080 inside the container too. Raw published host ports share the same namespace as `port`.
- **`description`** and **`releaseNotes`** use folded YAML (`>-`). Single newlines fold into spaces,
  so a Markdown paragraph break needs **two** blank lines in the source, and a bullet list needs a
  blank line before it and between items. Verified with `ruby -ryaml`.
- **`version`** must be a quoted string. Unquoted `1.0` parses as a float and silently loses the
  trailing zero.
- **`dependencies`** is for other Umbrel apps only. A Postgres or Redis that lives in the same
  compose file is a service, not a dependency.
- **`defaultUsername` / `defaultPassword`** are only display values shown in the UI. They do not
  configure the app. Leave them empty unless the app really ships fixed credentials.
- **`gallery`** is `[]` here. See section 5.

## 7. docker-compose.yml reference

The shape used across this store:

```yaml
services:
  app_proxy:                    # injected by umbrelOS, define it with environment only
    environment:
      APP_HOST: nrz-nrzdns_dns_1   # <app-id>_<service>_1
      APP_PORT: 8080               # the service's real internal port
    container_name: nrz-nrzdns_app_proxy_1

  dns:                            # one service per long-running process
    image: <registry>/<repo>:<tag>
    container_name: nrz-nrzdns_dns_1
    restart: unless-stopped
    init: true
    environment:
      - KEY=value
    ports:                         # only for non-HTTP protocols
      - "53:53/udp"
    volumes:
      - ${APP_DATA_DIR}/data:/app/data
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD", "…"]
```

- **`app_proxy` fronts the web UI.** Do not publish the web port raw as well. `APP_HOST` is the
  container name umbrelOS injects: `<app-id>_<service-name>_1`.
- **umbrelOS auth is on by default** in front of `app_proxy`. Apps in this store that run their own
  login turn it off with `settings.yml` (`appProxyAuthEnabled: false`) — see section 10.
- **Publish raw ports only** for protocols that cannot go through a proxy: DNS, WireGuard, game
  servers, companion-client ports. Always with an explicit host mapping and protocol
  (`"34197:34197/udp"`), never Docker's random-port short syntax.
- **Ports `80`, `443` and `2000` belong to umbrelOS.** If an app needs 443 on the host, pick another
  port and let the router forward the external port to it.
- **Everything durable is a bind mount** under `${APP_DATA_DIR}/data/...`. A directory that must
  exist on the host before `docker compose up` is either committed with `data/.gitkeep` (umbrelOS
  deletes the file at runtime, leaving an empty dir) or created by a `pre-start` hook.
- **Bind-mount *files* are a trap.** `${APP_DATA_DIR}/data/config.yml:/app/config.yml` breaks if the
  host file does not exist yet — Docker creates a *directory* there. Commit the file, render it from
  a `*.template`, or create it in `pre-start`.
- **`user: "1000:1000"`** keeps runtime-created files writable across restarts and updates, because
  umbrelOS installs app directories as 1000:1000. But if the image needs its own root entrypoint to
  create/chown the data directory, forcing 1000 makes it crash-loop with "Permission denied". Two
  valid ways out: no `user:` at all and let the image's entrypoint do the work, or keep `user:` and
  create/chown the directory in `pre-start`. Never do both. Check this whenever you remove a hook.
- **Least privilege.** `cap_drop: [ALL]` plus the one capability the app needs,
  `security_opt: [no-new-privileges:true]`, `restart: unless-stopped`, and a size-capped
  `json-file` log. Never `privileged: true`, never the Docker socket, never a broad host mount
  unless the app genuinely needs it and the reason is in a comment.
- **No top-level `networks:` block.** umbrelOS injects `umbrel_main_network` as the default network.
  Some older files in this store still carry an empty `networks: {}`; it is harmless but pointless.
- **`version:` at the top** is obsolete in Compose v2 and only produces a warning. The existing
  files keep it for consistency; new files can drop it.

## 8. Images and registries

- **Prebuilt, maintained, multi-arch.** The device is either `linux/amd64` or `linux/arm64`. Verify
  before shipping: `docker buildx imagetools inspect <image>:<tag>`.
- **Pullable from the device without credentials.** No Docker Hub login, no GitHub package access, no
  image that only exists on the maintainer's laptop.
- **Pin the digest** next to the readable tag, the way `nrz-jolina-openclaw` does:
  ```yaml
  image: ghcr.io/getumbrel/openclaw-umbrel:2026.9.4-1@sha256:f021c247…
  ```
  Use the multi-arch manifest-list digest, not an architecture-specific one.
- **Never `latest`.** Use the released upstream version.
- **No `build:`.** If there is no acceptable upstream image, build a wrapper image and push it.

### The registry on the device

There is a Forgejo container registry on port 8101 on the Umbrel device. Apps that need a custom
image use it:

```yaml
image: localhost:8101/nicorenezweers/nrzdns:1.0
```

`localhost` works without any daemon configuration because Docker treats `127.0.0.0/8` as an
insecure registry by default. A LAN or Tailscale address does **not** — that one has to be listed
in `/etc/docker/daemon.json`:

```json
{
  "insecure-registries": ["10.21.0.23:8101", "10.21.0.21:8101", "umbrel.local:8101"]
}
```

```bash
sudo systemctl restart docker
```

Publishing a custom image for the device, from a Mac:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t localhost:8101/nicorenezweers/<name>:<tag> --push <app-dir>
```

If a custom image is unavoidable, document in the release notes that the registry must be reachable,
and keep a fallback plan in mind: the app cannot build on the device, so a broken registry means a
broken install.

## 9. Data, secrets and environment

Umbrel provides these to compose and hooks — use them instead of hardcoded paths:

| Variable | Meaning |
|----------|---------|
| `APP_ID` | app ID from the manifest |
| `APP_VERSION` | manifest version — setting it in `environment` forces a fresh container per release |
| `APP_DATA_DIR` | `${UMBREL_ROOT}/app-data/<app-id>` |
| `APP_SEED` | stable per-install 256-bit hex seed, derived from the user's Umbrel seed |
| `APP_PASSWORD` | stable per-install password for the app's own login |
| `APP_DOMAIN` | the device's `.local` domain |
| `DEVICE_DOMAIN_NAME` | device hostname with `.local` |
| `APP_PROXY_PORT` | the manifest port, for building canonical URLs |
| `UMBREL_ROOT` | Umbrel data root on the host |

`APP_SEED` is the right way to hand an app a stable secret. For a *second* independent secret, call
`derive_entropy` in `exports.sh` with a purpose-specific label rather than reusing one value for
everything.

**Never commit a real secret.** A password hash in the compose file is acceptable; a plaintext
password, API key, or token is not. `nrz-nrzdns` stores only the SHA-256 of the dashboard password
(`NRZDNS_PASSWORD_SHA256`) and lets the user override it. If the user has to type a secret, expose
it as a manifest setting or an environment override, and keep the default out of the repo when it is
user-specific.

## 10. Optional files

- **`settings.yml`** — store-level app settings, used by `nrz-jolina-openclaw` and `nrz-nrzdns`:
  ```yaml
  dependencies: {}
  autoStart: true
  appProxyAuthEnabled: false   # only for apps with their own login screen
  ```
- **`exports.sh`** — sourced shell, not an executable. Exports variables other apps or compose need,
  e.g. a generated secret. Use `EXPORTS_APP_DATA_DIR` (not `APP_DATA_DIR`) and
  `derive_entropy "${app_entropy_identifier}-<purpose>"`. No `exit`, no `set -e` games, no Docker
  calls. Prefix with `APP_<APP_ID_UNDERSCORES>_`.
- **`*.template`** — rendered with `envsubst` on install; the output lands next to it without the
  suffix. Commit the template, never the rendered file. Escape shell variables you do not want
  substituted (`$$` in compose, `\$` in shell scripts).
- **`hooks/`** — `pre-install`, `post-install`, `pre-start`, `post-start`, `pre-stop`, `post-stop`,
  `pre-update`, `post-update`. Executable, `#!/usr/bin/env bash`, `set -euo pipefail`, idempotent.
  `pre-start` is the one you want 95% of the time: app env and templates are ready, containers have
  not started, and it re-runs on every restart and update. Derive paths from the hook location in
  `pre-install`/`pre-stop`/`pre-update`, where `APP_DATA_DIR` is not set yet.
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  APP_DIR="${APP_DATA_DIR:-$(readlink -f "$(dirname "${BASH_SOURCE[0]}")/..")}"
  DATA_DIR="${APP_DIR}/data"
  ```
- **`app-gateway.json`** — extra app-gateway configuration, see `nrz-jolina-openclaw`.

## 11. Releasing an update

**Automatic (nrzWorkflow, nrzGit 1.2.0 and newer).** For apps whose program comes from nrzGit,
releasing in the app repository is enough – do not push the store by hand:

- `hooks/pre-start` apps (`RELEASE="umbrel-<version>"`, `BASE=…/<owner>/<repo>/raw/tag/${RELEASE}`):
  push the tag `umbrel-<version>` to the app repository (annotated, the message becomes
  `releaseNotes`; a release with that tag is used if there is one, also when published later).
- Image apps whose `image:` points at the nrzGit registry (`<nrzgit-host>/<owner>/<name>:<tag>`):
  `docker push` the new version tag.

nrzGit then commits to this store as the person who pushed: `RELEASE` or `image:` (tag + digest),
`version` and `releaseNotes` in `umbrel-app.yml`, the app's `Version:` in `README.md`, and the store
`version` (minor + 1), with the usual message `nrz-<app> <version>: <summary>, nrzStore <x.y.0>`.
`git pull` before you work here next. The store is still a normal repository: anything else
(new apps, compose changes, description, icons) is done by hand as below, and an app you already
updated by hand is left alone. Runs and errors: `GET /api/v1/workflow` on nrzGit; re-run a tag with
`POST /api/v1/workflow/run` `{"repo": "<owner>/<repo>", "tag": "umbrel-<version>"}`. Not covered:
`nrz-git` itself (binaries under `hooks/app-files`) and images on ghcr.io.

With a `nrzStore.json` in the app repository, the app also manages its description, port, icon and
package files from there, including creating a new app. Format and rules: `/nrzgit.txt` on nrzGit. AI
tokens never trigger any of this.

**By hand:**

1. Edit `<app-id>/umbrel-app.yml`: bump `version`, rewrite `releaseNotes` to describe *this*
   release in user-visible terms.
2. Edit `<app-id>/docker-compose.yml` if images, ports, mounts, or environment changed.
3. Bump `version` in `umbrel-app-store.yml`. Without it the update is invisible.
4. Re-check the icon URL if anything about the host changed, and re-read every `icon:` line if the
   Forgejo address moved.
5. Update `README.md` if the app's ports, features, or version are described there.
6. Run the [preflight checklist](#12-preflight-checklist).
7. Commit and push:
   ```bash
   git status --short          # .DS_Store must not be staged
   git add <app-id> umbrel-app-store.yml README.md
   git commit -m "nrz-<app> <version>: <short German summary>"
   git push origin main
   ```

`README.md` and `AGENT.md` are the store's only user-facing docs. If a release changes a port, a
path, a default, or a required manual step, the README has to say so in the same commit.

## 12. Preflight checklist

Run through this before every push. Each line has caught a real bug in this store.

- [ ] `id` in `umbrel-app.yml` is identical to the directory name and starts with `nrz-`
- [ ] `version` in `umbrel-app.yml` is bumped and quoted
- [ ] `version` in `umbrel-app-store.yml` is bumped
- [ ] `releaseNotes` describe this release, not the last one
- [ ] `icon:` is an absolute URL, the file is a 256x256 PNG, and `curl -sI` on it returns
      `200 image/png` (after pushing)
- [ ] manifest `port` is unique in the store and not 80, 443, 2000, or 3456
- [ ] every published host port is unique and written explicitly with its protocol
- [ ] `app_proxy.APP_HOST` is `<app-id>_<service>_1` and `APP_PORT` is the service's real port
- [ ] every image is pinned, multi-arch, and pullable from the device — no `build:`, no `latest`
- [ ] all durable state is bind-mounted under `${APP_DATA_DIR}/data/...`
- [ ] the app can write to its data dir as whatever user it runs as (check `user:` vs. entrypoint)
- [ ] no secrets in the repo; `.DS_Store` and `*.tar.gz` are not staged
- [ ] `docker compose config` passes
- [ ] `git diff --check` is clean
- [ ] `README.md` matches the shipped state

## 13. Validation commands

This repo is maintained from a Mac, where `python3` has no `yaml` module. Use `ruby`:

```bash
# YAML syntax
ruby -ryaml -e 'd=YAML.load_file("nrz-nrzdns/umbrel-app.yml"); puts "#{d["id"]} #{d["version"]} #{d["icon"]}"'
ruby -ryaml -e 'YAML.load_file("nrz-nrzdns/settings.yml"); puts "settings OK"'

# Compose file. app_proxy has no image by design, so validate the app services:
python3 - <<'EOF'
import re
src = open('nrz-nrzdns/docker-compose.yml').read()
src = re.sub(r'version: "3\.8"\n\n', '', src)
src = re.sub(r'  app_proxy:\n(?:.*\n)*?    container_name: \S+\n\n', '', src)
open('/tmp/compose-check.yml','w').write(src)
EOF
APP_DATA_DIR=/tmp/nrztest docker compose -f /tmp/compose-check.yml config

# Icon
python3 -c "import struct,sys; d=open(sys.argv[1],'rb').read(33); print('%dx%d' % struct.unpack('>II', d[16:24]))" nrz-nrzdns/icon.png
curl -sI -o /dev/null -w "%{http_code} %{content_type}\n" "<icon-url>"

# Whitespace, staged files
git diff --check
git status --short
```

`docker compose config` on the app's own file always reports
`service "app_proxy" has neither an image nor a build context` — that is expected, umbrelOS injects
it. Strip the service before validating.

## 14. Pitfalls we already hit

- **Dead icon host.** `i.ibb.co` link died between releases, blank logo. Self-host store assets.
- **`icon: icon.png`.** Not resolved by umbrelOS, blank logo. Icons are URLs.
- **Store version not bumped.** The fix was pushed and the user never saw it.
- **App version not bumped.** Same outcome, from the app side. Both counters, always.
- **`build:` plus `pull_policy: never`.** Worked on the maintainer's machine, broke everywhere else.
  A `pre-start` hook existed only to make the local image exist before Compose ran — the real fix
  was publishing the image and dropping the hook.
- **`user: "1000:1000"` with a root entrypoint.** The hook that chowned the data dir was removed
  while the `user:` line stayed, which would have crash-looped on "Permission denied". Removing a
  hook means re-checking who creates the data directory.
- **Image for the wrong architecture.** The registry image was `amd64`, the device `arm64`. Check
  with `docker buildx imagetools inspect` before tagging.
- **Docker creates a missing bind-mount source as root.** With `user: "1000:1000"` the app then
  cannot write its own data directory and crash-loops. Commit `data/.gitkeep`, or let the image's
  root entrypoint create the directory and drop the `user:` line.
- **Image tag that was never pushed.** `nrz-nrzdns` 3.2.0 pointed at
  `localhost:8101/nicorenezweers/nrzdns:3.2`, but the registry only had up to `3.1.1`, so every
  install failed with `manifest unknown`. Since 3.3.0 the app runs the pinned upstream
  `node:22-alpine` image and ships its code under `hooks/app-files/nrzdns`; `hooks/pre-start` syncs
  it to `${APP_DATA_DIR}/app` (umbrelOS copies only `hooks/` on updates, so code outside it would go
  stale). Before pointing a manifest at a custom tag, check that the tag exists in the registry.
- **Registry token realm points at `umbrel.local`.** Pulling `localhost:8101/...` on the device
  makes Forgejo send Docker to `http://umbrel.local:8101/v2/token` (its `ROOT_URL`), and on the
  LAN that answered `connection refused` - every pull from the device registry failed, also for
  images that were there. `nrz-nrz-search` 1.6.0 therefore runs the pinned `debian:bookworm-slim`
  image and ships its binaries (amd64 + arm64) under `hooks/app-files`, like `nrz-nrzdns`.
- **`.DS_Store`** is in `.gitignore`, but it was committed before that rule existed, so it is still
  tracked and shows up as modified in every `git status`. Never stage it. `git rm --cached .DS_Store`
  once and the noise is gone.

## 15. Apps in this store

| App ID | Purpose | `port` (app_proxy) | raw host ports |
|--------|---------|--------------------|----------------|
| `nrz-paper` | Dokumentenverwaltung wie Papra (Rust), OCR mit mitgeliefertem Tesseract/Poppler, SQLCipher | 8320 | — |
| `nrz-mail` | nrzMail: Mail-Client mit Archiv (IMAP/SMTP, Import/Export, Statistik, KI), Rust, SQLCipher; kein eigenes Image: `debian:trixie-slim` + Programm, Zertifikate und Rocket.toml aus dem nrzMail-Repo auf nrzGit (Zweig `umbrel`, Tag `umbrel-<version>`, erstellt mit `scripts/umbrel-release.sh`, pre-start laedt von `localhost:8390`), braucht `nrz-git`, Schluessel aus `APP_SEED` | 8360 | — |
| `nrz-backup` | nrzBackup: Backups anderer Apps E2E-verschluesselt zu Filen.io (Push/Anfordern per HTTP und MCP, Aufbewahrung, MCP fuer nrzDashboard); Programm vom Zweig `umbrel` im nrzBackup-Repo (pre-start, `RELEASE=`), Image `debian:trixie-slim`, braucht `nrz-git` | 8510 | — |
| `nrz-rust-learn` | nrzLearn: Programmieren lernen wie Duolingo, 48 Kurse mit Logos (Rust im Code, die 47 anderen als JSON unter `courses/`), App in 40 Sprachen, Kurse uebersetzt soweit fertig (neue Kurse vorerst Englisch), statische SEO-Seiten pro Sprache (hreflang, JSON-LD, Sitemap) und Link-Vorschau mit eigenem Bild pro Kurs (`/og/<kurs>.png`), alles im Browser (kein Konto, Fortschritt in localStorage, Sicherung als Datei, Impressum/Datenschutz); Admin-Bereich auf `29091` (`admin` + `APP_PASSWORD`): anonyme Statistik (`POST /api/stats` aus der App), Webanalyse-Skript (vorbelegt per `NRZLEARN_ANALYTICS_SRC`/`_DOMAIN`, erst nach Einschalten aktiv), Bestaetigungscodes der Suchmaschinen, gespeichert in `data/settings.json` und `data/stats.json`; kein eigenes Image: `debian:trixie-slim` (read_only, uid 1000) + statischer Dateiserver und Web-App per `pre-start` aus dem nrzLearn-Repo auf nrzGit (Zweig `umbrel`, Tag `umbrel-<version>`, `scripts/umbrel-release.sh`, `nrzStore.json` mit `package: umbrel`); seit 6.0 ohne vorkomprimierte Seiten/Kurstexte im Paket (28 statt 205 MB), `pre-start` erzeugt die gzip-Kopien; haengt von `nrz-git` ab, ohne umbrelOS-Anmeldung (`appProxyAuthEnabled: false`); `data/` haelt ausserdem die ungenutzte SQLite-Datenbank aus 3.x; Anzeigename seit 2.0.0 nrzLearn, ID bleibt | 29090 | `29091/tcp` (Admin-Bereich) |
| `nrz-music` | nrzMusic: Musik-Client in Rust mit Konten (erstes Konto Admin), Ablageordner `${UMBREL_ROOT}/home/nrzMusic`, YouTube Music ueber yt-dlp, Spotify, Android-App (APK unter `/static/nrzMusic.apk`); kein eigenes Image: `debian:trixie-slim` + Programm, ffmpeg/ffprobe, yt-dlp und Deno, die `hooks/pre-start` aus dem nrzMusic-Repo (Zweig `umbrel`, Tag `umbrel-<version>`, erstellt mit `scripts/umbrel-release.sh`) von nrzGit (`localhost:8390`) laedt, haengt von `nrz-git` ab, eigene Anmeldung (`appProxyAuthEnabled: false`), `NRZMUSIC_PUBLIC_URL=https://music.zweers.ch` | 8350 | — |
| `nrz-tube` | nrzTube: YouTube-Frontend in Rust (InnerTube + yt-dlp, Proxy fuer Bilder/Videos, SponsorBlock, DeArrow, Abos/Profile, Import/Export), eigene Konten (`appProxyAuthEnabled: false`); kein eigenes Image: `debian:trixie-slim` + Programm, yt-dlp und Deno, die `hooks/pre-start` aus dem nrzTube-Repo (Zweig `umbrel`, Tag `umbrel-<version>`, `scripts/umbrel-release.sh`) von nrzGit (`localhost:8390`) laedt, haengt von `nrz-git` ab, verwaltet ueber `nrzStore.json` | 8455 | — |
| `nrz-code` | nrzCode: Coding-Agenten (Claude Code, Codex, Gemini, OpenCode, Kilo, Grok) mit mehreren Konten je Agent, Subagenten, nrzGit-MCP; kein eigenes Image: `node:22-bookworm` als root mit Docker-Socket, Programm per `pre-start` aus dem nrzCode-Repo auf nrzGit (Tag `umbrel-<version>`), haengt von `nrz-git` ab | 8410 | `8411/tcp` (Vorschau) |
| `nrz-rss` | nrzNews (bis 1.0.0 nrzRSS, ID bleibt): News-/RSS-Reader, SQLite in `data/` (eine alte `nrzrss.db` wird weiterverwendet), eigene Anmeldung; kein eigenes Image: `debian:trixie-slim` + Programm und `Rocket.toml` per `pre-start` aus dem nrzNews-Repo auf nrzGit (Zweig `umbrel`, Tag `umbrel-<version>`, erstellt mit `scripts/umbrel-release.sh`), haengt von `nrz-git` ab | 8340 | — |
| `nrz-dns` | nrzNetwork (frueher nrzDNS): DNS-Server wie Technitium (Rust), Zonen, Weiterleitung (UDP/TCP/DoT/DoH), Cache, Sperrlisten, Abfrageprotokoll, MCP-Server `/mcp` (mehrere Tokens, lesend/aendernd) fuer nrzDashboard, Claude & Co., SQLite in `data/`, eigene Anmeldung; Binaries unter `hooks/app-files` (pre-start), Image `debian:trixie-slim`, uid 1000 ohne Capabilities (`sysctls: net.ipv4.ip_unprivileged_port_start: 0`) | 8400 | `53/udp`, `53/tcp` (DNS; Port muss auf dem Geraet frei sein), `81/tcp` (Reverse Proxy; `hooks/nrznetwork-gateway` leitet Port 80 per iptables-DNAT dorthin, solange der Proxy antwortet; `hooks/pre-stop` beendet ihn), Host-Netzwerk (`network_mode: host`, privileged, root; UI auf 8401, App-Proxy ueber 10.21.0.1), `81/tcp` und `444/tcp` (HTTPS-Eingang nach SNI; Port 443 nur bei `data/tls-active = on`); im Container zusaetzlich `127.0.0.1:80/443` fuer den eingebauten NetBird (Netstack); `data/bin/` haelt cloudflared/netbird, die nrzNetwork selbst laedt und aktualisiert |
| `nrz-dashboard` | nrzDashboard: Dashboard fuer umbrelOS (Rust, Dioxus + nrzUI) ueber den umbrelOS-MCP-Server: Uebersicht, Ping (TCP/HTTP/ICMP per Datagram-Socket, `sysctls: net.ipv4.ping_group_range`), Apps, Dateien, System, MCP-Konsole; eigene Anmeldung (`admin` + `APP_PASSWORD`), MCP-Token in der App (`data/settings.json`), Umbrel ueber `host.docker.internal:host-gateway`; kein eigenes Image: `debian:trixie-slim` + Programm per `pre-start` aus dem nrzDashboard-Repo (Zweig `umbrel`, Tag `umbrel-<version>`, `scripts/umbrel-release.sh`, `nrzStore.json`), haengt von `nrz-git` ab | 8500 | — |
| `nrz-plan` | nrzPlan: Todos, Kalender, Kanban-Boards, Fokus-Timer (Rust, Dioxus fullstack + nrzUI, SQLite in `data/`), REST-API `/api/v1` mit API-Schluesseln und Webhooks; Oberflaeche hinter Umbrel-Login, `PROXY_AUTH_WHITELIST: "/api/v1/**"`; kein eigenes Image: `debian:trixie-slim` + Programm per `pre-start` aus dem nrzPlan-Repo (Zweig `umbrel`, Tag `umbrel-<version>`, `scripts/umbrel-release.sh`, `nrzStore.json` mit `package: umbrel`), haengt von `nrz-git` ab | 8560 | — |
| `nrz-gamepanel` | nrzGamePanel: Spielserver-Panel Minecraft/Factorio (Rust, axum + Dioxus/nrzUI), Import bestehender Server mit Auto-Erkennung, Konsole, Dateien, Inventar + Endertruhe, Karte, Modrinth, Backups, Automationen, MCP `/mcp`; Host-Netzwerk (`network_mode: host`, uid 1000, cap_drop ALL), Panel auf 8701, app_proxy ueber `host.docker.internal`; Import-Mounts `${UMBREL_ROOT}/home` und `${UMBREL_ROOT}/app-data` (schreibbar); Java/Factorio laedt das Panel nach `data/`; kein eigenes Image: `debian:trixie-slim` + Programm per `pre-start` aus dem Paket-Repo `nrzGamePanel-umbrel` (Tag `umbrel-<version>`, `nrzStore.json`), haengt von `nrz-git` ab | 8700 | host-Modus: Ports der Spielserver (z. B. `25565/tcp`, `34197/udp`, RCON ab `25575`), `8701/tcp` (Panel) |

Current user-facing documentation lives in `README.md`; keep the table here in sync when an app is
added or removed.

## 16. Credentials

Push access to `http://<forgejo-host>:8101/nicorenezweers/nrzStore.git` uses the account
`nicorenezweers`. The password lives only in the maintainer's macOS keychain (git credential helper
`osxkeychain`) – git asks for it once and stores it there. It is never written into this repo.

Never commit credentials to this repo, and never reuse the store password for the device's Docker
registry. If a password leaks, rotate it in Forgejo and update the keychain entry.
