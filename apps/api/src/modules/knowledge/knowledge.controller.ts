import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { KnowledgeDocumentDto, SearchResultDto } from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SearchDto } from './dto/search.dto';
import { KnowledgeService, type UploadedDocFile } from './knowledge.service';

/** All routes are tenant-scoped by companyId from the JWT and JWT-guarded. */
@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /** Upload a document (multipart field `file`, buffered in memory by Multer). */
  @Post('documents')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentTenant() companyId: string,
    @UploadedFile() file: UploadedDocFile,
  ): Promise<KnowledgeDocumentDto> {
    return this.knowledge.upload(companyId, file);
  }

  @Get('documents')
  list(@CurrentTenant() companyId: string): Promise<KnowledgeDocumentDto[]> {
    return this.knowledge.list(companyId);
  }

  @Get('documents/:id')
  get(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<KnowledgeDocumentDto> {
    return this.knowledge.get(companyId, id);
  }

  @Delete('documents/:id')
  @HttpCode(204)
  remove(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.knowledge.remove(companyId, id);
  }

  @Post('search')
  search(
    @CurrentTenant() companyId: string,
    @Body() dto: SearchDto,
  ): Promise<SearchResultDto[]> {
    return this.knowledge.search(companyId, dto);
  }
}
