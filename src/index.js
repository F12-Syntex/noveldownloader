#!/usr/bin/env node

/**
 * Content Downloader CLI
 * Entry point - delegates to app orchestrator
 */

import { run } from './app.js';
import { log } from './logger.js';

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\nGoodbye!\n');
  process.exit(0);
});

// Run application
run().catch(err => {
  log.error('Fatal error', { error: err.message, stack: err.stack });
  console.error('Fatal error:', err.message);
  process.exit(1);
});
