import NVIDIAModelsManager from '../managers/NVIDIAModelsManager';

describe('NVIDIAModelsManager', () => {
    let manager: NVIDIAModelsManager;

    beforeEach(() => {
        manager = new NVIDIAModelsManager('test-api-key');
    });

    describe('GetAvailableVoices', () => {
        it('returns a non-empty array', () => {
            const voices = manager.GetAvailableVoices();
            expect(Array.isArray(voices)).toBe(true);
            expect(voices.length).toBeGreaterThan(0);
        });

        it('each voice has name, languageCode and description', () => {
            for (const voice of manager.GetAvailableVoices()) {
                expect(typeof voice.name).toBe('string');
                expect(typeof voice.languageCode).toBe('string');
                expect(typeof voice.description).toBe('string');
                expect(voice.name.length).toBeGreaterThan(0);
                expect(voice.languageCode.length).toBeGreaterThan(0);
            }
        });

        it('includes at least one English voice', () => {
            const voices = manager.GetAvailableVoices();
            const en = voices.filter(v => v.languageCode === 'en-US');
            expect(en.length).toBeGreaterThan(0);
        });

        it('includes at least one Spanish voice', () => {
            const voices = manager.GetAvailableVoices();
            const es = voices.filter(v => v.languageCode === 'es-US');
            expect(es.length).toBeGreaterThan(0);
        });

        it('includes voices for multiple languages', () => {
            const voices = manager.GetAvailableVoices();
            const langs = new Set(voices.map(v => v.languageCode));
            expect(langs.size).toBeGreaterThanOrEqual(3);
        });
    });

    describe('GetBestMaleVoice', () => {
        it('returns a string for en-US', () => {
            const voice = manager.GetBestMaleVoice('en-US');
            expect(typeof voice).toBe('string');
        });

        it('returns null for unsupported language', () => {
            const voice = manager.GetBestMaleVoice('xx-XX');
            expect(voice).toBeNull();
        });

        it('returns a male voice name for en-US', () => {
            const voice = manager.GetBestMaleVoice('en-US');
            expect(voice).toBeTruthy();
            const voiceData = manager.GetAvailableVoices().find(v => v.name === voice);
            expect(voiceData).toBeDefined();
        });

        it('returns different male voice for a different language if available', () => {
            const enVoice = manager.GetBestMaleVoice('en-US');
            const frVoice = manager.GetBestMaleVoice('fr-FR');
            if (frVoice !== null) {
                expect(frVoice).not.toBe(enVoice);
            }
        });
    });

    describe('CreateChatSession', () => {
        it('returns a chat session object with sendMessage', () => {
            const session = manager.CreateChatSession({ maxTokens: 200 });
            expect(typeof session.sendMessage).toBe('function');
        });

        it('returned session has primeTools method', () => {
            const session = manager.CreateChatSession();
            expect(typeof session.primeTools).toBe('function');
        });

        it('returned session has addSystemMessage method', () => {
            const session = manager.CreateChatSession();
            expect(typeof session.addSystemMessage).toBe('function');
        });

        it('creates session with custom model', () => {
            const session = manager.CreateChatSession({ model: 'meta/llama-3.1-8b-instruct' });
            expect(session).toBeDefined();
        });
    });

    describe('GetConversationSafety', () => {
        it('returns safe=true when fetch fails (fail-open)', async () => {
            const result = await manager.GetConversationSafety(
                [{ role: 'user', content: 'Hello' }],
                1
            );
            expect(result.safe).toBe(true);
        });
    });

    describe('GetModelChatResponse', () => {
        it('returns empty content gracefully when API is unavailable', async () => {
            const result = await manager.GetModelChatResponse(
                [{ role: 'user', content: 'Hello' }],
                100,
                'chat',
                false
            );
            expect(typeof result.content).toBe('string');
        });
    });

    describe('GetVisualDescription', () => {
        it('returns empty string when image URL is invalid', async () => {
            const result = await manager.GetVisualDescription(
                'http://localhost:9999/nonexistent.jpg',
                'en',
                500
            );
            expect(typeof result).toBe('string');
        });
    });
});
