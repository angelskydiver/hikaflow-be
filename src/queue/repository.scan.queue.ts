import { AccountCredentialsType, ScanStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { DeepSeek } from 'src/config/helpers/ai/deepseek.ai.helper';
import { Gemini } from 'src/config/helpers/ai/gemini.ai.helper';
import { fetchFileByUrl } from 'src/config/helpers/repositories/github.helper';
import { PrismaService } from 'src/prisma/prisma.service';

export class connectionType {
  host: string;
  port: number;
}

/**
 * Queue for full repository scans
 */
export const repositoryScanQueue = new Queue('repository-scan', {
  connection: {
    host: '127.0.0.1',
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
 */
export async function queueChangedFilesScan(
  repositoryId: string,
  changedFiles: string[],
  accountId: string,
) {
  // Filter out files that we don't want to scan
  const filteredFiles = changedFiles.filter((file) => {
    // Skip files with extensions we don't want to scan
    const skipExtensions = [
      '.md',
      '.json',
      '.yaml',
      '.yml',
      '.lock',
      '.gitignore',
    ];
    if (skipExtensions.some((ext) => file.endsWith(ext))) {
      return false;
    }

    // Skip files in certain directories
    const skipDirs = ['node_modules/', 'dist/', 'build/', '.git/', 'temp/'];
    if (skipDirs.some((dir) => file.startsWith(dir))) {
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
    },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    },
  );

  console.log(`Queued ${filteredFiles.length} changed files for scanning`);
  return filteredFiles.length;
}

/**
 * Queue for on-demand file scanning
 * Uses the same queue name so it can be processed by the same worker
 *
 * @param repositoryId Repository ID
 * @param filePath Path to the file to scan
 * @param accountId Account ID
 * @param processDirect If true, processes the file directly instead of queuing (for API responses)
 * @param prisma Optional PrismaService instance for direct processing
 * @param repositoryData Optional repository data for direct processing
 * @param accountCredentials Optional account credentials for direct processing
 */
export async function queueOnDemandFileScan(
  repositoryId: string,
  filePath: string,
  accountId: string,
  processDirect = false,
  prisma?: PrismaService,
  repositoryData?: any,
  accountCredentials?: any,
) {
  // Validate inputs
  if (!repositoryId || !filePath || !accountId) {
    console.error('Missing required parameters for on-demand file scan');
    return { success: false, error: 'Missing required parameters' };
  }

  // Skip files with extensions we don't want to scan
  const skipExtensions = [
    '.md',
    '.json',
    '.yaml',
    '.yml',
    '.lock',
    '.gitignore',
  ];

  if (skipExtensions.some((ext) => filePath.endsWith(ext))) {
    console.log(`Skipping file with unsupported extension: ${filePath}`);
    return {
      success: false,
      error: 'File has unsupported extension',
    };
  }

  // Skip files in certain directories
  const skipDirs = ['node_modules/', 'dist/', 'build/', '.git/', 'temp/'];
  if (skipDirs.some((dir) => filePath.startsWith(dir))) {
    console.log(`Skipping file in excluded directory: ${filePath}`);
    return {
      success: false,
      error: 'File is in excluded directory',
    };
  }

  // If direct processing is requested (for API responses)
  if (processDirect && prisma && repositoryData && accountCredentials) {
    try {
      console.log(`Directly processing file scan for: ${filePath}`);

      // Check if file exists in the repository - construct proper URL based on provider
      let fileUrl = filePath;

      if (
        accountCredentials.accountType === AccountCredentialsType.GITHUB_TOKEN
      ) {
        fileUrl = `https://raw.githubusercontent.com/${repositoryData.owner}/${repositoryData.name}/${repositoryData.baseBranch}/${filePath}`;
      } else {
        // Bitbucket
        const workspace = accountCredentials.payload.workspace.replace(
          ' ',
          '-',
        );
        const repo = repositoryData.name.replace(' ', '-');
        const branch = repositoryData.baseBranch.replace(' ', '-');
        fileUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/src/${branch}/${filePath}`;
      }

      console.log(`Fetching file from URL: ${fileUrl}`);
      const { fileContent } = await fetchFileByUrl(
        fileUrl,
        accountCredentials.decryptedToken,
      );

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
        name: filePath.split('/').pop(),
        filePath: filePath,
        fileRelativePath: filePath,
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
          fullPath: filePath,
        },
      });

      // Extract file extension and name
      const fileName = filePath.split('/').pop();

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
            fullPath: filePath,
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
            fullPath: filePath,
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

      console.log(`Successfully processed file scan directly: ${filePath}`);
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
        filePath,
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
      `Queued on-demand scan for file: ${filePath}, job ID: ${job.id}`,
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
