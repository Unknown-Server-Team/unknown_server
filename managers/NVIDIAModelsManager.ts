import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { promises as fs } from 'fs';
import sharp from 'sharp';

export type NIMToolCall = { name: string; args: any };
export type NIMChatResponse = { text: () => string; functionCalls: () => NIMToolCall[] | undefined };
export type NIMChatResult = { response: NIMChatResponse };
export type NIMChatMessage = ChatCompletionMessageParam;
export type NIMToolDefinition = {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: any;
    };
};
export type NIMChatSession = {
    sendMessage: (input: string | Array<{ functionResponse: { name: string; response: { result: any } } }>) => Promise<NIMChatResult>;
    primeTools?: (toolResults: Array<{ name: string; result: any; args?: any }>) => void;
    addSystemMessage?: (content: string) => void;
};

const stripThink = (text: string): string => {
    if (!text) return '';
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
};

class NIMChatSessionImpl implements NIMChatSession {
    private messages: NIMChatMessage[] = [];
    private lastToolCalls: Array<{ id: string; name: string }> = [];

    constructor(
        private openai: OpenAI,
        private model: string,
        private tools: NIMToolDefinition[] | undefined,
        private config: { max_tokens?: number; temperature?: number; top_p?: number; chat_template_kwargs?: any },
        systemInstruction?: string
    ) {
        if (systemInstruction) {
            this.messages.push({ role: 'system', content: systemInstruction });
        }
    }

    private parseArgs(value: string): any {
        try {
            return value ? JSON.parse(value) : {};
        } catch {
            return value;
        }
    }

    private createToolMessage(name: string, result: any): ChatCompletionMessageParam {
        const toolCallId = this.lastToolCalls.find(call => call.name === name)?.id;
        return {
            role: 'tool',
            tool_call_id: toolCallId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            content: JSON.stringify(result ?? {})
        } as ChatCompletionMessageParam;
    }

    public primeTools(toolResults: Array<{ name: string; result: any; args?: any }>): void {
        if (!toolResults.length) return;
        const toolCalls = toolResults.map(result => ({
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            type: 'function' as const,
            function: {
                name: result.name,
                arguments: JSON.stringify(result.args ?? {})
            }
        }));
        this.messages.push({ role: 'assistant', tool_calls: toolCalls } as ChatCompletionMessageParam);
        this.lastToolCalls = toolCalls.map(call => ({ id: call.id, name: call.function.name }));
        for (const toolResult of toolResults) {
            this.messages.push(this.createToolMessage(toolResult.name, toolResult.result));
        }
    }

    public addSystemMessage(content: string): void {
        if (!content?.trim()) return;
        this.messages.push({ role: 'system', content: content.trim() });
    }

    public async sendMessage(
        input: string | Array<{ functionResponse: { name: string; response: { result: any } } }>
    ): Promise<NIMChatResult> {
        if (typeof input === 'string') {
            this.messages.push({ role: 'user', content: input });
        } else if (Array.isArray(input)) {
            for (const item of input) {
                const name = item?.functionResponse?.name;
                if (!name) continue;
                this.messages.push(this.createToolMessage(name, item.functionResponse.response?.result));
            }
        }

        const response = await (this.openai.chat.completions.create as any)({
            model: this.model,
            messages: this.messages,
            tools: this.tools,
            tool_choice: this.tools?.length ? 'auto' : undefined,
            max_tokens: this.config.max_tokens,
            temperature: this.config.temperature,
            top_p: this.config.top_p,
            stream: false,
            ...(this.config.chat_template_kwargs && { chat_template_kwargs: this.config.chat_template_kwargs })
        });

        const message = response.choices[0]?.message as any;
        if (message) {
            this.messages.push(message as ChatCompletionMessageParam);
        }

        const toolCalls = Array.isArray(message?.tool_calls)
            ? message.tool_calls.map((call: any) => ({
                name: call.function?.name,
                args: this.parseArgs(call.function?.arguments ?? '')
            }))
            : undefined;

        this.lastToolCalls = Array.isArray(message?.tool_calls)
            ? message.tool_calls.map((call: any) => ({ id: call.id, name: call.function?.name }))
            : [];

        const text = stripThink(message?.content ?? '');
        return { response: { text: () => text, functionCalls: () => toolCalls } };
    }
}

const TASK_MODELS: Record<string, { name: string; hasReasoning: boolean; hasThinkMode: boolean }> = {
    chat: { name: 'deepseek-ai/deepseek-v3.1-terminus', hasReasoning: false, hasThinkMode: true },
    reasoning: { name: 'deepseek-ai/deepseek-v3.2', hasReasoning: true, hasThinkMode: false },
    math: { name: 'qwen/qwq-32b', hasReasoning: false, hasThinkMode: false },
    programming: { name: 'minimaxai/minimax-m2.1', hasReasoning: false, hasThinkMode: false },
    monitor_small: { name: 'meta/llama-3.1-8b-instruct', hasReasoning: false, hasThinkMode: false },
    monitor_large: { name: 'deepseek-ai/deepseek-v3.1-terminus', hasReasoning: false, hasThinkMode: true }
};

const TASK_CONFIGS: Record<string, { max_tokens: number; top_p: number; temperature: number }> = {
    chat: { max_tokens: 1024, top_p: 0.9, temperature: 0.7 },
    reasoning: { max_tokens: 2048, top_p: 0.9, temperature: 0.7 },
    math: { max_tokens: 4096, top_p: 0.95, temperature: 0.3 },
    programming: { max_tokens: 2048, top_p: 0.9, temperature: 0.35 },
    monitor_small: { max_tokens: 256, top_p: 0.8, temperature: 0.2 },
    monitor_large: { max_tokens: 1024, top_p: 0.9, temperature: 0.5 }
};

const TASK_ALIASES: Record<string, string> = {
    'general question': 'chat',
    general_question: 'chat',
    'general reasoning': 'reasoning',
    general_reasoning: 'reasoning',
    'math problem': 'math',
    math_problem: 'math',
    'programming help': 'programming',
    programming_help: 'programming'
};

const ASR_PROTO = `syntax = "proto3";
package nvidia.riva.asr;
service RivaSpeechRecognition {
  rpc Recognize(RecognizeRequest) returns (RecognizeResponse) {}
}
message RecognizeRequest {
  RecognitionConfig config = 1;
  bytes audio = 2;
}
message RecognizeResponse {
  repeated SpeechRecognitionResult results = 1;
}
message RecognitionConfig {
  AudioEncoding encoding = 1;
  int32 sample_rate_hertz = 2;
  string language_code = 3;
  int32 max_alternatives = 4;
  bool enable_automatic_punctuation = 10;
  string model = 13;
}
enum AudioEncoding {
  ENCODING_UNSPECIFIED = 0;
  LINEAR_PCM = 1;
  FLAC = 2;
  MULAW = 3;
  OGGOPUS = 4;
  ALAW = 20;
}
message SpeechRecognitionResult {
  repeated SpeechRecognitionAlternative alternatives = 1;
}
message SpeechRecognitionAlternative {
  string transcript = 1;
  float confidence = 2;
}`;

const TTS_PROTO = `syntax = "proto3";
package nvidia.riva.tts;
service RivaSpeechSynthesis {
  rpc Synthesize(SynthesizeSpeechRequest) returns (SynthesizeSpeechResponse) {}
}
message SynthesizeSpeechRequest {
  string text = 1;
  string language_code = 2;
  AudioEncoding encoding = 3;
  int32 sample_rate_hertz = 4;
  string voice_name = 5;
}
message SynthesizeSpeechResponse {
  bytes audio = 1;
}
enum AudioEncoding {
  ENCODING_UNSPECIFIED = 0;
  LINEAR_PCM = 1;
  FLAC = 2;
  MULAW = 3;
  OGGOPUS = 4;
  ALAW = 20;
}`;

class NVIDIAModelsManager {
    private openai: OpenAI;

    constructor(private apiKey: string) {
        this.openai = new OpenAI({ apiKey, baseURL: 'https://integrate.api.nvidia.com/v1' });
    }

    private normalizeTask(task: string | null | undefined): string {
        const normalized = String(task ?? '').trim().toLowerCase();
        return TASK_ALIASES[normalized] ?? (normalized || 'chat');
    }

    private getTaskModel(task: string): { name: string; hasReasoning: boolean; hasThinkMode: boolean } {
        return TASK_MODELS[task] ?? TASK_MODELS.chat;
    }

    private getTaskConfig(task: string): { max_tokens: number; top_p: number; temperature: number } {
        return TASK_CONFIGS[task] ?? TASK_CONFIGS.chat;
    }

    private async ensureProtoFile(filePath: string, content: string): Promise<void> {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        try {
            await fs.access(filePath);
        } catch {
            await fs.writeFile(filePath, content);
        }
    }

    private buildGrpcCredentials(functionId?: string): grpc.ChannelCredentials {
        const metadata = new grpc.Metadata();
        metadata.add('authorization', `Bearer ${this.apiKey}`);
        if (functionId) metadata.add('function-id', functionId);
        const ssl = grpc.credentials.createSsl();
        const callCreds = grpc.credentials.createFromMetadataGenerator((_params, cb) => cb(null, metadata));
        return grpc.credentials.combineChannelCredentials(ssl, callCreds);
    }

    public CreateChatSession(options: {
        tools?: NIMToolDefinition[];
        systemInstruction?: string;
        maxTokens?: number;
        temperature?: number;
        topP?: number;
        model?: string;
    } = {}): NIMChatSession {
        const model = options.model ?? 'deepseek-ai/deepseek-v3.1-terminus';
        return new NIMChatSessionImpl(
            this.openai,
            model,
            options.tools,
            {
                max_tokens: options.maxTokens ?? 800,
                temperature: options.temperature ?? 0.7,
                top_p: options.topP ?? 0.8,
                chat_template_kwargs: { thinking: false }
            },
            options.systemInstruction
        );
    }

    public async GetConversationSafety(
        messages: ChatCompletionMessageParam[],
        timeoutMs = 2000
    ): Promise<{ safe: boolean; reason?: string }> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
            const response = await (this.openai.chat.completions.create as any)(
                {
                    model: 'nvidia/llama-3.1-nemoguard-8b-content-safety',
                    messages,
                    stream: false
                },
                { signal: controller.signal }
            );
            clearTimeout(timer);
            const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}') as {
                'User Safety': string;
                'Safety Categories': string;
            };
            return {
                safe: parsed['User Safety'] === 'safe',
                reason: parsed['User Safety'] !== 'safe' ? parsed['Safety Categories'] : undefined
            };
        } catch {
            return { safe: true };
        }
    }

    public async GetModelChatResponse(
        messages: ChatCompletionMessageParam[],
        timeoutMs = 20000,
        task: string,
        think: boolean
    ): Promise<{ content: string; reasoning?: string }> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
            const normalizedTask = this.normalizeTask(task);
            const modelConfig = this.getTaskModel(normalizedTask);
            const taskConfig = this.getTaskConfig(normalizedTask);

            const response = await (this.openai.chat.completions.create as any)(
                {
                    model: modelConfig.name,
                    messages,
                    stream: false,
                    ...(modelConfig.hasThinkMode && { chat_template_kwargs: { thinking: think ?? false } }),
                    ...taskConfig
                },
                { signal: controller.signal }
            );
            clearTimeout(timer);
            const content = stripThink(response.choices[0]?.message?.content ?? '');
            const reasoning =
                modelConfig.hasReasoning
                    ? (response.choices[0]?.message as any)?.reasoning_content
                    : undefined;
            return { content, reasoning };
        } catch {
            return { content: '' };
        }
    }

    public async GetVisualDescription(
        imageUrl: string,
        language: string,
        timeoutMs = 30000
    ): Promise<string> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
        try {
            const imgResp = await fetch(imageUrl, { signal: controller.signal as any });
            if (!imgResp.ok) { clearTimeout(timer); return ''; }

            const buf = Buffer.from(await imgResp.arrayBuffer());
            const resized = await sharp(buf)
                .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
                .png({ quality: 100, compressionLevel: 4 })
                .toBuffer();

            const b64 = resized.toString('base64');
            const payload = {
                model: 'meta/llama-4-maverick-17b-128e-instruct',
                messages: [{
                    role: 'user',
                    content: `Describe this image in detail, including any text, UI elements, or content shown (use language: ${language}): <img src="data:image/png;base64,${b64}" />`
                }],
                max_tokens: 1024,
                temperature: 0.7,
                top_p: 0.9,
                stream: false
            };

            const resp = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: controller.signal as any
            });
            clearTimeout(timer);
            if (!resp.ok) return '';
            const json: any = await resp.json();
            return String(json?.choices?.[0]?.message?.content ?? '').trim() || 'No visual details detected.';
        } catch {
            clearTimeout(timer);
            return '';
        }
    }

    public async GetSpeechToText(
        audioBuffer: Buffer,
        timeoutMs = 15000,
        functionId?: string
    ): Promise<string> {
        const protoPath = path.join(__dirname, '..', 'protos', 'riva_asr.proto');
        await this.ensureProtoFile(protoPath, ASR_PROTO);

        const packageDef = protoLoader.loadSync(protoPath, {
            keepCase: true, longs: String, enums: String, defaults: true, oneofs: true
        });
        const descriptor = grpc.loadPackageDefinition(packageDef) as any;
        const client = new descriptor.nvidia.riva.asr.RivaSpeechRecognition(
            'grpc.nvcf.nvidia.com:443',
            this.buildGrpcCredentials(functionId ?? process.env.NVIDIA_STT_FUNCTION_ID)
        );

        return new Promise((resolve, reject) => {
            const deadline = new Date(Date.now() + timeoutMs);
            const request = {
                config: {
                    encoding: 'LINEAR_PCM',
                    sample_rate_hertz: 16000,
                    language_code: 'en-US',
                    max_alternatives: 1,
                    enable_automatic_punctuation: true
                },
                audio: audioBuffer
            };
            client.Recognize(request, { deadline }, (err: Error | null, resp: any) => {
                if (err) { reject(new Error(`STT failed: ${err.message}`)); return; }
                resolve(resp?.results?.[0]?.alternatives?.[0]?.transcript ?? '');
            });
        });
    }

    public async GetTextToSpeech(
        text: string,
        voice = 'Magpie-Multilingual.EN-US.Aria',
        languageCode = 'en-US',
        timeoutMs = 15000,
        functionId?: string
    ): Promise<Buffer> {
        const raw = (text ?? '').toString().trim();
        if (!raw) throw new Error('Empty text provided for TTS');

        const protoPath = path.join(__dirname, '..', 'protos', 'riva_tts.proto');
        await this.ensureProtoFile(protoPath, TTS_PROTO);

        const packageDef = protoLoader.loadSync(protoPath, {
            keepCase: true, longs: String, enums: String, defaults: true, oneofs: true
        });
        const descriptor = grpc.loadPackageDefinition(packageDef) as any;
        const credentials = this.buildGrpcCredentials(functionId ?? process.env.NVIDIA_TTS_FUNCTION_ID);
        const client = new descriptor.nvidia.riva.tts.RivaSpeechSynthesis('grpc.nvcf.nvidia.com:443', credentials);

        const MAX_CHARS = 1800;
        const chunks: string[] = [];
        let current = '';
        for (const sentence of raw.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+|\n+/g).filter(Boolean)) {
            if ((current + (current ? ' ' : '') + sentence).length <= MAX_CHARS) {
                current += (current ? ' ' : '') + sentence;
            } else if (sentence.length <= MAX_CHARS) {
                if (current) chunks.push(current);
                current = sentence;
            } else {
                for (const word of sentence.split(/\s+/g)) {
                    if ((current + (current ? ' ' : '') + word).length <= MAX_CHARS) {
                        current += (current ? ' ' : '') + word;
                    } else {
                        if (current) chunks.push(current);
                        current = word;
                    }
                }
            }
        }
        if (current) chunks.push(current);

        const synthOne = (part: string): Promise<Buffer> => new Promise((resolve, reject) => {
            const deadline = new Date(Date.now() + timeoutMs);
            client.Synthesize(
                { text: part, language_code: languageCode, encoding: 'LINEAR_PCM', sample_rate_hertz: 22050, voice_name: voice },
                { deadline },
                (err: Error | null, resp: any) => {
                    if (err) { reject(new Error(`TTS failed: ${err.message}`)); return; }
                    if (resp?.audio?.length) resolve(Buffer.from(resp.audio));
                    else reject(new Error('No audio data received'));
                }
            );
        });

        const parts: Buffer[] = [];
        for (const chunk of chunks) {
            if (chunk.trim()) parts.push(await synthOne(chunk.trim()));
        }
        if (!parts.length) throw new Error('TTS returned no audio');
        return Buffer.concat(parts as any);
    }

    public GetAvailableVoices(): Array<{ name: string; languageCode: string; description: string }> {
        return [
            { name: 'Magpie-Multilingual.EN-US.Aria', languageCode: 'en-US', description: 'English (US) - Female - Neutral (Default)' },
            { name: 'Magpie-Multilingual.EN-US.Aria.Happy', languageCode: 'en-US', description: 'English (US) - Female - Happy' },
            { name: 'Magpie-Multilingual.EN-US.Aria.Calm', languageCode: 'en-US', description: 'English (US) - Female - Calm' },
            { name: 'Magpie-Multilingual.EN-US.Aria.Sad', languageCode: 'en-US', description: 'English (US) - Female - Sad' },
            { name: 'Magpie-Multilingual.EN-US.Aria.Angry', languageCode: 'en-US', description: 'English (US) - Female - Angry' },
            { name: 'Magpie-Multilingual.EN-US.Mia', languageCode: 'en-US', description: 'English (US) - Female - Neutral' },
            { name: 'Magpie-Multilingual.EN-US.Mia.Happy', languageCode: 'en-US', description: 'English (US) - Female - Happy' },
            { name: 'Magpie-Multilingual.EN-US.Mia.Calm', languageCode: 'en-US', description: 'English (US) - Female - Calm' },
            { name: 'Magpie-Multilingual.EN-US.Jason', languageCode: 'en-US', description: 'English (US) - Male - Neutral' },
            { name: 'Magpie-Multilingual.EN-US.Jason.Happy', languageCode: 'en-US', description: 'English (US) - Male - Happy' },
            { name: 'Magpie-Multilingual.EN-US.Jason.Calm', languageCode: 'en-US', description: 'English (US) - Male - Calm' },
            { name: 'Magpie-Multilingual.EN-US.Leo', languageCode: 'en-US', description: 'English (US) - Male - Neutral' },
            { name: 'Magpie-Multilingual.EN-US.Leo.Happy', languageCode: 'en-US', description: 'English (US) - Male - Happy' },
            { name: 'Magpie-Multilingual.EN-US.Leo.Calm', languageCode: 'en-US', description: 'English (US) - Male - Calm' },
            { name: 'Magpie-Multilingual.ES-US.Diego', languageCode: 'es-US', description: 'Spanish (US) - Male' },
            { name: 'Magpie-Multilingual.ES-US.Isabela', languageCode: 'es-US', description: 'Spanish (US) - Female' },
            { name: 'Magpie-Multilingual.FR-FR.Pascal', languageCode: 'fr-FR', description: 'French - Male - Neutral' },
            { name: 'Magpie-Multilingual.FR-FR.Pascal.Happy', languageCode: 'fr-FR', description: 'French - Male - Happy' },
            { name: 'Magpie-Multilingual.FR-FR.Louise', languageCode: 'fr-FR', description: 'French - Female - Neutral' },
            { name: 'Magpie-Multilingual.FR-FR.Louise.Happy', languageCode: 'fr-FR', description: 'French - Female - Happy' },
            { name: 'Magpie-Multilingual.DE-DE.Aria', languageCode: 'de-DE', description: 'German - Female - Neutral' },
            { name: 'Magpie-Multilingual.DE-DE.Jason', languageCode: 'de-DE', description: 'German - Male - Neutral' },
            { name: 'Magpie-Multilingual.ZH-CN.Mia', languageCode: 'zh-CN', description: 'Chinese - Female' },
            { name: 'Magpie-Multilingual.ZH-CN.Diego', languageCode: 'zh-CN', description: 'Chinese - Male' }
        ];
    }

    public GetBestMaleVoice(languageCode: string): string | null {
        const maleVoices = this.GetAvailableVoices().filter(v =>
            v.languageCode === languageCode &&
            (v.description.includes('Male') || /Jason|Leo|Diego|Pascal/.test(v.name))
        );
        if (!maleVoices.length) return null;
        return maleVoices.find(v => v.name.includes('.Happy'))?.name
            ?? maleVoices.find(v => v.name.includes('.Neutral') || !v.name.includes('.'))?.name
            ?? maleVoices[0].name;
    }
}

export default NVIDIAModelsManager;
