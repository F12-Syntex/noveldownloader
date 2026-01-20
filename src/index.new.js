#!/usr/bin/env node

/**
 * Novel/Manga/Anime Downloader CLI
 * Unified content downloader supporting multiple sources and content types
 *
 * Entry point - initializes and runs the application
 */

import { run } from './app.js';
import { log } from './logger.js';

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { error: err.message, stack: err.stack });
  console.error('\nAn unexpected error occurred:', err.message);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled rejection', { reason: String(reason) });
  console.error('\nUnhandled promise rejection:', reason);
});

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  console.log('\n');
  process.exit(0);
});

// Run the application
run().catch(err => {
  log.error('Application error', { error: err.message });
  console.error('\nApplication error:', err.message);
  process.exit(1);
});
