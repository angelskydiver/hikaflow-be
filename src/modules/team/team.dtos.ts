export class CreateTeamDto {
  organizationId: string;
  name: string;
  description?: string;
  createdByAccountId: string;
  // Note: Roles are now organization-level, not team-level
}

export class CreateTeamRoleDto {
  name: string;
  rank: number;
  requestedByAccountId: string;
}

export type CreateRoleArgs = { teamId: string } & CreateTeamRoleDto;

export class AddTeamMemberDto {
  accountId: string; // target account to add
  organizationRoleId: string; // organization-level role
  inviterAccountId: string;
}

export type AddTeamMemberArgs = { teamId: string } & AddTeamMemberDto;

export class ChangeTeamMemberRoleDto {
  newOrganizationRoleId: string; // organization-level role
  inviterAccountId: string;
}

export type ChangeTeamMemberRoleArgs = {
  teamId: string;
  accountId: string;
} & ChangeTeamMemberRoleDto;

export class LinkTeamRepositoryDto {
  repositoryId: string;
  requestedByAccountId: string;
}

export type LinkTeamRepositoryArgs = { teamId: string } & LinkTeamRepositoryDto;

export type UnlinkTeamRepositoryArgs = {
  teamId: string;
  repositoryId: string;
} & Pick<LinkTeamRepositoryDto, 'requestedByAccountId'>;

export class DefineOrganizationHierarchyDto {
  requestedByAccountId: string;
  roles: { name: string; rank: number; parentRoleId?: string | null }[];
}

export type DefineOrganizationHierarchyArgs = {
  organizationId: string;
} & DefineOrganizationHierarchyDto;
