import EventEmitter from 'events';
import NVIDIAModelsManager, { type NIMChatSession, type NIMToolCall } from './NVIDIAModelsManager';
import AIFunctions from './AIFunctions';

export interface AiRateLimit {
    id: string;
    messages: number;
    time: number;
}

export interface AiManagerOptions {
    apiKey: string;
    rateLimit?: number;
    maxMessages?: number;
    rateLimitWindowMs?: number;
    systemInstruction?: string;
}

export type AiResponse = {
    text: string;
    toolCalls?: NIMToolCall[];
};

const DEFAULT_SYSTEM = 'You are a helpful assistant integrated into an API server. Always respond clearly and concisely. When using tools, always follow up with a human-readable message after the tool result. Never emit raw tool call markup in plain text.';

class AiManager extends EventEmitter {
    private nvidiaModels: NVIDIAModelsManager;
    private chats: Map<string, NIMChatSession> = new Map();
    private bootstrapped: Set<string> = new Set();
    private ratelimits: Map<string, AiRateLimit> = new Map();
    private rateWindow: number;
    private rateMax: number;
    private rateTimeout: number;
    private systemInstruction: string;

    constructor(options: AiManagerOptions) {
        super();
        this.nvidiaModels = new NVIDIAModelsManager(options.apiKey);
        this.rateWindow = options.rateLimit ?? 1000;
        this.rateMax = options.maxMessages ?? 5;
        this.rateTimeout = options.rateLimitWindowMs ?? 10000;
        this.systemInstruction = options.systemInstruction ?? DEFAULT_SYSTEM;
        setInterval(() => this.clearExpiredRatelimits(), 5000);
    }

    public isRatelimited(id: string): boolean {
        const existing = this.ratelimits.get(id);
        if (!existing) {
            this.ratelimits.set(id, { id, messages: 1, time: Date.now() });
            return false;
        }
        if (Date.now() - existing.time > this.rateTimeout) {
            existing.time = Date.now();
            existing.messages = 1;
            return false;
        }
        existing.messages++;
        return existing.messages > this.rateMax;
    }

    public resetRateLimit(id: string): void {
        this.ratelimits.delete(id);
    }

    private clearExpiredRatelimits(): void {
        const now = Date.now();
        for (const [id, rl] of this.ratelimits) {
            if (now - rl.time > this.rateTimeout) this.ratelimits.delete(id);
        }
    }

    private getOrCreateChat(sessionId: string): NIMChatSession {
        if (!this.chats.has(sessionId)) {
            this.chats.set(sessionId, this.nvidiaModels.CreateChatSession({
                tools: AIFunctions.toToolDefinitions(),
                maxTokens: 800,
                temperature: 0.7,
                topP: 0.8,
                systemInstruction: this.systemInstruction
            }));
        }
        return this.chats.get(sessionId)!;
    }

    private async ensureBootstrapped(sessionId: string, chat: NIMChatSession): Promise<void> {
        if (this.bootstrapped.has(sessionId)) return;
        this.bootstrapped.add(sessionId);

        const serverInfo = await AIFunctions.implementations.get_server_info({});
        if (typeof chat.primeTools === 'function') {
            chat.primeTools([{ name: 'get_server_info', result: serverInfo, args: {} }]);
        }
    }

    public async GetResponse(sessionId: string, text: string): Promise<AiResponse> {
        if (this.isRatelimited(sessionId)) {
            return { text: 'Too many requests. Please wait a moment before sending another message.' };
        }
        const chat = this.getOrCreateChat(sessionId);
        await this.ensureBootstrapped(sessionId, chat);
        const result = await chat.sendMessage(text);
        const toolCalls = result.response.functionCalls() ?? [];
        return { text: result.response.text(), toolCalls: toolCalls.length ? toolCalls : undefined };
    }

    public async GetSingleResponse(text: string, task = 'chat'): Promise<string> {
        const result = await this.nvidiaModels.GetModelChatResponse(
            [{ role: 'user', content: text }],
            20000,
            task,
            false
        );
        return result.content;
    }

    public async ExecuteFunction(
        sessionId: string,
        name: string,
        args: any
    ): Promise<AiResponse> {
        if (this.isRatelimited(sessionId)) {
            return { text: 'Too many requests. Please wait a moment before sending another message.' };
        }

        const chat = this.getOrCreateChat(sessionId);
        const func = AIFunctions.implementations[name];

        let rawResult: any;
        if (!func) {
            const rsp = await chat.sendMessage([{
                functionResponse: { name, response: { result: { error: 'Unknown function' } } }
            }]);
            const followup = rsp.response.functionCalls() ?? [];
            if (followup.length) {
                let last: AiResponse = { text: '' };
                for (const call of followup) {
                    last = await this.ExecuteFunction(sessionId, call.name, call.args);
                }
                return last;
            }
            return { text: rsp.response.text() };
        }

        try {
            rawResult = await func({ ...args, sessionId });
        } catch (err: any) {
            rawResult = { error: err?.message ?? String(err) };
        }

        if (name === 'end_conversation') {
            await this.ClearSession(sessionId);
        }

        const rsp = await chat.sendMessage([{
            functionResponse: { name, response: { result: rawResult } }
        }]);

        const followup = rsp.response.functionCalls() ?? [];
        if (followup.length) {
            let last: AiResponse = { text: '' };
            for (const call of followup) {
                last = await this.ExecuteFunction(sessionId, call.name, call.args);
            }
            return last;
        }

        const text = rsp.response.text();
        if (!text.trim()) {
            chat.addSystemMessage?.('You did not return a valid response after tool execution. Always provide a user-facing message.');
            const retry = await chat.sendMessage('Summarize the result of the last tool call for the user in one sentence.');
            const retryText = retry.response.text();
            return { text: retryText || 'Tool executed successfully.' };
        }

        return { text };
    }

    public async CheckSafety(
        messages: Array<{ role: string; content: string }>,
        timeoutMs = 2000
    ): Promise<{ safe: boolean; reason?: string }> {
        return this.nvidiaModels.GetConversationSafety(
            messages as any,
            timeoutMs
        );
    }

    public async DescribeImage(imageUrl: string, language = 'en', timeoutMs = 30000): Promise<string> {
        return this.nvidiaModels.GetVisualDescription(imageUrl, language, timeoutMs);
    }

    public async TextToSpeech(
        text: string,
        voice?: string,
        languageCode?: string,
        timeoutMs = 15000
    ): Promise<Buffer> {
        return this.nvidiaModels.GetTextToSpeech(text, voice, languageCode, timeoutMs);
    }

    public async SpeechToText(audioBuffer: Buffer, timeoutMs = 15000): Promise<string> {
        return this.nvidiaModels.GetSpeechToText(audioBuffer, timeoutMs);
    }

    public GetAvailableVoices(): Array<{ name: string; languageCode: string; description: string }> {
        return this.nvidiaModels.GetAvailableVoices();
    }

    public GetBestMaleVoice(languageCode: string): string | null {
        return this.nvidiaModels.GetBestMaleVoice(languageCode);
    }

    public async ClearSession(sessionId: string): Promise<void> {
        this.chats.delete(sessionId);
        this.bootstrapped.delete(sessionId);
    }

    public getActiveSessionCount(): number {
        return this.chats.size;
    }
}

export default AiManager;
