import express, { Request, Response, Router } from 'express';
import AiManager from '../../../managers/AiManager';
import NVIDIAModelsManager from '../../../managers/NVIDIAModelsManager';
import AIFunctions from '../../../managers/AIFunctions';

const LogManager = require('../../../managers/LogManager');
const { RatelimitManager } = require('../../../managers/RatelimitManager');

const router: Router = express.Router();

let aiManager: AiManager | null = null;

const getAiManager = (): AiManager => {
    if (!aiManager) {
        const apiKey = process.env.NVIDIA_API_KEY;
        if (!apiKey) throw new Error('NVIDIA_API_KEY is not configured');
        aiManager = new AiManager({
            apiKey,
            rateLimit: 1000,
            maxMessages: parseInt(process.env.AI_RATE_LIMIT_MAX ?? '10'),
            rateLimitWindowMs: parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS ?? '30000'),
            systemInstruction: process.env.AI_SYSTEM_INSTRUCTION
        });
    }
    return aiManager;
};

router.use(RatelimitManager.createApiLimiter());

/**
 * @swagger
 * /api/v1/ai/chat:
 *   post:
 *     tags:
 *       - AI
 *     summary: Send a chat message
 *     description: Send a message to the AI and receive a response within a persistent session.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *               sessionId:
 *                 type: string
 *               executeTools:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: AI response
 *       400:
 *         description: Missing message
 *       429:
 *         description: Rate limited
 *       503:
 *         description: AI not configured
 */
router.post('/chat', async (req: Request, res: Response) => {
    const { message, sessionId, executeTools = true } = req.body;
    if (!message?.trim()) {
        return res.status(400).json({ error: true, message: 'message is required' });
    }

    let manager: AiManager;
    try {
        manager = getAiManager();
    } catch {
        return res.status(503).json({ error: true, message: 'AI service is not configured. Set NVIDIA_API_KEY.' });
    }

    const sid = sessionId ?? req.ip ?? 'default';
    try {
        const response = await manager.GetResponse(sid, message);
        if (response.text === 'Too many requests. Please wait a moment before sending another message.') {
            return res.status(429).json({ error: true, message: response.text });
        }

        const result: Record<string, any> = { sessionId: sid, text: response.text };

        if (executeTools && response.toolCalls?.length) {
            const toolResults: Array<{ name: string; result: any }> = [];
            let finalText = response.text;
            for (const call of response.toolCalls) {
                const toolResponse = await manager.ExecuteFunction(sid, call.name, call.args);
                toolResults.push({ name: call.name, result: toolResponse.text });
                if (toolResponse.text) finalText = toolResponse.text;
            }
            result.text = finalText;
            result.toolsExecuted = toolResults;
        } else if (response.toolCalls?.length) {
            result.toolCalls = response.toolCalls;
        }

        return res.json(result);
    } catch (err: any) {
        LogManager.error('AI chat error', err);
        return res.status(500).json({ error: true, message: 'AI request failed' });
    }
});

/**
 * @swagger
 * /api/v1/ai/single:
 *   post:
 *     tags:
 *       - AI
 *     summary: Single-shot AI response
 *     description: Get a one-off AI response without session context.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *               task:
 *                 type: string
 *                 enum: [chat, reasoning, math, programming]
 *     responses:
 *       200:
 *         description: AI response
 *       400:
 *         description: Missing message
 *       503:
 *         description: AI not configured
 */
router.post('/single', async (req: Request, res: Response) => {
    const { message, task = 'chat' } = req.body;
    if (!message?.trim()) {
        return res.status(400).json({ error: true, message: 'message is required' });
    }

    let manager: AiManager;
    try {
        manager = getAiManager();
    } catch {
        return res.status(503).json({ error: true, message: 'AI service is not configured. Set NVIDIA_API_KEY.' });
    }

    try {
        const text = await manager.GetSingleResponse(message, task);
        return res.json({ text });
    } catch (err: any) {
        LogManager.error('AI single response error', err);
        return res.status(500).json({ error: true, message: 'AI request failed' });
    }
});

/**
 * @swagger
 * /api/v1/ai/safety:
 *   post:
 *     tags:
 *       - AI
 *     summary: Check content safety
 *     description: Check if a conversation is safe using NVIDIA NeMo Guardrails.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messages
 *             properties:
 *               messages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                     content:
 *                       type: string
 *               timeoutMs:
 *                 type: number
 *     responses:
 *       200:
 *         description: Safety check result
 *       400:
 *         description: Invalid input
 *       503:
 *         description: AI not configured
 */
router.post('/safety', async (req: Request, res: Response) => {
    const { messages, timeoutMs = 2000 } = req.body;
    if (!Array.isArray(messages) || !messages.length) {
        return res.status(400).json({ error: true, message: 'messages array is required' });
    }

    let manager: AiManager;
    try {
        manager = getAiManager();
    } catch {
        return res.status(503).json({ error: true, message: 'AI service is not configured. Set NVIDIA_API_KEY.' });
    }

    try {
        const result = await manager.CheckSafety(messages, timeoutMs);
        return res.json(result);
    } catch (err: any) {
        LogManager.error('AI safety check error', err);
        return res.status(500).json({ error: true, message: 'Safety check failed' });
    }
});

/**
 * @swagger
 * /api/v1/ai/vision:
 *   post:
 *     tags:
 *       - AI
 *     summary: Describe an image
 *     description: Get a detailed description of an image from a URL.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - imageUrl
 *             properties:
 *               imageUrl:
 *                 type: string
 *               language:
 *                 type: string
 *               timeoutMs:
 *                 type: number
 *     responses:
 *       200:
 *         description: Image description
 *       400:
 *         description: Missing imageUrl
 *       503:
 *         description: AI not configured
 */
router.post('/vision', async (req: Request, res: Response) => {
    const { imageUrl, language = 'en', timeoutMs = 30000 } = req.body;
    if (!imageUrl?.trim()) {
        return res.status(400).json({ error: true, message: 'imageUrl is required' });
    }

    let manager: AiManager;
    try {
        manager = getAiManager();
    } catch {
        return res.status(503).json({ error: true, message: 'AI service is not configured. Set NVIDIA_API_KEY.' });
    }

    try {
        const description = await manager.DescribeImage(imageUrl, language, timeoutMs);
        return res.json({ description });
    } catch (err: any) {
        LogManager.error('AI vision error', err);
        return res.status(500).json({ error: true, message: 'Vision request failed' });
    }
});

/**
 * @swagger
 * /api/v1/ai/tts:
 *   post:
 *     tags:
 *       - AI
 *     summary: Text to speech
 *     description: Convert text to speech audio using NVIDIA Riva. Requires NVIDIA_TTS_FUNCTION_ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *             properties:
 *               text:
 *                 type: string
 *               voice:
 *                 type: string
 *               languageCode:
 *                 type: string
 *               timeoutMs:
 *                 type: number
 *     responses:
 *       200:
 *         description: Audio data (PCM WAV)
 *       400:
 *         description: Missing text
 *       503:
 *         description: AI not configured or TTS not available
 */
router.post('/tts', async (req: Request, res: Response) => {
    const { text, voice, languageCode = 'en-US', timeoutMs = 15000 } = req.body;
    if (!text?.trim()) {
        return res.status(400).json({ error: true, message: 'text is required' });
    }
    if (!process.env.NVIDIA_TTS_FUNCTION_ID) {
        return res.status(503).json({ error: true, message: 'TTS not configured. Set NVIDIA_TTS_FUNCTION_ID.' });
    }

    let manager: AiManager;
    try {
        manager = getAiManager();
    } catch {
        return res.status(503).json({ error: true, message: 'AI service is not configured. Set NVIDIA_API_KEY.' });
    }

    try {
        const audioBuffer = await manager.TextToSpeech(text, voice, languageCode, timeoutMs);
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', audioBuffer.length.toString());
        return res.send(audioBuffer);
    } catch (err: any) {
        LogManager.error('AI TTS error', err);
        return res.status(500).json({ error: true, message: 'TTS request failed' });
    }
});

/**
 * @swagger
 * /api/v1/ai/stt:
 *   post:
 *     tags:
 *       - AI
 *     summary: Speech to text
 *     description: Transcribe audio to text using NVIDIA Riva. Requires NVIDIA_STT_FUNCTION_ID and audio upload.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *               timeoutMs:
 *                 type: number
 *     responses:
 *       200:
 *         description: Transcription result
 *       400:
 *         description: Missing audio file
 *       503:
 *         description: AI not configured or STT not available
 */
router.post('/stt', async (req: Request, res: Response) => {
    if (!process.env.NVIDIA_STT_FUNCTION_ID) {
        return res.status(503).json({ error: true, message: 'STT not configured. Set NVIDIA_STT_FUNCTION_ID.' });
    }

    let manager: AiManager;
    try {
        manager = getAiManager();
    } catch {
        return res.status(503).json({ error: true, message: 'AI service is not configured. Set NVIDIA_API_KEY.' });
    }

    const files = (req as any).files;
    const audio = files?.audio;
    if (!audio) {
        return res.status(400).json({ error: true, message: 'audio file is required' });
    }

    try {
        const audioBuffer = Buffer.isBuffer(audio.data) ? audio.data : Buffer.from(audio.data);
        const timeoutMs = parseInt(req.body.timeoutMs ?? '15000');
        const transcript = await manager.SpeechToText(audioBuffer, timeoutMs);
        return res.json({ transcript });
    } catch (err: any) {
        LogManager.error('AI STT error', err);
        return res.status(500).json({ error: true, message: 'STT request failed' });
    }
});

/**
 * @swagger
 * /api/v1/ai/session/{sessionId}:
 *   delete:
 *     tags:
 *       - AI
 *     summary: Clear a chat session
 *     description: Delete a chat session and its conversation history.
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session cleared
 *       503:
 *         description: AI not configured
 */
router.delete('/session/:sessionId', async (req: Request, res: Response) => {
    let manager: AiManager;
    try {
        manager = getAiManager();
    } catch {
        return res.status(503).json({ error: true, message: 'AI service is not configured. Set NVIDIA_API_KEY.' });
    }

    await manager.ClearSession(String(req.params.sessionId));
    return res.json({ cleared: true, sessionId: req.params.sessionId });
});

/**
 * @swagger
 * /api/v1/ai/models:
 *   get:
 *     tags:
 *       - AI
 *     summary: List available AI models
 *     description: Returns the list of available NVIDIA NIM models and task mappings.
 *     responses:
 *       200:
 *         description: Available models
 */
router.get('/models', (_req: Request, res: Response) => {
    res.json({
        models: {
            chat: 'deepseek-ai/deepseek-v3.1-terminus',
            reasoning: 'deepseek-ai/deepseek-v3.2',
            math: 'qwen/qwq-32b',
            programming: 'minimaxai/minimax-m2.1',
            safety: 'nvidia/llama-3.1-nemoguard-8b-content-safety',
            vision: 'meta/llama-4-maverick-17b-128e-instruct'
        }
    });
});

/**
 * @swagger
 * /api/v1/ai/voices:
 *   get:
 *     tags:
 *       - AI
 *     summary: List available TTS voices
 *     description: Returns available NVIDIA Riva TTS voices grouped by language.
 *     responses:
 *       200:
 *         description: Available voices
 */
router.get('/voices', (_req: Request, res: Response) => {
    let manager: AiManager;
    try {
        manager = getAiManager();
    } catch {
        const nm = new NVIDIAModelsManager('');
        return res.json({ voices: nm.GetAvailableVoices() });
    }
    return res.json({ voices: manager.GetAvailableVoices() });
});

/**
 * @swagger
 * /api/v1/ai/functions:
 *   get:
 *     tags:
 *       - AI
 *     summary: List available AI tool functions
 *     description: Returns the list of AI tool function declarations.
 *     responses:
 *       200:
 *         description: Available functions
 */
router.get('/functions', (_req: Request, res: Response) => {
    res.json({ functions: Object.values(AIFunctions.declarations) });
});

/**
 * @swagger
 * /api/v1/ai/status:
 *   get:
 *     tags:
 *       - AI
 *     summary: Get AI service status
 *     description: Returns whether the AI service is configured and available.
 *     responses:
 *       200:
 *         description: AI service status
 */
router.get('/status', (_req: Request, res: Response) => {
    const configured = Boolean(process.env.NVIDIA_API_KEY);
    res.json({
        configured,
        ttsAvailable: configured && Boolean(process.env.NVIDIA_TTS_FUNCTION_ID),
        sttAvailable: configured && Boolean(process.env.NVIDIA_STT_FUNCTION_ID),
        activeSessions: configured && aiManager ? aiManager.getActiveSessionCount() : 0
    });
});

export = router;
