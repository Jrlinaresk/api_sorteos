// src/modules/transactions/transactions.controller.ts
import { Controller, Post, Body, Param, Get } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { Transaction } from './schemas/transaction.schema';

class CreateTxDto {
  userId: string;
  amount: number;
  description: string;
}

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly txService: TransactionsService) {}

  @Post()
  create(@Body() dto: CreateTxDto): Promise<Transaction> {
    return this.txService.create(dto.userId, dto.amount, dto.description);
  }

  @Get('user/:userId')
  list(@Param('userId') userId: string): Promise<Transaction[]> {
    return this.txService.findByUser(userId);
  }
}
