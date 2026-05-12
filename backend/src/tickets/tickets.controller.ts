import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { InviteManagerDto } from './dto/invite-manager.dto';
import { AssignManagerDto } from './dto/assign-manager.dto';
import { ResolveTicketDto } from './dto/resolve-ticket.dto';
import { RemoveInvitedManagerDto } from './dto/remove-invited-manager.dto';
import {
  CreateTicketContactDto,
  DeleteTicketContactDto,
  UpdateTicketContactDto,
} from './dto/create-ticket-contact.dto';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  create(
    @Body() body?: { title?: string; clientId?: string; clientName?: string },
  ) {
    return this.ticketsService.create(
      body?.title,
      body?.clientId,
      body?.clientName,
    );
  }

  @Post('with-first-message')
  createWithFirstMessage(
    @Body()
    body: {
      title: string;
      firstMessage: string;
      senderType: string;
      senderId?: string;
      senderName?: string;
      clientId?: string;
      clientName?: string;
      tradePointId?: string;
      tradePointExternalId?: string;
      tradePointName?: string;
      currentUserId?: string;
      currentUserEmail?: string;
      currentUserPhone?: string;
      currentUserXmlId?: string;
      isSuperuser?: boolean;
      superuserId?: string;
      superuserEmail?: string;
      superuserPhone?: string;
      canonicalEmail?: string;
      canonicalEmailSource?: string;
      clientEmail?: string;
      clientPhone?: string;
      aiEnabled?: boolean;
    },
  ) {
    return this.ticketsService.createWithFirstMessage(
      body.title,
      body.firstMessage,
      body.senderType,
      body.senderId,
      body.senderName,
      body.clientId,
      body.clientName,
      body.tradePointId,
      body.tradePointExternalId,
      body.tradePointName,
      body.currentUserId,
      body.currentUserEmail,
      body.currentUserPhone,
      body.currentUserXmlId,
      body.isSuperuser,
      body.superuserId,
      body.superuserEmail,
      body.superuserPhone,
      body.canonicalEmail,
      body.canonicalEmailSource,
      body.clientEmail,
      body.clientPhone,
      body.aiEnabled,
    );
  }

  @Post('manager-created-client')
  createManagerCreatedClient(
    @Body()
    body: {
      managerId: string;
      managerName: string;
      tradePointName: string;
      clientEmail: string;
      clientPhone?: string;
    },
  ) {
    return this.ticketsService.createManagerCreatedClient(
      body.managerId,
      body.managerName,
      body.tradePointName,
      body.clientEmail,
      body.clientPhone,
    );
  }

  @Get()
  findAll(
    @Query('viewerType') viewerType?: string,
    @Query('viewerId') viewerId?: string,
    @Query('viewerEmail') viewerEmail?: string,
    @Query('tradePointName') tradePointName?: string,
  ) {
    return this.ticketsService.findAll({
      viewerType,
      viewerId,
      viewerEmail,
      tradePointName,
    });
  }

  @Get('manager-supplier-dialogs')
  findManagerSupplierDialogs(
    @Query('managerId') managerId?: string,
    @Query('managerName') managerName?: string,
  ) {
    return this.ticketsService.findOrCreateManagerSupplierDialogs(
      managerId,
      managerName,
    );
  }

  @Get('supplier-manager-dialogs')
  findSupplierManagerDialogs(@Query('supplierId') supplierId?: string) {
    return this.ticketsService.findSupplierManagerDialogs(supplierId);
  }

  @Post(':id/typing')
  updateTyping(
    @Param('id') id: string,
    @Body() body: { senderType: string; previewText?: string },
  ) {
    return this.ticketsService.updateTyping(
      id,
      body.senderType,
      body.previewText,
    );
  }

  @Get(':id/typing')
  getTyping(@Param('id') id: string) {
    return this.ticketsService.getTyping(id);
  }

  @Get(':id/contacts')
  getContacts(
    @Param('id') id: string,
    @Query('viewerType') viewerType?: string,
    @Query('viewerId') viewerId?: string,
    @Query('viewerEmail') viewerEmail?: string,
    @Query('tradePointName') tradePointName?: string,
  ) {
    return this.ticketsService.getContacts(id, {
      viewerType,
      viewerId,
      viewerEmail,
      tradePointName,
    });
  }

  @Post('page-view')
  recordPageView(
    @Body()
    body: {
      tradePointId?: string;
      tradePointName?: string;
      pageUrl?: string;
      pagePath?: string;
      pageTitle?: string;
      pageName?: string;
      routeType?: string;
      entityId?: string;
      entityName?: string;
      referrer?: string;
      timestamp?: string;
      sourceType?: string;
    },
  ) {
    return this.ticketsService.recordPageView(body);
  }

  @Get(':id/page-views')
  getPageViews(
    @Param('id') id: string,
    @Query('viewerType') viewerType?: string,
    @Query('viewerId') viewerId?: string,
    @Query('viewerEmail') viewerEmail?: string,
    @Query('tradePointName') tradePointName?: string,
  ) {
    return this.ticketsService.getPageViews(id, {
      viewerType,
      viewerId,
      viewerEmail,
      tradePointName,
    });
  }

  @Post(':id/contacts')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  addContact(@Param('id') id: string, @Body() body: CreateTicketContactDto) {
    return this.ticketsService.addContact(
      id,
      body.managerId,
      body.managerName,
      body.type as 'email' | 'phone',
      body.value,
      body.label,
    );
  }

  @Patch(':id/contacts/:contactId')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  updateContact(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() body: UpdateTicketContactDto,
  ) {
    return this.ticketsService.updateContact(
      id,
      contactId,
      body.managerId,
      body.managerName,
      body.type as 'email' | 'phone' | undefined,
      body.value,
      body.label,
    );
  }

  @Post(':id/contacts/:contactId/delete')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  deleteContact(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() body: DeleteTicketContactDto,
  ) {
    return this.ticketsService.deleteContact(
      id,
      contactId,
      body.managerId,
      body.managerName,
    );
  }

  @Patch(':id/pin')
  togglePinned(@Param('id') id: string) {
    return this.ticketsService.togglePinned(id);
  }

  @Patch(':id/resolve')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  resolve(@Param('id') id: string, @Body() resolveTicketDto: ResolveTicketDto) {
    return this.ticketsService.resolve(id, resolveTicketDto);
  }

  @Post(':id/manager-rating')
  rateManager(@Param('id') id: string, @Body() body: { rating: number }) {
    return this.ticketsService.rateManager(id, body.rating);
  }

  @Patch(':id/reopen')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  reopen(@Param('id') id: string, @Body() assignManagerDto: AssignManagerDto) {
    return this.ticketsService.reopen(id, assignManagerDto);
  }

  @Patch(':id/invite-manager')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  inviteManager(
    @Param('id') id: string,
    @Body() inviteManagerDto: InviteManagerDto,
  ) {
    return this.ticketsService.inviteManager(id, inviteManagerDto);
  }

  @Patch(':id/remove-invited-manager')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  removeInvitedManager(
    @Param('id') id: string,
    @Body() removeInvitedManagerDto: RemoveInvitedManagerDto,
  ) {
    return this.ticketsService.removeInvitedManager(
      id,
      removeInvitedManagerDto,
    );
  }

  @Patch(':id/assign-manager')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  assignManager(
    @Param('id') id: string,
    @Body() assignManagerDto: AssignManagerDto,
  ) {
    return this.ticketsService.assignManager(id, assignManagerDto);
  }

  @Patch(':id/claim')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  claimIncoming(
    @Param('id') id: string,
    @Body() assignManagerDto: AssignManagerDto,
  ) {
    return this.ticketsService.claimIncoming(id, assignManagerDto);
  }

  @Post(':id/ai/enable')
  enableAiMode(@Param('id') id: string) {
    return this.ticketsService.enableAiMode(id);
  }

  @Post(':id/ai/disable')
  disableAiMode(@Param('id') id: string) {
    return this.ticketsService.disableAiMode(id);
  }
}
