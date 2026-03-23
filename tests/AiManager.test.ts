import AiManager from '../managers/AiManager';
import type { NIMChatSession, NIMToolCall } from '../managers/NVIDIAModelsManager';

const makeMockChat = (overrides: Partial<NIMChatSession> = {}): NIMChatSession => ({
    sendMessage: jest.fn().mockResolvedValue({
        response: {
            text: () => 'Mock response',
            functionCalls: () => undefined
        }
    }),
    primeTools: jest.fn(),
    addSystemMessage: jest.fn(),
    ...overrides
});

const makeMockNvidiaModels = (chatOverrides: Partial<NIMChatSession> = {}) => ({
    CreateChatSession: jest.fn(() => makeMockChat(chatOverrides)),
    GetModelChatResponse: jest.fn().mockResolvedValue({ content: 'Single response', reasoning: undefined }),
    GetConversationSafety: jest.fn().mockResolvedValue({ safe: true }),
    GetVisualDescription: jest.fn().mockResolvedValue('A blue sky'),
    GetTextToSpeech: jest.fn().mockResolvedValue(Buffer.from('audio')),
    GetSpeechToText: jest.fn().mockResolvedValue('hello world'),
    GetAvailableVoices: jest.fn().mockReturnValue([
        { name: 'Magpie-Multilingual.EN-US.Aria', languageCode: 'en-US', description: 'Default voice' }
    ]),
    GetBestMaleVoice: jest.fn().mockReturnValue('Magpie-Multilingual.EN-US.Jason')
});

jest.mock('../managers/NVIDIAModelsManager', () => {
    return {
        __esModule: true,
        default: jest.fn().mockImplementation(() => makeMockNvidiaModels())
    };
});

import NVIDIAModelsManager from '../managers/NVIDIAModelsManager';

const buildManager = (overrides?: Partial<NIMChatSession>) => {
    const mockModels = makeMockNvidiaModels(overrides);
    (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
    return new AiManager({ apiKey: 'test-key', maxMessages: 3, rateLimitWindowMs: 10000 });
};

describe('AiManager', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('rate limiting', () => {
        it('allows first message', () => {
            const mgr = buildManager();
            expect(mgr.isRatelimited('user1')).toBe(false);
        });

        it('allows messages up to maxMessages', () => {
            const mgr = buildManager();
            const id = 'user-rl';
            mgr.isRatelimited(id);
            mgr.isRatelimited(id);
            expect(mgr.isRatelimited(id)).toBe(false);
        });

        it('blocks after exceeding maxMessages', () => {
            const mgr = buildManager();
            const id = 'user-block';
            for (let i = 0; i < 4; i++) mgr.isRatelimited(id);
            expect(mgr.isRatelimited(id)).toBe(true);
        });

        it('resets rate limit on resetRateLimit', () => {
            const mgr = buildManager();
            const id = 'user-reset';
            for (let i = 0; i < 5; i++) mgr.isRatelimited(id);
            mgr.resetRateLimit(id);
            expect(mgr.isRatelimited(id)).toBe(false);
        });

        it('returns rate limit message from GetResponse when limited', async () => {
            const mgr = buildManager();
            const id = 'user-msg-rl';
            for (let i = 0; i < 5; i++) mgr.isRatelimited(id);
            const resp = await mgr.GetResponse(id, 'hello');
            expect(resp.text).toMatch(/Too many requests/);
        });
    });

    describe('session management', () => {
        it('starts with 0 active sessions', () => {
            const mgr = buildManager();
            expect(mgr.getActiveSessionCount()).toBe(0);
        });

        it('creates a session on GetResponse', async () => {
            const mockChat = makeMockChat();
            const mockModels = makeMockNvidiaModels();
            mockModels.CreateChatSession.mockReturnValue(mockChat);
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            await mgr.GetResponse('sess1', 'hello');
            expect(mgr.getActiveSessionCount()).toBe(1);
        });

        it('reuses the same session for the same sessionId', async () => {
            const mockChat = makeMockChat();
            const mockModels = makeMockNvidiaModels();
            mockModels.CreateChatSession.mockReturnValue(mockChat);
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            await mgr.GetResponse('sess2', 'message 1');
            await mgr.GetResponse('sess2', 'message 2');
            expect(mockModels.CreateChatSession).toHaveBeenCalledTimes(1);
        });

        it('ClearSession removes the session', async () => {
            const mockChat = makeMockChat();
            const mockModels = makeMockNvidiaModels();
            mockModels.CreateChatSession.mockReturnValue(mockChat);
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            await mgr.GetResponse('sess3', 'hi');
            await mgr.ClearSession('sess3');
            expect(mgr.getActiveSessionCount()).toBe(0);
        });

        it('creates a new session after clearing', async () => {
            const mockChat = makeMockChat();
            const mockModels = makeMockNvidiaModels();
            mockModels.CreateChatSession.mockReturnValue(mockChat);
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            await mgr.GetResponse('sess4', 'hi');
            await mgr.ClearSession('sess4');
            await mgr.GetResponse('sess4', 'hi again');
            expect(mockModels.CreateChatSession).toHaveBeenCalledTimes(2);
        });
    });

    describe('GetResponse', () => {
        it('returns the response text from the chat', async () => {
            const mockChat = makeMockChat({
                sendMessage: jest.fn().mockResolvedValue({
                    response: { text: () => 'Hello from AI', functionCalls: () => undefined }
                })
            });
            const mockModels = makeMockNvidiaModels();
            mockModels.CreateChatSession.mockReturnValue(mockChat);
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            const resp = await mgr.GetResponse('user1', 'hi');
            expect(resp.text).toBe('Hello from AI');
        });

        it('includes tool calls when present', async () => {
            const toolCalls: NIMToolCall[] = [{ name: 'get_server_info', args: {} }];
            const mockChat = makeMockChat({
                sendMessage: jest.fn().mockResolvedValue({
                    response: { text: () => 'Checking server...', functionCalls: () => toolCalls }
                })
            });
            const mockModels = makeMockNvidiaModels();
            mockModels.CreateChatSession.mockReturnValue(mockChat);
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            const resp = await mgr.GetResponse('user2', 'server status?');
            expect(resp.toolCalls).toEqual(toolCalls);
        });

        it('bootstraps the session on first message', async () => {
            const mockChat = makeMockChat();
            const mockModels = makeMockNvidiaModels();
            mockModels.CreateChatSession.mockReturnValue(mockChat);
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            await mgr.GetResponse('boot-user', 'hello');
            expect(mockChat.primeTools).toHaveBeenCalledTimes(1);
        });

        it('does not bootstrap twice for same session', async () => {
            const mockChat = makeMockChat();
            const mockModels = makeMockNvidiaModels();
            mockModels.CreateChatSession.mockReturnValue(mockChat);
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            await mgr.GetResponse('once-user', 'hello');
            await mgr.GetResponse('once-user', 'world');
            expect(mockChat.primeTools).toHaveBeenCalledTimes(1);
        });
    });

    describe('GetSingleResponse', () => {
        it('returns a single response without creating a session', async () => {
            const mockModels = makeMockNvidiaModels();
            mockModels.GetModelChatResponse.mockResolvedValue({ content: 'Direct response' });
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            const text = await mgr.GetSingleResponse('What is 2+2?');
            expect(text).toBe('Direct response');
            expect(mgr.getActiveSessionCount()).toBe(0);
        });

        it('passes the task to GetModelChatResponse', async () => {
            const mockModels = makeMockNvidiaModels();
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            await mgr.GetSingleResponse('solve x^2=4', 'math');
            expect(mockModels.GetModelChatResponse).toHaveBeenCalledWith(
                expect.any(Array),
                20000,
                'math',
                false
            );
        });
    });

    describe('ExecuteFunction', () => {
        it('executes a known function and returns text', async () => {
            const mockChat = makeMockChat({
                sendMessage: jest.fn()
                    .mockResolvedValueOnce({
                        response: { text: () => '', functionCalls: () => undefined }
                    })
                    .mockResolvedValueOnce({
                        response: { text: () => 'Tool done', functionCalls: () => undefined }
                    })
            });
            const mockModels = makeMockNvidiaModels();
            mockModels.CreateChatSession.mockReturnValue(mockChat);
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            const resp = await mgr.ExecuteFunction('user-fn', 'calculate', { expression: '1+1' });
            expect(resp.text).toBeTruthy();
        });

        it('handles unknown function gracefully', async () => {
            const mockChat = makeMockChat({
                sendMessage: jest.fn().mockResolvedValue({
                    response: { text: () => 'Unknown function handled', functionCalls: () => undefined }
                })
            });
            const mockModels = makeMockNvidiaModels();
            mockModels.CreateChatSession.mockReturnValue(mockChat);
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            const resp = await mgr.ExecuteFunction('user-fn2', 'nonexistent_func', {});
            expect(resp.text).toBeTruthy();
        });

        it('clears session when end_conversation is executed', async () => {
            const mockChat = makeMockChat({
                sendMessage: jest.fn().mockResolvedValue({
                    response: { text: () => 'Bye!', functionCalls: () => undefined }
                })
            });
            const mockModels = makeMockNvidiaModels();
            mockModels.CreateChatSession.mockReturnValue(mockChat);
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });

            await mgr.GetResponse('end-user', 'hello');
            expect(mgr.getActiveSessionCount()).toBe(1);

            await mgr.ExecuteFunction('end-user', 'end_conversation', { reason: 'Done' });
            expect(mgr.getActiveSessionCount()).toBe(0);
        });

        it('returns rate limit message when user is rate limited', async () => {
            const mgr = buildManager();
            const id = 'fn-rl-user';
            for (let i = 0; i < 5; i++) mgr.isRatelimited(id);

            const resp = await mgr.ExecuteFunction(id, 'calculate', { expression: '1+1' });
            expect(resp.text).toMatch(/Too many requests/);
        });
    });

    describe('utility methods', () => {
        it('GetAvailableVoices returns a non-empty array', () => {
            const mockModels = makeMockNvidiaModels();
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });
            const voices = mgr.GetAvailableVoices();
            expect(Array.isArray(voices)).toBe(true);
            expect(voices.length).toBeGreaterThan(0);
        });

        it('GetBestMaleVoice returns a string or null', () => {
            const mockModels = makeMockNvidiaModels();
            (NVIDIAModelsManager as jest.Mock).mockImplementation(() => mockModels);
            const mgr = new AiManager({ apiKey: 'key' });
            const voice = mgr.GetBestMaleVoice('en-US');
            expect(typeof voice === 'string' || voice === null).toBe(true);
        });
    });
});
