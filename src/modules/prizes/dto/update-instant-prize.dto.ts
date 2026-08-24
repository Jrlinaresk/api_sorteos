import { PartialType } from '@nestjs/mapped-types';
import { CreateInstantPrizeDto } from './create-instant-prize.dto';

export class UpdateInstantPrizeDto extends PartialType(CreateInstantPrizeDto) {}
