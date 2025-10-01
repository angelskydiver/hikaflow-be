// Removed AST analyzer dependency - using simplified approach

export interface FileNode {
  filename: string;
  content: string;
  size: number;
  type: 'source' | 'test' | 'config' | 'documentation' | 'other';
  priority: number;
  dependencies: string[];
  dependents: string[];
  complexity: number;
  lastModified?: Date;
  ast?: any;
  structure?: any; // Simplified structure without AST analysis
}

export interface FileGroup {
  id: string;
  files: FileNode[];
  totalSize: number;
  totalComplexity: number;
  relatedness: number;
  priority: number;
  type: 'related' | 'dependency-chain' | 'feature-module' | 'test-suite';
}

export interface ChunkingStrategy {
  maxChunkSize: number;
  maxFilesPerChunk: number;
  maxComplexityPerChunk: number;
  prioritizeBy: 'complexity' | 'size' | 'dependencies' | 'modified';
  groupRelated: boolean;
  respectDependencies: boolean;
}

export interface ChunkingResult {
  chunks: FileGroup[];
  totalChunks: number;
  averageChunkSize: number;
  averageComplexity: number;
  distribution: {
    small: number;
    medium: number;
    large: number;
  };
  metadata: {
    totalFiles: number;
    totalSize: number;
    totalComplexity: number;
    processingTime: number;
  };
}

export class IntelligentChunker {
  private static readonly DEFAULT_STRATEGY: ChunkingStrategy = {
    maxChunkSize: 50000, // 50KB
    maxFilesPerChunk: 10,
    maxComplexityPerChunk: 100,
    prioritizeBy: 'complexity',
    groupRelated: true,
    respectDependencies: true,
  };

  private static readonly FILE_TYPE_PRIORITIES = {
    source: 1.0,
    test: 0.8,
    config: 0.6,
    documentation: 0.4,
    other: 0.2,
  };

  private static readonly COMPLEXITY_THRESHOLDS = {
    low: 10,
    medium: 50,
    high: 100,
  };

  /**
   * Analyze code structure and create intelligent file groups
   */
  static analyzeCodeStructure(
    files: Array<{ filename: string; content: string }>,
  ): FileNode[] {
    const startTime = Date.now();
    const fileNodes: FileNode[] = [];

    for (const file of files) {
      const fileNode = this.createFileNode(file);
      fileNodes.push(fileNode);
    }

    // Analyze dependencies between files
    this.analyzeDependencies(fileNodes);

    console.log(
      `Code structure analysis completed in ${Date.now() - startTime}ms`,
    );
    return fileNodes;
  }

  /**
   * Group related files based on various criteria
   */
  static groupRelatedFiles(files: FileNode[]): FileGroup[] {
    const groups: FileGroup[] = [];
    const processed = new Set<string>();

    for (const file of files) {
      if (processed.has(file.filename)) continue;

      const relatedFiles = this.findRelatedFiles(file, files);
      if (relatedFiles.length > 0) {
        const group = this.createFileGroup(relatedFiles);
        groups.push(group);

        relatedFiles.forEach((f) => processed.add(f.filename));
      }
    }

    // Handle ungrouped files
    const ungrouped = files.filter((f) => !processed.has(f.filename));
    ungrouped.forEach((file) => {
      const group = this.createFileGroup([file]);
      groups.push(group);
    });

    return groups;
  }

  /**
   * Prioritize files for analysis
   */
  static prioritizeAnalysis(files: FileNode[]): FileNode[] {
    return files.sort((a, b) => {
      // Primary sort: by priority score
      const scoreA = this.calculatePriorityScore(a);
      const scoreB = this.calculatePriorityScore(b);

      if (scoreA !== scoreB) {
        return scoreB - scoreA; // Higher score first
      }

      // Secondary sort: by complexity
      if (a.complexity !== b.complexity) {
        return b.complexity - a.complexity; // Higher complexity first
      }

      // Tertiary sort: by size
      return b.size - a.size; // Larger files first
    });
  }

  /**
   * Create intelligent chunks based on strategy
   */
  static createIntelligentChunks(
    files: FileNode[],
    strategy: Partial<ChunkingStrategy> = {},
  ): ChunkingResult {
    const startTime = Date.now();
    const finalStrategy = { ...this.DEFAULT_STRATEGY, ...strategy };

    // Step 1: Analyze and group files
    const fileNodes = this.analyzeCodeStructure(files);
    const groups = this.groupRelatedFiles(fileNodes);

    // Step 2: Prioritize groups
    const prioritizedGroups = this.prioritizeGroups(groups);

    // Step 3: Create chunks respecting constraints
    const chunks = this.createChunksFromGroups(
      prioritizedGroups,
      finalStrategy,
    );

    // Step 4: Calculate metadata
    const result = this.calculateChunkingMetadata(
      chunks,
      fileNodes,
      Date.now() - startTime,
    );

    return result;
  }

  /**
   * Smart chunking that respects dependencies and relationships
   */
  static createSmartChunks(
    files: FileNode[],
    maxChunkSize: number = 50000,
    maxFilesPerChunk: number = 10,
  ): FileGroup[] {
    const fileNodes = this.analyzeCodeStructure(files);
    const groups = this.groupRelatedFiles(fileNodes);

    return this.createChunksFromGroups(groups, {
      maxChunkSize,
      maxFilesPerChunk,
      maxComplexityPerChunk: 100,
      prioritizeBy: 'complexity',
      groupRelated: true,
      respectDependencies: true,
    });
  }

  // Private helper methods
  private static createFileNode(file: {
    filename: string;
    content: string;
  }): FileNode {
    const content = file.content;
    const size = Buffer.byteLength(content, 'utf8');
    const type = this.determineFileType(file.filename);
    const complexity = this.calculateFileComplexity(content);
    const priority = this.calculateFilePriority(
      file.filename,
      type,
      complexity,
    );

    return {
      filename: file.filename,
      content,
      size,
      type,
      priority,
      dependencies: [],
      dependents: [],
      complexity,
    };
  }

  private static determineFileType(filename: string): FileNode['type'] {
    const lowerName = filename.toLowerCase();

    if (lowerName.includes('test') || lowerName.includes('spec')) {
      return 'test';
    }

    if (
      lowerName.includes('config') ||
      lowerName.includes('setup') ||
      lowerName.includes('.env')
    ) {
      return 'config';
    }

    if (
      lowerName.includes('readme') ||
      lowerName.includes('doc') ||
      lowerName.includes('.md')
    ) {
      return 'documentation';
    }

    if (
      lowerName.endsWith('.ts') ||
      lowerName.endsWith('.tsx') ||
      lowerName.endsWith('.js') ||
      lowerName.endsWith('.jsx')
    ) {
      return 'source';
    }

    return 'other';
  }

  private static calculateFileComplexity(content: string): number {
    // Simple complexity calculation based on code patterns
    let complexity = 0;

    // Count control structures
    complexity += (
      content.match(/\b(if|else|for|while|switch|try|catch)\b/g) || []
    ).length;

    // Count function definitions
    complexity += (
      content.match(/\b(function|const\s+\w+\s*=\s*\(|class\s+\w+)\b/g) || []
    ).length;

    // Count nested structures (rough estimate)
    const nestedLevel = this.calculateNestingLevel(content);
    complexity += nestedLevel * 2;

    return Math.max(1, complexity);
  }

  private static calculateNestingLevel(content: string): number {
    let maxNesting = 0;
    let currentNesting = 0;

    for (const char of content) {
      if (char === '{') {
        currentNesting++;
        maxNesting = Math.max(maxNesting, currentNesting);
      } else if (char === '}') {
        currentNesting = Math.max(0, currentNesting - 1);
      }
    }

    return maxNesting;
  }

  private static calculateFilePriority(
    filename: string,
    type: FileNode['type'],
    complexity: number,
  ): number {
    const typePriority = this.FILE_TYPE_PRIORITIES[type];
    const complexityMultiplier = Math.min(2, complexity / 50); // Cap at 2x
    const sizeMultiplier = Math.min(
      1.5,
      Buffer.byteLength(filename, 'utf8') / 1000,
    ); // Cap at 1.5x

    return typePriority * (1 + complexityMultiplier) * (1 + sizeMultiplier);
  }

  private static analyzeDependencies(files: FileNode[]): void {
    // Simple dependency analysis based on import statements
    for (const file of files) {
      const imports = this.extractImports(file.content);

      for (const importPath of imports) {
        const targetFile = this.resolveImportPath(
          importPath,
          file.filename,
          files,
        );
        if (targetFile) {
          file.dependencies.push(targetFile);

          const target = files.find((f) => f.filename === targetFile);
          if (target) {
            target.dependents.push(file.filename);
          }
        }
      }
    }
  }

  private static extractImports(content: string): string[] {
    const imports: string[] = [];

    // Match various import patterns
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  private static resolveImportPath(
    importPath: string,
    fromFile: string,
    allFiles: FileNode[],
  ): string | null {
    if (importPath.startsWith('.')) {
      // Relative import
      const basePath = fromFile.split('/').slice(0, -1).join('/');
      const resolvedPath = `${basePath}/${importPath}`;

      // Try different extensions
      const extensions = [
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '/index.ts',
        '/index.js',
      ];
      for (const ext of extensions) {
        const fullPath = `${resolvedPath}${ext}`;
        if (allFiles.some((f) => f.filename === fullPath)) {
          return fullPath;
        }
      }
    }

    return null;
  }

  private static findRelatedFiles(
    file: FileNode,
    allFiles: FileNode[],
  ): FileNode[] {
    const related: FileNode[] = [file];
    const processed = new Set<string>([file.filename]);

    // Find files in the same directory
    const fileDir = file.filename.split('/').slice(0, -1).join('/');
    const sameDirFiles = allFiles.filter(
      (f) =>
        f.filename !== file.filename &&
        f.filename.startsWith(fileDir) &&
        !processed.has(f.filename),
    );

    related.push(...sameDirFiles);
    sameDirFiles.forEach((f) => processed.add(f.filename));

    // Find files with similar names (e.g., user.service.ts and user.controller.ts)
    const baseName = file.filename.split('/').pop()?.split('.')[0];
    if (baseName) {
      const similarFiles = allFiles.filter((f) => {
        const fBaseName = f.filename.split('/').pop()?.split('.')[0];
        return fBaseName === baseName && !processed.has(f.filename);
      });

      related.push(...similarFiles);
      similarFiles.forEach((f) => processed.add(f.filename));
    }

    // Find files that import or are imported by this file
    const dependencyFiles = allFiles.filter(
      (f) =>
        f.filename !== file.filename &&
        !processed.has(f.filename) &&
        (file.dependencies.includes(f.filename) ||
          f.dependencies.includes(file.filename)),
    );

    related.push(...dependencyFiles);

    return related;
  }

  private static createFileGroup(files: FileNode[]): FileGroup {
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const totalComplexity = files.reduce((sum, f) => sum + f.complexity, 0);
    const avgPriority =
      files.reduce((sum, f) => sum + f.priority, 0) / files.length;

    return {
      id: `group_${files[0].filename.replace(/[^a-zA-Z0-9]/g, '_')}`,
      files,
      totalSize,
      totalComplexity,
      relatedness: this.calculateRelatedness(files),
      priority: avgPriority,
      type: this.determineGroupType(files),
    };
  }

  private static calculateRelatedness(files: FileNode[]): number {
    if (files.length <= 1) return 1.0;

    let relatedness = 0;
    let comparisons = 0;

    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const similarity = this.calculateFileSimilarity(files[i], files[j]);
        relatedness += similarity;
        comparisons++;
      }
    }

    return comparisons > 0 ? relatedness / comparisons : 0;
  }

  private static calculateFileSimilarity(
    file1: FileNode,
    file2: FileNode,
  ): number {
    let similarity = 0;

    // Directory similarity
    const dir1 = file1.filename.split('/').slice(0, -1).join('/');
    const dir2 = file2.filename.split('/').slice(0, -1).join('/');
    if (dir1 === dir2) similarity += 0.5;

    // Name similarity
    const name1 = file1.filename.split('/').pop()?.split('.')[0] || '';
    const name2 = file2.filename.split('/').pop()?.split('.')[0] || '';
    if (name1 === name2) similarity += 0.3;

    // Dependency similarity
    const commonDeps = file1.dependencies.filter((dep) =>
      file2.dependencies.includes(dep),
    );
    const depSimilarity =
      commonDeps.length /
      Math.max(file1.dependencies.length, file2.dependencies.length, 1);
    similarity += depSimilarity * 0.2;

    return Math.min(1.0, similarity);
  }

  private static determineGroupType(files: FileNode[]): FileGroup['type'] {
    if (files.length === 1) return 'related';

    const hasTests = files.some((f) => f.type === 'test');
    const hasSource = files.some((f) => f.type === 'source');

    if (hasTests && hasSource) return 'test-suite';

    const hasDependencies = files.some((f) => f.dependencies.length > 0);
    if (hasDependencies) return 'dependency-chain';

    return 'feature-module';
  }

  private static prioritizeGroups(groups: FileGroup[]): FileGroup[] {
    return groups.sort((a, b) => {
      // Primary sort: by priority
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }

      // Secondary sort: by complexity
      if (a.totalComplexity !== b.totalComplexity) {
        return b.totalComplexity - a.totalComplexity;
      }

      // Tertiary sort: by size
      return b.totalSize - a.totalSize;
    });
  }

  private static createChunksFromGroups(
    groups: FileGroup[],
    strategy: ChunkingStrategy,
  ): FileGroup[] {
    const chunks: FileGroup[] = [];
    let currentChunk: FileNode[] = [];
    let currentSize = 0;
    let currentComplexity = 0;

    for (const group of groups) {
      // Check if adding this group would exceed limits
      const wouldExceedSize =
        currentSize + group.totalSize > strategy.maxChunkSize;
      const wouldExceedFiles =
        currentChunk.length + group.files.length > strategy.maxFilesPerChunk;
      const wouldExceedComplexity =
        currentComplexity + group.totalComplexity >
        strategy.maxComplexityPerChunk;

      if (wouldExceedSize || wouldExceedFiles || wouldExceedComplexity) {
        // Finalize current chunk
        if (currentChunk.length > 0) {
          chunks.push(this.createFileGroup(currentChunk));
        }

        // Start new chunk
        currentChunk = [...group.files];
        currentSize = group.totalSize;
        currentComplexity = group.totalComplexity;
      } else {
        // Add group to current chunk
        currentChunk.push(...group.files);
        currentSize += group.totalSize;
        currentComplexity += group.totalComplexity;
      }
    }

    // Add final chunk if it has content
    if (currentChunk.length > 0) {
      chunks.push(this.createFileGroup(currentChunk));
    }

    return chunks;
  }

  private static calculateChunkingMetadata(
    chunks: FileGroup[],
    files: FileNode[],
    processingTime: number,
  ): ChunkingResult {
    const totalFiles = files.length;
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const totalComplexity = files.reduce((sum, f) => sum + f.complexity, 0);

    const averageChunkSize = chunks.length > 0 ? totalSize / chunks.length : 0;
    const averageComplexity =
      chunks.length > 0 ? totalComplexity / chunks.length : 0;

    const distribution = {
      small: chunks.filter((c) => c.totalSize < 10000).length,
      medium: chunks.filter((c) => c.totalSize >= 10000 && c.totalSize < 50000)
        .length,
      large: chunks.filter((c) => c.totalSize >= 50000).length,
    };

    return {
      chunks,
      totalChunks: chunks.length,
      averageChunkSize,
      averageComplexity,
      distribution,
      metadata: {
        totalFiles,
        totalSize,
        totalComplexity,
        processingTime,
      },
    };
  }

  private static calculatePriorityScore(file: FileNode): number {
    const typeScore = this.FILE_TYPE_PRIORITIES[file.type];
    const complexityScore = Math.min(2, file.complexity / 50);
    const sizeScore = Math.min(1.5, file.size / 10000);
    const dependencyScore = Math.min(1.2, file.dependencies.length / 10);

    return (
      typeScore *
      (1 + complexityScore) *
      (1 + sizeScore) *
      (1 + dependencyScore)
    );
  }
}
