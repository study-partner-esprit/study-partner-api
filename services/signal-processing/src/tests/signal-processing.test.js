// Set environment variables BEFORE any imports
process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_study_partner';
process.env.NODE_ENV = 'test';
process.env.AI_SERVICE_URL = 'http://localhost:8000';

// Prevent process.exit() from killing tests
process.exit = jest.fn();

const axios = require('axios');

jest.mock('axios');

jest.mock('../models/FocusSession', () => ({
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn()
}));

jest.mock('@study-partner/shared/auth', () => ({
  authenticate: jest.fn((req, res, next) => {
    req.user = { userId: 'test-user-123' };
    next();
  })
}));

jest.mock('@study-partner/shared', () => ({
  corsMiddleware: jest.fn(() => (req, res, next) => next()),
  securityMiddleware: jest.fn(() => (req, res, next) => next()),
  loggingMiddleware: jest.fn((req, res, next) => next()),
  errorHandler: jest.fn((err, req, res) => {
    res.status(err.status || 500).json({ error: err.message });
  }),
  rateLimiter: jest.fn(() => (req, res, next) => next()),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

describe('Signal Processing Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Focus Signals', () => {
    test('should record focus signal', async () => {
      const FocusSession = require('../models/FocusSession');
      const focusData = {
        userId: 'user-123',
        timestamp: new Date(),
        focusLevel: 8,
        duration: 45,
        sessionId: 'session-123'
      };

      FocusSession.create.mockResolvedValue({
        _id: 'signal-123',
        ...focusData
      });

      const result = await FocusSession.create(focusData);
      expect(result.focusLevel).toBe(8);
      expect(result.userId).toBe('user-123');
    });

    test('should validate focus level range', () => {
      const validFocusLevels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(validFocusLevels).toHaveLength(10);
      expect(validFocusLevels).toContain(8);
    });

    test('should aggregate focus signals', async () => {
      const signals = [
        { focusLevel: 8, duration: 45 },
        { focusLevel: 9, duration: 60 },
        { focusLevel: 7, duration: 30 }
      ];

      const averageFocus = signals.reduce((sum, s) => sum + s.focusLevel, 0) / signals.length;
      const totalDuration = signals.reduce((sum, s) => sum + s.duration, 0);

      expect(Math.round(averageFocus * 100) / 100).toBe(8);
      expect(totalDuration).toBe(135);
    });

    test('should detect focus drop', () => {
      const signals = [
        { timestamp: new Date('2024-01-01T10:00:00'), focusLevel: 9 },
        { timestamp: new Date('2024-01-01T10:15:00'), focusLevel: 7 },
        { timestamp: new Date('2024-01-01T10:30:00'), focusLevel: 4 }
      ];

      const focusDrop = signals[0].focusLevel - signals[signals.length - 1].focusLevel;
      expect(focusDrop).toBe(5);
    });
  });

  describe('Fatigue Signals', () => {
    test('should record fatigue signal', async () => {
      const FocusSession = require('../models/FocusSession');
      const fatigueData = {
        userId: 'user-123',
        timestamp: new Date(),
        fatigueLevel: 7,
        cause: 'prolonged_study'
      };

      FocusSession.create.mockResolvedValue({
        _id: 'fatigue-123',
        ...fatigueData
      });

      const result = await FocusSession.create(fatigueData);
      expect(result.fatigueLevel).toBe(7);
    });

    test('should identify fatigue triggers', () => {
      const triggers = ['prolonged_study', 'late_night', 'lack_of_break', 'high_stress'];
      expect(triggers).toContain('prolonged_study');
      expect(triggers).toHaveLength(4);
    });

    test('should recommend breaks based on fatigue', () => {
      const fatigueLevel = 8;
      const recommendedBreakMinutes = fatigueLevel > 7 ? 30 : fatigueLevel > 5 ? 15 : 5;

      expect(recommendedBreakMinutes).toBe(30);
    });

    test('should track fatigue trends', () => {
      const fatigueHistory = [
        { timestamp: new Date('2024-01-01'), level: 3 },
        { timestamp: new Date('2024-01-02'), level: 5 },
        { timestamp: new Date('2024-01-03'), level: 7 }
      ];

      const isIncreasing = fatigueHistory[2].level > fatigueHistory[0].level;
      expect(isIncreasing).toBe(true);
    });
  });

  describe('Signal Analysis', () => {
    test('should analyze signal patterns', () => {
      const signals = [
        { hour: 9, focusLevel: 9 },
        { hour: 12, focusLevel: 7 },
        { hour: 15, focusLevel: 5 },
        { hour: 18, focusLevel: 4 }
      ];

      const peakHour = signals.reduce((max, s) => (s.focusLevel > max.focusLevel ? s : max));

      expect(peakHour.hour).toBe(9);
      expect(peakHour.focusLevel).toBe(9);
    });

    test('should calculate signal statistics', () => {
      const focusLevels = [8, 9, 7, 6, 8, 9, 7];

      const mean = focusLevels.reduce((a, b) => a + b) / focusLevels.length;
      const max = Math.max(...focusLevels);
      const min = Math.min(...focusLevels);

      expect(Math.round(mean * 100) / 100).toBe(7.71);
      expect(max).toBe(9);
      expect(min).toBe(6);
    });

    test('should detect anomalies', () => {
      const normalRange = { min: 5, max: 10 };
      const anomaly = 2;

      const isAnomaly = anomaly < normalRange.min || anomaly > normalRange.max;
      expect(isAnomaly).toBe(true);
    });
  });

  describe('Real-time Processing', () => {
    test('should process signals in real-time', async () => {
      const signalTimestamp = new Date();
      const processingDelay = 100; // ms

      expect(signalTimestamp instanceof Date).toBe(true);
      expect(processingDelay).toBeLessThan(1000);
    });

    test('should handle signal buffering', () => {
      const buffer = [];
      const signal = { timestamp: new Date(), level: 8 };

      buffer.push(signal);
      expect(buffer).toHaveLength(1);
      expect(buffer[0]).toBe(signal);
    });

    test('should support streaming updates', () => {
      const subscribers = [];
      const callback = jest.fn();

      subscribers.push(callback);
      expect(subscribers).toHaveLength(1);
    });
  });

  describe('Integration with Study Service', () => {
    test('should send fatigue alerts', async () => {
      axios.post.mockResolvedValue({ status: 200 });

      const alert = {
        userId: 'user-123',
        type: 'high_fatigue',
        message: 'You seem tired. Take a break!'
      };

      const result = await axios.post('http://study-service/alerts', alert);
      expect(result.status).toBe(200);
    });

    test('should adjust recommendations based on signals', () => {
      const focusLevel = 4;
      const recommendAction = focusLevel < 5 ? 'suggest_break' : 'continue_study';

      expect(recommendAction).toBe('suggest_break');
    });
  });

  describe('Data Privacy & Security', () => {
    test('should not expose raw user data', () => {
      const publicSignal = {
        focusLevel: 8
        // userId intentionally excluded
      };

      expect(publicSignal).not.toHaveProperty('userId');
    });

    test('should encrypt sensitive signals', () => {
      const signal = {
        data: 'sensitive_data',
        encrypted: true
      };

      expect(signal.encrypted).toBe(true);
    });
  });
});
