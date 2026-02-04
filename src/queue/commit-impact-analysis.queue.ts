import { Queue } from 'bullmq';

/**
 * Queue for commit impact analysis jobs
 */
export const commitImpactAnalysisQueue = new Queue('commit-impact-analysis', {
  connection: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export interface CommitImpactAnalysisJob {
  repositoryId: string;
  commitSha: string;
  changedFiles: any[];
  organizationId: string;
  commitId?: string; // commitSummary.id
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryProvider?: string;
}

/**
 * Queue a commit impact analysis job
 */
export async function queueCommitImpactAnalysis(
  data: CommitImpactAnalysisJob,
): Promise<void> {
  console.log('🔄 [CHECKPOINT 4] Queueing commit impact analysis job:', {
    commitSha: data.commitSha,
    repositoryId: data.repositoryId,
    filesCount: data.changedFiles.length,
    commitId: data.commitId,
  });

  try {
    await commitImpactAnalysisQueue.add('analyze-commit-impact', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    console.log('✅ [CHECKPOINT 5] Successfully queued commit impact analysis job for commit:', data.commitSha);
  } catch (error) {
    console.error('❌ [CHECKPOINT 5] Failed to queue commit impact analysis:', error);
    throw error;
  }
}
