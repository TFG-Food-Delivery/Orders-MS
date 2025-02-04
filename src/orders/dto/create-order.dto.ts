import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { OrderItem } from '../types';
import { OrderItemDto } from './order-item.dto';

export class CreateOrderDto {
  @IsUUID()
  customerId: string;

  @IsUUID()
  restaurantId: string;

  @IsString()
  restaurantName: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItem[];

  @IsNumber()
  deliveryFee: number;

  @IsBoolean()
  useLoyaltyPoints: boolean;
}
