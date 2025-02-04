import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrderStatus, PrismaClient } from '@prisma/client';
import { NATS_SERVICE } from 'src/config';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { PaginationDto, PaidOrderDto } from './dto';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly LOGGER = new Logger('OrdersService');

  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {
    super();
  }

  /**
   * Initializes the module and connects to the database.
   */
  onModuleInit() {
    // this.$extends(
    //   readReplicas({
    //     url: [envs.follower1DatabaseUrl, envs.follower2DatabaseUrl],
    //   }),
    // );
    this.$connect();
    this.LOGGER.log('Connected to the database');
  }

  // Valid Transitions
  private readonly validTransitions: Record<string, string[]> = {
    [OrderStatus.PENDING]: [
      OrderStatus.CONFIRMED,
      OrderStatus.CANCELLED,
      OrderStatus.FAILED,
    ],
    [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
    [OrderStatus.PREPARING]: [OrderStatus.READY_FOR_DELIVERY],
    [OrderStatus.READY_FOR_DELIVERY]: [OrderStatus.OUT_FOR_DELIVERY],
    [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED, OrderStatus.FAILED],
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.CANCELLED]: [],
    [OrderStatus.FAILED]: [],
  };

  /**
   * Creates a new order.
   * @param createOrderDto - Data Transfer Object containing order details.
   * @returns An object containing the created order's ID.
   */
  async createOrder(createOrderDto: CreateOrderDto) {
    const totalAmount = createOrderDto.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const totalAmountWithDelivery = createOrderDto.useLoyaltyPoints
      ? totalAmount
      : totalAmount + createOrderDto.deliveryFee;

    const order = await this.order.create({
      data: {
        customerId: createOrderDto.customerId,
        restaurantId: createOrderDto.restaurantId,
        restaurantName: createOrderDto.restaurantName,
        totalAmount: totalAmountWithDelivery,
        items: {
          create: createOrderDto.items.map((item) => ({
            dishId: item.dishId,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
          })),
        },
      },
      include: {
        items: {
          select: {
            dishId: true,
            name: true,
            quantity: true,
            price: true,
          },
        },
      },
    });

    this.client.emit('order_created', { ...createOrderDto, orderId: order.id });
    return {
      orderId: order.id,
    };
  }

  /**
   * Updates the status of an order.
   * @param orderId - The ID of the order to update.
   * @param newStatus - The new status to set for the order.
   * @returns The updated order.
   * @throws RpcException if the order is not found or the status transition is invalid.
   */
  async updateOrderStatus(orderId: string, newStatus: OrderStatus) {
    // Obtener el estado actual de la orden
    const order = await this.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });

    if (!order) {
      throw new RpcException({
        message: 'Order not found',
        status: HttpStatus.NOT_FOUND,
      });
    }

    const currentStatus = order.status;

    // Verificar si la transición es válida
    const allowedStatuses = this.validTransitions[currentStatus];
    if (!allowedStatuses || !allowedStatuses.includes(newStatus)) {
      throw new RpcException({
        message: `Cannot transition from ${currentStatus} to ${newStatus}`,
        status: HttpStatus.NOT_FOUND,
      });
    }

    // Actualizar el estado de la orden
    const updatedOrder = await this.order.update({
      where: { id: orderId },
      data: { status: newStatus },
      include: {
        items: true,
      },
    });

    this.client.emit('order_status_updated', {
      orderId: updatedOrder.id,
      restaurantId: updatedOrder.restaurantId,
      newStatus: updatedOrder.status,
    });

    if (updatedOrder.status === OrderStatus.READY_FOR_DELIVERY) {
      this.client.emit('order_ready_for_delivery', {
        orderId: updatedOrder.id,
        restaurantId: updatedOrder.restaurantId,
        restaurantName: updatedOrder.restaurantName,
        customerId: updatedOrder.customerId,
        items: updatedOrder.items,
      });
    }

    return updatedOrder;
  }

  /**
   * Retrieves all orders.
   * @returns A string indicating that all orders are returned.
   */
  findAllOrders() {
    return `This action returns all orders`;
  }

  /**
   * Retrieves orders for a specific restaurant with pagination.
   * @param restaurantId - The ID of the restaurant.
   * @param paginationDto - Data Transfer Object containing pagination details.
   * @param type - Type of orders to retrieve ('pending' or 'completed')
   * @returns An object containing the orders and pagination metadata.
   */
  async findRestaurantOrders(
    restaurantId: string,
    paginationDto: PaginationDto,
    type: 'pending' | 'completed',
  ) {
    const { page, limit, search } = paginationDto;

    // Cacheamos los estados para evitar recrear el objeto en cada llamada
    const pendingStatuses = [
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.FAILED,
      OrderStatus.PENDING,
    ];

    const completedStatuses = [
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.FAILED,
    ];

    const baseWhere = {
      restaurantId,
      status: {
        [type === 'pending' ? 'notIn' : 'in']:
          type === 'pending' ? pendingStatuses : completedStatuses,
      },
    };

    if (search && search !== '') {
      // Optimización: Realizamos una única consulta con límite
      const ordersWithSearch = await this.order.findMany({
        where: baseWhere,
        select: {
          id: true,
        },
        orderBy: {
          date: 'desc',
        },
        // Aumentamos el límite para tener un buen conjunto de búsqueda
        take: 1000,
      });

      const matchingIds = ordersWithSearch
        .filter((order) => order.id.includes(search))
        .slice((page - 1) * limit, page * limit)
        .map((order) => order.id);

      if (matchingIds.length === 0) {
        return {
          data: [],
          meta: {
            total: 0,
            page,
            lastPage: 1,
          },
        };
      }

      // Obtenemos directamente las órdenes que necesitamos
      const orders = await this.order.findMany({
        where: {
          id: {
            in: matchingIds,
          },
        },
        include: {
          items: {
            select: {
              dishId: true,
              name: true,
              quantity: true,
              price: true,
            },
          },
        },
        orderBy: {
          date: 'desc',
        },
      });

      return {
        data: orders,
        meta: {
          total: ordersWithSearch.filter((order) => order.id.includes(search))
            .length,
          page,
          lastPage: Math.ceil(
            ordersWithSearch.filter((order) => order.id.includes(search))
              .length / limit,
          ),
        },
      };
    }

    // Si no hay búsqueda, usamos la consulta normal con paginación
    const [orders, totalOrders] = await Promise.all([
      this.order.findMany({
        where: baseWhere,
        include: {
          items: {
            select: {
              dishId: true,
              name: true,
              quantity: true,
              price: true,
            },
          },
        },
        orderBy: {
          date: 'desc',
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.order.count({
        where: baseWhere,
      }),
    ]);

    return {
      data: orders || [],
      meta: {
        total: totalOrders,
        page,
        lastPage: Math.ceil(totalOrders / limit),
      },
    };
  }

  /**
   * Retrieves all pending orders with pagination.
   * @param paginationDto - Data Transfer Object containing pagination details.
   * @returns An object containing the orders and pagination metadata.
   */
  async findAllPendingOrders(paginationDto: PaginationDto) {
    const { page, limit } = paginationDto;

    const [orders, totalPendingOrders] = await Promise.all([
      this.order.findMany({
        where: {
          status: OrderStatus.READY_FOR_DELIVERY,
          courierId: undefined,
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.order.count({
        where: {
          status: OrderStatus.READY_FOR_DELIVERY,
        },
      }),
    ]);

    return {
      data: orders || [],
      meta: {
        total: totalPendingOrders,
        page: page,
        lastPage: Math.ceil(totalPendingOrders / limit),
      },
    };
  }

  /**
   * Retrieves all orders for a specific customer with pagination.
   * @param customerId - The ID of the customer.
   * @param paginationDto - Data Transfer Object containing pagination details.
   * @returns An object containing the orders and pagination metadata.
   */
  async findAllCustomerOrders(
    customerId: string,
    paginationDto: PaginationDto,
  ) {
    const { page, limit } = paginationDto;

    const [orders, totalOrders] = await Promise.all([
      this.order.findMany({
        where: {
          customerId: customerId,
        },
        orderBy: {
          date: 'desc',
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.order.count({
        where: {
          customerId: customerId,
        },
      }),
    ]);

    return {
      data: orders || [],
      meta: {
        total: totalOrders,
        page: page,
        lastPage: Math.ceil(totalOrders / limit),
      },
    };
  }

  async getCustomerStats(
    customerId: string,
    period: 'daily' | 'monthly' = 'monthly',
  ) {
    // Obtener todos los pedidos del cliente
    const orders = await this.order.findMany({
      where: { customerId, status: OrderStatus.DELIVERED },
    });

    // Calcular estadísticas básicas
    const totalSpent = orders.reduce(
      (sum, order) => sum + order.totalAmount,
      0,
    );
    const totalOrders = orders.length;
    const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;

    // Encontrar el restaurante más pedido
    const restaurantCounts = orders.reduce(
      (acc: Record<string, { count: number; name: string }>, order) => {
        if (!acc[order.restaurantId]) {
          acc[order.restaurantId] = {
            count: 0,
            name: order.restaurantName,
          };
        }
        acc[order.restaurantId].count++;
        return acc;
      },
      {},
    );

    let mostOrderedRestaurant = {
      id: '',
      name: '',
      orderCount: 0,
    };

    Object.entries(restaurantCounts).forEach(([id, data]) => {
      if (data.count > mostOrderedRestaurant.orderCount) {
        mostOrderedRestaurant = {
          id,
          name: data.name,
          orderCount: data.count,
        };
      }
    });

    // Agrupar gastos por período
    const spendingByPeriod = orders.reduce(
      (acc: Record<string, number>, order) => {
        const date = new Date(order.date);
        const key =
          period === 'monthly'
            ? `${date.toLocaleString('es', { month: 'short' })} ${date.getFullYear()}`
            : date.toISOString().split('T')[0];

        if (!acc[key]) acc[key] = 0;
        acc[key] += order.totalAmount;
        return acc;
      },
      {},
    );

    // Convertir a array y ordenar
    const periodicalSpending = Object.entries(spendingByPeriod)
      .map(([period, amount]) => ({
        [period === 'monthly' ? 'month' : 'date']: period,
        amount: Number(amount.toFixed(2)),
      }))
      .sort((a, b) => {
        const dateA =
          period === 'monthly'
            ? new Date((a.month as string).replace(/(\w+)\s(\d+)/, '$2-$1-01'))
            : new Date(a.date as string);
        const dateB =
          period === 'monthly'
            ? new Date((b.month as string).replace(/(\w+)\s(\d+)/, '$2-$1-01'))
            : new Date(b.date as string);
        return dateA.getTime() - dateB.getTime();
      });

    return {
      totalSpent: Number(totalSpent.toFixed(2)),
      averageOrderValue: Number(averageOrderValue.toFixed(2)),
      totalOrders,
      [period === 'monthly' ? 'monthlySpending' : 'dailySpending']:
        periodicalSpending,
      mostOrderedRestaurant: {
        id: mostOrderedRestaurant.id,
        name: mostOrderedRestaurant.name,
        orderCount: mostOrderedRestaurant.orderCount,
      },
    };
  }

  async getRestaurantStats(
    restaurantId: string,
    period: 'daily' | 'weekly' | 'monthly' = 'weekly',
  ) {
    const orders = await this.order.findMany({
      where: { restaurantId, status: OrderStatus.DELIVERED },
    });

    if (orders.length === 0) {
      return {
        stats: {
          totalRevenue: 0,
          totalCustomers: 0,
          totalOrders: 0,
          averageServiceTime: 0,
        },
        revenueData: [],
      };
    }

    const totalRevenue = orders.reduce(
      (sum, order) => sum + order.totalAmount,
      0,
    );
    const totalOrders = orders.length;

    // Calcular clientes únicos
    const uniqueCustomers = new Set(orders.map((order) => order.customerId));
    const totalCustomers = uniqueCustomers.size;

    // Agrupar ingresos por día de la semana
    const revenueByPeriod = orders.reduce(
      (acc: Record<string, number>, order) => {
        const date = new Date(order.date);
        let key: string;

        switch (period) {
          case 'daily':
            key = date.toISOString().split('T')[0]; // YYYY-MM-DD
            break;
          case 'weekly':
            key = `Week ${this.getWeekNumber(date)}, ${date.getFullYear()}`; // Semana del año
            break;
          case 'monthly':
            key = `${date.toLocaleString('en', { month: 'long' })} ${date.getFullYear()}`; // Mes y año
            break;
        }

        if (!acc[key]) acc[key] = 0;
        acc[key] += order.totalAmount;
        return acc;
      },
      {},
    );

    // Convertir a un array ordenado por días de la semana
    const revenueData = Object.entries(revenueByPeriod)
      .map(([period, revenue]) => ({
        [period === 'daily' ? 'date' : period === 'weekly' ? 'week' : 'month']:
          period,
        revenue: Number(revenue.toFixed(2)),
      }))
      .sort((a, b) => {
        const dateA = new Date(Object.values(a)[0] as string);
        const dateB = new Date(Object.values(b)[0] as string);
        return dateA.getTime() - dateB.getTime();
      });

    return {
      stats: {
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalCustomers,
        totalOrders,
        averageServiceTime: 15,
      },
      revenueData,
    };
  }

  getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = Math.floor(
      (date.getTime() - firstDayOfYear.getTime()) / (24 * 60 * 60 * 1000),
    );
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  /**
   * Retrieves a specific order by ID.
   * @param id - The ID of the order to retrieve.
   * @returns The order if found, otherwise null.
   */
  async findOneOrder(id: string) {
    const order = await this.order.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });
    if (!order) {
      this.LOGGER.error('Order not found:', id);
      return null;
    }
    this.LOGGER.log('Order found:', order.id);
    return order;
  }

  /**
   * Marks an order as paid.
   * @param paidOrderDto - Data Transfer Object containing payment details.
   */
  async paidOrder(paidOrderDto: PaidOrderDto) {
    this.LOGGER.log('Payment succeeded:', { paidOrderDto });

    await this.findOneOrder(paidOrderDto.orderId);

    this.LOGGER.log('Order found:', { orderId: paidOrderDto.orderId });

    const paidOrder = await this.order.update({
      where: { id: paidOrderDto.orderId },
      data: {
        status: OrderStatus.CONFIRMED,
        paid: true,
        stripeChargeId: paidOrderDto.stripePaymentId,
        OrderReceipt: {
          create: {
            receiptUrl: paidOrderDto.receiptUrl,
          },
        },
      },
      include: {
        items: true,
      },
    });
    this.LOGGER.log('Order paid:', { orderId: paidOrderDto.orderId });

    this.client.emit('order_paid', paidOrder);
  }

  /**
   * Marks an order as failed due to payment session expiration.
   * @param orderId - The ID of the order.
   * @returns The updated order.
   */
  async paymentSessionExpired(orderId: string) {
    this.LOGGER.log('Payment session expired:', { orderId });

    await this.findOneOrder(orderId);

    const updatedOrder = await this.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.FAILED,
      },
    });
    return updatedOrder;
  }

  /**
   * Updates an order.
   * @param id - The ID of the order to update.
   * @param updateOrderDto - Data Transfer Object containing update details.
   * @returns A string indicating that the order is updated.
   */
  updateOrder(id: string, updateOrderDto: UpdateOrderDto) {
    return `This action updates a #${id} order`;
  }

  /**
   * Assigns a courier to an order and generates a PIN code.
   * @param orderId - The ID of the order.
   * @param courierId - The ID of the courier.
   * @returns The updated order.
   */
  async courierAssigned(orderId: string, courierId: string) {
    await this.findOneOrder(orderId);
    const pin = this.generatePin();

    const order = await this.order.update({
      where: { id: orderId },
      data: {
        courierId: courierId,
        pin_code: pin,
      },
    });

    this.client.emit('courier_assigned', { order, courierId, pin });
    return order;
  }

  /**
   * Generates a random 4-digit PIN code.
   * @returns A 4-digit PIN code as a string.
   */
  generatePin = () => {
    return Math.floor(1000 + Math.random() * 9000).toString();
  };

  /**
   * Verifies the PIN code for an order.
   * @param orderId - The ID of the order.
   * @param pin - The PIN code to verify.
   * @returns True if the PIN is correct, otherwise false.
   */
  async verifyOrderPin(orderId: string, pin: string) {
    const order = await this.findOneOrder(orderId);

    if (order.pin_code === pin) {
      await this.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.DELIVERED },
      });
      this.client.emit('order_delivered', {
        orderId,
        courierId: order.courierId,
        restaurantId: order.restaurantId,
        totalAmount: order.totalAmount,
        customerId: order.customerId,
      });
      return true;
    } else {
      return false;
    }
  }

  /**
   * Cancels an order.
   * @param id - The ID of the order to cancel.
   * @returns The updated order.
   * @throws RpcException if the order is not found.
   */
  async removeOrder(id: string) {
    const order = await this.findOneOrder(id);
    if (!order) {
      throw new RpcException({
        message: 'Order not found',
        status: HttpStatus.NOT_FOUND,
      });
    }

    const updatedOrder = await this.order.update({
      where: { id },
      data: { status: OrderStatus.CANCELLED },
    });

    this.client.emit('order_status_updated', {
      orderId: updatedOrder.id,
      restaurantId: order.restaurantId,
      newStatus: updatedOrder.status,
    });

    return updatedOrder;
  }
}
