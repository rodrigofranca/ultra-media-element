# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

**Read [AGENTS.md](./AGENTS.md) first.** It has the project structure,
commands, and golden rules shared by every coding agent working here
(Claude Code, Codex, opencode, ...). This file only adds notes specific to
Claude Code.

## Project Documentation

The `/docs` folder contains comprehensive project analysis and implementation
plans:

- **`/docs/evaluation/`** — 6-part project analysis: purpose, architecture,
  code quality, community potential, evolution roadmap
- **`/docs/implementation/`** — technical implementation plans (e.g. YouTube
  embed support, iframe/events refactoring)
- **`/docs/tasks.md`** — feature roadmap with implementation status

## Current Feature Status

**Completed:**
- Multi audio track support
- Video quality/renditions support
- Subtitles support via `<track>` elements
- Advertisement component (`ultra-media-ad`)
- YouTube embed support

**Planned:**
- Library extension capabilities (Dash.js, HLS.js customization)
- Custom URL support for self-hosted libraries
- DRM support for protected content
- URL signature support
- Video sequence/playlist support
- Preload optimization using web workers
- XHR request override capabilities

## Build Configuration

- Vite library mode: ESM + UMD bundles, TypeScript declarations to `dist/`
- Custom Elements Manifest generated for IDE support
- VSCode HTML custom data support via `vscode.html-custom-data.json`
