const mockFind = jest.fn();

jest.mock('../../services/user-profile/src/character/models', () => ({
  Character: {},
  CharacterAbility: {},
  UserCharacter: {},
  CharacterUnlockProgress: {
    find: (...args) => mockFind(...args)
  }
}));

jest.mock('@study-partner/shared/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const characterManager = require('../../services/user-profile/src/character/character_manager');

function mockProgressFindResult(progressDocs) {
  mockFind.mockReturnValue({
    populate: jest.fn().mockResolvedValue(progressDocs)
  });
}

describe('Rank Unlock Threshold Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('syncUnlockProgressByMetrics unlocks rank-gated character when rankIndex reaches threshold', async () => {
    const progressDoc = {
      unlock_type: 'rank',
      required_progress: 15,
      current_progress: 14,
      is_unlocked: false,
      unlocked_at: null,
      character_id: {
        _id: 'zenith-1',
        unlock_condition: { type: 'rank', value: 15 }
      },
      save: jest.fn().mockResolvedValue(undefined)
    };

    mockProgressFindResult([progressDoc]);

    const result = await characterManager.syncUnlockProgressByMetrics('user-1', {
      rankIndex: 15
    });

    expect(result.updatedCount).toBe(1);
    expect(result.unlockedCharacterIds).toContain('zenith-1');
    expect(progressDoc.current_progress).toBe(15);
    expect(progressDoc.is_unlocked).toBe(true);
    expect(progressDoc.unlocked_at).toBeInstanceOf(Date);
    expect(progressDoc.save).toHaveBeenCalledTimes(1);
  });

  test('syncUnlockProgressByMetrics resolves string rank requirement aliases to numeric index', async () => {
    const progressDoc = {
      unlock_type: 'rank',
      required_progress: null,
      current_progress: 10,
      is_unlocked: false,
      unlocked_at: null,
      character_id: {
        _id: 'zenith-2',
        unlock_condition: { type: 'rank', value: 'gold' }
      },
      save: jest.fn().mockResolvedValue(undefined)
    };

    mockProgressFindResult([progressDoc]);

    const result = await characterManager.syncUnlockProgressByMetrics('user-2', {
      rankName: 'master iii'
    });

    expect(result.updatedCount).toBe(1);
    expect(result.unlockedCharacterIds).toContain('zenith-2');
    expect(progressDoc.required_progress).toBe(15);
    expect(progressDoc.current_progress).toBe(15);
    expect(progressDoc.is_unlocked).toBe(true);
    expect(progressDoc.save).toHaveBeenCalledTimes(1);
  });
});
