import * as babel from '@babel/parser';
import * as traverse from '@babel/traverse';
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { PrismaService } from '../../prisma/prisma.service';
import { ImpactAnalysisLogger } from './impact-analysis.logger';
import { SimpleLogger } from './simple-logger';

export interface DependencyMap {
  imports: Record<string, string[]>; // file -> imported files
  importedBy: Record<string, string[]>; // file -> files that import it
  exports: Record<string, string[]>; // file -> exported symbols
  impacts: Record<string, string[]>; // file -> files it impacts
  modules: Record<string, string[]>; // module -> files in module
}

export interface ImportInfo {
  file: string;
  importedFrom: string;
  symbol: string;
  type: 'NAMED' | 'DEFAULT' | 'NAMESPACE';
  isReExport: boolean;
}

@Injectable()
export class DependencyAnalyzerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build comprehensive dependency map for repository
   */
  async buildDependencyMap(repositoryId: string): Promise<DependencyMap> {
    const logger = ImpactAnalysisLogger.getInstance();
    const simpleLogger = SimpleLogger.getInstance();

    simpleLogger.log(
      `🔗 Building dependency map for repository: ${repositoryId}`,
    );
    console.log(`Building dependency map for repository ${repositoryId}`);

    const dependencyMap: DependencyMap = {
      imports: {},
      importedBy: {},
      exports: {},
      impacts: {},
      modules: {},
    };

    try {
      // Get all files in repository
      const files = await this.getAllRepositoryFiles(repositoryId);
      simpleLogger.log(`📁 Found ${files.length} files to analyze`, {
        files: files.slice(0, 20), // Show first 20 files
      });
      console.log(`Found ${files.length} files to analyze`);

      logger.info(
        'buildDependencyMap',
        'Files fetched for dependency analysis',
        { repositoryId, count: files.length },
      );

      // Analyze each file for imports and exports
      let processedCount = 0;
      for (const file of files) {
        try {
          simpleLogger.log(`🔍 Analyzing dependencies for: ${file}`);

          const analysis = await this.analyzeFileDependencies(file);
          this.updateDependencyMap(dependencyMap, file, analysis);

          processedCount++;
          simpleLogger.log(
            `✅ Processed ${processedCount}/${files.length} files`,
            {
              file,
              imports: analysis.imports.length,
              exports: analysis.exports.length,
            },
          );

          logger.traceAst('analyzeFileDependencies', 'File analyzed', {
            file,
            imports: analysis.imports.length,
            exports: analysis.exports.length,
          });
        } catch (error) {
          simpleLogger.log(`❌ Error analyzing ${file}`, {
            error: String(error),
          });

          logger.error('analyzeFileDependencies', `Error for ${file}`, {
            error: String(error),
          });
        }
      }

      // Build impact relationships
      simpleLogger.log('🔗 Building impact relationships');
      this.buildImpactRelationships(dependencyMap);
      logger.debug('buildDependencyMap', 'Impact relationships built');

      // Build module relationships
      simpleLogger.log('📦 Building module relationships');
      this.buildModuleRelationships(dependencyMap, files);
      logger.debug('buildDependencyMap', 'Module relationships built');

      simpleLogger.log('✅ Dependency map built successfully', {
        totalFiles: files.length,
        processedFiles: processedCount,
        totalImports: Object.keys(dependencyMap.imports).length,
        totalExports: Object.keys(dependencyMap.exports).length,
      });

      console.log('Dependency map built successfully');
      logger.info('buildDependencyMap', 'Dependency map built successfully');
      return dependencyMap;
    } catch (error) {
      simpleLogger.log('❌ Error building dependency map', {
        error: String(error),
      });

      logger.error('buildDependencyMap', 'Error building dependency map', {
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Analyze file dependencies using existing FileDocumentation
   */
  private async analyzeFileDependencies(filePath: string): Promise<{
    imports: ImportInfo[];
    exports: string[];
  }> {
    const logger = ImpactAnalysisLogger.getInstance();
    const imports: ImportInfo[] = [];
    const exports: string[] = [];

    try {
      // First check if it's a valid file
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        logger.debug('analyzeFileDependencies', 'Skipping non-file path', {
          filePath,
          isDirectory: stats.isDirectory(),
        });
        return { imports, exports };
      }

      // Check if file has a valid extension
      const fileExtension = path.extname(filePath).toLowerCase();
      const validExtensions = ['.ts', '.tsx', '.js', '.jsx'];
      if (!validExtensions.includes(fileExtension)) {
        logger.debug(
          'analyzeFileDependencies',
          'Skipping unsupported file type',
          { filePath, extension: fileExtension },
        );
        return { imports, exports };
      }

      // First try to get from existing FileDocumentation
      const fileDoc = await this.getFileDocumentation(filePath);
      if (fileDoc) {
        logger.traceAst(
          'analyzeFileDependencies',
          'Using FileDocumentation cache',
          { filePath },
        );
        return this.extractDependenciesFromFileDoc(fileDoc);
      }

      // Fallback to parsing file content
      const content = await this.getFileContent(filePath);
      if (!content) {
        return { imports, exports };
      }

      if (fileExtension === '.ts' || fileExtension === '.tsx') {
        logger.traceAst(
          'analyzeFileDependencies',
          'Parsing TypeScript dependencies',
          { filePath },
        );
        return this.analyzeTypeScriptDependencies(content, filePath);
      } else if (fileExtension === '.js' || fileExtension === '.jsx') {
        logger.traceAst(
          'analyzeFileDependencies',
          'Parsing JavaScript dependencies',
          { filePath },
        );
        return this.analyzeJavaScriptDependencies(content, filePath);
      }
    } catch (error) {
      logger.error(
        'analyzeFileDependencies',
        `Error analyzing dependencies for ${filePath}`,
        { error: String(error) },
      );
    }

    return { imports, exports };
  }

  /**
   * Analyze TypeScript file dependencies
   */
  private analyzeTypeScriptDependencies(
    content: string,
    filePath: string,
  ): {
    imports: ImportInfo[];
    exports: string[];
  } {
    const imports: ImportInfo[] = [];
    const exports: string[] = [];

    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
      );

      const visit = (node: ts.Node) => {
        // Handle imports
        if (ts.isImportDeclaration(node)) {
          const importInfo = this.extractImportFromDeclaration(node, filePath);
          if (importInfo) imports.push(importInfo);
        }

        // Handle exports
        if (ts.isExportDeclaration(node)) {
          const exportSymbols = this.extractExportsFromDeclaration(node);
          exports.push(...exportSymbols);
        }

        // Handle export assignments
        if (ts.isExportAssignment(node)) {
          exports.push('default');
        }

        // Handle export modifiers on declarations
        if (ts.canHaveModifiers(node)) {
          const modifiers = ts.getModifiers(node);
          if (
            modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)
          ) {
            const symbolName = this.extractSymbolNameFromNode(node);
            if (symbolName) exports.push(symbolName);
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (error) {
      console.error(
        `Error analyzing TypeScript dependencies for ${filePath}:`,
        error,
      );
    }

    return { imports, exports };
  }

  /**
   * Analyze JavaScript file dependencies
   */
  private analyzeJavaScriptDependencies(
    content: string,
    filePath: string,
  ): {
    imports: ImportInfo[];
    exports: string[];
  } {
    const imports: ImportInfo[] = [];
    const exports: string[] = [];

    try {
      const ast = babel.parse(content, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript', 'decorators-legacy'],
      });

      traverse.default(ast, {
        ImportDeclaration: (path) => {
          const importInfo = this.extractImportFromBabelDeclaration(
            path,
            filePath,
          );
          if (importInfo) imports.push(importInfo);
        },
        ExportNamedDeclaration: (path) => {
          const exportSymbols =
            this.extractExportsFromBabelNamedDeclaration(path);
          exports.push(...exportSymbols);
        },
        ExportDefaultDeclaration: (path) => {
          exports.push('default');
        },
      });
    } catch (error) {
      console.error(
        `Error analyzing JavaScript dependencies for ${filePath}:`,
        error,
      );
    }

    return { imports, exports };
  }

  /**
   * Extract import information from TypeScript import declaration
   */
  private extractImportFromDeclaration(
    node: ts.ImportDeclaration,
    filePath: string,
  ): ImportInfo | null {
    try {
      const moduleSpecifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) {
        return null;
      }

      const importedFrom = this.resolveImportPath(
        moduleSpecifier.text,
        filePath,
      );
      const importClause = node.importClause;

      if (importClause?.name) {
        // Default import
        return {
          file: filePath,
          importedFrom,
          symbol: importClause.name.text,
          type: 'DEFAULT',
          isReExport: false,
        };
      }

      if (importClause?.namedBindings) {
        if (ts.isNamespaceImport(importClause.namedBindings)) {
          // Namespace import
          return {
            file: filePath,
            importedFrom,
            symbol: importClause.namedBindings.name.text,
            type: 'NAMESPACE',
            isReExport: false,
          };
        } else if (ts.isNamedImports(importClause.namedBindings)) {
          // Named imports - return the first one, others will be handled separately
          const firstImport = importClause.namedBindings.elements[0];
          if (firstImport) {
            return {
              file: filePath,
              importedFrom,
              symbol: firstImport.name.text,
              type: 'NAMED',
              isReExport: false,
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error(
        'Error extracting import from TypeScript declaration:',
        error,
      );
      return null;
    }
  }

  /**
   * Extract import information from Babel import declaration
   */
  private extractImportFromBabelDeclaration(
    path: any,
    filePath: string,
  ): ImportInfo | null {
    try {
      const node = path.node;
      const importedFrom = this.resolveImportPath(node.source.value, filePath);

      if (node.specifiers) {
        const specifier = node.specifiers[0];
        if (specifier) {
          let type: 'NAMED' | 'DEFAULT' | 'NAMESPACE' = 'NAMED';
          let symbol = '';

          if (specifier.type === 'ImportDefaultSpecifier') {
            type = 'DEFAULT';
            symbol = specifier.local.name;
          } else if (specifier.type === 'ImportNamespaceSpecifier') {
            type = 'NAMESPACE';
            symbol = specifier.local.name;
          } else if (specifier.type === 'ImportSpecifier') {
            type = 'NAMED';
            symbol = specifier.imported.name;
          }

          return {
            file: filePath,
            importedFrom,
            symbol,
            type,
            isReExport: false,
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Error extracting import from Babel declaration:', error);
      return null;
    }
  }

  /**
   * Extract exports from TypeScript export declaration
   */
  private extractExportsFromDeclaration(node: ts.ExportDeclaration): string[] {
    const exports: string[] = [];

    try {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        node.exportClause.elements.forEach((element) => {
          exports.push(element.name.text);
        });
      }
    } catch (error) {
      console.error(
        'Error extracting exports from TypeScript declaration:',
        error,
      );
    }

    return exports;
  }

  /**
   * Extract exports from Babel named export declaration
   */
  private extractExportsFromBabelNamedDeclaration(path: any): string[] {
    const exports: string[] = [];

    try {
      const node = path.node;
      if (node.specifiers) {
        node.specifiers.forEach((specifier: any) => {
          if (specifier.exported) {
            exports.push(specifier.exported.name);
          }
        });
      }
    } catch (error) {
      console.error(
        'Error extracting exports from Babel named declaration:',
        error,
      );
    }

    return exports;
  }

  /**
   * Extract symbol name from TypeScript node
   */
  private extractSymbolNameFromNode(node: ts.Node): string | null {
    try {
      if (ts.isFunctionDeclaration(node) && node.name) {
        return node.name.text;
      } else if (ts.isClassDeclaration(node) && node.name) {
        return node.name.text;
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        return node.name.text;
      }
    } catch (error) {
      console.error(
        'Error extracting symbol name from TypeScript node:',
        error,
      );
    }

    return null;
  }

  /**
   * Resolve import path to actual file path
   */
  private resolveImportPath(importPath: string, fromFile: string): string {
    // Handle relative imports
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      const fromDir = path.dirname(fromFile);
      return path.resolve(fromDir, importPath);
    }

    // Handle absolute imports (node_modules, etc.)
    // This would need more sophisticated resolution logic
    return importPath;
  }

  /**
   * Update dependency map with file analysis results
   */
  private updateDependencyMap(
    dependencyMap: DependencyMap,
    file: string,
    analysis: { imports: ImportInfo[]; exports: string[] },
  ): void {
    // Update imports
    dependencyMap.imports[file] = analysis.imports.map(
      (imp) => imp.importedFrom,
    );

    // Update importedBy
    analysis.imports.forEach((imp) => {
      if (!dependencyMap.importedBy[imp.importedFrom]) {
        dependencyMap.importedBy[imp.importedFrom] = [];
      }
      if (!dependencyMap.importedBy[imp.importedFrom].includes(file)) {
        dependencyMap.importedBy[imp.importedFrom].push(file);
      }
    });

    // Update exports
    dependencyMap.exports[file] = analysis.exports;
  }

  /**
   * Build impact relationships based on dependencies
   */
  private buildImpactRelationships(dependencyMap: DependencyMap): void {
    // A file impacts all files that import it
    Object.keys(dependencyMap.imports).forEach((file) => {
      const importedFiles = dependencyMap.imports[file];
      if (!dependencyMap.impacts[file]) {
        dependencyMap.impacts[file] = [];
      }

      importedFiles.forEach((importedFile) => {
        if (!dependencyMap.impacts[file].includes(importedFile)) {
          dependencyMap.impacts[file].push(importedFile);
        }
      });
    });
  }

  /**
   * Build module relationships
   */
  private buildModuleRelationships(
    dependencyMap: DependencyMap,
    files: string[],
  ): void {
    files.forEach((file) => {
      const module = this.getModuleFromPath(file);
      if (!dependencyMap.modules[module]) {
        dependencyMap.modules[module] = [];
      }
      if (!dependencyMap.modules[module].includes(file)) {
        dependencyMap.modules[module].push(file);
      }
    });
  }

  /**
   * Get module name from file path
   */
  private getModuleFromPath(filePath: string): string {
    const pathParts = filePath.split(path.sep);
    // Find the first directory that looks like a module (not 'src', 'lib', etc.)
    const moduleIndex = pathParts.findIndex(
      (part) => !['src', 'lib', 'dist', 'build', 'node_modules'].includes(part),
    );

    if (moduleIndex !== -1 && moduleIndex < pathParts.length - 1) {
      return pathParts[moduleIndex];
    }

    return path.dirname(filePath);
  }

  /**
   * Get all files in repository from FileDocumentation table
   */
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
   * Extract dependencies from existing FileDocumentation
   */
  private extractDependenciesFromFileDoc(fileDoc: any): {
    imports: ImportInfo[];
    exports: string[];
  } {
    const imports: ImportInfo[] = [];
    const exports: string[] = [];

    try {
      // Extract imports from the imports array
      if (Array.isArray(fileDoc.imports)) {
        fileDoc.imports.forEach((importPath: string) => {
          imports.push({
            file: fileDoc.fullPath,
            importedFrom: importPath,
            symbol: 'default', // Default assumption, could be enhanced
            type: 'DEFAULT',
            isReExport: false,
          });
        });
      }

      // Extract exports from the exports array
      if (Array.isArray(fileDoc.exports)) {
        exports.push(...fileDoc.exports);
      }
    } catch (error) {
      console.error(
        'Error extracting dependencies from file documentation:',
        error,
      );
    }

    return { imports, exports };
  }

  /**
   * Get file content
   */
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
      const validExtensions = ['.ts', '.tsx', '.js', '.jsx'];
      if (!validExtensions.includes(fileExtension)) {
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

  /**
   * Find files that might be affected by changes to a specific file
   */
  async findAffectedFiles(
    changedFile: string,
    dependencyMap: DependencyMap,
  ): Promise<string[]> {
    const affectedFiles = new Set<string>();

    // Add files that import from the changed file
    const importedBy = dependencyMap.importedBy[changedFile] || [];
    importedBy.forEach((file) => affectedFiles.add(file));

    // Add files that import from files that import the changed file (transitive)
    let newFilesAdded = true;
    let safetyCounter = 0;
    const maxIterations = 10;

    while (newFilesAdded && safetyCounter < maxIterations) {
      newFilesAdded = false;
      safetyCounter++;

      Array.from(affectedFiles).forEach((file) => {
        const importedByThisFile = dependencyMap.importedBy[file] || [];
        importedByThisFile.forEach((importedFile) => {
          if (!affectedFiles.has(importedFile)) {
            affectedFiles.add(importedFile);
            newFilesAdded = true;
          }
        });
      });
    }

    return Array.from(affectedFiles);
  }

  /**
   * Get files in the same module as the given file
   */
  getFilesInSameModule(
    filePath: string,
    dependencyMap: DependencyMap,
  ): string[] {
    const module = this.getModuleFromPath(filePath);
    return dependencyMap.modules[module] || [];
  }

  /**
   * Get files in the same directory as the given file
   */
  getFilesInSameDirectory(
    filePath: string,
    dependencyMap: DependencyMap,
  ): string[] {
    const directory = path.dirname(filePath);
    return Object.keys(dependencyMap.imports).filter(
      (file) => path.dirname(file) === directory,
    );
  }
}
