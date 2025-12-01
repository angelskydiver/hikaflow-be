import { Injectable, Logger } from '@nestjs/common';
import { RepositoryProvider } from '@prisma/client';
import axios from 'axios';
import { Buffer } from 'buffer';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountCredentialService } from '../accountCredentials/accountCredentials.service';
import { CodeBlockType } from './impact-analysis.types';

export interface RemoteCodeMatch {
  provider: RepositoryProvider;
  branch: string;
  filePath: string;
  line: number;
  snippet: string;
  url?: string;
  score?: number;
  searchContext: RemoteSearchMetadata;
}

interface RemoteSearchRequest {
  repositoryId: string;
  functionName: string;
  filePath?: string;
  prNumber?: number;
  branchName?: string;
  limit?: number;
  codeType?: CodeBlockType;
  includeBaseBranch?: boolean;
  relevantFiles?: string[]; // Files identified via dependency map/FileDocumentation
}

interface RepositoryAuthContext {
  id: string;
  owner: string;
  name: string;
  provider: RepositoryProvider;
  baseBranch: string;
  token: string;
  workspace?: string;
}

interface LineMatch {
  line: number;
  snippet: string;
}

interface RemoteSearchMetadata {
  functionName: string;
  fileName?: string;
  branchName: string;
  codeType: CodeBlockType;
}

@Injectable()
export class RemoteCodeSearchService {
  private readonly logger = new Logger(RemoteCodeSearchService.name);
  private readonly repositoryContextCache = new Map<
    string,
    RepositoryAuthContext
  >();
  private readonly prBranchCache = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountCredentialService: AccountCredentialService,
  ) {}

  async searchFunctionReferences(
    options: RemoteSearchRequest,
  ): Promise<RemoteCodeMatch[]> {
    try {
      const context = await this.getRepositoryContext(options.repositoryId);
      if (!context) {
        return [];
      }

      const branchName =
        options.branchName ||
        (options.prNumber
          ? await this.resolveBranchForPr(context, options.prNumber)
          : context.baseBranch);

      const branchesToSearch = this.resolveBranchesToSearch(
        branchName,
        context,
        options.includeBaseBranch,
      );

      const matches: RemoteCodeMatch[] = [];

      for (const branch of branchesToSearch) {
        const branchMatches =
          context.provider === RepositoryProvider.GITHUB
            ? await this.searchGithub(options, context, branch)
            : await this.searchBitbucket(options, context, branch);
        matches.push(...branchMatches);
      }

      return this.deduplicateMatches(matches);
    } catch (error) {
      this.logger.error(
        `Remote code search failed for repository ${options.repositoryId}`,
        error as Error,
      );
      return [];
    }
  }

  private async searchGithub(
    options: RemoteSearchRequest,
    context: RepositoryAuthContext,
    branchName: string,
  ): Promise<RemoteCodeMatch[]> {
    const matches: RemoteCodeMatch[] = [];
    try {
      // If relevant files are provided (from dependency map/FileDocumentation),
      // search only in those files (much faster and more accurate!)
      if (options.relevantFiles && options.relevantFiles.length > 0) {
        this.logger.debug(
          `Searching in ${options.relevantFiles.length} relevant files (from dependency map)`,
        );
        return await this.searchInRelevantFiles(options, context, branchName);
      }

      // Otherwise, use multiple search queries to find all usages
      const searchQueries = this.buildSearchQueries(
        options.functionName,
        options.filePath,
        context,
        options.codeType,
      );

      const perPage = Math.min(options.limit ?? 20, 20);
      const allMatches = new Map<string, RemoteCodeMatch>();

      // Execute all search queries
      for (const query of searchQueries) {
        try {
          const queryMatches = await this.executeGithubSearch(
            query,
            context,
            branchName,
            options,
            perPage,
          );

          // Add unique matches (deduplicate by file:line)
          for (const match of queryMatches) {
            const key = `${match.filePath}:${match.line}`;
            if (!allMatches.has(key)) {
              allMatches.set(key, match);
            }
          }

          // Stop if we have enough matches
          if (allMatches.size >= perPage) {
            break;
          }
        } catch (error) {
          this.logger.debug(`Search query failed: ${query} - ${error}`);
          // Continue with next query
        }
      }

      return Array.from(allMatches.values()).slice(0, perPage);
    } catch (error) {
      this.logger.warn(
        `GitHub search failed for ${context.owner}/${context.name}: ${error}`,
      );
    }

    return matches;
  }

  /**
   * Search only in relevant files identified via dependency map/FileDocumentation
   * This is much faster than searching the entire repository
   */
  private async searchInRelevantFiles(
    options: RemoteSearchRequest,
    context: RepositoryAuthContext,
    branchName: string,
  ): Promise<RemoteCodeMatch[]> {
    const matches: RemoteCodeMatch[] = [];
    const limit = Math.min(options.limit ?? 20, 20);

    if (!options.relevantFiles || options.relevantFiles.length === 0) {
      return matches;
    }

    this.logger.debug(
      `Searching function "${options.functionName}" in ${options.relevantFiles.length} relevant files`,
    );

    // Search in each relevant file
    for (const filePath of options.relevantFiles.slice(0, 50)) {
      // Skip self references
      if (
        options.filePath &&
        this.normalizePath(filePath) === this.normalizePath(options.filePath)
      ) {
        continue;
      }

      try {
        const occurrences = await this.extractMatchesFromGithubFile(
          filePath,
          context,
          branchName,
          options.functionName,
          options.repositoryId,
        );

        for (const occurrence of occurrences) {
          matches.push({
            provider: context.provider,
            branch: branchName,
            filePath: filePath,
            line: occurrence.line,
            snippet: occurrence.snippet,
            url: `https://github.com/${context.owner}/${context.name}/blob/${branchName}/${filePath}#L${occurrence.line}`,
            searchContext: this.buildSearchContext(options, branchName),
          });

          if (matches.length >= limit) {
            return matches;
          }
        }
      } catch (error) {
        this.logger.debug(
          `Failed to search in relevant file ${filePath}: ${error}`,
        );
        // Continue with next file
      }
    }

    return matches;
  }

  /**
   * Build multiple search queries for comprehensive function/component search
   */
  private buildSearchQueries(
    functionName: string,
    filePath: string | undefined,
    context: RepositoryAuthContext,
    codeType?: CodeBlockType,
  ): string[] {
    const queries: string[] = [];
    const repoFilter = `repo:${context.owner}/${context.name}`;
    const fileName = filePath ? path.basename(filePath) : undefined;
    const fileNameFilter = fileName ? `filename:${fileName}` : '';

    // Query 1: Exact function name match
    queries.push(`"${functionName}" ${repoFilter} ${fileNameFilter}`.trim());

    // Query 2: Function call pattern
    queries.push(`${functionName}( ${repoFilter} ${fileNameFilter}`.trim());

    // Query 3: Import statement
    queries.push(
      `import.*${functionName} ${repoFilter} ${fileNameFilter}`.trim(),
    );

    // Query 4: Destructured import
    queries.push(`{ ${functionName} } ${repoFilter} ${fileNameFilter}`.trim());

    // Query 5: Method call (object.functionName)
    queries.push(`.${functionName}( ${repoFilter} ${fileNameFilter}`.trim());

    // Query 6: Component usage (JSX/TSX) - if it's a component
    if (codeType === 'COMPONENT' || /^[A-Z]/.test(functionName)) {
      queries.push(
        `<${functionName} ${repoFilter} ${fileNameFilter ? `filename:*.tsx filename:*.jsx` : ''}`.trim(),
      );
    }

    return queries;
  }

  /**
   * Execute a single GitHub search query using Code Search API (fast, direct)
   * Falls back to targeted file search if Code Search API fails
   */
  private async executeGithubSearch(
    query: string,
    context: RepositoryAuthContext,
    branchName: string,
    options: RemoteSearchRequest,
    limit: number,
  ): Promise<RemoteCodeMatch[]> {
    // Try GitHub Code Search API first (fast, direct search)
    try {
      return await this.executeGithubCodeSearch(
        query,
        context,
        branchName,
        options,
        limit,
      );
    } catch (error: any) {
      // If Code Search API fails (403, 404, etc.), use fallback
      if (error.response?.status === 403 || error.response?.status === 404) {
        this.logger.debug(
          `GitHub Code Search API not available (${error.response?.status}), using fallback method`,
        );
        return await this.executeGithubSearchFallback(
          query,
          context,
          branchName,
          options,
          limit,
        );
      }
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Use GitHub Code Search API - fast, direct code search
   * This finds exact files where the code exists
   */
  private async executeGithubCodeSearch(
    query: string,
    context: RepositoryAuthContext,
    branchName: string,
    options: RemoteSearchRequest,
    limit: number,
  ): Promise<RemoteCodeMatch[]> {
    const matches: RemoteCodeMatch[] = [];

    try {
      let response;
      try {
        // Use GitHub Code Search API - searches code directly
        response = await axios.get('https://api.github.com/search/code', {
          params: {
            q: query,
            per_page: Math.min(limit, 100), // GitHub allows up to 100 per page
          },
          headers: this.githubHeaders(context.token),
        });
      } catch (error: any) {
        // Handle 401 - token expired
        if (error.response?.status === 401) {
          this.logger.warn(
            `GitHub token expired, refreshing for code search...`,
          );
          this.repositoryContextCache.delete(options.repositoryId);
          const freshContext = await this.getRepositoryContext(
            options.repositoryId,
          );
          if (!freshContext) {
            throw new Error('Failed to refresh repository context');
          }

          response = await axios.get('https://api.github.com/search/code', {
            params: {
              q: query,
              per_page: Math.min(limit, 100),
            },
            headers: this.githubHeaders(freshContext.token),
          });
        } else {
          throw error;
        }
      }

      const items = response.data?.items || [];

      for (const item of items) {
        // Skip self references
        if (
          options.filePath &&
          this.normalizePath(item.path) === this.normalizePath(options.filePath)
        ) {
          continue;
        }

        // Extract line matches from the file
        const occurrences = await this.extractMatchesFromGithubFile(
          item.path,
          context,
          branchName,
          options.functionName,
          options.repositoryId,
        );

        for (const occurrence of occurrences) {
          matches.push({
            provider: context.provider,
            branch: branchName,
            filePath: item.path,
            line: occurrence.line,
            snippet: occurrence.snippet,
            url: `${item.html_url}?plain=1#L${occurrence.line}`,
            searchContext: this.buildSearchContext(options, branchName),
          });

          if (matches.length >= limit) {
            return matches;
          }
        }
      }
    } catch (error) {
      this.logger.debug(`GitHub Code Search failed: ${error}`);
      throw error; // Re-throw to trigger fallback
    }

    return matches;
  }

  /**
   * Fallback: Targeted file search when Code Search API is not available
   * Only searches in relevant directories (src/, lib/, etc.) instead of entire repo
   */
  private async executeGithubSearchFallback(
    query: string,
    context: RepositoryAuthContext,
    branchName: string,
    options: RemoteSearchRequest,
    limit: number,
  ): Promise<RemoteCodeMatch[]> {
    const matches: RemoteCodeMatch[] = [];

    try {
      // Instead of fetching entire tree, search in targeted directories
      const searchPaths = this.getTargetedSearchPaths(options.filePath);

      for (const searchPath of searchPaths) {
        try {
          // Get files only from specific directory
          const fileList = await this.getGithubDirectoryFiles(
            context,
            branchName,
            searchPath,
            options.repositoryId,
          );

          // Filter to code files only
          const codeFiles = fileList.filter((file) => {
            const ext = path.extname(file.path).toLowerCase();
            return [
              '.ts',
              '.tsx',
              '.js',
              '.jsx',
              '.py',
              '.java',
              '.go',
              '.rs',
            ].includes(ext);
          });

          // Search in these files
          for (const file of codeFiles.slice(0, 20)) {
            // Skip self references
            if (
              options.filePath &&
              this.normalizePath(file.path) ===
                this.normalizePath(options.filePath)
            ) {
              continue;
            }

            try {
              const occurrences = await this.extractMatchesFromGithubFile(
                file.path,
                context,
                branchName,
                options.functionName,
                options.repositoryId,
              );

              for (const occurrence of occurrences) {
                matches.push({
                  provider: context.provider,
                  branch: branchName,
                  filePath: file.path,
                  line: occurrence.line,
                  snippet: occurrence.snippet,
                  url: `https://github.com/${context.owner}/${context.name}/blob/${branchName}/${file.path}#L${occurrence.line}`,
                  searchContext: this.buildSearchContext(options, branchName),
                });

                if (matches.length >= limit) {
                  return matches;
                }
              }
            } catch (error) {
              this.logger.debug(
                `Failed to search in file ${file.path}: ${error}`,
              );
            }
          }
        } catch (error) {
          this.logger.debug(`Failed to search in path ${searchPath}: ${error}`);
        }
      }
    } catch (error) {
      this.logger.debug(`Fallback search failed: ${error}`);
    }

    return matches;
  }

  /**
   * Get targeted search paths based on file location
   * Instead of searching entire repo, search in relevant directories
   */
  private getTargetedSearchPaths(filePath?: string): string[] {
    const paths: string[] = [];

    if (filePath) {
      // Search in the same directory and parent directories
      const dir = path.dirname(filePath);
      const parts = dir.split('/').filter((p) => p);

      // Add progressively broader paths
      for (let i = 0; i < parts.length; i++) {
        paths.push(parts.slice(0, i + 1).join('/'));
      }
    } else {
      // Default search paths
      paths.push('src');
      paths.push('lib');
      paths.push('app');
      paths.push('components');
    }

    return paths;
  }

  /**
   * Get files from a specific directory (more efficient than entire tree)
   */
  private async getGithubDirectoryFiles(
    context: RepositoryAuthContext,
    branchName: string,
    directoryPath: string,
    repositoryId: string,
  ): Promise<Array<{ path: string; type: string }>> {
    try {
      let response;
      try {
        response = await axios.get(
          `https://api.github.com/repos/${context.owner}/${context.name}/contents/${directoryPath}`,
          {
            params: { ref: branchName },
            headers: this.githubHeaders(context.token),
          },
        );
      } catch (error: any) {
        if (error.response?.status === 401) {
          this.repositoryContextCache.delete(repositoryId);
          const freshContext = await this.getRepositoryContext(repositoryId);
          if (!freshContext) {
            throw new Error('Failed to refresh repository context');
          }

          response = await axios.get(
            `https://api.github.com/repos/${freshContext.owner}/${freshContext.name}/contents/${directoryPath}`,
            {
              params: { ref: branchName },
              headers: this.githubHeaders(freshContext.token),
            },
          );
        } else {
          throw error;
        }
      }

      // Recursively get files from directory
      const files: Array<{ path: string; type: string }> = [];
      const items = Array.isArray(response.data)
        ? response.data
        : [response.data];

      for (const item of items) {
        if (item.type === 'file') {
          files.push({ path: item.path, type: 'blob' });
        } else if (item.type === 'dir') {
          // Recursively get files from subdirectory (limit depth to avoid too many calls)
          const subFiles = await this.getGithubDirectoryFiles(
            context,
            branchName,
            item.path,
            repositoryId,
          );
          files.push(...subFiles);
        }
      }

      return files;
    } catch (error) {
      this.logger.debug(
        `Failed to get directory files for ${directoryPath}: ${error}`,
      );
      return [];
    }
  }

  /**
   * Get all files from GitHub repository using tree API
   */
  private async getGithubRepositoryFiles(
    context: RepositoryAuthContext,
    branchName: string,
    repositoryId: string,
  ): Promise<Array<{ path: string; type: string }>> {
    try {
      let response;
      try {
        response = await axios.get(
          `https://api.github.com/repos/${context.owner}/${context.name}/git/trees/${branchName}?recursive=1`,
          {
            headers: this.githubHeaders(context.token),
          },
        );
      } catch (error: any) {
        // Handle 401/403 errors - token might be expired or insufficient permissions
        if (error.response?.status === 401 || error.response?.status === 403) {
          if (error.response?.status === 401) {
            this.logger.warn(
              `GitHub token expired for ${context.owner}/${context.name}, refreshing...`,
            );
            // Clear cached context to force token refresh
            this.repositoryContextCache.delete(repositoryId);

            // Get fresh context with new token
            const freshContext = await this.getRepositoryContext(repositoryId);
            if (!freshContext) {
              throw new Error('Failed to refresh repository context');
            }

            // Retry with fresh token
            response = await axios.get(
              `https://api.github.com/repos/${freshContext.owner}/${freshContext.name}/git/trees/${branchName}?recursive=1`,
              {
                headers: this.githubHeaders(freshContext.token),
              },
            );
          } else {
            // 403 - insufficient permissions, log and return empty
            this.logger.warn(
              `Insufficient permissions to access repository tree for ${context.owner}/${context.name}`,
            );
            return [];
          }
        } else {
          throw error;
        }
      }

      const tree = response.data?.tree || [];
      // Filter to only include blob (file) types
      return tree
        .filter((item: any) => item.type === 'blob')
        .map((item: any) => ({
          path: item.path,
          type: item.type,
        }));
    } catch (error) {
      this.logger.warn(
        `Failed to get repository tree for ${context.owner}/${context.name}: ${error}`,
      );
      return [];
    }
  }

  private async searchBitbucket(
    options: RemoteSearchRequest,
    context: RepositoryAuthContext,
    branchName: string,
  ): Promise<RemoteCodeMatch[]> {
    const matches: RemoteCodeMatch[] = [];
    const workspace = context.workspace || context.owner;

    try {
      // If relevant files are provided, search only in those files (faster!)
      if (options.relevantFiles && options.relevantFiles.length > 0) {
        this.logger.debug(
          `Searching in ${options.relevantFiles.length} relevant files (Bitbucket)`,
        );
        return await this.searchInRelevantFilesBitbucket(
          options,
          context,
          branchName,
        );
      }

      // Otherwise, use Bitbucket search API
      // Build search query - include function name and optionally filename
      let searchQuery = options.functionName;
      if (options.filePath) {
        const fileName = path.basename(options.filePath);
        // Bitbucket search supports searching for multiple terms
        searchQuery = `${options.functionName} ${fileName}`;
      }

      const response = await axios.get(
        `https://api.bitbucket.org/2.0/repositories/${workspace}/${context.name}/search/code`,
        {
          params: {
            search: searchQuery,
            branch: branchName,
            pagelen: Math.min(options.limit ?? 20, 20),
          },
          headers: this.bitbucketHeaders(context.token),
        },
      );

      const values = response.data?.values ?? [];

      for (const value of values) {
        const matchPath =
          value?.path ||
          value?.file?.path ||
          value?.location?.path ||
          value?.file?.display_path;
        if (!matchPath) {
          continue;
        }

        if (
          options.filePath &&
          this.normalizePath(matchPath) === this.normalizePath(options.filePath)
        ) {
          continue;
        }

        const occurrences = await this.extractMatchesFromBitbucketFile(
          matchPath,
          context,
          branchName,
          options.functionName,
        );

        for (const occurrence of occurrences) {
          matches.push({
            provider: context.provider,
            branch: branchName,
            filePath: matchPath,
            line: occurrence.line,
            snippet: occurrence.snippet,
            url: value?.href || value?.link?.href,
            searchContext: this.buildSearchContext(options, branchName),
          });

          if (matches.length >= (options.limit ?? 20)) {
            return matches;
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `Bitbucket code search failed for ${workspace}/${context.name}: ${error}`,
      );
    }

    return matches;
  }

  /**
   * Search only in relevant files for Bitbucket (similar to GitHub version)
   */
  private async searchInRelevantFilesBitbucket(
    options: RemoteSearchRequest,
    context: RepositoryAuthContext,
    branchName: string,
  ): Promise<RemoteCodeMatch[]> {
    const matches: RemoteCodeMatch[] = [];
    const limit = Math.min(options.limit ?? 20, 20);

    if (!options.relevantFiles || options.relevantFiles.length === 0) {
      return matches;
    }

    this.logger.debug(
      `Searching function "${options.functionName}" in ${options.relevantFiles.length} relevant files (Bitbucket)`,
    );

    // Search in each relevant file
    for (const filePath of options.relevantFiles.slice(0, 50)) {
      // Skip self references
      if (
        options.filePath &&
        this.normalizePath(filePath) === this.normalizePath(options.filePath)
      ) {
        continue;
      }

      try {
        const occurrences = await this.extractMatchesFromBitbucketFile(
          filePath,
          context,
          branchName,
          options.functionName,
        );

        for (const occurrence of occurrences) {
          matches.push({
            provider: context.provider,
            branch: branchName,
            filePath: filePath,
            line: occurrence.line,
            snippet: occurrence.snippet,
            url: `https://bitbucket.org/${context.workspace || context.owner}/${context.name}/src/${branchName}/${filePath}#lines-${occurrence.line}`,
            searchContext: this.buildSearchContext(options, branchName),
          });

          if (matches.length >= limit) {
            return matches;
          }
        }
      } catch (error) {
        this.logger.debug(
          `Failed to search in relevant file ${filePath}: ${error}`,
        );
        // Continue with next file
      }
    }

    return matches;
  }

  private async extractMatchesFromGithubFile(
    filePath: string,
    context: RepositoryAuthContext,
    branchName: string,
    functionName: string,
    repositoryId?: string,
  ): Promise<LineMatch[]> {
    const content = await this.fetchGithubFileContent(
      context,
      filePath,
      branchName,
      repositoryId,
    );

    if (!content) {
      return [];
    }

    return this.extractLineMatches(content, functionName);
  }

  private async extractMatchesFromBitbucketFile(
    filePath: string,
    context: RepositoryAuthContext,
    branchName: string,
    functionName: string,
  ): Promise<LineMatch[]> {
    const content = await this.fetchBitbucketFileContent(
      context,
      filePath,
      branchName,
    );

    if (!content) {
      return [];
    }

    return this.extractLineMatches(content, functionName);
  }

  private async fetchGithubFileContent(
    context: RepositoryAuthContext,
    filePath: string,
    branchName: string,
    repositoryId?: string,
  ): Promise<string | null> {
    try {
      const encodedPath = filePath
        .split(/[\\/]/)
        .map((segment) => encodeURIComponent(segment))
        .join('/');

      let response;
      try {
        response = await axios.get(
          `https://api.github.com/repos/${context.owner}/${context.name}/contents/${encodedPath}`,
          {
            params: { ref: branchName },
            headers: this.githubHeaders(context.token),
          },
        );
      } catch (error: any) {
        // Handle 401 Unauthorized - token might be expired, refresh it
        if (error.response?.status === 401 && repositoryId) {
          this.logger.warn(
            `GitHub token expired while fetching file content, refreshing...`,
          );
          // Clear cached context to force token refresh
          this.repositoryContextCache.delete(repositoryId);

          // Get fresh context with new token
          const freshContext = await this.getRepositoryContext(repositoryId);
          if (!freshContext) {
            throw new Error('Failed to refresh repository context');
          }

          // Retry with fresh token
          response = await axios.get(
            `https://api.github.com/repos/${freshContext.owner}/${freshContext.name}/contents/${encodedPath}`,
            {
              params: { ref: branchName },
              headers: this.githubHeaders(freshContext.token),
            },
          );
        } else {
          throw error;
        }
      }

      if (response.data?.content) {
        return Buffer.from(
          response.data.content,
          response.data.encoding || 'base64',
        ).toString('utf8');
      }
    } catch (error) {
      this.logger.debug(
        `Failed to fetch GitHub file content for ${filePath}: ${error}`,
      );
    }

    return null;
  }

  private async fetchBitbucketFileContent(
    context: RepositoryAuthContext,
    filePath: string,
    branchName: string,
  ): Promise<string | null> {
    try {
      const workspace = context.workspace || context.owner;
      const encodedBranch = encodeURIComponent(branchName);
      const encodedPath = filePath
        .split(/[\\/]/)
        .map((segment) => encodeURIComponent(segment))
        .join('/');

      const response = await axios.get(
        `https://api.bitbucket.org/2.0/repositories/${workspace}/${context.name}/src/${encodedBranch}/${encodedPath}`,
        {
          headers: this.bitbucketHeaders(context.token),
          responseType: 'text',
        },
      );

      return response.data;
    } catch (error) {
      this.logger.debug(
        `Failed to fetch Bitbucket file content for ${filePath}: ${error}`,
      );
      return null;
    }
  }

  private extractLineMatches(
    content: string,
    functionName: string,
    maxMatches = 5,
  ): LineMatch[] {
    const matches: LineMatch[] = [];
    const lines = content.split(/\r?\n/);
    const callRegex = new RegExp(
      `${this.escapeRegExp(functionName)}\\s*\\(`,
      'i',
    );
    const jsxRegex = new RegExp(
      `<${this.escapeRegExp(functionName)}[\\s>/]`,
      'i',
    );
    const definitionRegex = new RegExp(
      `\\b(function|class|const|let|var)\\s+${this.escapeRegExp(
        functionName,
      )}\\b`,
      'i',
    );

    for (let index = 0; index < lines.length; index++) {
      if (matches.length >= maxMatches) {
        break;
      }

      const line = lines[index];
      if (
        definitionRegex.test(line.trim()) ||
        (!callRegex.test(line) && !jsxRegex.test(line))
      ) {
        continue;
      }

      const snippet = this.buildSnippet(lines, index);
      matches.push({ line: index + 1, snippet });
    }

    return matches;
  }

  private buildSnippet(lines: string[], lineIndex: number): string {
    const start = Math.max(0, lineIndex - 1);
    const end = Math.min(lines.length, lineIndex + 2);
    return lines.slice(start, end).join('\n').trim();
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async getRepositoryContext(
    repositoryId: string,
  ): Promise<RepositoryAuthContext | null> {
    if (this.repositoryContextCache.has(repositoryId)) {
      return this.repositoryContextCache.get(repositoryId)!;
    }

    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        owner: true,
        name: true,
        provider: true,
        baseBranch: true,
        organizationId: true,
      },
    });

    if (!repository) {
      this.logger.warn(`Repository not found: ${repositoryId}`);
      return null;
    }

    const accountId = await this.resolveAccountId(repository);
    if (!accountId) {
      this.logger.warn(
        `Unable to resolve account credentials for repository ${repositoryId}`,
      );
      return null;
    }

    const credentials = await this.accountCredentialService.getAccountToken({
      accountId,
    });

    if (!credentials?.decryptedToken) {
      this.logger.warn(
        `No decrypted token available for repository ${repositoryId}`,
      );
      return null;
    }

    const context: RepositoryAuthContext = {
      id: repository.id,
      owner: repository.owner,
      name: repository.name,
      provider: repository.provider,
      baseBranch: repository.baseBranch || 'main',
      token: credentials.decryptedToken,
      workspace: credentials.payload?.workspace,
    };

    this.repositoryContextCache.set(repositoryId, context);
    return context;
  }

  private async resolveAccountId(repository: {
    id: string;
    organizationId?: string | null;
  }): Promise<string | null> {
    if (repository.organizationId) {
      const orgAdmin = await this.prisma.organizationAccounts.findFirst({
        where: { organizationId: repository.organizationId, role: 'ADMIN' },
        orderBy: { createdAt: 'asc' },
        select: { accountId: true },
      });

      if (orgAdmin) {
        return orgAdmin.accountId;
      }
    }

    const repositoryAccount = await this.prisma.accountRepository.findFirst({
      where: { repositoryId: repository.id },
      select: { accountId: true },
    });

    return repositoryAccount?.accountId ?? null;
  }

  private async resolveBranchForPr(
    context: RepositoryAuthContext,
    prNumber: number,
  ): Promise<string> {
    const cacheKey = `${context.id}:${prNumber}`;
    if (this.prBranchCache.has(cacheKey)) {
      return this.prBranchCache.get(cacheKey)!;
    }

    let branch = context.baseBranch;

    try {
      if (context.provider === RepositoryProvider.GITHUB) {
        const response = await axios.get(
          `https://api.github.com/repos/${context.owner}/${context.name}/pulls/${prNumber}`,
          {
            headers: this.githubHeaders(context.token),
          },
        );

        branch = response.data?.head?.ref || branch;
      } else {
        const workspace = context.workspace || context.owner;
        const response = await axios.get(
          `https://api.bitbucket.org/2.0/repositories/${workspace}/${context.name}/pullrequests/${prNumber}`,
          {
            headers: this.bitbucketHeaders(context.token),
          },
        );

        branch = response.data?.source?.branch?.name || branch;
      }
    } catch (error) {
      this.logger.debug(
        `Failed to resolve branch for PR ${prNumber}: ${error}`,
      );
    }

    this.prBranchCache.set(cacheKey, branch);
    return branch;
  }

  private githubHeaders(token: string) {
    // Follow the same pattern as github.helper.ts
    // Use text-match Accept header for code search to get match information
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.text-match+json',
      'User-Agent': 'codedeno-impact-analysis',
    };
  }

  private bitbucketHeaders(token: string) {
    const value = token.startsWith('JWT ') ? token : `Bearer ${token}`;
    return {
      Authorization: value,
    };
  }

  private resolveBranchesToSearch(
    branchName: string,
    context: RepositoryAuthContext,
    includeBaseBranch?: boolean,
  ): string[] {
    const branches = new Set<string>([branchName]);

    if (
      includeBaseBranch !== false &&
      context.baseBranch &&
      context.baseBranch !== branchName
    ) {
      branches.add(context.baseBranch);
    }

    return [...branches];
  }

  private deduplicateMatches(matches: RemoteCodeMatch[]): RemoteCodeMatch[] {
    const seen = new Set<string>();
    const unique: RemoteCodeMatch[] = [];

    for (const match of matches) {
      const key = `${match.provider}:${match.branch}:${this.normalizePath(match.filePath)}:${match.line}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      unique.push(match);
    }

    return unique;
  }

  private buildSearchContext(
    options: RemoteSearchRequest,
    branchName: string,
  ): RemoteSearchMetadata {
    return {
      functionName: options.functionName,
      fileName: options.filePath ? path.basename(options.filePath) : undefined,
      branchName,
      codeType: options.codeType ?? 'FUNCTION',
    };
  }

  private normalizePath(filePath: string): string {
    return filePath
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '')
      .toLowerCase();
  }
}
