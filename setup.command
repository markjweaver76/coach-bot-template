#!/bin/bash
# coach-bot-template: one-double-click installer for macOS.
#
# What this does:
#   1. Confirms git and Claude Code are installed (and tells the user how to
#      install them if not).
#   2. Downloads the Coach Bot Setup skill into ~/.claude/skills/.
#   3. Tells the user what to type in Claude Code next.
#
# Distribute by sending clients this file. They double-click; macOS pops a
# terminal window, runs this script, and closes. Pure GUI experience.

set -e

clear
cat <<'BANNER'
  ┌─────────────────────────────────────────────┐
  │                                             │
  │       Coach Bot — One-Click Installer       │
  │                                             │
  └─────────────────────────────────────────────┘

This installs a "skill" into Claude Code that walks you through
setting up your own AI coaching bot from scratch.

You'll only need to do this once.

BANNER

# --- Check for git ---
if ! command -v git >/dev/null 2>&1; then
  cat <<'NOGIT'
✗ Git is required, but isn't installed.

Open the Terminal app and run this one line to install it:

    xcode-select --install

A dialog will pop up — click "Install" and wait ~5 minutes.
Then come back and double-click this file again.

NOGIT
  read -p "Press Enter to close this window..."
  exit 1
fi

# --- Check for Claude Code ---
if ! command -v claude >/dev/null 2>&1; then
  cat <<'NOCLAUDE'
✗ Claude Code isn't installed yet.

Download and install it from:

    https://claude.com/download

After it's installed, double-click this file again to finish setup.

NOCLAUDE
  read -p "Press Enter to close this window..."
  exit 1
fi

# --- Install the skill ---
echo "Downloading the Coach Bot Setup skill..."
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

if ! git clone --depth 1 --quiet https://github.com/martincw/coach-bot-template "$TMP/template" 2>/dev/null; then
  cat <<'NETERR'
✗ Couldn't download. Check your internet connection and try again.

If your internet is fine, this might be a temporary GitHub issue —
just wait a couple minutes and double-click this file again.

NETERR
  read -p "Press Enter to close this window..."
  exit 1
fi

mkdir -p "$HOME/.claude/skills"
rm -rf "$HOME/.claude/skills/coach-bot-setup"
cp -r "$TMP/template/.claude/skills/coach-bot-setup" "$HOME/.claude/skills/coach-bot-setup"

# --- Done ---
cat <<'DONE'

✓ Installed.

What to do next:

  1. Open Claude Code (it's an app — find it in Spotlight or Applications).

  2. Type or paste this and press Enter:

         set up my coaching bot

  3. Answer Claude's questions. The whole setup takes about 30 minutes.
     You won't need to type any commands — Claude will handle everything
     for you.

If you ever want to update your bot's voice, content, or branding,
just open Claude Code and say:

    "update my coaching bot"

— and Claude will walk you through whatever you want to change.

DONE
read -p "Press Enter to close this window..."
