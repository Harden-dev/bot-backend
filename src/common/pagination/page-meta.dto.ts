import { ApiProperty } from '@nestjs/swagger';
import type { PageMeta } from './paginate.js';

/** `meta` des réponses paginées (Swagger). */
export class PageMetaDto implements PageMeta {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 42 })
  total: number;
}
