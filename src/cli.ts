#!/usr/bin/env node

import { program } from 'commander';
import { ClaudeWrapper } from './claude-wrapper.js';
import configManager from './config.js';
import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';

const execAsync = promisify(exec);

const wrapper = new ClaudeWrapper();

program
	.name('santa-claude')
	.description('Claude Code wrapper with usage tracking')
	.version('1.0.0', '-v, --version', 'Display version number')
	.helpOption('-h, --help', 'Display help for command')
	.addHelpText(
		'after',
		`
Commands:
  santa-claude [args...]          Start Claude with tracking (passes args to Claude)
  santa-claude stats              Show detailed usage statistics
  santa-claude sessions           List recent sessions
  santa-claude status             Show running instances
  santa-claude update-session-length  Update the session window length
  santa-claude set-subscription-date <day>  Set your billing cycle renewal day

Claude Arguments:
  All arguments are passed directly to Claude Code. Common examples:
    santa-claude "your prompt"      Send a prompt to Claude
    santa-claude --model opus       Use Opus model
    santa-claude -c                 Continue last conversation
    santa-claude -r                 Resume a conversation
    santa-claude --print "prompt"   Non-interactive mode
  
  Run 'claude --help' to see all available Claude options.

Subscription Tracking:
  To track your session usage per your billing cycle, run:
    santa-claude set-subscription-date <day>
  
  Where <day> is the day of month (1-31) when your Claude subscription renews.
  
  To find your renewal date:
  1. Visit https://claude.ai/settings/billing
  2. Sign in and look for text like "Your subscription will auto renew on Aug 6, 2025"
  3. Run: santa-claude set-subscription-date 6

Examples:
  santa-claude                    Start interactive Claude session
  santa-claude "fix this bug"     Send a prompt to Claude
  santa-claude --model opus -c    Continue last conversation with Opus
  santa-claude stats              View your usage statistics
  santa-claude set-subscription-date 15  Set renewal date to 15th of each month`
	);

// Add standalone commands instead of options
program
	.command('status')
	.description('Show running instances')
	.action(async () => {
		await showStatus();
	});

// Default command - run claude with tracking
program
	.allowUnknownOption()
	.argument('[args...]', 'Arguments to pass to Claude')
	.action(async args => {
		try {
			await wrapper.initialize();

			// If no args provided, launch interactive Claude session
			// (don't show help - just pass through to Claude)

			await wrapper.runSession(args);
		} catch (error: any) {
			// Don't show error if it's just a non-zero exit code
			if (!error.message?.includes('Process exited with code')) {
				console.error(chalk.red('Error:'), error.message);
			}
			process.exit(1);
		} finally {
			await wrapper.close();
		}
	});

program
	.command('stats')
	.description('Show detailed usage statistics')
	.action(async () => {
		try {
			await wrapper.initialize();
			await wrapper.showStats();

			// Show extended analytics
			console.log(chalk.cyan('\n📈 Detailed Analytics:\n'));

			const analytics = await wrapper.getDetailedAnalytics();

			if (analytics.mostActiveHour !== undefined) {
				console.log(`Hour most sessions started: ${analytics.mostActiveHour}:00`);
			}

			if (analytics.mostActiveDay) {
				console.log(`Day most sessions started: ${analytics.mostActiveDay}`);
			}

			// Only show model usage if we have meaningful data
			const knownModels = analytics.modelUsage.filter(m => m.model !== 'unknown');
			if (knownModels.length > 0) {
				console.log('\nModel usage (when specified):');
				knownModels.forEach(m => {
					console.log(`  ${m.model}: ${m.count} sessions`);
				});
			}

			if (analytics.dailyUsage.length > 0) {
				console.log('\nLast 7 days:');
				analytics.dailyUsage.forEach(d => {
					const tokensStr = d.totalTokens > 0 ? `, ${d.totalTokens.toLocaleString()} tokens` : '';
					console.log(`  ${d.date}: ${d.sessions} sessions${tokensStr}`);
				});
			}
		} catch (error) {
			console.error(chalk.red('Error:'), error);
			process.exit(1);
		} finally {
			await wrapper.close();
		}
	});

program
	.command('sessions [count]')
	.description('List recent sessions with token usage')
	.action(async count => {
		try {
			await wrapper.initialize();
			// Use positional argument if provided, otherwise default to 10
			const sessionCount = count ? parseInt(count) : 10;
			await wrapper.listRecentSessions(sessionCount);
		} catch (error) {
			console.error(chalk.red('Error:'), error);
			process.exit(1);
		} finally {
			await wrapper.close();
		}
	});

program
	.command('update-session-length')
	.description('Update the session window length')
	.action(async () => {
		try {
			await updateSessionLength();
		} catch (error) {
			console.error(chalk.red('Error:'), error);
			process.exit(1);
		}
	});

program
	.command('set-subscription-date <day>')
	.description('Set the day of month when your Claude subscription renews (1-31)')
	.action(async (day: string) => {
		try {
			const dayNum = parseInt(day, 10);
			if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
				console.error(chalk.red('Error: Day must be a number between 1 and 31'));
				process.exit(1);
			}

			await configManager.setSubscriptionRenewalDay(dayNum);
			console.log(chalk.green(`✅ Subscription renewal day set to: ${dayNum}`));
			console.log(
				chalk.gray(
					`Your billing cycle stats will now be calculated from the ${dayNum}${getOrdinalSuffix(
						dayNum
					)} of each month`
				)
			);
		} catch (error) {
			console.error(chalk.red('Error:'), error);
			process.exit(1);
		}
	});

// Helper functions
export function getOrdinalSuffix(day: number): string {
	if (day >= 11 && day <= 13) return 'th';
	switch (day % 10) {
		case 1:
			return 'st';
		case 2:
			return 'nd';
		case 3:
			return 'rd';
		default:
			return 'th';
	}
}

async function updateSessionLength() {
	console.log(chalk.cyan('\n⚙️  Update Session Length\n'));

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		const answer = await new Promise<string>(resolve => {
			rl.question('\nEnter new session length in hours (e.g., 5 or 2.5): ', resolve);
		});

		const newHours = parseFloat(answer.trim());

		if (isNaN(newHours) || newHours <= 0) {
			console.error(chalk.red('❌ Invalid input. Please enter a positive number.'));
			return;
		}

		await configManager.updateSessionLength(newHours);

		// Show what this means in minutes for clarity
		const totalMinutes = newHours * 60;
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;

		if (minutes === 0) {
			console.log(chalk.green(`✅ Session length updated to ${hours} hour${hours !== 1 ? 's' : ''}`));
		} else {
			console.log(
				chalk.green(
					`✅ Session length updated to ${hours} hour${hours !== 1 ? 's' : ''} and ${minutes} minute${
						minutes !== 1 ? 's' : ''
					}`
				)
			);
		}

		console.log(chalk.dim('\n💡 This new session length will apply to future sessions.'));
	} finally {
		rl.close();
	}
}

async function showStatus() {
	console.log(chalk.cyan('\n🎅 Santa Claude Status\n'));

	// Check for running Claude instances
	try {
		const { stdout } = await execAsync('ps aux | grep "[c]laude" | grep -v santa-claude | wc -l');
		const claudeCount = parseInt(stdout.trim());
		console.log(`Santa Claude instances running: ${claudeCount}`);
	} catch {
		console.log('Santa Claude instances running: Unable to check');
	}

	// Show session info
	await wrapper.initialize();
	const timeRemaining = await wrapper.getSessionTimeRemaining();
	if (timeRemaining) {
		console.log(
			`\nActive session: ${chalk.yellow(timeRemaining.hours + 'h ' + timeRemaining.minutes + 'm')} remaining`
		);
	} else {
		console.log('\nNo active session');
	}
	await wrapper.close();
}
// Parse command line arguments
// Check if first arg is a known command or help flag
const knownCommands = ['status', 'stats', 'sessions', 'update-session-length', 'set-subscription-date'];
const firstArg = process.argv[2];
const isHelp = firstArg === '--help' || firstArg === '-h' || firstArg === '--version' || firstArg === '-v';

// If it's not a known command or help flag (or no args), treat everything as Claude args
if (!isHelp && (!firstArg || !knownCommands.includes(firstArg))) {
	// Run the default action with all args passed to Claude
	const claudeArgs = process.argv.slice(2);
	(async () => {
		try {
			await wrapper.initialize();
			await wrapper.runSession(claudeArgs);
		} catch (error: any) {
			if (!error.message?.includes('Process exited with code')) {
				console.error(chalk.red('Error:'), error.message);
			}
			process.exit(1);
		} finally {
			await wrapper.close();
		}
	})();
} else {
	// Normal command parsing
	program.parse();
}
