import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AddTeamMemberArgs,
  ChangeTeamMemberRoleArgs,
  CreateRoleArgs,
  CreateTeamDto,
  DefineOrganizationHierarchyArgs,
  LinkTeamRepositoryArgs,
  UnlinkTeamRepositoryArgs,
} from './team.dtos';

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  async createTeam(dto: CreateTeamDto) {
    // Only org members with ADMIN or MANAGER can create teams
    const orgAccount = await this.prisma.organizationAccounts.findFirst({
      where: {
        organizationId: dto.organizationId,
        accountId: dto.createdByAccountId,
      },
    });
    if (!orgAccount) throw new ForbiddenException('Not part of organization');
    if (orgAccount.role !== 'ADMIN' && orgAccount.role !== 'MANAGER') {
      throw new ForbiddenException('Insufficient permissions to create team');
    }

    const team = await this.prisma.team.create({
      data: {
        organizationId: dto.organizationId,
        name: dto.name,
        description: dto.description || '',
      },
    });

    // Note: Hierarchy/roles are now organization-level, not team-level
    // Teams don't have their own roles anymore

    return team;
  }

  async createRole(args: CreateRoleArgs) {
    // DEPRECATED: Roles are now organization-level, not team-level
    // Use defineOrganizationHierarchy instead
    const team = await this.prisma.team.findUnique({
      where: { id: args.teamId },
    });
    if (!team) throw new NotFoundException('Team not found');

    // Only org ADMIN/MANAGER can create organization-level roles
    const requester = await this.prisma.organizationAccounts.findFirst({
      where: {
        organizationId: team.organizationId,
        accountId: args.requestedByAccountId,
      },
    });
    if (!requester) throw new ForbiddenException('Not part of organization');

    const isOrgManager =
      requester.role === 'ADMIN' || requester.role === 'MANAGER';

    if (!isOrgManager) {
      // Check if user is top-level member in any team of the organization
      const topRank = await this.getTopRankSafeForOrg(team.organizationId);
      if (topRank !== null) {
        const isTopMember = await this.prisma.teamMember.findFirst({
          where: {
            accountId: args.requestedByAccountId,
            team: { organizationId: team.organizationId },
            organizationRole: { rank: topRank },
          },
        });
        if (!isTopMember) {
          throw new ForbiddenException(
            'Insufficient permissions to create role',
          );
        }
      } else {
        throw new ForbiddenException('Insufficient permissions to create role');
      }
    }

    // Create organization-level role
    return await this.prisma.organizationRole.create({
      data: {
        organizationId: team.organizationId,
        name: args.name,
        rank: args.rank,
      },
    });
  }

  async addMember(args: AddTeamMemberArgs) {
    const team = await this.prisma.team.findUnique({
      where: { id: args.teamId },
    });
    if (!team) throw new NotFoundException('Team not found');

    // Inviter must be in team or be org ADMIN/MANAGER
    const inviterOrgAccount = await this.prisma.organizationAccounts.findFirst({
      where: {
        organizationId: team.organizationId,
        accountId: args.inviterAccountId,
      },
    });
    if (!inviterOrgAccount)
      throw new ForbiddenException('Inviter not in organization');

    const isOrgManager =
      inviterOrgAccount.role === 'ADMIN' ||
      inviterOrgAccount.role === 'MANAGER';

    if (!isOrgManager) {
      // Organization-level policy applies to non-org-managers
      const canInvite = await this.canInviteToOrganizationRole({
        organizationId: team.organizationId,
        inviterAccountId: args.inviterAccountId,
        targetRoleId: args.organizationRoleId,
      });
      if (!canInvite)
        throw new ForbiddenException('Insufficient hierarchy to add this role');
    }

    // Validate target role belongs to organization
    const role = await this.prisma.organizationRole.findFirst({
      where: {
        id: args.organizationRoleId,
        organizationId: team.organizationId,
      },
    });
    if (!role) throw new BadRequestException('Invalid role for organization');

    // Ensure target account is in same organization
    const targetOrgAccount = await this.prisma.organizationAccounts.findFirst({
      where: { organizationId: team.organizationId, accountId: args.accountId },
    });
    if (!targetOrgAccount)
      throw new BadRequestException('User not part of organization');

    return await this.prisma.teamMember.upsert({
      where: {
        teamId_accountId: { teamId: args.teamId, accountId: args.accountId },
      },
      update: { organizationRoleId: args.organizationRoleId },
      create: {
        teamId: args.teamId,
        accountId: args.accountId,
        organizationRoleId: args.organizationRoleId,
      },
      include: { organizationRole: true },
    });
  }

  async changeMemberRole(args: ChangeTeamMemberRoleArgs) {
    const team = await this.prisma.team.findUnique({
      where: { id: args.teamId },
    });
    if (!team) throw new NotFoundException('Team not found');

    // Only inviter with sufficient rank can change another member's role
    const canInvite = await this.canInviteToOrganizationRole({
      organizationId: team.organizationId,
      inviterAccountId: args.inviterAccountId,
      targetRoleId: args.newOrganizationRoleId,
    });
    if (!canInvite)
      throw new ForbiddenException(
        'Insufficient hierarchy to assign this role',
      );

    // Ensure member exists in team
    const existing = await this.prisma.teamMember.findUnique({
      where: {
        teamId_accountId: { teamId: args.teamId, accountId: args.accountId },
      },
    });
    if (!existing) throw new NotFoundException('Member not found in team');

    // Ensure target role belongs to same organization
    const role = await this.prisma.organizationRole.findFirst({
      where: {
        id: args.newOrganizationRoleId,
        organizationId: team.organizationId,
      },
    });
    if (!role) throw new BadRequestException('Invalid role for organization');

    return await this.prisma.teamMember.update({
      where: {
        teamId_accountId: { teamId: args.teamId, accountId: args.accountId },
      },
      data: { organizationRoleId: args.newOrganizationRoleId },
      include: { organizationRole: true },
    });
  }

  async removeMember(args: {
    teamId: string;
    accountId: string;
    requestedByAccountId: string;
  }) {
    const team = await this.prisma.team.findUnique({
      where: { id: args.teamId },
    });
    if (!team) throw new NotFoundException('Team not found');

    // Check if requester is org ADMIN/MANAGER
    const requester = await this.prisma.organizationAccounts.findFirst({
      where: {
        organizationId: team.organizationId,
        accountId: args.requestedByAccountId,
      },
    });
    if (!requester) throw new ForbiddenException('Not part of organization');

    const isOrgManager =
      requester.role === 'ADMIN' || requester.role === 'MANAGER';

    // If not org manager, check hierarchy permissions
    if (!isOrgManager) {
      // Get the member being removed and the requester's role in this team
      const memberToRemove = await this.prisma.teamMember.findUnique({
        where: {
          teamId_accountId: {
            teamId: args.teamId,
            accountId: args.accountId,
          },
        },
        include: { organizationRole: true },
      });
      if (!memberToRemove)
        throw new NotFoundException('Member not found in team');

      const requesterMember = await this.prisma.teamMember.findFirst({
        where: {
          teamId: args.teamId,
          accountId: args.requestedByAccountId,
        },
        include: { organizationRole: true },
      });

      // Only allow removal if requester has higher rank (lower number)
      if (
        !requesterMember ||
        requesterMember.organizationRole.rank >=
          memberToRemove.organizationRole.rank
      ) {
        throw new ForbiddenException(
          'Insufficient permissions to remove this member',
        );
      }
    }

    return await this.prisma.teamMember.delete({
      where: {
        teamId_accountId: {
          teamId: args.teamId,
          accountId: args.accountId,
        },
      },
    });
  }

  async linkRepository(args: LinkTeamRepositoryArgs) {
    // Validate team and repo
    const team = await this.prisma.team.findUnique({
      where: { id: args.teamId },
    });
    if (!team) throw new NotFoundException('Team not found');
    const repo = await this.prisma.repository.findUnique({
      where: { id: args.repositoryId },
    });
    if (!repo) throw new NotFoundException('Repository not found');

    // Only org ADMIN/MANAGER or top-level team members can link
    const requester = await this.prisma.organizationAccounts.findFirst({
      where: {
        organizationId: team.organizationId,
        accountId: args.requestedByAccountId,
      },
    });
    if (!requester) throw new ForbiddenException('Not part of organization');
    const isOrgManager =
      requester.role === 'ADMIN' || requester.role === 'MANAGER';

    if (!isOrgManager) {
      // Check if user is top-level member in any team of the organization
      const topRank = await this.getTopRankSafeForOrg(team.organizationId);
      if (topRank !== null) {
        const isTopMember = await this.prisma.teamMember.findFirst({
          where: {
            accountId: args.requestedByAccountId,
            team: { organizationId: team.organizationId },
            organizationRole: { rank: topRank },
          },
        });
        if (!isTopMember) {
          throw new ForbiddenException('Insufficient permissions');
        }
      } else {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    return await this.prisma.teamRepository.upsert({
      where: {
        teamId_repositoryId: {
          teamId: args.teamId,
          repositoryId: args.repositoryId,
        },
      },
      update: {},
      create: { teamId: args.teamId, repositoryId: args.repositoryId },
    });
  }

  async unlinkRepository(args: UnlinkTeamRepositoryArgs) {
    const team = await this.prisma.team.findUnique({
      where: { id: args.teamId },
    });
    if (!team) throw new NotFoundException('Team not found');

    const repo = await this.prisma.repository.findUnique({
      where: { id: args.repositoryId },
    });
    if (!repo) throw new NotFoundException('Repository not found');

    const requester = await this.prisma.organizationAccounts.findFirst({
      where: {
        organizationId: team.organizationId,
        accountId: args.requestedByAccountId,
      },
    });
    if (!requester) throw new ForbiddenException('Not part of organization');
    const isOrgManager =
      requester.role === 'ADMIN' || requester.role === 'MANAGER';

    if (!isOrgManager) {
      const topRank = await this.getTopRankSafeForOrg(team.organizationId);
      if (topRank !== null) {
        const isTopMember = await this.prisma.teamMember.findFirst({
          where: {
            accountId: args.requestedByAccountId,
            team: { organizationId: team.organizationId },
            organizationRole: { rank: topRank },
          },
        });
        if (!isTopMember) {
          throw new ForbiddenException('Insufficient permissions');
        }
      } else {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    return await this.prisma.teamRepository.delete({
      where: {
        teamId_repositoryId: {
          teamId: args.teamId,
          repositoryId: args.repositoryId,
        },
      },
    });
  }

  async listByOrganization(organizationId: string) {
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      include: {
        members: {
          include: {
            organizationRole: {
              include: {
                parent: true,
                children: true,
              },
            },
            account: { include: { user: true } },
          },
        },
        repositories: true,
      },
    });

    // Get organization roles separately (shared across all teams)
    const organizationRoles = await this.prisma.organizationRole.findMany({
      where: { organizationId },
      include: {
        parent: true,
        children: true,
      },
      orderBy: { rank: 'asc' },
    });

    return {
      teams,
      organizationRoles,
    };
  }

  async listByRepository(repositoryId: string) {
    const links = await this.prisma.teamRepository.findMany({
      where: { repositoryId },
      include: { team: true },
    });
    return links.map((l) => l.team);
  }

  async defineOrganizationHierarchy(args: DefineOrganizationHierarchyArgs) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: args.organizationId },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    // Only org ADMIN/MANAGER or current top-level members can define hierarchy
    const requester = await this.prisma.organizationAccounts.findFirst({
      where: {
        organizationId: args.organizationId,
        accountId: args.requestedByAccountId,
      },
    });
    if (!requester) throw new ForbiddenException('Not part of organization');
    const isOrgManager =
      requester.role === 'ADMIN' || requester.role === 'MANAGER';
    let isTopMember: any = null;
    if (!isOrgManager) {
      const topRank = await this.getTopRankSafeForOrg(args.organizationId);
      if (topRank !== null) {
        // Check if user is in any team with top rank role
        isTopMember = await this.prisma.teamMember.findFirst({
          where: {
            accountId: args.requestedByAccountId,
            team: { organizationId: args.organizationId },
            organizationRole: { rank: topRank },
          },
        });
      }
      if (!isTopMember && topRank !== null)
        throw new ForbiddenException('Insufficient permissions');
    }

    // Get existing roles to identify which ones should be deleted
    const existingRoles = await this.prisma.organizationRole.findMany({
      where: { organizationId: args.organizationId },
    });

    // Get names of roles in the new hierarchy
    const newRoleNames = new Set(args.roles.map((r) => r.name));

    // Find roles that should be deleted (exist in DB but not in new list)
    const rolesToDelete = existingRoles.filter(
      (role) => !newRoleNames.has(role.name),
    );

    // Check if any of the roles to delete are still being used by TeamMembers
    if (rolesToDelete.length > 0) {
      const rolesToDeleteIds = rolesToDelete.map((r) => r.id);
      const membersUsingDeletedRoles = await this.prisma.teamMember.findFirst({
        where: {
          organizationRoleId: { in: rolesToDeleteIds },
        },
      });

      if (membersUsingDeletedRoles) {
        throw new BadRequestException(
          `Cannot delete roles that are still assigned to team members. Please reassign or remove members from these roles first: ${rolesToDelete.map((r) => r.name).join(', ')}`,
        );
      }

      // Before deleting parent roles, set their children's parentRoleId to null
      // (children that will remain in the hierarchy will be updated during upsert)
      await this.prisma.organizationRole.updateMany({
        where: {
          parentRoleId: { in: rolesToDeleteIds },
        },
        data: {
          parentRoleId: null,
        },
      });

      // Delete roles that are not in use
      await this.prisma.organizationRole.deleteMany({
        where: {
          id: { in: rolesToDeleteIds },
        },
      });
    }

    // Create a map to track role IDs (name -> id) for parent relationships
    const roleIdMap = new Map<string, string>();

    // First pass: create/update roles without parents
    const rolesWithoutParents = args.roles.filter((r) => !r.parentRoleId);
    for (const r of rolesWithoutParents) {
      const role = await this.prisma.organizationRole.upsert({
        where: {
          organizationId_name: {
            organizationId: args.organizationId,
            name: r.name,
          },
        },
        update: { rank: r.rank, parentRoleId: null },
        create: {
          organizationId: args.organizationId,
          name: r.name,
          rank: r.rank,
          parentRoleId: null,
        },
      });
      roleIdMap.set(r.name, role.id);
    }

    // Second pass: create/update roles with parents (sorted by rank to handle hierarchy)
    const rolesWithParents = args.roles
      .filter((r) => r.parentRoleId)
      .sort((a, b) => a.rank - b.rank);

    for (const r of rolesWithParents) {
      // Find parent role ID by name (assuming parentRoleId in frontend is a temp name/id we need to resolve)
      let parentId: string | null = null;

      // Try to find parent by checking if parentRoleId matches an existing role name or ID
      if (r.parentRoleId) {
        const parentRole = await this.prisma.organizationRole.findFirst({
          where: {
            organizationId: args.organizationId,
            OR: [{ id: r.parentRoleId }, { name: r.parentRoleId }],
          },
        });
        if (parentRole) {
          parentId = parentRole.id;
        }
      }

      const role = await this.prisma.organizationRole.upsert({
        where: {
          organizationId_name: {
            organizationId: args.organizationId,
            name: r.name,
          },
        },
        update: { rank: r.rank, parentRoleId: parentId },
        create: {
          organizationId: args.organizationId,
          name: r.name,
          rank: r.rank,
          parentRoleId: parentId,
        },
      });
      roleIdMap.set(r.name, role.id);
    }

    // Return updated role list with hierarchy
    return await this.prisma.organizationRole.findMany({
      where: { organizationId: args.organizationId },
      include: { parent: true, children: true },
      orderBy: { rank: 'asc' },
    });
  }

  private async getTopRankSafeForOrg(
    organizationId: string,
  ): Promise<number | null> {
    const topRole = await this.prisma.organizationRole.findFirst({
      where: { organizationId },
      orderBy: { rank: 'asc' },
    });
    return topRole ? topRole.rank : null;
  }

  private async canInviteToOrganizationRole(args: {
    organizationId: string;
    inviterAccountId: string;
    targetRoleId: string;
  }): Promise<boolean> {
    // Inviter must be a member of at least one team in the organization
    const inviterMembership = await this.prisma.teamMember.findFirst({
      where: {
        accountId: args.inviterAccountId,
        team: { organizationId: args.organizationId },
      },
      include: { organizationRole: true },
    });
    if (!inviterMembership) return false;

    const targetRole = await this.prisma.organizationRole.findFirst({
      where: { id: args.targetRoleId, organizationId: args.organizationId },
    });
    if (!targetRole) return false;

    const inviterRank = inviterMembership.organizationRole.rank;
    const targetRank = targetRole.rank;
    const topRank = await this.getTopRankForOrg(args.organizationId);

    // Upper person (lower rank number) can add lower hierarchy (higher or equal rank number)
    if (inviterRank < targetRank) return true;

    // Exception: Top-level can add same-rank peers
    if (inviterRank === topRank && targetRank === topRank) return true;

    return false;
  }

  private async getTopRankForOrg(organizationId: string): Promise<number> {
    const top = await this.prisma.organizationRole.findFirst({
      where: { organizationId },
      orderBy: { rank: 'asc' },
    });
    if (!top)
      throw new BadRequestException('No roles defined for organization');
    return top.rank;
  }
}
