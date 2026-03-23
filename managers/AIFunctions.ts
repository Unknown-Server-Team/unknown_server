import { evaluate } from 'mathjs';
import os from 'os';

export enum SchemaType {
    OBJECT = 'object',
    STRING = 'string',
    NUMBER = 'number',
    INTEGER = 'integer',
    BOOLEAN = 'boolean',
    ARRAY = 'array'
}

export type FunctionDeclaration = {
    name: string;
    description: string;
    parameters: {
        type: SchemaType;
        properties: Record<string, any>;
        required?: string[];
    };
};

export type AIFunctionMap = Record<string, (args: any) => Promise<any>>;

const declarations: Record<string, FunctionDeclaration> = {
    get_server_info: {
        name: 'get_server_info',
        description: 'Get current server status including uptime, memory usage, CPU load, and environment.',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },
    calculate: {
        name: 'calculate',
        description: 'Evaluate a mathematical expression and return the result.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                expression: { type: SchemaType.STRING, description: 'Math expression to evaluate, e.g. "2 + 2 * 3"' }
            },
            required: ['expression']
        }
    },
    fetch_url: {
        name: 'fetch_url',
        description: 'Fetch the text content of a public URL.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'The URL to fetch.' }
            },
            required: ['url']
        }
    },
    analyze_sentiment: {
        name: 'analyze_sentiment',
        description: 'Perform basic sentiment analysis on a piece of text, returning positive/negative/neutral classification and a confidence score.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                text: { type: SchemaType.STRING, description: 'Text to analyze.' }
            },
            required: ['text']
        }
    },
    end_conversation: {
        name: 'end_conversation',
        description: 'End the current chat session and clear conversation history.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                reason: { type: SchemaType.STRING, description: 'Reason for ending the conversation.' }
            },
            required: ['reason']
        }
    }
};

const implementations: AIFunctionMap = {
    get_server_info: async () => {
        const mem = process.memoryUsage();
        return {
            uptime: process.uptime(),
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            cpuCores: os.cpus().length,
            loadAverage: os.loadavg(),
            memory: {
                totalMb: Math.round(os.totalmem() / 1024 / 1024),
                freeMb: Math.round(os.freemem() / 1024 / 1024),
                heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
                heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024)
            },
            env: process.env.NODE_ENV ?? 'development'
        };
    },

    calculate: async (args: { expression: string }) => {
        try {
            const result = evaluate(args.expression);
            return { result: typeof result === 'object' ? result.toString() : result };
        } catch (err: any) {
            return { error: err?.message ?? 'Invalid expression' };
        }
    },

    fetch_url: async (args: { url: string }) => {
        try {
            const resp = await fetch(args.url, { signal: AbortSignal.timeout(8000) });
            if (!resp.ok) return { error: `HTTP ${resp.status}` };
            const text = await resp.text();
            const cleaned = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            return { content: cleaned.slice(0, 4000) };
        } catch (err: any) {
            return { error: err?.message ?? 'Fetch failed' };
        }
    },

    analyze_sentiment: async (args: { text: string }) => {
        const positive = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'love', 'happy', 'best', 'perfect', 'awesome'];
        const negative = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'poor', 'disappointing', 'useless', 'broken'];
        const lower = args.text.toLowerCase();
        const posCount = positive.filter(w => lower.includes(w)).length;
        const negCount = negative.filter(w => lower.includes(w)).length;
        if (posCount === negCount) return { sentiment: 'neutral', confidence: 0.5 };
        if (posCount > negCount) return { sentiment: 'positive', confidence: Math.min(0.5 + posCount * 0.1, 0.99) };
        return { sentiment: 'negative', confidence: Math.min(0.5 + negCount * 0.1, 0.99) };
    },

    end_conversation: async (args: { reason: string; sessionId?: string }) => {
        return { ended: true, reason: args.reason, sessionId: args.sessionId };
    }
};

const AIFunctions = {
    declarations,
    implementations,
    toToolDefinitions(): Array<{ type: 'function'; function: { name: string; description?: string; parameters?: any } }> {
        return Object.values(declarations).map(decl => ({
            type: 'function' as const,
            function: {
                name: decl.name,
                description: decl.description,
                parameters: decl.parameters
            }
        }));
    }
};

export default AIFunctions;
