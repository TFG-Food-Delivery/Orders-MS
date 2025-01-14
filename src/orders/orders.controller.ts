import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { OrdersService } from './orders.service';
import {
  CreateOrderDto,
  PaginationDto,
  PaidOrderDto,
  UpdateOrderStatusDto,
} from './dto';

/**
 * OrdersController handles incoming messages and events related to orders.
 */
@Controller()
export class OrdersController {
  /**
   * Creates an instance of OrdersController.
   * @param ordersService - The service used to manage orders.
   */
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Handles the 'createOrder' message pattern.
   * @param createOrderDto - The data transfer object containing order creation details.
   * @returns The created order.
   */
  @MessagePattern('createOrder')
  createOrder(@Payload() createOrderDto: CreateOrderDto) {
    return this.ordersService.createOrder(createOrderDto);
  }

  /**
   * Handles the 'findAllOrders' message pattern.
   * @returns A list of all orders.
   */
  @MessagePattern('findAllOrders')
  findAllOrders() {
    return this.ordersService.findAllOrders();
  }

  /**
   * Handles the 'findAllRestaurantPendingOrders' message pattern.
   * @param payload - The payload containing restaurant ID and pagination details.
   * @returns A list of pending orders for the specified restaurant.
   */
  @MessagePattern('findAllRestaurantPendingOrders')
  findAllRestaurantPendingOrders(
    @Payload() payload: { restaurantId: string; paginationDto: PaginationDto },
  ) {
    const { restaurantId, paginationDto } = payload;
    return this.ordersService.findRestaurantOrders(
      restaurantId,
      paginationDto,
      'pending',
    );
  }

  @MessagePattern('findAllRestaurantCompletedOrders')
  findAllRestaurantCompletedOrders(
    @Payload() payload: { restaurantId: string; paginationDto: PaginationDto },
  ) {
    const { restaurantId, paginationDto } = payload;
    return this.ordersService.findRestaurantOrders(
      restaurantId,
      paginationDto,
      'completed',
    );
  }

  /**
   * Handles the 'findAllPendingOrders' message pattern.
   * @param payload - The payload containing pagination details.
   * @returns A list of all pending orders.
   */
  @MessagePattern('findAllPendingOrders')
  findAllPendingOrders(@Payload() payload: { paginationDto: PaginationDto }) {
    const { paginationDto } = payload;
    return this.ordersService.findAllPendingOrders(paginationDto);
  }

  /**
   * Handles the 'findAllCustomerOrders' message pattern.
   * @param payload - The payload containing customer ID and pagination details.
   * @returns A list of orders for the specified customer.
   */
  @MessagePattern('findAllCustomerOrders')
  findAllCustomerOrders(
    @Payload() payload: { customerId: string; paginationDto: PaginationDto },
  ) {
    const { customerId, paginationDto } = payload;
    return this.ordersService.findAllCustomerOrders(customerId, paginationDto);
  }

  @MessagePattern('getCustomerStats')
  getCustomerStats(@Payload() payload: { customerId: string; period: string }) {
    const { customerId, period } = payload;
    return this.ordersService.getCustomerStats(
      customerId,
      period as 'daily' | 'monthly',
    );
  }
  @MessagePattern('getRestaurantStats')
  getRestaurantStats(
    @Payload() payload: { restaurantId: string; period: string },
  ) {
    const { restaurantId, period } = payload;
    return this.ordersService.getRestaurantStats(
      restaurantId,
      period as 'daily' | 'weekly' | 'monthly',
    );
  }

  /**
   * Handles the 'findOneOrder' message pattern.
   * @param payload - The payload containing the order ID.
   * @returns The details of the specified order.
   */
  @MessagePattern('findOneOrder')
  findOneOrder(@Payload() payload: { id: string }) {
    return this.ordersService.findOneOrder(payload.id);
  }

  /**
   * Handles the 'updateOrderStatus' message pattern.
   * @param updateOrderStatusDto - The data transfer object containing order status update details.
   * @returns The updated order.
   */
  @MessagePattern('updateOrderStatus')
  updateOrderStatus(@Payload() updateOrderStatusDto: UpdateOrderStatusDto) {
    const { orderId, status } = updateOrderStatusDto;
    return this.ordersService.updateOrderStatus(orderId, status);
  }

  /**
   * Handles the 'courierAssigned' message pattern.
   * @param payload - The payload containing order ID and courier ID.
   * @returns The updated order with assigned courier.
   */
  @MessagePattern('courierAssigned')
  courierAssigned(@Payload() payload: { orderId: string; courierId: string }) {
    const { orderId, courierId } = payload;
    return this.ordersService.courierAssigned(orderId, courierId);
  }

  /**
   * Handles the 'verifyOrderPin' message pattern.
   * @param payload - The payload containing order ID and pin.
   * @returns The result of the pin verification.
   */
  @MessagePattern('verifyOrderPin')
  verifyOrderPin(@Payload() payload: { orderId: string; pin: string }) {
    const { orderId, pin } = payload;
    return this.ordersService.verifyOrderPin(orderId, pin);
  }

  /**
   * Handles the 'removeOrder' message pattern.
   * @param payload - The payload containing the order ID.
   * @returns The result of the order removal.
   */
  @MessagePattern('removeOrder')
  removeOrder(@Payload() payload: { id: string }) {
    return this.ordersService.removeOrder(payload.id);
  }

  /* ----------------------------- EVENT HANDLERS ----------------------------- */

  /**
   * Handles the 'payment_succeeded' event pattern.
   * @param paidOrderDto - The data transfer object containing payment details.
   */
  @EventPattern('payment_succeeded')
  paidOrder(@Payload() paidOrderDto: PaidOrderDto) {
    this.ordersService.paidOrder(paidOrderDto);
  }

  /**
   * Handles the 'payment_session_abandoned' event pattern.
   * @param payload - The payload containing the order ID.
   */
  @EventPattern('payment_session_abandoned')
  paymentSessionAbandoned(@Payload() payload) {
    const { orderId } = payload;
    this.ordersService.paymentSessionExpired(orderId);
  }

  /**
   * Handles the 'payment_session_expired' event pattern.
   * @param payload - The payload containing the order ID.
   */
  @EventPattern('payment_session_expired')
  paymentSessionExpired(@Payload() payload) {
    const { orderId } = payload;
    this.ordersService.paymentSessionExpired(orderId);
  }
}
