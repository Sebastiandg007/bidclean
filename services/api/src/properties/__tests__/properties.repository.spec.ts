import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { PropertiesRepository } from '../properties.repository';
import { Property } from '../entities/property.entity';
import { PropertyPhoto } from '../entities/property-photo.entity';
import { PROPERTY_LIST_MAX_PAGE_SIZE } from '../properties.constants';

describe('PropertiesRepository', () => {
  let repository: PropertiesRepository;

  const USER_ID = 'user-uuid-owner-1';
  const PROPERTY_ID = 'property-uuid-1';

  const mockQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };

  const mockPropertyRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };

  const mockPhotoRepo = {
    count: jest.fn(),
    findOne: jest.fn(),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  const createMockProperty = (overrides: Partial<Property> = {}): Property =>
    ({
      id: PROPERTY_ID,
      userId: USER_ID,
      name: 'My Apartment',
      type: 'apartment',
      description: 'A nice apartment',
      addressStreet: 'Cra 7 #72-12',
      addressCity: 'Bogotá',
      addressState: 'Cundinamarca',
      addressPostalCode: '110231',
      addressCountry: 'CO',
      location: 'POINT(-74.063 4.624)',
      formattedAddress: 'Cra 7 #72-12, Bogotá, Colombia',
      locationSource: 'GEOCODED',
      squareMeters: 85,
      bedrooms: 2,
      bathrooms: 1,
      floorNumber: 5,
      hasParking: true,
      hasElevator: true,
      specialRequirements: ['pets'],
      checklistItems: ['Mop floors', 'Clean windows'],
      accessInstructions: 'Ring bell twice',
      deletedAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-15'),
      photos: [],
      ...overrides,
    }) as Property;

  const createMockPhoto = (overrides: Partial<PropertyPhoto> = {}): PropertyPhoto =>
    ({
      id: 'photo-uuid-1',
      propertyId: PROPERTY_ID,
      storageKey: `${PROPERTY_ID}/photo-uuid-1.jpg`,
      mimeType: 'image/jpeg',
      fileSizeBytes: 150000,
      displayOrder: 0,
      createdAt: new Date('2024-01-02'),
      ...overrides,
    }) as PropertyPhoto;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropertiesRepository,
        {
          provide: getRepositoryToken(Property),
          useValue: mockPropertyRepo,
        },
        {
          provide: getRepositoryToken(PropertyPhoto),
          useValue: mockPhotoRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<PropertiesRepository>(PropertiesRepository);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('findOneByOwner', () => {
    it('should return property when it exists and belongs to user', async () => {
      const property = createMockProperty();
      mockPropertyRepo.findOne.mockResolvedValue(property);

      const result = await repository.findOneByOwner(PROPERTY_ID, USER_ID);

      expect(result).toEqual(property);
      expect(mockPropertyRepo.findOne).toHaveBeenCalledWith({
        where: {
          id: PROPERTY_ID,
          userId: USER_ID,
          deletedAt: IsNull(),
        },
        relations: ['photos'],
      });
    });

    it('should return null when property does not exist', async () => {
      mockPropertyRepo.findOne.mockResolvedValue(null);

      const result = await repository.findOneByOwner('non-existent', USER_ID);

      expect(result).toBeNull();
    });

    it('should return null when property belongs to another user', async () => {
      mockPropertyRepo.findOne.mockResolvedValue(null);

      const result = await repository.findOneByOwner(PROPERTY_ID, 'other-user-id');

      expect(result).toBeNull();
    });
  });

  describe('findAllByOwner', () => {
    it('should return paginated results with ownership filter', async () => {
      const properties = [createMockProperty()];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([properties, 1]);

      const result = await repository.findAllByOwner(USER_ID, {
        page: 1,
        pageSize: 20,
      });

      expect(result.items).toEqual(properties);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'property.userId = :userId',
        { userId: USER_ID },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'property.deletedAt IS NULL',
      );
    });

    it('should apply search filter with ILIKE on name, street and city', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.findAllByOwner(USER_ID, {
        page: 1,
        pageSize: 20,
        search: 'bogota',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(property.name ILIKE :search OR property.addressStreet ILIKE :search OR property.addressCity ILIKE :search)',
        { search: '%bogota%' },
      );
    });

    it('should apply type filter', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.findAllByOwner(USER_ID, {
        page: 1,
        pageSize: 20,
        type: 'apartment',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'property.type = :type',
        { type: 'apartment' },
      );
    });

    it('should cap page size at PROPERTY_LIST_MAX_PAGE_SIZE', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.findAllByOwner(USER_ID, {
        page: 1,
        pageSize: 999,
      });

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(PROPERTY_LIST_MAX_PAGE_SIZE);
    });

    it('should default sort to updatedAt DESC', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.findAllByOwner(USER_ID, { page: 1, pageSize: 20 });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'property.updatedAt',
        'DESC',
      );
    });

    it('should sort by name when specified', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.findAllByOwner(USER_ID, {
        page: 1,
        pageSize: 20,
        sortBy: 'name',
      });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'property.name',
        'DESC',
      );
    });

    it('should calculate totalPages correctly', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 45]);

      const result = await repository.findAllByOwner(USER_ID, {
        page: 1,
        pageSize: 20,
      });

      expect(result.totalPages).toBe(3);
    });

    it('should enforce minimum page of 1', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.findAllByOwner(USER_ID, { page: -5, pageSize: 20 });

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
    });
  });

  describe('findPublicProperty', () => {
    it('should return property with only public fields', async () => {
      const publicRow = {
        id: PROPERTY_ID,
        name: 'My Apartment',
        type: 'apartment',
        description: 'A nice place',
        addressCity: 'Bogotá',
        addressCountry: 'CO',
        squareMeters: 85,
        bedrooms: 2,
        bathrooms: 1,
        floorNumber: 5,
        hasParking: true,
        hasElevator: true,
        specialRequirements: ['pets'],
        checklistItems: ['Mop floors'],
      };
      const photos = [
        {
          id: 'photo-1',
          storageKey: 'key/photo.jpg',
          mimeType: 'image/jpeg',
          fileSizeBytes: 100000,
          displayOrder: 0,
        },
      ];

      mockDataSource.query
        .mockResolvedValueOnce([publicRow])
        .mockResolvedValueOnce(photos);

      const result = await repository.findPublicProperty(PROPERTY_ID);

      expect(result).not.toBeNull();
      expect(result!['id']).toBe(PROPERTY_ID);
      expect(result!['name']).toBe('My Apartment');
      expect(result!['photos']).toEqual(photos);

      // Verify PRIVATE fields are NOT present
      expect(result).not.toHaveProperty('addressStreet');
      expect(result).not.toHaveProperty('addressState');
      expect(result).not.toHaveProperty('addressPostalCode');
      expect(result).not.toHaveProperty('formattedAddress');
      expect(result).not.toHaveProperty('location');
      expect(result).not.toHaveProperty('locationSource');
      expect(result).not.toHaveProperty('accessInstructions');
    });

    it('should return null when property does not exist', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);

      const result = await repository.findPublicProperty('non-existent');

      expect(result).toBeNull();
    });

    it('should use parameterized queries only', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([{ id: PROPERTY_ID }])
        .mockResolvedValueOnce([]);

      await repository.findPublicProperty(PROPERTY_ID);

      // First call is the property query
      const [sql, params] = mockDataSource.query.mock.calls[0];
      expect(sql).toContain('$1');
      expect(params).toEqual([PROPERTY_ID]);
      expect(sql).not.toContain(PROPERTY_ID);
    });

    it('should filter out soft-deleted properties', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([{ id: PROPERTY_ID }])
        .mockResolvedValueOnce([]);

      await repository.findPublicProperty(PROPERTY_ID);

      const [sql] = mockDataSource.query.mock.calls[0];
      expect(sql).toContain('deleted_at IS NULL');
    });
  });

  describe('createProperty', () => {
    it('should create and save a new property', async () => {
      const data: Partial<Property> = {
        userId: USER_ID,
        name: 'New Place',
        type: 'house',
      };
      const created = createMockProperty(data);
      mockPropertyRepo.create.mockReturnValue(created);
      mockPropertyRepo.save.mockResolvedValue(created);

      const result = await repository.createProperty(data);

      expect(mockPropertyRepo.create).toHaveBeenCalledWith(data);
      expect(mockPropertyRepo.save).toHaveBeenCalledWith(created);
      expect(result).toEqual(created);
    });
  });

  describe('updateProperty', () => {
    it('should update property with ownership enforcement', async () => {
      const data: Partial<Property> = { name: 'Updated Name' };
      mockQueryBuilder.execute.mockResolvedValue({ affected: 1 });
      mockPropertyRepo.findOne.mockResolvedValue(
        createMockProperty({ name: 'Updated Name' }),
      );

      const result = await repository.updateProperty(PROPERTY_ID, USER_ID, data);

      expect(result).not.toBeNull();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'id = :propertyId',
        { propertyId: PROPERTY_ID },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user_id = :userId',
        { userId: USER_ID },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'deleted_at IS NULL',
      );
    });

    it('should return null when property not found or not owned', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 0 });

      const result = await repository.updateProperty(
        PROPERTY_ID,
        'other-user',
        { name: 'Hacked' },
      );

      expect(result).toBeNull();
    });
  });

  describe('softDelete', () => {
    it('should set deleted_at with ownership enforcement', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 1 });

      const result = await repository.softDelete(PROPERTY_ID, USER_ID);

      expect(result).toBe(true);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'id = :propertyId',
        { propertyId: PROPERTY_ID },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user_id = :userId',
        { userId: USER_ID },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'deleted_at IS NULL',
      );
    });

    it('should return false when property not found or not owned', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 0 });

      const result = await repository.softDelete(PROPERTY_ID, 'other-user');

      expect(result).toBe(false);
    });
  });

  describe('findByIdempotencyKey', () => {
    it('should return property when idempotency key matches', async () => {
      const property = createMockProperty();
      mockDataSource.query.mockResolvedValue([{ property_id: PROPERTY_ID }]);
      mockPropertyRepo.findOne.mockResolvedValue(property);

      const result = await repository.findByIdempotencyKey(USER_ID, 'idem-key-1');

      expect(result).toEqual(property);
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('property_idempotency_keys'),
        [USER_ID, 'idem-key-1'],
      );
    });

    it('should return null when no idempotency match found', async () => {
      mockDataSource.query.mockResolvedValue([]);

      const result = await repository.findByIdempotencyKey(USER_ID, 'unknown-key');

      expect(result).toBeNull();
    });
  });

  describe('countPhotos', () => {
    it('should return the count of photos for a property', async () => {
      mockPhotoRepo.count.mockResolvedValue(5);

      const result = await repository.countPhotos(PROPERTY_ID);

      expect(result).toBe(5);
      expect(mockPhotoRepo.count).toHaveBeenCalledWith({
        where: { propertyId: PROPERTY_ID },
      });
    });
  });

  describe('getCoverPhoto', () => {
    it('should return the photo with display_order = 0', async () => {
      const coverPhoto = createMockPhoto({ displayOrder: 0 });
      mockPhotoRepo.findOne.mockResolvedValue(coverPhoto);

      const result = await repository.getCoverPhoto(PROPERTY_ID);

      expect(result).toEqual(coverPhoto);
      expect(mockPhotoRepo.findOne).toHaveBeenCalledWith({
        where: { propertyId: PROPERTY_ID, displayOrder: 0 },
      });
    });

    it('should return null when property has no photos', async () => {
      mockPhotoRepo.findOne.mockResolvedValue(null);

      const result = await repository.getCoverPhoto(PROPERTY_ID);

      expect(result).toBeNull();
    });
  });
});
