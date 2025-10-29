#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const logFile = path.resolve(process.cwd(), 'logs', 'impact-analysis.log');

function monitorLogs() {
  console.log('🔍 Monitoring Impact Analysis Logs...');
  console.log('📁 Log file:', logFile);
  console.log('⏹️  Press Ctrl+C to stop\n');

  if (!fs.existsSync(logFile)) {
    console.log(
      '❌ Log file does not exist yet. Waiting for first log entry...\n',
    );
  }

  // Watch for file changes
  fs.watchFile(logFile, { interval: 1000 }, (curr, prev) => {
    if (curr.mtime > prev.mtime) {
      readNewLogs();
    }
  });

  // Read existing logs
  readNewLogs();
}

function readNewLogs() {
  try {
    if (!fs.existsSync(logFile)) return;

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content
      .trim()
      .split('\n')
      .filter((line) => line.trim());

    if (lines.length === 0) return;

    // Get the last few lines
    const recentLines = lines.slice(-10);

    console.log('📊 Recent Impact Analysis Activity:');
    console.log('═'.repeat(50));

    recentLines.forEach((line) => {
      try {
        const log = JSON.parse(line);

        // Add null checks and default values
        const timestamp = log.timestamp
          ? new Date(log.timestamp).toLocaleTimeString()
          : 'Unknown';
        const level = (log.level || 'UNKNOWN').padEnd(5);
        const scope = (log.scope || 'Unknown').padEnd(25);
        const message = log.message || 'No message';

        let color = '';
        switch (log.level) {
          case 'ERROR':
            color = '\x1b[31m';
            break; // Red
          case 'WARN':
            color = '\x1b[33m';
            break; // Yellow
          case 'INFO':
            color = '\x1b[36m';
            break; // Cyan
          case 'DEBUG':
            color = '\x1b[90m';
            break; // Gray
          case 'TRACE':
            color = '\x1b[35m';
            break; // Magenta
          default:
            color = '\x1b[37m'; // White for unknown levels
        }

        console.log(
          `${color}[${timestamp}] ${level} ${scope} ${message}\x1b[0m`,
        );

        if (
          log.data &&
          typeof log.data === 'object' &&
          Object.keys(log.data).length > 0
        ) {
          console.log(
            `    📋 Data: ${JSON.stringify(log.data, null, 2).replace(/\n/g, '\n    ')}`,
          );
        }
      } catch (parseError) {
        console.log(`⚠️  Invalid log line: ${line}`);
      }
    });

    console.log('═'.repeat(50));
    console.log(`📈 Total log entries: ${lines.length}\n`);
  } catch (error) {
    console.error('❌ Error reading log file:', error.message);
  }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n👋 Stopped monitoring logs');
  process.exit(0);
});

// Start monitoring
monitorLogs();
