import { ConfigService } from '@nestjs/config';
import { ScanStatus } from '@prisma/client';
import { Worker } from 'bullmq';
import { Gemini } from 'src/config/helpers/ai/gemini.ai.helper';
import { fetchFileByUrl } from 'src/config/helpers/repositories/github.helper';
import { MailService } from 'src/mail/mail.service';
import { AccountCredentialService } from 'src/modules/accountCredentials/accountCredentials.service';
import { BillingService } from 'src/modules/billing/billing.service';
import { CommentService } from 'src/modules/comment/comment.service';
import { RepositoryScanService } from 'src/modules/repositoryScan/repositoryScan.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { FileCache } from '../cache/file.cache';
// import { MailService } from '../mail/mail.service';

// Initialize Prisma & Services
const prisma = new PrismaService();
const accountCredentialService = new AccountCredentialService(prisma);
const commentService = new CommentService(prisma);
const billingService = new BillingService(prisma, new ConfigService());

// Create a mock MailerService for the worker environment
const mockMailerService = {
  sendMail: async () => {
    console.log('Mock email sending in worker environment');
    return true;
  },
};

const mailService = new MailService(mockMailerService as any, prisma);
// const mailService = new MailService(mockMailerService as any);

const fileCache = new FileCache();

const repositoryScanService = new RepositoryScanService(
  prisma,
  commentService,
  accountCredentialService,
  billingService,
  // mailService,
  // fileCache,
);

// Function to process full repository scan jobs
const processRepositoryScan = async (job) => {
  const { repositoryName, accountId, repositoryScanId } = job.data;

  // Update scan status to PENDING
  await prisma.repositoryScan.update({
    where: { id: repositoryScanId },
    data: { status: ScanStatus.IN_PROGRESS },
  });

  // Execute repository scan
  await repositoryScanService.scanRepositoriesDirect(
    repositoryName,
    accountId,
    repositoryScanId,
  );
};

// Function to process changed files scan jobs
const processChangedFilesScan = async (job) => {
  const { repositoryId, changedFiles, accountId } = job.data;

  console.log(`Processing changed files scan for repository ${repositoryId}`);
  console.log(`Changed files: ${changedFiles.length}`);

  try {
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

    console.log(`Found existing scan: ${existingScan?.id || 'None'}`);

    // Execute changed files scan
    const result = await repositoryScanService.rescanChangedFiles(
      repositoryId,
      changedFiles,
      accountId,
    );

    console.log(
      `Completed changed files scan. Files scanned: ${result.filesScanned}`,
    );
    return result;
  } catch (error) {
    console.error('Error in changed files scan worker:', error);
    throw error;
  }
};

// Function to process on-demand file scan jobs
const processOnDemandFileScan = async (job) => {
  const { repositoryId, filePath, accountId } = job.data;

  console.log(
    `Processing on-demand scan for file: ${filePath} in repository ${repositoryId}`,
  );

  try {
    // Get repository details for on-demand scan
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      include: {
        repositorySettings: true,
      },
    });

    if (!repository) {
      throw new Error(`Repository with ID ${repositoryId} not found`);
    }

    // Get account credentials for repository access
    const accountCredentials = await accountCredentialService.getAccountToken({
      accountId,
    });

    // Check if file exists in the repository
    const fileContent = await fetchFileByUrl(
      `${filePath}`,
      accountCredentials.decryptedToken,
    );

    if (!fileContent) {
      throw new Error(`File ${filePath} not found in repository`);
    }

    // Get an existing scan record - don't create a new one
    const scanRecord = await prisma.repositoryScan.findFirst({
      where: {
        repositoryId,
        status: ScanStatus.COMPLETED,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!scanRecord) {
      throw new Error(`No existing scan found for repository ${repositoryId}`);
    }

    const scanId = scanRecord.id;

    // Process the file
    const fileObj = {
      name: filePath.split('/').pop(),
      filePath: filePath,
      fileRelativePath: filePath,
      content: fileContent,
    };

    // Analyze the file
    const analysisResult = await repositoryScanService.analyzeFiles(
      fileObj,
      accountCredentials.decryptedToken,
      repositoryId,
      scanId,
      repository,
    );

    if (!analysisResult) {
      throw new Error(`Failed to analyze file ${filePath}`);
    }

    // Generate embedding only for this specific file using the embedSpecificFiles method
    const gemini = new Gemini();

    // Get documentation for the specific file
    const fileDoc = await prisma.fileDocumentation.findFirst({
      where: {
        repositoryId,
        fullPath: filePath,
      },
    });

    if (fileDoc && fileDoc.summary) {
      // Generate and store embedding
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

    console.log(`Successfully processed on-demand scan for file: ${filePath}`);
    return { success: true, fileId: fileDoc?.id };
  } catch (error) {
    console.error(
      `Error in on-demand file scan worker for ${filePath}:`,
      error,
    );
    throw error;
  }
};

// Register worker processors
const repositoryScanWorker = new Worker(
  'repository-scan',
  async (job) => {
    // Check job type to determine which processor to use
    if (job.data.type === 'changed-files-scan') {
      return processChangedFilesScan(job);
    } else if (job.data.type === 'on-demand-file-scan') {
      return processOnDemandFileScan(job);
    } else {
      // Default to full repository scan
      return processRepositoryScan(job);
    }
  },
  {
    connection: {
      host: '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT),
    },
    concurrency: 2, // Maximum parallel jobs
  },
);

console.log('✅ Repository Scan Worker is running...');

// Export the worker for use in other modules
export { repositoryScanWorker };
