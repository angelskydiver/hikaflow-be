import { OrganizationalAccountRole } from './../../../../node_modules/.prisma/client/index.d';
export class CreateOrganizationRequestDto {
  name: string;
}

export class InviteUserToOrganizationRequestDTO {
  users: Array<InviteUserDTO>;
  organizationId: string;
}

export class InviteUserDTO {
  name: string;
  email: string;
  role: OrganizationalAccountRole;
}
