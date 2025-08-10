# Santa Claude 🎅

> He sees you when you're coding! He knows when your session's awake! 👀

Santa Claude is a usage tracking wrapper for [Claude Code](https://claude.ai/code) that helps you monitor your Pro/Max plan usage limits. It transparently wraps 🎁 the `claude` CLI (from the `@anthropic-ai/claude-code` package), providing real-time session tracking and stats about your Claude Code usage.

## Why Santa Claude?

Claude Code Pro/Max plans have usage limits:

-  5-hour session windows
-  Weekly limits
-  Monthly limits

While session counts aren't the sole limiting factor on your Pro or Max subscription, keeping track of how many sessions you've used and if you're still in an active session before you send a prompt helps you maximize the value out of your Claude Code subscription.
But Claude Code itself prints no built-in usage tracking to help you understand when your session is about to end or how many sessions you've been consuming.

Santa Claude solves this by:

-  ⏱️ Showing time remaining in your current 5-hour session window
-  📊 Tracking token usage during each session
-  🎯 Displaying session time remaining directly in the Claude Code UI
-  📝 Providing interesting stats for the curious user

## Features

-  **Transparent Integration**: Works as a drop-in replacement for the `claude` command
-  **Session Tracking**: Automatically tracks all sessions in a local SQLite database
-  **Usage Statistics**: View weekly, rolling 30-day, and billing cycle statistics
-  **Token Monitoring**: Real-time tracking of token usage
-  **Pass-through Arguments**: All Claude Code arguments work normally (e.g. `claude --continue`)

## Installation

### Prerequisites

-  Node.js 18+
-  Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
-  Note: `status` command is supported on macOS/Linux.
-  `sqlite3` is a native dependency and may download binaries during install.

### Install from npm

```bash
npm install -g santa-claude
```

### Install from source

```bash
# Install dependencies and build CLI
npm install
npm run build
npm link  # Makes 'santa-claude' available globally
```

## Usage

### Basic Usage

```bash
# Start an interactive Claude session (with tracking)
santa-claude

# Send a prompt directly
santa-claude "Write a hello world in Python"

# Use any Claude Code arguments
santa-claude --model opus "Complex task"
santa-claude -c  # Continue last conversation
santa-claude -r  # Resume a conversation
```

### Advanced Features

```bash
# View usage statistics
santa-claude stats

# List recent sessions (default 10, or specify count)
santa-claude sessions
santa-claude sessions 20

# Update session window length (only needed if Anthropic changes it)
santa-claude update-session-length

# Set billing cycle date for accurate monthly tracking
santa-claude set-subscription-date 15  # If your plan renews on the 15th

# Purge old sessions, keeping last N (default 100)
santa-claude gc
santa-claude gc 200
```

## How it Works

### Architecture

```
santa-claude wraps a claude instance and monitors its output via node-pty
santa-claude detects when a session has started by monitoring token output provided by claude in verbose mode

┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  santa-claude   │────▶│  Claude Code CLI │────▶│  Anthropic API  │
│   (wrapper)     │◀────│   (passthrough)  │◀────│                 │
└────────┬────────┘     └──────────────────┘     └─────────────────┘
         │
         │
         │ stores session info in a local SQLite db
         │
         ▼
┌─────────────────┐
│ SQLite Database │
│   (~/.santa-    │
│    claude/)     │
└─────────────────┘
```

### Key Components

1. **CLI Wrapper**

   -  Uses `node-pty` to preserve Claude's interactive features
   -  Monitors output for token usage patterns
   -  Detects actual API activity vs idle time
   -  Keeps track of session lifecycle

2. **Session Tracking**

   -  SQLite database at `~/.santa-claude/sessions.db`
   -  Tracks session start and calculates end time
   -  Calculates 5-hour windows
   -  Aggregates weekly, 30-day, and billing cycle statistics

3. **Token Monitor**

   -  Real-time token usage detection
   -  Updates database with token counts

## Command Reference

| Command                                  | Description                                |
| ---------------------------------------- | ------------------------------------------ |
| `santa-claude [args...]`                 | Run Claude with tracking (passes all args) |
| `santa-claude stats`                     | Show usage statistics and time remaining   |
| `santa-claude sessions [count]`          | List recent sessions (default 10)          |
| `santa-claude status`                    | Show running instances (Unix/macOS only)   |
| `santa-claude update-session-length`     | Update the 5-hour session window length    |
| `santa-claude set-subscription-date <n>` | Set billing renewal day (1-31)             |
| `santa-claude --help`                    | Show help                                  |

## Nitty Gritty

1. **The cookies and milk**: Santa Claude monitors the output from Claude Code CLI via node-pty. It starts a claude instance with the verbose flag (`claude --verbose`) and monitors the total token count that is printed in the CLI. When the token count increases Santa Claude knows the Claude Code instance is in use. If no active session is currently stored in the local SQLite db a new session row is inserted and a new session is "active". Note that Santa Claude is not guaranteed to be accurate and is just using the token count to estimate the session start time. **Important**: Santa Claude automatically applies a 1-minute safety buffer to all session end times (e.g., a 5-hour session is tracked as 4 hours 59 minutes) to account for any delay between token count detection and Anthropic's actual session start tracking.

   **Resume Detection**: When resuming an existing Claude Code session, the CLI initially shows 0 tokens, then jumps to the full session total on the first interaction. Santa Claude detects jumps >2000 tokens from 0 and treats them as session resumes rather than new tokens, preventing double-counting, but the token count could therefore not be entirely accurate in this case.

2. **Debugging info**: Session logs stored in `~/.santa-claude/logs/`

3. **Config file**: Santa Claude stores configuration in `~/.santa-claude/config.json`. This file is created automatically on first run. Currently it stores only the session length. If Anthropic updates the length from 5 hours to another number of hours you can update the value in this file or run `santa-claude update-session-length`.

### Session Length

By default, Santa Claude tracks Claude Code's 5-hour session window. If Anthropic changes this limit, you can update it:

**Via CLI:**

```bash
santa-claude update-session-length
# Enter new value when prompted (e.g., 3.5 for 3.5 hours)
```

**Via config file:**

```json
{
	"sessionLengthHours": 5.0,
	"subscriptionRenewalDay": 15
}
```

## Development

```bash
# Clone and install
git clone https://github.com/stevejboyer/santa-claude.git
cd santa-claude
npm install

# Run in development mode
npm run dev -- "Your arguments here"

# Build TypeScript
npm run build

# Link for local testing
npm link
```

### Database Schema

There's one table, `sessions`, in the local SQLite database (stored at ~/.santa-claude/sessions.db).

See `src/session-tracker.ts` for the full schema. Key fields:

The sessions table tracks:

-  `id`: UUID for each session
-  `start_time`: When session began
-  `end_time`: Calculated end time (start + 5 hours)
-  `total_tokens`: Total tokens used

Two suggested ways to view the data manually are:
1- visit https://sqliteviewer.app/ and browse to your local db file
2- use the [sqlite3 npm package](https://www.npmjs.com/package/sqlite3) to query your table in your terminal: `sqlite3 ~/.santa-claude/sessions.db "SELECT * FROM sessions;"` or run `npm run db:show` which will run a query that formats the timestamp to be human readable.

## Maintenance

Purge old sessions, keeping only the most recent N (default 100):

```bash
santa-claude gc           # keep last 100
santa-claude gc 200       # keep last 200
```

You will be prompted for confirmation before deletion.

## Troubleshooting

### Session logs

View logs: `ls ~/.santa-claude/logs/`

## Privacy & Security

-  **100% Local**: All data stored locally in `~/.santa-claude/`
-  **No Network Calls**: Only monitors Claude's output
-  **No Data Collection**: Zero telemetry or analytics
-  **Open Source**: Audit the code yourself

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

-  Keep the wrapper transparent - don't modify Claude's behavior
-  Maintain compatibility with all Claude Code arguments
-  Test with different Claude models and modes
-  Ensure all Claude features work (resume, continue, etc.)

## License

MIT License - see [LICENSE](LICENSE) file for details

---

**Note**: This is an unofficial tool and is not affiliated with Anthropic. It's a community project designed to enhance the Claude Code experience.
