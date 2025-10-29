import * as babel from '@babel/parser';
import * as traverse from '@babel/traverse';
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { PrismaService } from '../../prisma/prisma.service';
import { ImpactAnalysisLogger } from './impact-analysis.logger';
import { SimpleLogger } from './simple-logger';

// Constants for file processing
const VALID_FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

export interface FunctionDefinition {
  name: string;
  file: string;
  line: number;
  signature: string;
  type: 'FUNCTION' | 'METHOD' | 'ARROW_FUNCTION' | 'CLASS_METHOD';
  isExported: boolean;
  parameters: string[];
  returnType?: string;
}

export interface CallsiteInfo {
  functionName: string;
  file: string;
  line: number;
  column: number;
  callCode: string;
  callType: 'DIRECT' | 'METHOD' | 'CALLBACK' | 'IMPORTED' | 'DESTRUCTURED';
  context: {
    importPath?: string;
    callFrequency: 'FREQUENT' | 'MODERATE' | 'RARE';
    callContext: string;
    isInSameDirectory: boolean;
    isInSameModule: boolean;
  };
}

@Injectable()
export class CallsiteDetectorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Extract function definitions from a file using existing FileDocumentation
   */
  async extractFunctionsFromFile(file: any): Promise<FunctionDefinition[]> {
    const logger = ImpactAnalysisLogger.getInstance();
    const functions: FunctionDefinition[] = [];

    try {
      const filePath = file.filename;

      // First try to get from existing FileDocumentation
      const existingDoc = await this.getFileDocumentation(filePath);
      if (existingDoc) {
        logger.traceAst(
          'extractFunctionsFromFile',
          'Using FileDocumentation cache',
          { filePath },
        );
        return this.extractFunctionsFromFileDoc(existingDoc);
      }

      // Fallback to parsing file content if not in FileDocumentation
      const fileContent = await this.getFileContent(filePath);
      if (!fileContent) {
        return functions;
      }

      const fileExtension = path.extname(filePath).toLowerCase();

      if (fileExtension === '.ts' || fileExtension === '.tsx') {
        logger.traceAst('extractFunctionsFromFile', 'Parsing TypeScript AST', {
          filePath,
        });
        return this.extractTypeScriptFunctions(fileContent, filePath);
      } else if (fileExtension === '.js' || fileExtension === '.jsx') {
        logger.traceAst('extractFunctionsFromFile', 'Parsing JavaScript AST', {
          filePath,
        });
        return this.extractJavaScriptFunctions(fileContent, filePath);
      }
    } catch (error) {
      logger.error(
        'extractFunctionsFromFile',
        `Error extracting functions from ${file.filename}`,
        { error: String(error) },
      );
    }

    return functions;
  }

  /**
   * Find all callsites for a specific function
   */
  async findCallsites(
    functionName: string,
    sourceFile: string,
    dependencyMap: any,
    repositoryId: string,
  ): Promise<CallsiteInfo[]> {
    const logger = ImpactAnalysisLogger.getInstance();
    const simpleLogger = SimpleLogger.getInstance();
    const callsites: CallsiteInfo[] = [];

    try {
      simpleLogger.log(`🔍 Finding callsites for function: ${functionName}`, {
        sourceFile,
        repositoryId,
      });

      // Get all files that might contain callsites
      const candidateFiles = await this.getCandidateFiles(
        functionName,
        sourceFile,
        dependencyMap,
        repositoryId,
      );

      simpleLogger.log(`📁 Found ${candidateFiles.length} candidate files`, {
        candidateFiles: candidateFiles.slice(0, 10), // Show first 10 files
      });

      logger.traceAst('findCallsites', 'Candidate files resolved', {
        functionName,
        sourceFile,
        candidates: candidateFiles.length,
      });

      for (const candidateFile of candidateFiles) {
        try {
          simpleLogger.log(`🔎 Searching callsites in: ${candidateFile}`);

          const fileCallsites = await this.findCallsitesInFile(
            functionName,
            candidateFile,
            sourceFile,
          );

          if (fileCallsites.length) {
            simpleLogger.log(
              `✅ Found ${fileCallsites.length} callsites in ${candidateFile}`,
              {
                callsites: fileCallsites.map((c) => ({
                  line: c.line,
                  callCode: c.callCode,
                  callType: c.callType,
                })),
              },
            );

            logger.traceAst('findCallsitesInFile', 'Callsites found', {
              functionName,
              candidateFile,
              count: fileCallsites.length,
            });
          } else {
            simpleLogger.log(`❌ No callsites found in: ${candidateFile}`);
          }

          callsites.push(...fileCallsites);
        } catch (error) {
          simpleLogger.log(`❌ Error searching in ${candidateFile}`, {
            error: String(error),
          });

          logger.error('findCallsitesInFile', `Error in ${candidateFile}`, {
            error: String(error),
          });
        }
      }

      simpleLogger.log(
        `🎯 Total callsites found for ${functionName}: ${callsites.length}`,
        {
          totalCallsites: callsites.length,
          filesWithCallsites: [...new Set(callsites.map((c) => c.file))].length,
        },
      );
    } catch (error) {
      simpleLogger.log(`❌ Error finding callsites for ${functionName}`, {
        error: String(error),
      });

      logger.error(
        'findCallsites',
        `Error finding callsites for ${functionName}`,
        { error: String(error) },
      );
    }

    return callsites;
  }

  /**
   * Extract TypeScript functions using TypeScript compiler API
   */
  private extractTypeScriptFunctions(
    content: string,
    filePath: string,
  ): FunctionDefinition[] {
    const logger = ImpactAnalysisLogger.getInstance();
    const functions: FunctionDefinition[] = [];

    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
      );

      const visit = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node)) {
          const func = this.extractFunctionFromNode(node, filePath, 'FUNCTION');
          if (func) functions.push(func);
        } else if (ts.isMethodDeclaration(node)) {
          const func = this.extractFunctionFromNode(node, filePath, 'METHOD');
          if (func) functions.push(func);
        } else if (
          ts.isArrowFunction(node) &&
          ts.isVariableDeclaration(node.parent)
        ) {
          const func = this.extractArrowFunctionFromNode(node, filePath);
          if (func) functions.push(func);
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
      logger.traceAst('extractTypeScriptFunctions', 'Functions extracted', {
        filePath,
        count: functions.length,
      });
    } catch (error) {
      logger.error(
        'extractTypeScriptFunctions',
        `TS parse error for ${filePath}`,
        { error: String(error) },
      );
    }

    return functions;
  }

  /**
   * Extract JavaScript functions using Babel parser
   */
  private extractJavaScriptFunctions(
    content: string,
    filePath: string,
  ): FunctionDefinition[] {
    const logger = ImpactAnalysisLogger.getInstance();
    const functions: FunctionDefinition[] = [];

    try {
      const ast = babel.parse(content, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript', 'decorators-legacy'],
      });

      traverse.default(ast, {
        FunctionDeclaration: (path) => {
          const func = this.extractFunctionFromBabelPath(
            path,
            filePath,
            'FUNCTION',
          );
          if (func) functions.push(func);
        },
        FunctionExpression: (path) => {
          if (path.parent.type === 'VariableDeclarator') {
            const func = this.extractFunctionFromBabelPath(
              path,
              filePath,
              'FUNCTION',
            );
            if (func) functions.push(func);
          }
        },
        ArrowFunctionExpression: (path) => {
          if (path.parent.type === 'VariableDeclarator') {
            const func = this.extractFunctionFromBabelPath(
              path,
              filePath,
              'ARROW_FUNCTION',
            );
            if (func) functions.push(func);
          }
        },
        ClassMethod: (path) => {
          const func = this.extractFunctionFromBabelPath(
            path,
            filePath,
            'METHOD',
          );
          if (func) functions.push(func);
        },
      });
      logger.traceAst('extractJavaScriptFunctions', 'Functions extracted', {
        filePath,
        count: functions.length,
      });
    } catch (error) {
      logger.error(
        'extractJavaScriptFunctions',
        `JS parse error for ${filePath}`,
        { error: String(error) },
      );
    }

    return functions;
  }

  /**
   * Extract function from TypeScript AST node
   */
  private extractFunctionFromNode(
    node: any,
    filePath: string,
    type: string,
  ): FunctionDefinition | null {
    try {
      const name = node.name?.text || 'anonymous';
      const line =
        node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
          .line + 1;
      const signature = node.getText();
      const isExported = this.hasExportModifier(node);
      const parameters =
        node.parameters?.map((param: any) => param.name?.text || 'unknown') ||
        [];
      const returnType = node.type?.getText();

      return {
        name,
        file: filePath,
        line,
        signature,
        type: type as any,
        isExported,
        parameters,
        returnType,
      };
    } catch (error) {
      const logger = ImpactAnalysisLogger.getInstance();
      logger.error(
        'extractFunctionFromNode',
        'Error extracting function from TypeScript node',
        { error: String(error), filePath, nodeType: node.kind },
      );
      return null;
    }
  }

  /**
   * Extract arrow function from TypeScript AST node
   */
  private extractArrowFunctionFromNode(
    node: any,
    filePath: string,
  ): FunctionDefinition | null {
    try {
      const parent = node.parent;
      const name = parent.name?.text || 'anonymous';
      const line =
        node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
          .line + 1;
      const signature = node.getText();
      const isExported = this.hasExportModifier(parent);
      const parameters =
        node.parameters?.map((param: any) => param.name?.text || 'unknown') ||
        [];

      return {
        name,
        file: filePath,
        line,
        signature,
        type: 'ARROW_FUNCTION',
        isExported,
        parameters,
      };
    } catch (error) {
      console.error(
        'Error extracting arrow function from TypeScript node:',
        error,
      );
      return null;
    }
  }

  /**
   * Extract function from Babel AST path
   */
  private extractFunctionFromBabelPath(
    path: any,
    filePath: string,
    type: string,
  ): FunctionDefinition | null {
    try {
      const node = path.node;
      const name = node.id?.name || node.key?.name || 'anonymous';
      const line = node.loc?.start?.line || 1;
      const signature = this.getFunctionSignature(node);
      const isExported = this.isExportedInBabel(path);
      const parameters =
        node.params?.map((param: any) => param.name || 'unknown') || [];

      return {
        name,
        file: filePath,
        line,
        signature,
        type: type as any,
        isExported,
        parameters,
      };
    } catch (error) {
      console.error('Error extracting function from Babel path:', error);
      return null;
    }
  }

  /**
   * Find callsites in a specific file
   */
  private async findCallsitesInFile(
    functionName: string,
    filePath: string,
    sourceFile: string,
  ): Promise<CallsiteInfo[]> {
    const callsites: CallsiteInfo[] = [];

    try {
      const content = await this.getFileContent(filePath);
      if (!content) return callsites;

      const fileExtension = path.extname(filePath).toLowerCase();

      if (fileExtension === '.ts' || fileExtension === '.tsx') {
        return this.findCallsitesInTypeScriptFile(
          functionName,
          content,
          filePath,
          sourceFile,
        );
      } else if (fileExtension === '.js' || fileExtension === '.jsx') {
        return this.findCallsitesInJavaScriptFile(
          functionName,
          content,
          filePath,
          sourceFile,
        );
      }
    } catch (error) {
      console.error(`Error finding callsites in ${filePath}:`, error);
    }

    return callsites;
  }

  /**
   * Find callsites in TypeScript file
   */
  private findCallsitesInTypeScriptFile(
    functionName: string,
    content: string,
    filePath: string,
    sourceFile: string,
  ): CallsiteInfo[] {
    const logger = ImpactAnalysisLogger.getInstance();
    const callsites: CallsiteInfo[] = [];

    try {
      const sourceFileObj = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
      );

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const callsite = this.extractCallsiteFromCallExpression(
            node,
            functionName,
            filePath,
            sourceFile,
          );
          if (callsite) callsites.push(callsite);
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFileObj);
      if (callsites.length) {
        logger.traceAst(
          'findCallsitesInTypeScriptFile',
          'Callsites extracted',
          { functionName, filePath, count: callsites.length },
        );
      }
    } catch (error) {
      logger.error(
        'findCallsitesInTypeScriptFile',
        `TS callsite error in ${filePath}`,
        { error: String(error) },
      );
    }

    return callsites;
  }

  /**
   * Find callsites in JavaScript file
   */
  private findCallsitesInJavaScriptFile(
    functionName: string,
    content: string,
    filePath: string,
    sourceFile: string,
  ): CallsiteInfo[] {
    const logger = ImpactAnalysisLogger.getInstance();
    const callsites: CallsiteInfo[] = [];

    try {
      const ast = babel.parse(content, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript', 'decorators-legacy'],
      });

      traverse.default(ast, {
        CallExpression: (path) => {
          const callsite = this.extractCallsiteFromBabelCallExpression(
            path,
            functionName,
            filePath,
            sourceFile,
          );
          if (callsite) callsites.push(callsite);
        },
      });
      if (callsites.length) {
        logger.traceAst(
          'findCallsitesInJavaScriptFile',
          'Callsites extracted',
          { functionName, filePath, count: callsites.length },
        );
      }
    } catch (error) {
      logger.error(
        'findCallsitesInJavaScriptFile',
        `JS callsite error in ${filePath}`,
        { error: String(error) },
      );
    }

    return callsites;
  }

  /**
   * Extract callsite from TypeScript call expression
   */
  private extractCallsiteFromCallExpression(
    node: ts.CallExpression,
    functionName: string,
    filePath: string,
    sourceFile: string,
  ): CallsiteInfo | null {
    try {
      const expression = node.expression;
      let calledFunctionName = '';

      if (ts.isIdentifier(expression)) {
        calledFunctionName = expression.text;
      } else if (ts.isPropertyAccessExpression(expression)) {
        calledFunctionName = expression.name.text;
      }

      if (calledFunctionName !== functionName) {
        return null;
      }

      const line =
        node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
          .line + 1;
      const column =
        node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
          .character + 1;
      const callCode = node.getText();
      const callType = this.determineCallType(node);
      const context = this.buildCallContext(node, filePath, sourceFile);

      return {
        functionName,
        file: filePath,
        line,
        column,
        callCode,
        callType,
        context,
      };
    } catch (error) {
      console.error(
        'Error extracting callsite from TypeScript call expression:',
        error,
      );
      return null;
    }
  }

  /**
   * Extract callsite from Babel call expression
   */
  private extractCallsiteFromBabelCallExpression(
    path: any,
    functionName: string,
    filePath: string,
    sourceFile: string,
  ): CallsiteInfo | null {
    try {
      const node = path.node;
      let calledFunctionName = '';

      if (node.callee.type === 'Identifier') {
        calledFunctionName = node.callee.name;
      } else if (node.callee.type === 'MemberExpression') {
        calledFunctionName = node.callee.property.name;
      }

      if (calledFunctionName !== functionName) {
        return null;
      }

      const line = node.loc?.start?.line || 1;
      const column = node.loc?.start?.column || 0;
      const callCode = this.getCallCodeFromBabelNode(node);
      const callType = this.determineCallTypeFromBabel(node);
      const context = this.buildCallContextFromBabel(
        path,
        filePath,
        sourceFile,
      );

      return {
        functionName,
        file: filePath,
        line,
        column,
        callCode,
        callType,
        context,
      };
    } catch (error) {
      console.error(
        'Error extracting callsite from Babel call expression:',
        error,
      );
      return null;
    }
  }

  /**
   * Get candidate files that might contain callsites
   */
  private async getCandidateFiles(
    functionName: string,
    sourceFile: string,
    dependencyMap: any,
    repositoryId: string,
  ): Promise<string[]> {
    const candidateFiles = new Set<string>();

    try {
      // Add source file directory files
      const sourceDir = path.dirname(sourceFile);
      const sourceDirFiles = await this.getFilesInDirectory(sourceDir);
      sourceDirFiles.forEach((file) => candidateFiles.add(file));

      // Add files that import from source file
      const importedBy = dependencyMap?.importedBy?.[sourceFile] || [];
      importedBy.forEach((file) => candidateFiles.add(file));

      // Add files that might import the function
      const allFiles = await this.getAllRepositoryFiles(repositoryId);
      for (const file of allFiles) {
        if (
          await this.fileMightImportFunction(file, functionName, sourceFile)
        ) {
          candidateFiles.add(file);
        }
      }
    } catch (error) {
      console.error('Error getting candidate files:', error);
    }

    return Array.from(candidateFiles);
  }

  /**
   * Helper methods
   */
  private hasExportModifier(node: any): boolean {
    return (
      node.modifiers?.some(
        (mod: any) => mod.kind === ts.SyntaxKind.ExportKeyword,
      ) || false
    );
  }

  private isExportedInBabel(path: any): boolean {
    return (
      path.parent.type === 'ExportNamedDeclaration' ||
      path.parent.type === 'ExportDefaultDeclaration'
    );
  }

  private getFunctionSignature(node: any): string {
    // Implementation to extract function signature
    return node.toString();
  }

  private determineCallType(
    node: any,
  ): 'DIRECT' | 'METHOD' | 'CALLBACK' | 'IMPORTED' | 'DESTRUCTURED' {
    if (ts.isPropertyAccessExpression(node.expression)) {
      return 'METHOD';
    }
    return 'DIRECT';
  }

  private determineCallTypeFromBabel(
    node: any,
  ): 'DIRECT' | 'METHOD' | 'CALLBACK' | 'IMPORTED' | 'DESTRUCTURED' {
    if (node.callee.type === 'MemberExpression') {
      return 'METHOD';
    }
    return 'DIRECT';
  }

  private buildCallContext(
    node: any,
    filePath: string,
    sourceFile: string,
  ): any {
    const isInSameDirectory =
      path.dirname(filePath) === path.dirname(sourceFile);
    const isInSameModule = this.isInSameModule(filePath, sourceFile);

    return {
      callFrequency: 'MODERATE',
      callContext: 'Unknown',
      isInSameDirectory,
      isInSameModule,
    };
  }

  private buildCallContextFromBabel(
    path: any,
    filePath: string,
    sourceFile: string,
  ): any {
    const isInSameDirectory =
      path.dirname(filePath) === path.dirname(sourceFile);
    const isInSameModule = this.isInSameModule(filePath, sourceFile);

    return {
      callFrequency: 'MODERATE',
      callContext: 'Unknown',
      isInSameDirectory,
      isInSameModule,
    };
  }

  private getCallCodeFromBabelNode(node: any): string {
    // Implementation to extract call code from Babel node
    return node.toString();
  }

  private isInSameModule(filePath: string, sourceFile: string): boolean {
    // Implementation to determine if files are in the same module
    return path.dirname(filePath) === path.dirname(sourceFile);
  }

  private async getFileContent(filePath: string): Promise<string | null> {
    const logger = ImpactAnalysisLogger.getInstance();
    try {
      // Check if path exists and is a file
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        logger.debug('getFileContent', 'Skipping non-file path', {
          filePath,
          isDirectory: stats.isDirectory(),
        });
        return null;
      }

      // Check if file has a valid extension
      const fileExtension = path.extname(filePath).toLowerCase();
      if (!VALID_FILE_EXTENSIONS.includes(fileExtension)) {
        logger.debug('getFileContent', 'Skipping unsupported file type', {
          filePath,
          extension: fileExtension,
        });
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      logger.traceAst('getFileContent', 'File content read successfully', {
        filePath,
        size: content.length,
      });
      return content;
    } catch (error) {
      logger.error('getFileContent', `Error reading file ${filePath}`, {
        error: String(error),
      });
      return null;
    }
  }

  private async getFilesInDirectory(dirPath: string): Promise<string[]> {
    try {
      const files = fs.readdirSync(dirPath);
      return files.map((file) => path.join(dirPath, file));
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
      return [];
    }
  }

  private async getAllRepositoryFiles(repositoryId: string): Promise<string[]> {
    const logger = ImpactAnalysisLogger.getInstance();
    const simpleLogger = SimpleLogger.getInstance();

    try {
      // First try to get from FileDocumentation table
      const fileDocs = await this.prisma.fileDocumentation.findMany({
        where: { repositoryId },
        select: { fullPath: true },
      });

      if (fileDocs.length > 0) {
        simpleLogger.log(
          `📚 Found ${fileDocs.length} files in FileDocumentation table`,
        );

        // Filter out directories and only keep valid files
        const validFiles = fileDocs
          .map((doc) => doc.fullPath)
          .filter((filePath) => {
            try {
              const stats = fs.statSync(filePath);
              const isValidFile = stats.isFile();
              const hasValidExtension = ['.ts', '.tsx', '.js', '.jsx'].includes(
                path.extname(filePath).toLowerCase(),
              );

              if (!isValidFile) {
                logger.debug(
                  'getAllRepositoryFiles',
                  'Filtering out directory',
                  {
                    filePath,
                  },
                );
              } else if (!hasValidExtension) {
                logger.debug(
                  'getAllRepositoryFiles',
                  'Filtering out unsupported file type',
                  { filePath },
                );
              }

              return isValidFile && hasValidExtension;
            } catch (error) {
              logger.debug(
                'getAllRepositoryFiles',
                'File not accessible, filtering out',
                { filePath, error: String(error) },
              );
              return false;
            }
          });

        simpleLogger.log(
          `✅ Filtered to ${validFiles.length} valid files from FileDocumentation`,
        );

        logger.info('getAllRepositoryFiles', 'Repository files filtered', {
          total: fileDocs.length,
          valid: validFiles.length,
        });

        return validFiles;
      } else {
        // Fallback: Scan file system directly
        simpleLogger.log(
          '⚠️ No files in FileDocumentation, scanning file system directly',
        );
        return await this.scanFileSystemForFiles(repositoryId);
      }
    } catch (error) {
      simpleLogger.log(
        '❌ Error getting repository files, falling back to file system scan',
        {
          error: String(error),
        },
      );

      logger.error('getAllRepositoryFiles', 'Error getting repository files', {
        error: String(error),
      });

      // Fallback to file system scan
      return await this.scanFileSystemForFiles(repositoryId);
    }
  }

  private async scanFileSystemForFiles(
    repositoryId: string,
  ): Promise<string[]> {
    const simpleLogger = SimpleLogger.getInstance();
    const logger = ImpactAnalysisLogger.getInstance();

    try {
      // Get repository info from database
      const repository = await this.prisma.repository.findUnique({
        where: { id: repositoryId },
        select: { name: true, owner: true },
      });

      if (!repository) {
        simpleLogger.log('❌ Repository not found', { repositoryId });
        return [];
      }

      // For now, we'll use a default path structure
      // In a real implementation, you'd need to store the actual local path
      const defaultPath = path.resolve(
        process.cwd(),
        'repositories',
        repository.owner,
        repository.name,
      );

      // Check if directory exists before scanning
      if (!fs.existsSync(defaultPath)) {
        simpleLogger.log(`⚠️ Repository directory not found: ${defaultPath}`);
        return [];
      }

      simpleLogger.log(`🔍 Scanning file system at: ${defaultPath}`);

      const allFiles: string[] = [];
      const validExtensions = ['.ts', '.tsx', '.js', '.jsx'];
      const skipDirs = new Set([
        'node_modules',
        '.git',
        'dist',
        'build',
        '.next',
        'coverage',
        '.vscode',
        '.idea',
        'coverage',
        'logs',
      ]);

      const scanDirectory = (dirPath: string) => {
        try {
          const items = fs.readdirSync(dirPath);

          for (const item of items) {
            const fullPath = path.join(dirPath, item);

            try {
              const stats = fs.statSync(fullPath);

              if (stats.isDirectory()) {
                // Skip known directories that don't contain source code
                if (!skipDirs.has(item) && !item.startsWith('.')) {
                  scanDirectory(fullPath);
                }
              } else if (stats.isFile()) {
                const ext = path.extname(fullPath).toLowerCase();
                if (validExtensions.includes(ext)) {
                  allFiles.push(fullPath);
                }
              }
            } catch (statError) {
              // Skip files that can't be accessed
              continue;
            }
          }
        } catch (error) {
          simpleLogger.log(`⚠️ Error scanning directory ${dirPath}`, {
            error: String(error),
          });
        }
      };

      scanDirectory(defaultPath);

      simpleLogger.log(
        `✅ File system scan complete: ${allFiles.length} files found`,
        {
          files: allFiles.slice(0, 10), // Show first 10 files
        },
      );

      logger.info('scanFileSystemForFiles', 'File system scan completed', {
        repositoryId,
        fileCount: allFiles.length,
      });

      return allFiles;
    } catch (error) {
      simpleLogger.log('❌ Error scanning file system', {
        error: String(error),
      });

      logger.error('scanFileSystemForFiles', 'Error scanning file system', {
        error: String(error),
      });
      return [];
    }
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
   * Extract functions from existing FileDocumentation
   */
  private extractFunctionsFromFileDoc(fileDoc: any): FunctionDefinition[] {
    const functions: FunctionDefinition[] = [];

    try {
      // Parse functions from the JSON field
      const functionsData =
        typeof fileDoc.functions === 'string'
          ? JSON.parse(fileDoc.functions)
          : fileDoc.functions;

      if (Array.isArray(functionsData)) {
        functionsData.forEach((func: any) => {
          functions.push({
            name: func.name || 'anonymous',
            file: fileDoc.fullPath,
            line: func.line || 1,
            signature: func.signature || func.toString(),
            type: func.type || 'FUNCTION',
            isExported: func.isExported || false,
            parameters: func.parameters || [],
            returnType: func.returnType,
          });
        });
      }
    } catch (error) {
      console.error(
        'Error extracting functions from file documentation:',
        error,
      );
    }

    return functions;
  }

  private async fileMightImportFunction(
    filePath: string,
    functionName: string,
    sourceFile: string,
  ): Promise<boolean> {
    // Implementation to check if file might import the function
    // This would parse import statements
    return false;
  }
}
