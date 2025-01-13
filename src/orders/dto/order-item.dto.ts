import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class OrderItemDto {
  @IsUUID()
  dishId: string;

  @IsString()
  name: string;

  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsNumber()
  @IsPositive()
  price: number;

  @IsString()
  @IsOptional()
  notes?: string; // Opcional
}
