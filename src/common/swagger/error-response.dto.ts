import { ApiProperty } from '@nestjs/swagger';

/** Format de toutes les erreurs de l'API : `{ statusCode, message, error }`. */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    description: 'Message en français ; liste pour les erreurs de validation',
    example: 'Commande introuvable',
  })
  message: string | string[];

  @ApiProperty({ example: 'Not Found' })
  error: string;
}
