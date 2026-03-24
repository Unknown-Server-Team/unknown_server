import request from 'supertest';
import express from 'express';

jest.mock('../managers/LogManager', () => ({
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../managers/RatelimitManager', () => ({
    RatelimitManager: {
        createApiLimiter: () => (_req: any, _res: any, next: any) => next()
    }
}));

const mockAiManager = {
    GetResponse: jest.fn(),
    GetSingleResponse: jest.fn(),
    CheckSafety: jest.fn(),
    DescribeImage: jest.fn(),
    TextToSpeech: jest.fn(),
    SpeechToText: jest.fn(),
    ClearSession: jest.fn(),
    GetAvailableVoices: jest.fn(),
    GetBestMaleVoice: jest.fn(),
    getActiveSessionCount: jest.fn().mockReturnValue(0)
};

jest.mock('../managers/AiManager', () => {
    return { __esModule: true, default: jest.fn().mockImplementation(() => mockAiManager) };
});

jest.mock('../managers/NVIDIAModelsManager', () => {
    return {
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
            GetAvailableVoices: jest.fn().mockReturnValue([
                { name: 'TestVoice', languageCode: 'en-US', description: 'Test' }
            ])
        }))
    };
});

jest.mock('../managers/AIFunctions', () => ({
    __esModule: true,
    default: {
        declarations: {
            get_server_info: { name: 'get_server_info', description: 'Get server info', parameters: { type: 'object', properties: {} } }
        },
        toToolDefinitions: jest.fn().mockReturnValue([])
    }
}));

const buildApp = () => {
    process.env.NVIDIA_API_KEY = 'test-key';
    jest.resetModules();
    const aiRouter = require('../routers/api/v1/ai');
    const app = express();
    app.use(express.json());
    app.use('/ai', aiRouter);
    return app;
};

describe('AI Router', () => {
    let app: express.Express;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockAiManager.GetResponse.mockResolvedValue({ text: 'Hello!', toolCalls: undefined });
        mockAiManager.GetSingleResponse.mockResolvedValue('Single answer');
        mockAiManager.CheckSafety.mockResolvedValue({ safe: true });
        mockAiManager.DescribeImage.mockResolvedValue('A test image');
        mockAiManager.GetAvailableVoices.mockReturnValue([
            { name: 'TestVoice', languageCode: 'en-US', description: 'Test' }
        ]);
        mockAiManager.getActiveSessionCount.mockReturnValue(2);
    });

    describe('GET /ai/status', () => {
        it('returns configured status when NVIDIA_API_KEY is set', async () => {
            const res = await request(app).get('/ai/status');
            expect(res.status).toBe(200);
            expect(res.body.configured).toBe(true);
        });

        it('returns sttAvailable and ttsAvailable fields', async () => {
            const res = await request(app).get('/ai/status');
            expect(typeof res.body.sttAvailable).toBe('boolean');
            expect(typeof res.body.ttsAvailable).toBe('boolean');
        });
    });

    describe('GET /ai/models', () => {
        it('returns a models object', async () => {
            const res = await request(app).get('/ai/models');
            expect(res.status).toBe(200);
            expect(res.body.models).toBeDefined();
            expect(res.body.models.chat).toBeTruthy();
        });
    });

    describe('GET /ai/functions', () => {
        it('returns functions list', async () => {
            const res = await request(app).get('/ai/functions');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.functions)).toBe(true);
        });
    });

    describe('GET /ai/voices', () => {
        it('returns voices array', async () => {
            const res = await request(app).get('/ai/voices');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.voices)).toBe(true);
        });
    });

    describe('POST /ai/chat', () => {
        it('returns 400 when message is missing', async () => {
            const res = await request(app).post('/ai/chat').send({});
            expect(res.status).toBe(400);
            expect(res.body.error).toBe(true);
        });

        it('returns text response for valid message', async () => {
            const res = await request(app)
                .post('/ai/chat')
                .send({ message: 'Hello', sessionId: 'test-session' });
            expect(res.status).toBe(200);
            expect(res.body.text).toBe('Hello!');
            expect(res.body.sessionId).toBe('test-session');
        });

        it('uses IP as sessionId when not provided', async () => {
            const res = await request(app)
                .post('/ai/chat')
                .send({ message: 'Hi' });
            expect(res.status).toBe(200);
            expect(res.body.sessionId).toBeTruthy();
        });
    });

    describe('POST /ai/single', () => {
        it('returns 400 when message is missing', async () => {
            const res = await request(app).post('/ai/single').send({});
            expect(res.status).toBe(400);
        });

        it('returns text for valid message', async () => {
            const res = await request(app)
                .post('/ai/single')
                .send({ message: 'What is 2+2?', task: 'math' });
            expect(res.status).toBe(200);
            expect(res.body.text).toBe('Single answer');
        });
    });

    describe('POST /ai/safety', () => {
        it('returns 400 when messages is missing', async () => {
            const res = await request(app).post('/ai/safety').send({});
            expect(res.status).toBe(400);
        });

        it('returns safety result for valid messages', async () => {
            const res = await request(app)
                .post('/ai/safety')
                .send({ messages: [{ role: 'user', content: 'Hello' }] });
            expect(res.status).toBe(200);
            expect(typeof res.body.safe).toBe('boolean');
        });
    });

    describe('POST /ai/vision', () => {
        it('returns 400 when imageUrl is missing', async () => {
            const res = await request(app).post('/ai/vision').send({});
            expect(res.status).toBe(400);
        });

        it('returns description for valid imageUrl', async () => {
            const res = await request(app)
                .post('/ai/vision')
                .send({ imageUrl: 'https://example.com/img.png' });
            expect(res.status).toBe(200);
            expect(res.body.description).toBe('A test image');
        });
    });

    describe('POST /ai/tts', () => {
        it('returns 400 when text is missing', async () => {
            const res = await request(app).post('/ai/tts').send({});
            expect(res.status).toBe(400);
        });

        it('returns 503 when NVIDIA_TTS_FUNCTION_ID is not set', async () => {
            delete process.env.NVIDIA_TTS_FUNCTION_ID;
            const res = await request(app).post('/ai/tts').send({ text: 'Hello' });
            expect(res.status).toBe(503);
        });
    });

    describe('POST /ai/stt', () => {
        it('returns 503 when NVIDIA_STT_FUNCTION_ID is not set', async () => {
            delete process.env.NVIDIA_STT_FUNCTION_ID;
            const res = await request(app).post('/ai/stt').send({});
            expect(res.status).toBe(503);
        });
    });

    describe('DELETE /ai/session/:sessionId', () => {
        it('clears the session and returns cleared: true', async () => {
            const res = await request(app).delete('/ai/session/test-sess');
            expect(res.status).toBe(200);
            expect(res.body.cleared).toBe(true);
            expect(res.body.sessionId).toBe('test-sess');
        });
    });
});

describe('AI Router - unconfigured', () => {
    let app: express.Express;

    beforeAll(() => {
        delete process.env.NVIDIA_API_KEY;
        jest.resetModules();
        const aiRouter = require('../routers/api/v1/ai');
        app = express();
        app.use(express.json());
        app.use('/ai', aiRouter);
    });

    it('POST /chat returns 503 when NVIDIA_API_KEY is not set', async () => {
        const res = await request(app).post('/ai/chat').send({ message: 'Hi' });
        expect(res.status).toBe(503);
        expect(res.body.message).toMatch(/NVIDIA_API_KEY/);
    });

    it('POST /single returns 503 when NVIDIA_API_KEY is not set', async () => {
        const res = await request(app).post('/ai/single').send({ message: 'Hi' });
        expect(res.status).toBe(503);
    });
});
