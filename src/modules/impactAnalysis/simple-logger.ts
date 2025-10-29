import * as fs from 'fs';
import * as path from 'path';

/**
 * SimpleLogger - Local Development Only
 * This logger only works in local/development environments.
 * In production, all logging methods are no-ops to avoid performance impact.
 */
export class SimpleLogger {
  private static instance: SimpleLogger;
  private readonly logFile: string;
  private readonly isLocalEnvironment: boolean;

  private constructor() {
    this.isLocalEnvironment =
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'local';
    this.logFile = path.resolve(process.cwd(), 'impact-analysis-debug.txt');
  }

  static getInstance(): SimpleLogger {
    if (!SimpleLogger.instance) {
      SimpleLogger.instance = new SimpleLogger();
    }
    return SimpleLogger.instance;
  }

  log(message: string, data?: any) {
    // Only log in local/development environment
    if (!this.isLocalEnvironment) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    const dataStr = data ? `\n  Data: ${JSON.stringify(data, null, 2)}` : '';
    const fullEntry = logEntry + dataStr + '\n' + '─'.repeat(80) + '\n';

    try {
      fs.appendFileSync(this.logFile, fullEntry, 'utf8');
    } catch (error) {
      // Silently fail in production
      if (this.isLocalEnvironment) {
        console.error('Failed to write to log file:', error);
      }
    }
  }

  clear() {
    // Only clear in local/development environment
    if (!this.isLocalEnvironment) {
      return;
    }

    try {
      if (fs.existsSync(this.logFile)) {
        fs.unlinkSync(this.logFile);
      }
    } catch (error) {
      // Silently fail in production
      if (this.isLocalEnvironment) {
        console.error('Failed to clear log file:', error);
      }
    }
  }
}
