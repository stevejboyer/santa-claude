import { readFileSync } from 'fs';

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

export function formatDate(date: Date): string {
	const month = date.getMonth() + 1;
	const day = date.getDate();
	const year = date.getFullYear();
	const hours = date.getHours();
	const minutes = date.getMinutes();
	const ampm = hours >= 12 ? 'pm' : 'am';
	const displayHours = hours % 12 || 12;
	const displayMinutes = minutes.toString().padStart(2, '0');
	return `${month}/${day}/${year} ${displayHours}:${displayMinutes}${ampm}`;
}

export function getPackageVersion(): string {
	try {
		// Resolve package.json relative to compiled file location (dist/*.js)
		const pkgUrl = new URL('../package.json', import.meta.url);
		const pkg = JSON.parse(readFileSync(pkgUrl, 'utf-8')) as { version?: string };
		return pkg.version ?? '0.0.0';
	} catch (_err) {
		return '0.0.0';
	}
}
