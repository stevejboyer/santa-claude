# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2025-08-12

### Fixed

- **Critical session detection bug**: Fixed cache validation logic that was preventing expired sessions from being properly cleared
- **Session countdown display**: Resolved intermittent "No active session" display during active sessions
- **Session reuse issue**: Fixed bug where expired sessions were incorrectly being reused instead of creating new sessions
- **Cache corruption**: Improved cache invalidation to prevent stale session data from persisting
- **Race conditions**: Enhanced error handling in session creation and cache management

### Changed

- Simplified session cache validation logic for better reliability
- Removed problematic fallback mechanisms that were masking cache issues
- Improved session state consistency across multiple santa-claude instances

## [0.1.1] - 2025-08-11

### Added

-  Automatic log file cleanup (runs every 24 hours, keeps 7 days/50 files max)
-  New `santa-claude log-stats` command to view log statistics and trigger cleanup
-  Query result caching for improved performance
-  Database indexes on `total_tokens` column for faster queries
-  Centralized error handling and logging system
-  Custom error classes for better error tracking
-  Type definitions for all database operations

### Fixed

-  Critical resource leaks in CLI and wrapper components
-  Race conditions in token monitoring
-  SQL injection vulnerabilities through input validation
-  Commands (`stats`, `sessions`, `status`, `gc`, `log-stats`) now exit properly instead of hanging
-  Memory leaks from uncleaned intervals
-  Improved cleanup handlers for all resources

### Changed

-  Replaced all `any` types with proper TypeScript types
-  Improved error messages and logging throughout
-  Better resource management on process exit

### Performance

-  Added caching for frequently accessed database queries
-  Database queries optimized with new indexes
-  Reduced database load through intelligent caching

## [0.1.0] - 2025-08-08

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
