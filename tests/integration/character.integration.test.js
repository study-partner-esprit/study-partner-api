const express = require('express');
const request = require('supertest');

let mockAuthUser = { userId: 'user-123', role: 'student' };
const mockStripeCreate = jest.fn();
const mockStripeRetrieve = jest.fn();

process.env.STRIPE_SECRET_KEY = 'sk_test_character';

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: (...args) => mockStripeCreate(...args),
        retrieve: (...args) => mockStripeRetrieve(...args)
      }
    }
  }));
});

jest.mock('@study-partner/shared/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = mockAuthUser;
    next();
  }
}));

jest.mock('@study-partner/shared/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const mockPurchaseFindOneAndUpdate = jest.fn();
const mockPurchaseFind = jest.fn();

jest.mock('../../services/user-profile/src/character/models', () => ({
  CharacterPurchase: {
    findOneAndUpdate: (...args) => mockPurchaseFindOneAndUpdate(...args),
    find: (...args) => mockPurchaseFind(...args)
  }
}));

jest.mock('../../services/user-profile/src/character/character_manager', () => ({
  getAllCharacters: jest.fn(),
  getBaseCharacters: jest.fn(),
  getCharacterById: jest.fn(),
  selectCharacterForUser: jest.fn(),
  getUserCharacter: jest.fn(),
  getUserOwnedCharacters: jest.fn(),
  unlockCharacterForUser: jest.fn(),
  changeUserCharacter: jest.fn(),
  getUserUnlockProgress: jest.fn(),
  createCharacter: jest.fn(),
  updateCharacter: jest.fn(),
  createAbility: jest.fn()
}));

jest.mock('../../services/user-profile/src/character/ability_executor', () => ({
  executeAbility: jest.fn(),
  getAbilityStats: jest.fn(),
  getAbilityEventHistory: jest.fn()
}));

const characterManager = require('../../services/user-profile/src/character/character_manager');
const abilityExecutor = require('../../services/user-profile/src/character/ability_executor');
const { CharacterPurchase } = require('../../services/user-profile/src/character/models');
const characterRoutes = require('../../services/user-profile/src/character/routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', characterRoutes);
  return app;
}

describe('Character Routes Integration', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { userId: 'user-123', role: 'student' };
  });

  test('GET /api/v1/characters returns filtered character list', async () => {
    const characters = [{ _id: 'c1', name: 'Chrono', rarity: 'common' }];
    characterManager.getAllCharacters.mockResolvedValue(characters);

    const res = await request(app).get('/api/v1/characters?layer=base&rarity=common');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(characters);
    expect(characterManager.getAllCharacters).toHaveBeenCalledWith({
      layer: 'base',
      rarity: 'common'
    });
  });

  test('GET /api/v1/characters/:id/abilities returns character abilities', async () => {
    characterManager.getCharacterById.mockResolvedValue({
      _id: 'c1',
      abilities: [{ _id: 'a1', name: 'Golden Touch' }]
    });

    const res = await request(app).get('/api/v1/characters/c1/abilities');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Golden Touch');
  });

  test('POST /api/v1/user/select-character selects a character for authenticated user', async () => {
    const assignment = {
      _id: 'uc-1',
      user_id: 'user-123',
      character_id: 'c1',
      mastery_level: 0,
      mastery_points: 0
    };
    characterManager.selectCharacterForUser.mockResolvedValue(assignment);

    const res = await request(app)
      .post('/api/v1/user/select-character')
      .send({ characterId: 'c1' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(characterManager.selectCharacterForUser).toHaveBeenCalledWith('user-123', 'c1');
  });

  test('POST /api/v1/user/select-character returns 401 when auth user id is missing', async () => {
    mockAuthUser = { role: 'student' };

    const res = await request(app)
      .post('/api/v1/user/select-character')
      .send({ characterId: 'c1' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(characterManager.selectCharacterForUser).not.toHaveBeenCalled();
  });

  test('GET /api/v1/user/character uses req.user.userId contract', async () => {
    characterManager.getUserCharacter.mockResolvedValue({
      _id: 'uc-1',
      user_id: 'user-123',
      character_id: { _id: 'c1', name: 'Chrono' }
    });

    const res = await request(app).get('/api/v1/user/character');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(characterManager.getUserCharacter).toHaveBeenCalledWith('user-123');
  });

  test('PATCH /api/v1/user/character updates current character', async () => {
    characterManager.changeUserCharacter.mockResolvedValue({
      _id: 'uc-1',
      user_id: 'user-123',
      character_id: 'c2'
    });

    const res = await request(app).patch('/api/v1/user/character').send({ characterId: 'c2' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(characterManager.changeUserCharacter).toHaveBeenCalledWith('user-123', 'c2');
  });

  test('POST /api/v1/user/characters/:id/purchase starts Stripe checkout', async () => {
    characterManager.getCharacterById.mockResolvedValue({
      _id: 'c2',
      name: 'Aegis',
      layer: 'progression',
      is_purchasable: true,
      purchase_price_usd_cents: 499
    });
    characterManager.getUserOwnedCharacters.mockResolvedValue({
      active_character_id: 'c1',
      starter_character_id: 'c1',
      owned_characters: [{ _id: 'c1', name: 'Chrono' }]
    });
    mockStripeCreate.mockResolvedValue({
      id: 'cs_character_1',
      url: 'https://checkout.stripe.test/session/cs_character_1'
    });
    mockPurchaseFindOneAndUpdate.mockResolvedValue({ _id: 'cp-1' });

    const res = await request(app).post('/api/v1/user/characters/c2/purchase').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checkoutSessionId).toBe('cs_character_1');
    expect(res.body.data.amountUsdCents).toBe(499);
    expect(characterManager.getCharacterById).toHaveBeenCalledWith('c2');
    expect(mockPurchaseFindOneAndUpdate).toHaveBeenCalled();
  });

  test('POST /api/v1/user/characters/purchase/confirm unlocks purchased character', async () => {
    mockStripeRetrieve.mockResolvedValue({
      id: 'cs_character_1',
      payment_status: 'paid',
      amount_total: 499,
      currency: 'usd',
      payment_intent: 'pi_123',
      metadata: {
        userId: 'user-123',
        characterId: 'c2'
      }
    });

    characterManager.unlockCharacterForUser.mockResolvedValue({ _id: 'uc-1' });
    characterManager.getUserOwnedCharacters.mockResolvedValue({
      active_character_id: 'c1',
      starter_character_id: 'c1',
      owned_characters: [{ _id: 'c1' }, { _id: 'c2' }]
    });

    mockPurchaseFindOneAndUpdate.mockReturnValue({
      populate: jest.fn().mockResolvedValue({
        _id: 'cp-1',
        user_id: 'user-123',
        character_id: { _id: 'c2', name: 'Aegis' },
        status: 'succeeded'
      })
    });

    const res = await request(app)
      .post('/api/v1/user/characters/purchase/confirm')
      .send({ sessionId: 'cs_character_1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(characterManager.unlockCharacterForUser).toHaveBeenCalledWith('user-123', 'c2');
    expect(mockPurchaseFindOneAndUpdate).toHaveBeenCalled();
  });

  test('POST /api/v1/abilities/trigger validates required payload fields', async () => {
    const res = await request(app).post('/api/v1/abilities/trigger').send({ characterId: 'c1' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(abilityExecutor.executeAbility).not.toHaveBeenCalled();
  });

  test('POST /api/v1/abilities/trigger returns execution result', async () => {
    abilityExecutor.executeAbility.mockResolvedValue({
      success: true,
      applied: true,
      abilityName: 'Golden Touch',
      xpGain: 125,
      xpBonus: 25
    });

    const res = await request(app)
      .post('/api/v1/abilities/trigger')
      .send({
        characterId: 'c1',
        sessionData: { sessionType: 'study', duration: 30 },
        baseXp: 100
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.xpBonus).toBe(25);
    expect(abilityExecutor.executeAbility).toHaveBeenCalledWith(
      'user-123',
      'c1',
      { sessionType: 'study', duration: 30 },
      100
    );
  });

  test('POST /api/v1/admin/characters blocks non-admin users', async () => {
    const res = await request(app)
      .post('/api/v1/admin/characters')
      .send({ name: 'Test Character' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(characterManager.createCharacter).not.toHaveBeenCalled();
  });

  test('POST /api/v1/admin/characters allows admin users', async () => {
    mockAuthUser = { userId: 'admin-1', role: 'admin' };
    characterManager.createCharacter.mockResolvedValue({
      _id: 'c-admin',
      name: 'Admin Created'
    });

    const res = await request(app).post('/api/v1/admin/characters').send({ name: 'Admin Created' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(characterManager.createCharacter).toHaveBeenCalledWith({
      name: 'Admin Created'
    });
  });
});
