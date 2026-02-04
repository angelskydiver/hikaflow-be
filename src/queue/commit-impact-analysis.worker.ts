import { MailerService } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { RepositoryScanService } from '../modules/repositoryScan/repositoryScan.service';
import { AccountCredentialService } from '../modules/accountCredentials/accountCredentials.service';
import { BillingService } from '../modules/billing/billing.service';
import { CommentService } from '../modules/comment/comment.service';
import { FeedbackService } from '../modules/feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { SeniorEngineerAnalysisService } from '../modules/repositoryScan/seniorEngineerAnalysis.service';
import { CommitImpactAnalysisJob } from './commit-impact-analysis.queue';

// Initialize Prisma & Services (matching repository.scan.worker.ts pattern)
const prisma = new PrismaService();
const accountCredentialService = new AccountCredentialService(prisma);
const feedbackService = new FeedbackService(prisma);
const commentService = new CommentService(prisma, feedbackService);
const configService = new ConfigService();
const mailerService = new MailerService(
  {
    transport: {
      host: configService.get('MAILER_HOST'),
      secure: false,
      auth: {
        user: configService.get('MAILER_USER_EMAIL'),
        pass: configService.get('MAILER_USER_PASSWORD'),
      },
    },
    defaults: {
      from: `"No Reply" <${configService.get('MAILER_USER_EMAIL')}>`,
    },
    template: {
      dir: join(__dirname, 'templates'),
      adapter: new HandlebarsAdapter(),
      options: {
        strict: true,
      },
    },
  },
  null,
);
const mailService = new MailService(mailerService, prisma);
const billingService = new BillingService(prisma, configService, mailService);
const seniorEngineerAnalysisService = new SeniorEngineerAnalysisService();

// Initialize RepositoryScanService (same as PR analysis)
const repositoryScanService = new RepositoryScanService(
  prisma,
  commentService,
  accountCredentialService,
  billingService,
  mailService,
  seniorEngineerAnalysisService,
);

// Add cleanup handlers for graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 [WORKER] Received SIGINT, closing Prisma connection...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 [WORKER] Received SIGTERM, closing Prisma connection...');
  await prisma.$disconnect();
  process.exit(0);
});

/**
 * Process commit impact analysis job
 */
const processCommitImpactAnalysis = async (job: any) => {
  const {
    repositoryId,
    commitSha,
    changedFiles,
    organizationId,
    commitId,
    repositoryOwner,
    repositoryName,
    repositoryProvider,
  } = job.data as CommitImpactAnalysisJob;

  console.log('🚀 [CHECKPOINT 7] Worker: Starting commit impact analysis processing:', {
    commitSha,
    repositoryId,
    commitId,
    filesCount: changedFiles.length,
    jobId: job.id,
  });

  try {
    // [CHECKPOINT 7.1] Update commit summary status to 'processing'
    if (commitId) {
      console.log('🔄 [CHECKPOINT 7.1] Updating commit summary status to processing:', commitId);
      await prisma.commitSummary.update({
        where: { id: commitId },
        data: { impactAnalysisStatus: 'processing' },
      });
      console.log('✅ [CHECKPOINT 7.1] Commit summary status updated to processing');
    }

    // [CHECKPOINT 7.2] Get repository and accountId
    console.log('🔄 [CHECKPOINT 7.2] Getting repository and account credentials...');
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      include: {
        accounts: {
          include: {
            account: true,
          },
        },
      },
    });

    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    // Get accountId from organization account
    const organizationAccount = await prisma.organizationAccounts.findFirst({
      where: {
        organizationId: repository.organizationId,
        role: 'ADMIN',
      },
    });

    if (!organizationAccount) {
      throw new Error(`No organization account found for repository ${repositoryId}`);
    }

    const accountId = organizationAccount.accountId;
    console.log('✅ [CHECKPOINT 7.2] Got accountId:', accountId);

    // [CHECKPOINT 7.3] Prepare changed files with patch/content
    console.log('🔄 [CHECKPOINT 7.3] Preparing changed files for AI analysis...');
    const filesForAnalysis = changedFiles.map((file) => ({
      filename: file.filename,
      patch: file.patch || '',
      previousContent: file.previousContent || '',
      currentContent: file.currentContent || '',
    }));
    console.log('✅ [CHECKPOINT 7.3] Prepared', filesForAnalysis.length, 'files for analysis');

    // [CHECKPOINT 7.4] Run AI-based impact analysis (same as PR analysis)
    // Note: analyzeRegressionImpactEnhanced expects a prNumber, but for commits we use -1 as a special marker
    // The method will fail to fetch PR commit info, but that's OK - we already have the changed files
    console.log('🔄 [CHECKPOINT 7.4] Running AI-based impact analysis (same as PR analysis)...');
    
    // For commits, we need to ensure files have proper patch/content
    // The method will try to fetch PR commit info but will fall back gracefully
    const analysisResult = await repositoryScanService.analyzeRegressionImpactEnhanced(
      repositoryId,
      -1, // Use -1 as special marker for commits (method will fail to fetch PR info, which is OK)
      filesForAnalysis,
      accountId,
    );
    console.log('✅ [CHECKPOINT 7.4] AI analysis completed:', {
      hasSummary: !!analysisResult?.summary,
      impactedFlows: analysisResult?.impactedFlows?.length || 0,
      changedBehavior: analysisResult?.changedBehavior?.length || 0,
      potentialBreakages: analysisResult?.potentialBreakages?.length || 0,
      testCases: analysisResult?.testCases?.length || 0,
    });

    // [CHECKPOINT 7.5] Create regression report with AI analysis results
    console.log('🔄 [CHECKPOINT 7.5] Creating regression report with AI analysis results...');
    const report = await prisma.regressionReport.create({
      data: {
        repositoryId,
        prNumber: null, // Commits don't have PR numbers
        commitSha: commitSha,
        commitId: commitId || null,
        analysisType: 'COMMIT',
        status: analysisResult ? 'COMPLETED' : 'PARTIAL',
        summary: analysisResult?.summary || 'Analysis incomplete',
        impactedFlows: analysisResult?.impactedFlows || [],
        testCases: analysisResult?.testCases || [],
        potentialBreakages: analysisResult?.potentialBreakages || [],
        changedBehavior: analysisResult?.changedBehavior || [],
        organizationId: repository.organizationId,
      },
    });
    console.log('✅ [CHECKPOINT 7.5] Regression report created:', report.id);

    // [CHECKPOINT 7.6] Link report to commit summary
    if (commitId) {
      console.log('🔄 [CHECKPOINT 7.6] Linking report to commit summary...');
      await prisma.commitSummary.update({
        where: { id: commitId },
        data: {
          impactAnalysisReportId: report.id,
          impactAnalysisStatus: 'completed',
        },
      });
      console.log('✅ [CHECKPOINT 7.6] Report linked to commit summary');
    }

    console.log('✅ [CHECKPOINT 7.7] Commit impact analysis completed successfully for commit:', commitSha);
    return {
      success: true,
      reportId: report.id,
      analysis: analysisResult,
    };
  } catch (error) {
    console.error('❌ [CHECKPOINT ERROR] Error in commit impact analysis:', {
      commitSha,
      error: error.message,
      stack: error.stack,
    });

    // Update status to failed
    if (commitId) {
      try {
        await prisma.commitSummary.update({
          where: { id: commitId },
          data: { impactAnalysisStatus: 'failed' },
        });
        console.log('✅ Updated commit summary status to failed');
      } catch (updateError) {
        console.error('❌ Failed to update commit summary status:', updateError);
      }
    }

    throw error; // Will trigger retry
  }
};

// Create worker
const commitImpactAnalysisWorker = new Worker(
  'commit-impact-analysis',
  processCommitImpactAnalysis,
  {
    connection: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    concurrency: parseInt(process.env.COMMIT_ANALYSIS_WORKER_CONCURRENCY || '2'),
  },
);

// Worker event handlers
commitImpactAnalysisWorker.on('completed', (job) => {
  console.log('✅ [WORKER] Job completed:', job.id);
});

commitImpactAnalysisWorker.on('failed', (job, err) => {
  console.error('❌ [WORKER] Job failed:', job?.id, err.message);
});

commitImpactAnalysisWorker.on('error', (err) => {
  console.error('❌ [WORKER] Worker error:', err);
});

console.log('✅ [WORKER] Commit Impact Analysis Worker is running...');

export { commitImpactAnalysisWorker };
