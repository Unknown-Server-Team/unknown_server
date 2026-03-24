import AIFunctions, { SchemaType } from '../managers/AIFunctions';

describe('AIFunctions declarations', () => {
    it('exports all expected function names', () => {
        const names = Object.keys(AIFunctions.declarations);
        expect(names).toContain('get_server_info');
        expect(names).toContain('calculate');
        expect(names).toContain('fetch_url');
        expect(names).toContain('analyze_sentiment');
        expect(names).toContain('end_conversation');
    });

    it('toToolDefinitions returns correct shape for each declaration', () => {
        const tools = AIFunctions.toToolDefinitions();
        expect(tools.length).toBe(Object.keys(AIFunctions.declarations).length);
        for (const tool of tools) {
            expect(tool.type).toBe('function');
            expect(tool.function.name).toBeTruthy();
            expect(tool.function.description).toBeTruthy();
        }
    });

    it('each declaration has required fields', () => {
        for (const [, decl] of Object.entries(AIFunctions.declarations)) {
            expect(decl.name).toBeTruthy();
            expect(decl.description).toBeTruthy();
            expect(decl.parameters.type).toBe(SchemaType.OBJECT);
        }
    });
});

describe('AIFunctions implementations', () => {
    describe('get_server_info', () => {
        it('returns server info with expected keys', async () => {
            const info = await AIFunctions.implementations.get_server_info({});
            expect(typeof info.uptime).toBe('number');
            expect(typeof info.nodeVersion).toBe('string');
            expect(typeof info.platform).toBe('string');
            expect(info.memory).toBeDefined();
            expect(typeof info.memory.totalMb).toBe('number');
            expect(typeof info.memory.freeMb).toBe('number');
            expect(typeof info.memory.heapUsedMb).toBe('number');
            expect(typeof info.cpuCores).toBe('number');
            expect(Array.isArray(info.loadAverage)).toBe(true);
        });

        it('returns a non-empty env field', async () => {
            const info = await AIFunctions.implementations.get_server_info({});
            expect(typeof info.env).toBe('string');
            expect(info.env.length).toBeGreaterThan(0);
        });
    });

    describe('calculate', () => {
        it('evaluates a simple addition', async () => {
            const result = await AIFunctions.implementations.calculate({ expression: '2 + 2' });
            expect(result.result).toBe(4);
        });

        it('evaluates operator precedence correctly', async () => {
            const result = await AIFunctions.implementations.calculate({ expression: '2 + 2 * 3' });
            expect(result.result).toBe(8);
        });

        it('evaluates a division expression', async () => {
            const result = await AIFunctions.implementations.calculate({ expression: '10 / 4' });
            expect(result.result).toBe(2.5);
        });

        it('returns error for invalid expression', async () => {
            const result = await AIFunctions.implementations.calculate({ expression: 'not_a_number + xyz' });
            expect(result.error).toBeTruthy();
        });

        it('handles power operator', async () => {
            const result = await AIFunctions.implementations.calculate({ expression: '2 ^ 10' });
            expect(result.result).toBe(1024);
        });
    });

    describe('analyze_sentiment', () => {
        it('detects positive sentiment', async () => {
            const result = await AIFunctions.implementations.analyze_sentiment({ text: 'This is great and amazing!' });
            expect(result.sentiment).toBe('positive');
            expect(result.confidence).toBeGreaterThan(0.5);
        });

        it('detects negative sentiment', async () => {
            const result = await AIFunctions.implementations.analyze_sentiment({ text: 'This is terrible and awful.' });
            expect(result.sentiment).toBe('negative');
            expect(result.confidence).toBeGreaterThan(0.5);
        });

        it('returns neutral for balanced text', async () => {
            const result = await AIFunctions.implementations.analyze_sentiment({ text: 'The weather is okay today.' });
            expect(result.sentiment).toBe('neutral');
            expect(result.confidence).toBe(0.5);
        });

        it('confidence does not exceed 0.99', async () => {
            const result = await AIFunctions.implementations.analyze_sentiment({
                text: 'good great excellent amazing wonderful love happy best perfect awesome'
            });
            expect(result.confidence).toBeLessThanOrEqual(0.99);
        });
    });

    describe('end_conversation', () => {
        it('returns ended true with the given reason', async () => {
            const result = await AIFunctions.implementations.end_conversation({ reason: 'User requested', sessionId: 'test-session' });
            expect(result.ended).toBe(true);
            expect(result.reason).toBe('User requested');
            expect(result.sessionId).toBe('test-session');
        });

        it('works without sessionId', async () => {
            const result = await AIFunctions.implementations.end_conversation({ reason: 'Done' });
            expect(result.ended).toBe(true);
            expect(result.sessionId).toBeUndefined();
        });
    });

    describe('fetch_url', () => {
        it('returns error when fetch fails', async () => {
            const result = await AIFunctions.implementations.fetch_url({ url: 'http://localhost:9999/nonexistent' });
            expect(result.error).toBeTruthy();
        });

        it('strips HTML tags from content', async () => {
            const mockFetch = jest.fn().mockResolvedValue({
                ok: true,
                text: async () => '<html><body><h1>Hello World</h1><p>Some text</p></body></html>'
            });
            const originalFetch = global.fetch;
            global.fetch = mockFetch as any;
            const result = await AIFunctions.implementations.fetch_url({ url: 'https://example.com' });
            global.fetch = originalFetch;
            expect(result.content).not.toContain('<html>');
            expect(result.content).toContain('Hello World');
        });

        it('returns error for non-ok HTTP response', async () => {
            const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
            const originalFetch = global.fetch;
            global.fetch = mockFetch as any;
            const result = await AIFunctions.implementations.fetch_url({ url: 'https://example.com/404' });
            global.fetch = originalFetch;
            expect(result.error).toBe('HTTP 404');
        });

        it('truncates content to 4000 chars', async () => {
            const longContent = 'a'.repeat(10000);
            const mockFetch = jest.fn().mockResolvedValue({
                ok: true,
                text: async () => longContent
            });
            const originalFetch = global.fetch;
            global.fetch = mockFetch as any;
            const result = await AIFunctions.implementations.fetch_url({ url: 'https://example.com' });
            global.fetch = originalFetch;
            expect(result.content.length).toBeLessThanOrEqual(4000);
        });
    });
});
