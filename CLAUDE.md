# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Santa Claude is a comprehensive usage tracking system for Claude Code (Pro/Max plans) that transparently wraps the `claude` CLI (provided by the `@anthropic-ai/claude-code` package) while capturing detailed session metrics, token usage, and managing the 5-hour session window limit.

## Architecture

The project consists of four main components:

1. **CLI (`src/cli.ts`)**: Commander.js-based CLI interface with commands for running wrapped sessions, viewing stats, listing sessions, GC, and configuration
2. **Claude Wrapper (`src/claude-wrapper.ts`)**: Core wrapper that uses node-pty for terminal emulation, handles session management, and extracts usage metrics from verbose output
3. **Session Tracker (`src/session-tracker.ts`)**: SQLite-based persistence layer that tracks sessions, token usage, and the 5-hour session window
4. **Token Monitor (`src/token-monitor.ts`)**: Simple token usage monitor that detects when sessions start based on token activity

## Common Commands

### Development

```bash
npm run dev -- "Your arguments here"    # Run in development mode
npm run build                        # Build TypeScript to dist/
npm start                           # Run built version
```

### Installation

```bash
npm install
npm run build
npm link                            # Makes 'santa-claude' available globally
```

### Usage

```bash
santa-claude "Write hello world"              # Default wrapper mode
santa-claude -m opus "Complex task"           # Specify model
santa-claude stats                            # View usage statistics
santa-claude sessions                         # List recent sessions
santa-claude sessions 20                      # Show last 20 sessions
```

## Key Implementation Details

### Session Tracking

-  Sessions are stored in `~/.santa-claude/sessions.db` SQLite database
-  Each session gets a UUID and tracks start/end times and token usage
-  Active sessions are tracked to enforce Claude Code's 5-hour limit
-  Monthly statistics aggregate all session data
-  Session start time is detected when API activity begins (first token usage)
-  Session logs are stored in `~/.santa-claude/logs/` for debugging

### Token Monitoring

The wrapper uses node-pty to preserve Claude's interactive mode while monitoring output:

-  Monitors token count increases to detect actual session start
-  Logs session activity to timestamped files
-  Updates database with total tokens used
-  Displays real-time countdown and token count in Claude Code UI

### Database Schema

```sql
sessions (
  id TEXT PRIMARY KEY,
  start_time INTEGER NOT NULL,      -- When API activity began
  end_time INTEGER NOT NULL,         -- Session end time (calculated)
  total_tokens INTEGER DEFAULT 0     -- Total tokens used
)
```

## Dependencies

-  `@anthropic-ai/claude-code`: The underlying Claude Code CLI users must install separately (not bundled)
-  `commander`: CLI argument parsing
-  `sqlite3`/`sqlite`: Database operations
-  `date-fns`: Date manipulation for session windows and monthly stats
-  `chalk`: Terminal color output
-  `node-pty`: Pseudo-terminal for preserving interactivity while monitoring

## Testing

No tests are currently configured.
