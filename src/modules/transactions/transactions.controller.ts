import {
  Controller,
  Post,
  Body,
  Param,
  Get,
  Query,
  Patch,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { Transaction, TxStatus } from './schemas/transaction.schema';

@ApiTags('Transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly txService: TransactionsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear solicitud de transacción (estado pending)' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Transacción creada con estado pending',
    type: Transaction,
  })
  create(@Body() dto: CreateTransactionDto): Promise<Transaction> {
    return this.txService.create(dto);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Listar transacciones de un usuario' })
  @ApiParam({ name: 'userId', description: 'ID del usuario' })
  @ApiQuery({
    name: 'status',
    description: 'Estado opcional para filtrar',
    required: false,
    enum: TxStatus,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Listado de transacciones filtradas',
    type: [Transaction],
  })
  listByUser(
    @Param('userId') userId: string,
    @Query('status') status?: string,
  ): Promise<Transaction[]> {
    return this.txService.findByUser(userId, status);
  }

  @Get('pending')
  @ApiOperation({ summary: 'Listar todas las transacciones pendientes' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Listado de transacciones con estado pending',
    type: [Transaction],
  })
  listPending(): Promise<Transaction[]> {
    return this.txService.findAllByStatus(TxStatus.Pending);
  }

  @Patch(':txId')
  @ApiOperation({ summary: 'Actualizar estado de una transacción' })
  @ApiParam({ name: 'txId', description: 'ID de la transacción' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Transacción con estado actualizado',
    type: Transaction,
  })
  update(
    @Param('txId') txId: string,
    @Body() dto: UpdateTransactionDto,
  ): Promise<Transaction> {
    return this.txService.updateStatus(txId, dto.status!);
  }
}
