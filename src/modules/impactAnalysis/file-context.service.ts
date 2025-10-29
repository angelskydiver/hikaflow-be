import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';

// Constants for complexity analysis thresholds
const COMPLEXITY_THRESHOLDS = {
  HIGH: {
    lines: 500,
    functions: 20,
    complexity: 50,
  },
  MEDIUM: {
    lines: 200,
    functions: 10,
    complexity: 20,
  },
} as const;

export interface FileContext {
  filePath: string;
  directory: string;
  module: string;
  isTestFile: boolean;
  isConfigFile: boolean;
  isCoreFile: boolean;
  fileType: 'COMPONENT' | 'SERVICE' | 'UTILITY' | 'CONFIG' | 'TEST' | 'UNKNOWN';
  dependencies: string[];
  dependents: string[];
  complexity: 'LOW' | 'MEDIUM' | 'HIGH';
  lastModified: Date;
  size: number;
}

@Injectable()
export class FileContextService {
  constructor(private readonly prisma: PrismaService) {}
  /**
   * Analyze file context using existing FileDocumentation
   */
  async analyzeFileContext(filePath: string): Promise<FileContext> {
    try {
      // First try to get from existing FileDocumentation
      const fileDoc = await this.getFileDocumentation(filePath);
      if (fileDoc) {
        return this.extractContextFromFileDoc(fileDoc);
      }

      // Fallback to analyzing file directly
      const stats = await this.getFileStats(filePath);
      const directory = path.dirname(filePath);
      const module = this.extractModuleFromPath(filePath);
      const isTestFile = this.isTestFile(filePath);
      const isConfigFile = this.isConfigFile(filePath);
      const isCoreFile = this.isCoreFile(filePath);
      const fileType = this.determineFileType(filePath);
      const complexity = await this.analyzeFileComplexity(filePath);

      return {
        filePath,
        directory,
        module,
        isTestFile,
        isConfigFile,
        isCoreFile,
        fileType,
        dependencies: [], // Will be populated by dependency analyzer
        dependents: [], // Will be populated by dependency analyzer
        complexity,
        lastModified: stats.mtime,
        size: stats.size,
      };
    } catch (error) {
      console.error(`Error analyzing file context for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Get files in the same directory
   */
  async getFilesInSameDirectory(filePath: string): Promise<string[]> {
    try {
      const directory = path.dirname(filePath);
      const files = await fs.promises.readdir(directory);

      // Use Promise.all to check file stats asynchronously
      const fileStats = await Promise.all(
        files.map(async (file) => {
          const fullPath = path.join(directory, file);
          try {
            const stats = await fs.promises.stat(fullPath);
            return {
              file,
              fullPath,
              isFile: stats.isFile(),
              isCodeFile: this.isCodeFile(fullPath),
            };
          } catch (error) {
            // Skip files that can't be accessed
            return null;
          }
        }),
      );

      return fileStats
        .filter(
          (fileInfo) => fileInfo && fileInfo.isFile && fileInfo.isCodeFile,
        )
        .map((fileInfo) => fileInfo!.fullPath);
    } catch (error) {
      console.error(
        `Error getting files in same directory for ${filePath}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Get files in the same module
   */
  async getFilesInSameModule(filePath: string): Promise<string[]> {
    try {
      const module = this.extractModuleFromPath(filePath);
      const moduleDir = this.getModuleDirectory(filePath, module);

      if (!moduleDir) {
        return [];
      }

      const files = await this.getAllFilesInDirectory(moduleDir);
      return files.filter((file) => this.isCodeFile(file));
    } catch (error) {
      console.error(
        `Error getting files in same module for ${filePath}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Determine if two files are in the same module
   */
  areFilesInSameModule(filePath1: string, filePath2: string): boolean {
    const module1 = this.extractModuleFromPath(filePath1);
    const module2 = this.extractModuleFromPath(filePath2);
    return module1 === module2;
  }

  /**
   * Determine if two files are in the same directory
   */
  areFilesInSameDirectory(filePath1: string, filePath2: string): boolean {
    const dir1 = path.dirname(filePath1);
    const dir2 = path.dirname(filePath2);
    return dir1 === dir2;
  }

  /**
   * Get file priority based on context
   */
  getFilePriority(filePath: string): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (this.isCoreFile(filePath)) {
      return 'HIGH';
    }

    if (this.isConfigFile(filePath) || this.isTestFile(filePath)) {
      return 'LOW';
    }

    return 'MEDIUM';
  }

  /**
   * Get call frequency based on file context
   */
  getCallFrequency(
    filePath: string,
    functionName: string,
  ): 'FREQUENT' | 'MODERATE' | 'RARE' {
    if (this.isCoreFile(filePath)) {
      return 'FREQUENT';
    }

    if (this.isTestFile(filePath)) {
      return 'RARE';
    }

    // Check if function is commonly used
    if (this.isCommonFunction(functionName)) {
      return 'FREQUENT';
    }

    return 'MODERATE';
  }

  /**
   * Get call context description
   */
  getCallContext(filePath: string, functionName: string): string {
    if (this.isTestFile(filePath)) {
      return 'Test environment';
    }

    if (this.isConfigFile(filePath)) {
      return 'Configuration setup';
    }

    if (this.isCoreFile(filePath)) {
      return 'Core application logic';
    }

    const fileType = this.determineFileType(filePath);
    switch (fileType) {
      case 'COMPONENT':
        return 'React component';
      case 'SERVICE':
        return 'Service layer';
      case 'UTILITY':
        return 'Utility function';
      default:
        return 'Application code';
    }
  }

  /**
   * Extract module from file path
   */
  private extractModuleFromPath(filePath: string): string {
    const pathParts = filePath.split(path.sep);

    // Find the first directory that looks like a module
    const moduleIndex = pathParts.findIndex(
      (part) =>
        ![
          'src',
          'lib',
          'dist',
          'build',
          'node_modules',
          'components',
          'utils',
          'services',
        ].includes(part),
    );

    if (moduleIndex !== -1 && moduleIndex < pathParts.length - 1) {
      return pathParts[moduleIndex];
    }

    // Fallback to parent directory
    return path.basename(path.dirname(filePath));
  }

  /**
   * Get module directory
   */
  private getModuleDirectory(filePath: string, module: string): string | null {
    const pathParts = filePath.split(path.sep);
    const moduleIndex = pathParts.findIndex((part) => part === module);

    if (moduleIndex !== -1) {
      return pathParts.slice(0, moduleIndex + 1).join(path.sep);
    }

    return null;
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const directory = path.dirname(filePath);

    return (
      fileName.includes('.test.') ||
      fileName.includes('.spec.') ||
      fileName.endsWith('.test.js') ||
      fileName.endsWith('.test.ts') ||
      fileName.endsWith('.spec.js') ||
      fileName.endsWith('.spec.ts') ||
      directory.includes('test') ||
      directory.includes('spec') ||
      directory.includes('__tests__')
    );
  }

  /**
   * Check if file is a config file
   */
  private isConfigFile(filePath: string): boolean {
    const fileName = path.basename(filePath);

    return (
      fileName.includes('config') ||
      fileName.includes('Config') ||
      fileName.endsWith('.config.js') ||
      fileName.endsWith('.config.ts') ||
      fileName === 'package.json' ||
      fileName === 'tsconfig.json' ||
      fileName === 'webpack.config.js' ||
      fileName === 'next.config.js'
    );
  }

  /**
   * Check if file is a core file
   */
  private isCoreFile(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const directory = path.dirname(filePath);

    return (
      fileName === 'index.js' ||
      fileName === 'index.ts' ||
      fileName === 'main.js' ||
      fileName === 'main.ts' ||
      fileName === 'app.js' ||
      fileName === 'app.ts' ||
      directory.includes('core') ||
      directory.includes('main') ||
      directory.includes('app')
    );
  }

  /**
   * Check if file is a code file
   */
  private isCodeFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return [
      '.js',
      '.jsx',
      '.ts',
      '.tsx',
      '.py',
      '.java',
      '.cs',
      '.cpp',
      '.c',
      '.go',
      '.rs',
    ].includes(ext);
  }

  /**
   * Determine file type
   */
  private determineFileType(
    filePath: string,
  ): 'COMPONENT' | 'SERVICE' | 'UTILITY' | 'CONFIG' | 'TEST' | 'UNKNOWN' {
    if (this.isTestFile(filePath)) {
      return 'TEST';
    }

    if (this.isConfigFile(filePath)) {
      return 'CONFIG';
    }

    const fileName = path.basename(filePath);
    const directory = path.dirname(filePath);

    if (
      fileName.includes('component') ||
      fileName.includes('Component') ||
      directory.includes('component') ||
      directory.includes('Component')
    ) {
      return 'COMPONENT';
    }

    if (
      fileName.includes('service') ||
      fileName.includes('Service') ||
      directory.includes('service') ||
      directory.includes('Service')
    ) {
      return 'SERVICE';
    }

    if (
      fileName.includes('util') ||
      fileName.includes('Util') ||
      directory.includes('util') ||
      directory.includes('Util') ||
      directory.includes('utils') ||
      directory.includes('Utils')
    ) {
      return 'UTILITY';
    }

    return 'UNKNOWN';
  }

  /**
   * Analyze file complexity
   */
  private async analyzeFileComplexity(
    filePath: string,
  ): Promise<'LOW' | 'MEDIUM' | 'HIGH'> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      const lines = content.split('\n').length;
      const functions = (
        content.match(/function\s+\w+|const\s+\w+\s*=\s*\(|class\s+\w+/g) || []
      ).length;
      const complexity = (
        content.match(/if\s*\(|for\s*\(|while\s*\(|switch\s*\(/g) || []
      ).length;

      if (
        lines > COMPLEXITY_THRESHOLDS.HIGH.lines ||
        functions > COMPLEXITY_THRESHOLDS.HIGH.functions ||
        complexity > COMPLEXITY_THRESHOLDS.HIGH.complexity
      ) {
        return 'HIGH';
      }

      if (
        lines > COMPLEXITY_THRESHOLDS.MEDIUM.lines ||
        functions > COMPLEXITY_THRESHOLDS.MEDIUM.functions ||
        complexity > COMPLEXITY_THRESHOLDS.MEDIUM.complexity
      ) {
        return 'MEDIUM';
      }

      return 'LOW';
    } catch (error) {
      console.error(`Error analyzing file complexity for ${filePath}:`, error);
      return 'MEDIUM';
    }
  }

  /**
   * Check if function is commonly used
   */
  private isCommonFunction(functionName: string): boolean {
    const commonFunctions = [
      'render',
      'componentDidMount',
      'componentWillUnmount',
      'useEffect',
      'useState',
      'useCallback',
      'useMemo',
      'map',
      'filter',
      'reduce',
      'forEach',
      'get',
      'post',
      'put',
      'delete',
      'create',
      'update',
      'delete',
      'find',
      'validate',
      'format',
      'parse',
      'stringify',
    ];

    return commonFunctions.some((func) =>
      functionName.toLowerCase().includes(func.toLowerCase()),
    );
  }

  /**
   * Get file stats
   */
  private async getFileStats(filePath: string): Promise<fs.Stats> {
    return await fs.promises.stat(filePath);
  }

  /**
   * Get file documentation from existing FileDocumentation table
   */
  private async getFileDocumentation(filePath: string): Promise<any> {
    try {
      return await this.prisma.fileDocumentation.findFirst({
        where: { fullPath: filePath },
      });
    } catch (error) {
      console.error(`Error getting file documentation for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Extract context from existing FileDocumentation
   */
  private extractContextFromFileDoc(fileDoc: any): FileContext {
    const directory = path.dirname(fileDoc.fullPath);
    const module = this.extractModuleFromPath(fileDoc.fullPath);
    const isTestFile = this.isTestFile(fileDoc.fullPath);
    const isConfigFile = this.isConfigFile(fileDoc.fullPath);
    const isCoreFile = this.isCoreFile(fileDoc.fullPath);
    const fileType = this.determineFileTypeFromDoc(fileDoc);

    return {
      filePath: fileDoc.fullPath,
      directory,
      module,
      isTestFile,
      isConfigFile,
      isCoreFile,
      fileType,
      dependencies: fileDoc.imports || [],
      dependents: [], // Will be populated by dependency analyzer
      complexity: this.analyzeComplexityFromDoc(fileDoc),
      lastModified: fileDoc.updatedAt,
      size: 0, // Not stored in FileDocumentation
    };
  }

  /**
   * Determine file type from FileDocumentation
   */
  private determineFileTypeFromDoc(
    fileDoc: any,
  ): 'COMPONENT' | 'SERVICE' | 'UTILITY' | 'CONFIG' | 'TEST' | 'UNKNOWN' {
    if (this.isTestFile(fileDoc.fullPath)) {
      return 'TEST';
    }

    if (this.isConfigFile(fileDoc.fullPath)) {
      return 'CONFIG';
    }

    // Check fileType array from FileDocumentation
    if (Array.isArray(fileDoc.fileType)) {
      if (fileDoc.fileType.includes('COMPONENT')) return 'COMPONENT';
      if (fileDoc.fileType.includes('SERVICE')) return 'SERVICE';
      if (fileDoc.fileType.includes('UTILITY')) return 'UTILITY';
    }

    return 'UNKNOWN';
  }

  /**
   * Analyze complexity from FileDocumentation
   */
  private analyzeComplexityFromDoc(fileDoc: any): 'LOW' | 'MEDIUM' | 'HIGH' {
    // Simple heuristic based on functions count
    try {
      const functions =
        typeof fileDoc.functions === 'string'
          ? JSON.parse(fileDoc.functions)
          : fileDoc.functions;

      const functionCount = Array.isArray(functions) ? functions.length : 0;

      if (functionCount > 20) return 'HIGH';
      if (functionCount > 10) return 'MEDIUM';
      return 'LOW';
    } catch (error) {
      return 'MEDIUM';
    }
  }

  /**
   * Get all files in directory recursively
   */
  private async getAllFilesInDirectory(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.promises.readdir(dirPath, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          const subFiles = await this.getAllFilesInDirectory(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile() && this.isCodeFile(fullPath)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
    }

    return files;
  }

  /**
   * Update file context with dependency information
   */
  updateFileContextWithDependencies(
    fileContext: FileContext,
    dependencies: string[],
    dependents: string[],
  ): FileContext {
    return {
      ...fileContext,
      dependencies,
      dependents,
    };
  }

  /**
   * Get related files based on context
   */
  async getRelatedFiles(filePath: string): Promise<{
    sameDirectory: string[];
    sameModule: string[];
    relatedByDependency: string[];
  }> {
    const sameDirectory = await this.getFilesInSameDirectory(filePath);
    const sameModule = await this.getFilesInSameModule(filePath);

    // This would be populated by the dependency analyzer
    const relatedByDependency: string[] = [];

    return {
      sameDirectory,
      sameModule,
      relatedByDependency,
    };
  }
}
