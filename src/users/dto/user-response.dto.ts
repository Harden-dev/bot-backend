import { ApiProperty } from '@nestjs/swagger';
import type { User, UserRole } from '../../generated/prisma/client.js';
import { toNumberId } from '../../prisma/index.js';

/** Utilisateur renvoyé par l'API, sans le hachage du mot de passe. */
export class UserResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'admin@example.com' })
  email: string;

  @ApiProperty({ example: 'Administrateur' })
  name: string;

  @ApiProperty({ example: 'admin' })
  role: UserRole;
}

export function toUserResponse(
  user: Pick<User, 'id' | 'email' | 'name' | 'role'>,
): UserResponseDto {
  return {
    id: toNumberId(user.id),
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
