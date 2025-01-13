import { IsMongoId, IsString, IsUrl } from 'class-validator';

export class PaidOrderDto {
  @IsString()
  stripePaymentId: string;

  @IsString()
  @IsMongoId()
  orderId: string;

  @IsString()
  @IsUrl()
  receiptUrl: string;
}
