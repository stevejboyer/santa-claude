# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-08-08

### Added

-  Initial release of Santa Claude
-  Transparent wrapper for Claude Code CLI with full argument pass-through
-  Real-time session tracking with 5-hour window countdown
-  Token usage monitoring and display in Claude UI
-  SQLite database for persistent session storage
-  Comprehensive usage statistics (weekly, 30-day, billing cycle)
-  Commands:
   -  `santa-claude` - Run Claude with tracking
   -  `santa-claude stats` - View usage statistics
   -  `santa-claude sessions` - List recent sessions
   -  `santa-claude status` - Show running instances
   -  `santa-claude update-session-length` - Configure session window
   -  `santa-claude set-subscription-date` - Set billing cycle day
-  Session logs stored in `~/.santa-claude/logs/`
-  Configuration file at `~/.santa-claude/config.json`
-  Full compatibility with all Claude Code arguments (--model, -c, -r, etc.)

### Features

-  Works as drop-in replacement for `claude` command
-  Preserves Claude's interactive mode using node-pty
-  No interference with Claude's session management
-  100% local - no telemetry or external API calls
-  Utilize's Claude Code's verbose mode for token tracking
-  Displays real-time countdown of session duration so you know you're still in an active session
