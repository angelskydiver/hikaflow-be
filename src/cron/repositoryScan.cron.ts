import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RepositoryScanService } from '../modules/repositoryScan/repositoryScan.service';

@Injectable()
export class RepositoryScanCronService {
  private readonly logger = new Logger(RepositoryScanCronService.name);

  constructor(private readonly repositoryScanService: RepositoryScanService) {}

  /**
   * Daily job to rescan files that were missed in previous scans
   * Runs at 1:00 AM every day
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  // @Cron(CronExpression.EVERY_5_MINUTES)
  async handleDailyRescan() {
    this.logger.log('Starting daily rescan of missing files...');

    try {
      const result: any = await this.repositoryScanService.rescanMissingFiles();

      if (result.success) {
        if (result.rescannedFiles && result.rescannedFiles.length > 0) {
          this.logger.log(
            `Successfully rescanned files in ${result.rescannedFiles.length} repositories`,
          );

          // Log details for each repository
          result.rescannedFiles.forEach((repo) => {
            this.logger.log(
              `Repository ${repo.repositoryName}: ${repo.successfullyScannedCount}/${repo.missingFilesCount} files scanned`,
            );
          });
        } else {
          this.logger.log('No files needed rescanning');
        }
      } else {
        this.logger.error(`Rescan failed: ${result.message}`);
      }
    } catch (error) {
      this.logger.error(`Error in daily rescan: ${error.message}`, error.stack);
    }
  }
}
