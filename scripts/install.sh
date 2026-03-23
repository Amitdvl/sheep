#!/bin/bash

set -euo pipefail

REPO_URL="${SHEEP_REPO_URL:-https://github.com/Amitdvl/sheep.git}"
INSTALL_DIR="${SHEEP_INSTALL_DIR:-$HOME/.local/share/sheep}"
BIN_DIR="${SHEEP_BIN_DIR:-$HOME/.local/bin}"
DEFAULT_BRANCH="${SHEEP_GIT_BRANCH:-main}"

log() {
  printf '[sheep-install] %s\n' "$1"
}

warn() {
  printf '[sheep-install] Warning: %s\n' "$1" >&2
}

fail() {
  printf '[sheep-install] Error: %s\n' "$1" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

is_wsl() {
  [ -f /proc/version ] && grep -qiE 'microsoft|wsl' /proc/version
}

node_major_version() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "0"
}

platform() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux) echo "linux" ;;
    *) echo "unknown" ;;
  esac
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command_exists sudo; then
    sudo "$@"
  else
    fail "This step requires root privileges, but sudo is not installed."
  fi
}

load_homebrew_env() {
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

install_homebrew() {
  if command_exists brew; then
    load_homebrew_env
    return
  fi

  log "Installing Homebrew..."
  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_homebrew_env

  command_exists brew || fail "Homebrew installation completed, but brew is still not on PATH."
}

ensure_git() {
  if command_exists git; then
    return
  fi

  case "$(platform)" in
    macos)
      install_homebrew
      log "Installing git..."
      brew install git
      ;;
    linux)
      if command_exists apt-get; then
        run_root apt-get update
        run_root apt-get install -y git
      elif command_exists dnf; then
        run_root dnf install -y git
      elif command_exists yum; then
        run_root yum install -y git
      else
        fail "Unsupported Linux package manager. Install git manually and rerun."
      fi
      ;;
    *)
      fail "Unsupported platform. Install git manually and rerun."
      ;;
  esac
}

ensure_node() {
  if command_exists node && command_exists npm && [ "$(node_major_version)" -ge 20 ]; then
    return
  fi

  case "$(platform)" in
    macos)
      install_homebrew
      log "Installing Node.js..."
      brew install node
      ;;
    linux)
      if command_exists apt-get; then
        run_root apt-get update
        run_root apt-get install -y nodejs npm
      elif command_exists dnf; then
        run_root dnf install -y nodejs npm
      elif command_exists yum; then
        run_root yum install -y nodejs npm
      else
        fail "Unsupported Linux package manager. Install Node.js 20+ manually and rerun."
      fi
      ;;
    *)
      fail "Unsupported platform. Install Node.js 20+ manually and rerun."
      ;;
  esac

  command_exists node || fail "Node.js installation failed."
  command_exists npm || fail "npm installation failed."
  [ "$(node_major_version)" -ge 20 ] || fail "Node.js 20 or newer is required."
}

start_docker_macos() {
  if [ -d /Applications/Docker.app ]; then
    open -a Docker >/dev/null 2>&1 || true
  fi
}

install_docker() {
  if is_wsl; then
    fail "WSL should use Docker Desktop from Windows. Run the Windows installer script instead."
  fi

  case "$(platform)" in
    macos)
      install_homebrew
      if ! command_exists docker; then
        log "Installing Docker Desktop..."
        brew install --cask docker
      fi
      start_docker_macos
      ;;
    linux)
      if ! command_exists docker; then
        log "Installing Docker..."
        curl -fsSL https://get.docker.com | run_root sh
      fi
      if command_exists systemctl; then
        run_root systemctl enable --now docker || true
      fi
      ;;
    *)
      fail "Unsupported platform. Install Docker manually and rerun."
      ;;
  esac
}

wait_for_docker() {
  if docker info >/dev/null 2>&1; then
    return
  fi

  log "Waiting for Docker to become ready..."
  for _ in $(seq 1 90); do
    if docker info >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done

  case "$(platform)" in
    macos)
      fail "Docker Desktop did not become ready. Finish any first-run prompts in Docker Desktop, then rerun 'sheep install'."
      ;;
    linux)
      if is_wsl; then
        fail "Docker is not available inside WSL yet. Start Docker Desktop on Windows and enable WSL integration for this distro, then rerun 'sheep install'."
      fi
      fail "Docker did not become ready. Ensure the daemon is running and your user can access it, then rerun 'sheep install'."
      ;;
    *)
      fail "Docker did not become ready."
      ;;
  esac
}

ensure_docker() {
  if ! command_exists docker; then
    if is_wsl; then
      fail "Docker is not available in this WSL distro. Run the Windows installer script or enable Docker Desktop WSL integration, then rerun 'sheep install'."
    fi
    install_docker
  else
    case "$(platform)" in
      macos)
        start_docker_macos
        ;;
      linux)
        if is_wsl; then
          :
        elif command_exists systemctl; then
          run_root systemctl start docker || true
        fi
        ;;
    esac
  fi

  wait_for_docker
}

ensure_repo() {
  if [ -f "$SCRIPT_ROOT/package.json" ] && [ -f "$SCRIPT_ROOT/bin/sheep" ]; then
    SHEEP_DIR="$SCRIPT_ROOT"
    return
  fi

  ensure_git

  if [ -d "$INSTALL_DIR/.git" ]; then
    if ! git -C "$INSTALL_DIR" diff --quiet || ! git -C "$INSTALL_DIR" diff --cached --quiet; then
      warn "Skipping repo update in $INSTALL_DIR because it has local changes."
    else
      log "Updating Sheep in $INSTALL_DIR..."
      git -C "$INSTALL_DIR" fetch --depth=1 origin "$DEFAULT_BRANCH"
      git -C "$INSTALL_DIR" checkout -q "$DEFAULT_BRANCH"
      git -C "$INSTALL_DIR" pull --ff-only origin "$DEFAULT_BRANCH"
    fi
  elif [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    fail "Install directory $INSTALL_DIR already exists and is not a git checkout."
  else
    mkdir -p "$(dirname "$INSTALL_DIR")"
    log "Cloning Sheep into $INSTALL_DIR..."
    git clone --depth=1 --branch "$DEFAULT_BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi

  SHEEP_DIR="$INSTALL_DIR"
}

ensure_cli_link() {
  mkdir -p "$BIN_DIR"
  ln -sf "$SHEEP_DIR/bin/sheep" "$BIN_DIR/sheep"

  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      warn "$BIN_DIR is not on PATH yet."
      warn "Add this to your shell profile: export PATH=\"$BIN_DIR:\$PATH\""
      ;;
  esac
}

ensure_env_file() {
  if [ ! -f "$SHEEP_DIR/.env" ] && [ -f "$SHEEP_DIR/.env.example" ]; then
    cp "$SHEEP_DIR/.env.example" "$SHEEP_DIR/.env"
    log "Created $SHEEP_DIR/.env from .env.example"
  fi
}

install_app() {
  log "Installing npm dependencies..."
  (cd "$SHEEP_DIR" && npm install --silent)

  log "Building TypeScript..."
  (cd "$SHEEP_DIR" && npm run build)

  log "Building agent container image..."
  (cd "$SHEEP_DIR" && ./container/build.sh)
}

SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" 2>/dev/null && pwd || pwd)"
if [ -f "$SCRIPT_DIR/../package.json" ] && [ -f "$SCRIPT_DIR/../bin/sheep" ]; then
  SCRIPT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  SCRIPT_ROOT=""
fi

SHEEP_DIR=""

main() {
  [ "$(platform)" != "unknown" ] || fail "Only macOS and Linux are supported."

  ensure_repo
  ensure_node
  ensure_docker
  ensure_cli_link
  ensure_env_file
  install_app

  log "Install complete."
  if [ -f "$SHEEP_DIR/.env" ]; then
    log "Next: edit $SHEEP_DIR/.env, then run 'sheep'."
  else
    log "Next: create $SHEEP_DIR/.env, then run 'sheep'."
  fi
}

main "$@"
