import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

export default [
	eslint.configs.recommended,
	prettier,
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
				project: './tsconfig.json',
			},
			globals: {
				console: 'readonly',
				process: 'readonly',
				Buffer: 'readonly',
				__dirname: 'readonly',
				__filename: 'readonly',
				setInterval: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				clearInterval: 'readonly',
				NodeJS: 'readonly',
				URL: 'readonly',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],
			'no-unused-vars': 'off', // Turn off base rule in favor of TypeScript rule
			'no-control-regex': 'off', // Allow control characters in regex for ANSI code handling
		},
	},
	{
		ignores: ['dist/**', 'node_modules/**'],
	},
];
