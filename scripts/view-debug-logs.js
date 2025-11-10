#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const logFile = path.resolve(process.cwd(), 'impact-analysis-debug.txt');

function viewLogs() {
  console.log('📋 Impact Analysis Debug Logs');
  console.log('═'.repeat(60));

  if (!fs.existsSync(logFile)) {
    console.log('❌ No debug log file found at:', logFile);
    console.log('   The log file will be created when impact analysis runs.');
    return;
  }

  try {
    const content = fs.readFileSync(logFile, 'utf8');

    if (!content.trim()) {
      console.log('📝 Log file is empty - no analysis has been run yet.');
      return;
    }

    console.log(content);
    console.log('\n═'.repeat(60));
    console.log(`📊 Log file: ${logFile}`);
    console.log(
      `📏 File size: ${(fs.statSync(logFile).size / 1024).toFixed(2)} KB`,
    );
  } catch (error) {
    console.error('❌ Error reading log file:', error.message);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('--watch') || args.includes('-w')) {
  console.log('👀 Watching for changes... (Press Ctrl+C to stop)');

  fs.watchFile(logFile, { interval: 1000 }, (curr, prev) => {
    if (curr.mtime > prev.mtime) {
      console.clear();
      viewLogs();
    }
  });

  // Initial view
  viewLogs();

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n👋 Stopped watching logs');
    process.exit(0);
  });
} else {
  viewLogs();
}



