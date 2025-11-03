import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'INFO' | 'DEBUG' | 'ERROR' | 'TRACE';

interface LogRecord {
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: any;
}

export class ImpactAnalysisLogger {
  private static instance: ImpactAnalysisLogger;
  private readonly logDir: string;
  private readonly logFile: string;

  private constructor() {
    this.logDir = path.resolve(process.cwd(), 'logs');
    this.logFile = path.resolve(this.logDir, 'impact-analysis.log');
    this.ensureLogDir();
  }

  static getInstance(): ImpactAnalysisLogger {
    if (!ImpactAnalysisLogger.instance) {
      ImpactAnalysisLogger.instance = new ImpactAnalysisLogger();
    }
    return ImpactAnalysisLogger.instance;
  }

  info(scope: string, message: string, data?: any) {
    this.write({ level: 'INFO', scope, message, data });
  }

  debug(scope: string, message: string, data?: any) {
    this.write({ level: 'DEBUG', scope, message, data });
  }

  error(scope: string, message: string, data?: any) {
    this.write({ level: 'ERROR', scope, message, data });
  }

  traceAst(scope: string, message: string, data?: any) {
    this.write({ level: 'TRACE', scope: `AST:${scope}`, message, data });
  }

  private write(partial: Omit<LogRecord, 'timestamp'>) {
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      ...partial,
    };
    try {
      fs.appendFileSync(this.logFile, JSON.stringify(record) + '\n', 'utf8');
    } catch (_) {
      // As a last resort, avoid throwing from logger
    }
  }

  private ensureLogDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      if (!fs.existsSync(this.logFile)) {
        fs.writeFileSync(this.logFile, '', 'utf8');
      }
    } catch (_) {
      // swallow
    }
  }
}

