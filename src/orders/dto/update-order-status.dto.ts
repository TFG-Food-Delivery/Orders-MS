import {
  IsEnum,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { OrderStatusList } from '../enum/order-status.enum';
import { Type } from 'class-transformer';

export class LocationCoordsDto {
  @IsNumber({}, { message: 'Latitude must be a valid number.' })
  latitude: number;

  @IsNumber({}, { message: 'Longitude must be a valid number.' })
  longitude: number;
}

export class UpdateOrderStatusDto {
  @IsMongoId()
  orderId: string;

  @IsEnum(OrderStatusList, {
    message: `Order status must be a valid value from the list: ${OrderStatusList}.`,
  })
  status: OrderStatus;

  @IsOptional()
  @IsObject({ message: 'Location must be an object.' })
  @ValidateNested()
  @Type(() => LocationCoordsDto)
  location?: LocationCoordsDto;
}
