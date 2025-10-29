import { AccountCredentialsType, ScanStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { DeepSeek } from 'src/config/helpers/ai/deepseek.ai.helper';
import { Gemini } from 'src/config/helpers/ai/gemini.ai.helper';
import { fetchFileByUrl } from 'src/config/helpers/repositories/github.helper';
import { PrismaService } from 'src/prisma/prisma.service';

export class ConnectionType {
  host: string;
  port: number;
}

// Type definitions
interface RepositoryData {
  owner: string;
  name: string;
  baseBranch: string;
}

interface AccountCredentials {
  accountType: AccountCredentialsType;
  decryptedToken: string;
  payload?: {
    workspace: string;
  };
}

interface OnDemandFileScanOptions {
  repositoryId: string;
  filePath: string;
  accountId: string;
  processDirect?: boolean;
  prisma?: PrismaService;
  repositoryData?: RepositoryData;
  accountCredentials?: AccountCredentials;
}

// Configuration constants
const SKIP_EXTENSIONS = [
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.lock',
  '.gitignore',
];

const SKIP_DIRECTORIES = ['node_modules/', 'dist/', 'build/', '.git/', 'temp/'];

/**
 * Sanitizes file path to prevent directory traversal attacks
 * @param filePath The file path to sanitize
 * @returns Sanitized file path
 */
function sanitizeFilePath(filePath: string): string {
  if (!filePath) {
    throw new Error('File path is required');
  }

  // Remove any '..' sequences to prevent directory traversal
  let sanitized = filePath.replace(/\.\.\//g, '').replace(/\.\./g, '');

  // Remove leading slashes and dots
  sanitized = sanitized.replace(/^[./]+/, '');

  // Ensure the path doesn't contain null bytes
  if (sanitized.includes('\0')) {
    throw new Error('Invalid file path: contains null bytes');
  }

  return sanitized;
}

/**
 * Queue for full repository scans
 */
export const repositoryScanQueue = new Queue('repository-scan', {
  connection: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT),
  },
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

/**
 * Queue for rescanning changed files
 * Uses the same queue name so it can be processed by the same worker
 * @param skipIssueDetection - If true, only updates documentation/embeddings without catching new issues
 */
export async function queueChangedFilesScan(
  repositoryId: string,
  changedFiles: string[],
  accountId: string,
  skipIssueDetection: boolean = false,
) {
  // Filter out files that we don't want to scan
  const filteredFiles = changedFiles.filter((file) => {
    // Skip files with extensions we don't want to scan
    if (SKIP_EXTENSIONS.some((ext) => file.endsWith(ext))) {
      return false;
    }

    // Skip files in certain directories
    if (SKIP_DIRECTORIES.some((dir) => file.startsWith(dir))) {
      return false;
    }

    return true;
  });

  if (filteredFiles.length === 0) {
    console.log('No files to scan after filtering');
    return;
  }

  // Add job to the queue
  await repositoryScanQueue.add(
    'changed-files-scan',
    {
      type: 'changed-files-scan',
      repositoryId,
      changedFiles: filteredFiles,
      accountId,
      skipIssueDetection,
    },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    },
  );

  console.log(
    `Queued ${filteredFiles.length}   (skipIssueDetection: ${skipIssueDetection})`,
  );
  return filteredFiles.length;
}

/**
 * Queue for on-demand file scanning
 * Uses the same queue name so it can be processed by the same worker
 *
 * @param options Options object containing all parameters
 */
export async function queueOnDemandFileScan(options: OnDemandFileScanOptions) {
  const {
    repositoryId,
    filePath,
    accountId,
    processDirect = false,
    prisma,
    repositoryData,
    accountCredentials,
  } = options;

  // Validate inputs
  if (!repositoryId || !filePath || !accountId) {
    console.error('Missing required parameters for on-demand file scan');
    return { success: false, error: 'Missing required parameters' };
  }

  // Sanitize file path to prevent directory traversal
  let sanitizedFilePath: string;
  try {
    sanitizedFilePath = sanitizeFilePath(filePath);
  } catch (error) {
    console.error(`Invalid file path: ${error.message}`);
    return { success: false, error: error.message };
  }

  // Skip files with extensions we don't want to scan
  if (SKIP_EXTENSIONS.some((ext) => sanitizedFilePath.endsWith(ext))) {
    console.log(
      `Skipping file with unsupported extension: ${sanitizedFilePath}`,
    );
    return {
      success: false,
      error: 'File has unsupported extension',
    };
  }

  // Skip files in certain directories
  if (SKIP_DIRECTORIES.some((dir) => sanitizedFilePath.startsWith(dir))) {
    console.log(`Skipping file in excluded directory: ${sanitizedFilePath}`);
    return {
      success: false,
      error: 'File is in excluded directory',
    };
  }

  // If direct processing is requested (for API responses)
  if (processDirect && prisma && repositoryData && accountCredentials) {
    try {
      console.log(`Directly processing file scan for: ${sanitizedFilePath}`);

      // Validate required data fields
      if (
        !repositoryData.owner ||
        !repositoryData.name ||
        !repositoryData.baseBranch
      ) {
        return { success: false, error: 'Invalid repository data' };
      }

      if (!accountCredentials.decryptedToken) {
        return { success: false, error: 'Missing account credentials token' };
      }

      // Check if file exists in the repository - construct proper URL based on provider
      let fileUrl: string;

      if (
        accountCredentials?.accountType === AccountCredentialsType.GITHUB_TOKEN
      ) {
        fileUrl = `https://raw.githubusercontent.com/${repositoryData.owner}/${repositoryData.name}/${repositoryData.baseBranch}/${sanitizedFilePath}`;
      } else {
        // Bitbucket
        const workspace = accountCredentials.payload?.workspace?.replace(
          ' ',
          '-',
        );
        if (!workspace) {
          return { success: false, error: 'Missing Bitbucket workspace' };
        }
        const repo = repositoryData.name.replace(' ', '-');
        const branch = repositoryData.baseBranch.replace(' ', '-');
        fileUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/src/${branch}/${sanitizedFilePath}`;
      }

      console.log(`Fetching file from URL: ${fileUrl}`);
      const { fileContent } = await fetchFileByUrl(fileUrl, {
        token: accountCredentials.decryptedToken,
      });

      if (!fileContent) {
        return { success: false, error: 'File not found in repository' };
      }

      // Find existing scan for this repository
      const existingScan = await prisma.repositoryScan.findFirst({
        where: {
          repositoryId,
          status: ScanStatus.COMPLETED,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Use existing scan ID if available
      const scanId = existingScan ? existingScan.id : null;

      if (!scanId) {
        console.log(`No existing scan found for repository ${repositoryId}`);
        return { success: false, error: 'No repository scan found' };
      }

      // Process the file
      const fileObj = {
        name: sanitizedFilePath.split('/').pop(),
        filePath: sanitizedFilePath,
        fileRelativePath: sanitizedFilePath,
        content: fileContent,
      };

      // Create AI instances
      const deepseekAI = new DeepSeek();
      const gemini = new Gemini();

      // Analyze the file
      const analysisResult = await deepseekAI.analyzeFile({
        ...fileObj,
        content: fileContent,
      });

      if (!analysisResult) {
        return { success: false, error: 'Failed to analyze file' };
      }

      // Check if file documentation already exists
      const existingDoc = await prisma.fileDocumentation.findFirst({
        where: {
          repositoryId,
          fullPath: sanitizedFilePath,
        },
      });

      // Extract file extension and name
      const fileName = sanitizedFilePath.split('/').pop();

      // Determine file type based on analysis tags
      const fileTypeStr = analysisResult.tags?.[0] || 'UNKNOWN';
      const fileTypeMap = {
        CONTROLLER: 'CONTROLLER',
        SERVICE: 'SERVICE',
        MODEL: 'MODEL',
        COMPONENT: 'COMPONENT',
        UTIL: 'UTILITY',
        CONFIG: 'CONFIG',
        TEST: 'TEST',
        UNKNOWN: 'UNKNOWN',
      };
      const docType = fileTypeMap[fileTypeStr] || 'UNKNOWN';

      // Create or update file documentation
      let fileDoc;
      if (existingDoc) {
        fileDoc = await prisma.fileDocumentation.update({
          where: { id: existingDoc.id },
          data: {
            name: fileName,
            fullPath: sanitizedFilePath,
            fileType: [docType],
            summary: analysisResult.summary || '',
            imports: analysisResult.imports || [],
            exports: analysisResult.exports || [],
            functions: analysisResult.functions || [],
            classes: analysisResult.classes || [],
            components: analysisResult.components || [],
            repositoryScanId: scanId,
          },
        });
      } else {
        fileDoc = await prisma.fileDocumentation.create({
          data: {
            name: fileName,
            fullPath: sanitizedFilePath,
            fileType: [docType],
            summary: analysisResult.summary || '',
            imports: analysisResult.imports || [],
            exports: analysisResult.exports || [],
            functions: analysisResult.functions || [],
            classes: analysisResult.classes || [],
            components: analysisResult.components || [],
            repositoryId,
            repositoryScanId: scanId,
          },
        });
      }

      // Generate embedding for the file
      if (fileDoc && fileDoc.summary) {
        const embedding = await gemini.getEmbeddings(
          typeof fileDoc.summary === 'string'
            ? fileDoc.summary
            : String(fileDoc.summary),
        );

        // Store embedding as vector
        await prisma.$executeRaw`
          UPDATE "FileDocumentation"
          SET "summaryEmbedding" = ${embedding}::vector
          WHERE id = ${fileDoc.id}
        `;
      }

      console.log(
        `Successfully processed file scan directly: ${sanitizedFilePath}`,
      );
      return { success: true, fileDoc };
    } catch (error) {
      console.error(`Error in direct file processing: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Otherwise, queue the job for background processing
  try {
    // Add job to the queue with high priority
    const job = await repositoryScanQueue.add(
      'on-demand-file-scan',
      {
        type: 'on-demand-file-scan',
        repositoryId,
        filePath: sanitizedFilePath,
        accountId,
      },
      {
        priority: 1, // Higher priority (lower number = higher priority)
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000, // Fast retry for on-demand scanning
        },
      },
    );

    console.log(
      `Queued on-demand scan for file: ${sanitizedFilePath}, job ID: ${job.id}`,
    );
    return {
      success: true,
      jobId: job.id,
    };
  } catch (error) {
    console.error(`Error queueing on-demand file scan: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}
