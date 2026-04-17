import { Test, TestingModule } from '@nestjs/testing';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';

const mockDeliveriesService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
  acceptDelivery: jest.fn(),
  updateStatus: jest.fn(),
  cancelDelivery: jest.fn(),
  getAvailableDeliveries: jest.fn(),
  getDeliveryPersonDeliveries: jest.fn(),
  getHistory: jest.fn(),
  getStats: jest.fn(),
  getAdminOverview: jest.fn(),
  exportCsv: jest.fn(),
  rateDelivery: jest.fn(),
};

describe('DeliveriesController', () => {
  let controller: DeliveriesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeliveriesController],
      providers: [
        { provide: DeliveriesService, useValue: mockDeliveriesService },
      ],
    }).compile();

    controller = module.get<DeliveriesController>(DeliveriesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
