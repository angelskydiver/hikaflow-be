import { ScanStatus } from '@prisma/client';
import { Worker } from 'bullmq';
import { AccountCredentialService } from 'src/modules/accountCredentials/accountCredentials.service';
import { CommentService } from 'src/modules/comment/comment.service';
import { RepositoryScanService } from 'src/modules/repositoryScan/repositoryScan.service';
import { PrismaService } from 'src/prisma/prisma.service';

// Initialize Prisma & Services
const prisma = new PrismaService();
const accountCredentialService = new AccountCredentialService(prisma);
const commentService = new CommentService(prisma);

const repositoryScanService = new RepositoryScanService(
  prisma,
  commentService,
  accountCredentialService,
);

// Function to process jobs
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

// Create worker with Redis connection
const repositoryScanWorker = new Worker(
  'repository-scan',
  processRepositoryScan,
  {
    connection: {
      host: '127.0.0.1',
      port: 6380, // Ensure it's using the correct Redis instance
    },
    concurrency: 2, // Maximum parallel jobs
  },
);

console.log('✅ Repository Scan Worker is running...');
