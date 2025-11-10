import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Request,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AccountService } from './account.service';

@ApiTags('Account')
@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @ApiBearerAuth()
  @Get(':accountId/git-contributor-names')
  @ApiOperation({
    summary: 'Get all Git contributor names for an account',
    description: 'Returns a list of all Git contributor names associated with the account',
  })
  @ApiParam({
    name: 'accountId',
    description: 'Account ID',
    type: String,
  })
  async getGitContributorNames(
    @Param('accountId') accountId: string,
    @Request() req: any,
  ) {
    // Verify the account belongs to the requesting user
    const userAccountId = req.user.accountId;
    if (accountId !== userAccountId) {
      throw new ForbiddenException('Unauthorized');
    }

    const names = await this.accountService.getGitContributorNames(accountId);
    return {
      success: true,
      data: names,
      message: 'Git contributor names fetched successfully',
    };
  }

  @ApiBearerAuth()
  @Post(':accountId/git-contributor-names')
  @ApiOperation({
    summary: 'Add a Git contributor name',
    description: 'Adds a new Git contributor name to the account',
  })
  @ApiParam({
    name: 'accountId',
    description: 'Account ID',
    type: String,
  })
  async addGitContributorName(
    @Param('accountId') accountId: string,
    @Body() body: { name: string },
    @Request() req: any,
  ) {
    // Verify the account belongs to the requesting user
    const userAccountId = req.user.accountId;
    if (accountId !== userAccountId) {
      throw new ForbiddenException('Unauthorized');
    }

    const gitName = await this.accountService.addGitContributorName(
      accountId,
      body.name,
    );
    return {
      success: true,
      data: gitName,
      message: 'Git contributor name added successfully',
    };
  }

  @ApiBearerAuth()
  @Delete(':accountId/git-contributor-names/:id')
  @ApiOperation({
    summary: 'Delete a Git contributor name',
    description: 'Removes a Git contributor name from the account',
  })
  @ApiParam({
    name: 'accountId',
    description: 'Account ID',
    type: String,
  })
  @ApiParam({
    name: 'id',
    description: 'Git contributor name ID',
    type: String,
  })
  async deleteGitContributorName(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    // Verify the account belongs to the requesting user
    const userAccountId = req.user.accountId;
    if (accountId !== userAccountId) {
      throw new ForbiddenException('Unauthorized');
    }

    await this.accountService.deleteGitContributorName(id, accountId);
    return {
      success: true,
      message: 'Git contributor name deleted successfully',
    };
  }
}
