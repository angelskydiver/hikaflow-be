import { Injectable } from '@nestjs/common';
import { githubRepositoryAccess } from 'src/config/helpers/repositories/github.helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccountCredentialService } from '../accountCredentials/accountCredentials.service';

@Injectable()
export class RepositoryScanService {
  constructor(
    private _accountCredentialsService: AccountCredentialService,
    private _prismaService: PrismaService,
  ) {}
  async scanRepositories(repositoryName, accountId) {
    try {
      let accountCredentials =
        await this._accountCredentialsService.getAccountToken({ accountId });
      let repositories = await this._prismaService.repository.findFirst({
        where: { name: repositoryName },
      });

      console.log(
        'accountCredentials.decryptedToken, repositories: ',
        accountCredentials.decryptedToken,
        repositories,
      );

      let repositoryStructure = await githubRepositoryAccess({
        owner: repositories.owner,
        repo: repositories.name,
        branch: repositories.baseBranch,
        token: accountCredentials.decryptedToken,
      });

      console.log('hello bhai: ', JSON.stringify(repositoryStructure));
      return repositoryStructure;
    } catch (error) {
      console.log(error.message);
      throw new Error('Failed to scan repositories');
    }
  }
}
