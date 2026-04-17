import { Test, TestingModule } from '@nestjs/testing';
import { DeliveriesService } from './deliveries.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveriesGateway } from './deliveries.gateway';

const mockPrismaService = {
  delivery: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  order: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  deliveryEvent: {
    create: jest.fn(),
  },
  condominium: {
    findUnique: jest.fn(),
  },
};

const mockDeliveriesGateway = {
  deliveryCreated: jest.fn(),
  deliveryAccepted: jest.fn(),
  deliveryStatusUpdated: jest.fn(),
  orderUpdated: jest.fn(),
  sendToUser: jest.fn(),
  sendToAll: jest.fn(),
  getOnlineDeliveryPeopleCount: jest.fn().mockReturnValue(0),
};

describe('DeliveriesService', () => {
  let service: DeliveriesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveriesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DeliveriesGateway, useValue: mockDeliveriesGateway },
      ],
    }).compile();

    service = module.get<DeliveriesService>(DeliveriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
