/**
 * Vertex AI (Generative AI) Client for Chat Bot Creation
 *
 * Provides generative AI capabilities via Google Vertex AI for
 * creating event chat bots that can answer questions about events,
 * schedules, venues, and community rituals.
 *
 * Uses the Gemini model family through the Vertex AI API with
 * service account authentication from google/auth.ts.
 *
 * @module cloud/vertexai
 */

import { getGoogleAccessToken, type GoogleServiceAccountEnv } from '../google/auth';
import { getProjectId, getRegion, getVertexAiBaseUrl, type CloudEnv } from './config';

// =============================================================================
// Constants
// =============================================================================

/** Default model for chat generation */
const DEFAULT_MODEL_ID = 'gemini-2.0-flash';

/** Request timeout for generation (30 seconds — LLM can be slow) */
const VERTEX_AI_TIMEOUT_MS = 30000;

/** Maximum input tokens to send */
const MAX_INPUT_CHARS = 8000;

/** System instruction for the event chat bot */
const EVENT_BOT_SYSTEM_INSTRUCTION =
  'You are a helpful community events assistant for ourCommunityRituals. ' +
  'You help people find information about upcoming events, schedules, venues, ' +
  'and community activities. Be friendly, concise, and accurate. ' +
  'If you do not know something, say so honestly. ' +
  'Never make up event details — only reference information provided to you.';

// =============================================================================
// Error Codes
// =============================================================================

export const VERTEX_AI_ERROR_CODES = {
  GENERATION_FAILED: 'VERTEX_AI_GENERATION_FAILED',
  NOT_CONFIGURED: 'VERTEX_AI_NOT_CONFIGURED',
  INPUT_TOO_LONG: 'VERTEX_AI_INPUT_TOO_LONG',
  SAFETY_BLOCKED: 'VERTEX_AI_SAFETY_BLOCKED',
} as const;

export type VertexAiErrorCode = typeof VERTEX_AI_ERROR_CODES[keyof typeof VERTEX_AI_ERROR_CODES];

// =============================================================================
// Types
// =============================================================================

export interface VertexAiEnv extends GoogleServiceAccountEnv, CloudEnv {}

export class VertexAiError extends Error {
  readonly code: VertexAiErrorCode;
  readonly googleStatus?: number;

  constructor(code: VertexAiErrorCode, message: string, googleStatus?: number) {
    super(message);
    this.name = 'VertexAiError';
    this.code = code;
    this.googleStatus = googleStatus;
  }
}

/** A single message in a chat conversation */
export interface ChatMessage {
  /** Role: 'user' or 'model' */
  role: 'user' | 'model';
  /** Message text content */
  text: string;
}

/** Configuration for text generation */
export interface GenerationConfig {
  /** Maximum output tokens (default: 1024) */
  maxOutputTokens?: number;
  /** Temperature for randomness (0.0-1.0, default: 0.7) */
  temperature?: number;
  /** Top-p sampling (default: 0.95) */
  topP?: number;
  /** Top-k sampling (default: 40) */
  topK?: number;
}

/** Result from a generation request */
export interface GenerationResult {
  /** Generated text response */
  text: string;
  /** Whether the response was blocked by safety filters */
  blocked: boolean;
  /** Finish reason from the model */
  finishReason: string;
  /** Token usage metadata */
  usage?: {
    promptTokens: number;
    candidateTokens: number;
    totalTokens: number;
  };
}

/** Chat bot context with event data */
export interface EventBotContext {
  /** Event name */
  eventName?: string;
  /** Event date */
  eventDate?: string;
  /** Venue name and address */
  venue?: string;
  /** Schedule items */
  schedule?: string[];
  /** Sponsor names */
  sponsors?: string[];
  /** Additional context */
  additionalInfo?: string;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if Vertex AI is configured
 */
export function isVertexAiConfigured(env: VertexAiEnv): boolean {
  return !!(env.GOOGLE_SA_CLIENT_EMAIL && env.GOOGLE_SA_PRIVATE_KEY_PEM);
}

/**
 * Get the effective model ID
 */
function getModelId(env: VertexAiEnv): string {
  return env.VERTEX_AI_MODEL_ID || DEFAULT_MODEL_ID;
}

/**
 * Generate text from a prompt using Vertex AI
 *
 * @param env - Worker environment with Google credentials
 * @param prompt - Text prompt for generation
 * @param config - Optional generation configuration
 * @returns Generation result with text response
 * @throws {VertexAiError} If generation fails
 */
export async function generateText(
  env: VertexAiEnv,
  prompt: string,
  config?: GenerationConfig
): Promise<GenerationResult> {
  if (!isVertexAiConfigured(env)) {
    throw new VertexAiError(
      VERTEX_AI_ERROR_CODES.NOT_CONFIGURED,
      'Vertex AI credentials not configured'
    );
  }

  if (prompt.length > MAX_INPUT_CHARS) {
    throw new VertexAiError(
      VERTEX_AI_ERROR_CODES.INPUT_TOO_LONG,
      `Input length ${prompt.length} exceeds maximum of ${MAX_INPUT_CHARS} characters`
    );
  }

  return callVertexAi(env, [{ role: 'user', text: prompt }], undefined, config);
}

/**
 * Generate a chat response with conversation history
 *
 * Used for multi-turn event chat bot conversations.
 *
 * @param env - Worker environment with Google credentials
 * @param messages - Conversation history (user/model alternating)
 * @param systemInstruction - Optional system instruction override
 * @param config - Optional generation configuration
 * @returns Generation result with text response
 * @throws {VertexAiError} If generation fails
 */
export async function chat(
  env: VertexAiEnv,
  messages: ChatMessage[],
  systemInstruction?: string,
  config?: GenerationConfig
): Promise<GenerationResult> {
  if (!isVertexAiConfigured(env)) {
    throw new VertexAiError(
      VERTEX_AI_ERROR_CODES.NOT_CONFIGURED,
      'Vertex AI credentials not configured'
    );
  }

  return callVertexAi(env, messages, systemInstruction, config);
}

/**
 * Create an event-aware chat bot response
 *
 * Generates a response using event context data so the bot
 * can answer questions about a specific event accurately.
 *
 * @param env - Worker environment
 * @param userMessage - User's question
 * @param context - Event context data
 * @param history - Previous conversation messages
 * @returns Chat bot response
 */
export async function eventBotRespond(
  env: VertexAiEnv,
  userMessage: string,
  context: EventBotContext,
  history: ChatMessage[] = []
): Promise<GenerationResult> {
  // Build context block for the system instruction
  const contextParts: string[] = [EVENT_BOT_SYSTEM_INSTRUCTION, ''];

  if (context.eventName) {
    contextParts.push(`Current Event: ${context.eventName}`);
  }
  if (context.eventDate) {
    contextParts.push(`Date: ${context.eventDate}`);
  }
  if (context.venue) {
    contextParts.push(`Venue: ${context.venue}`);
  }
  if (context.schedule && context.schedule.length > 0) {
    contextParts.push(`Schedule: ${context.schedule.join(', ')}`);
  }
  if (context.sponsors && context.sponsors.length > 0) {
    contextParts.push(`Sponsors: ${context.sponsors.join(', ')}`);
  }
  if (context.additionalInfo) {
    contextParts.push(`Additional Info: ${context.additionalInfo}`);
  }

  const systemInstruction = contextParts.join('\n');

  const messages: ChatMessage[] = [
    ...history,
    { role: 'user', text: userMessage },
  ];

  return chat(env, messages, systemInstruction, {
    maxOutputTokens: 512,
    temperature: 0.7,
  });
}

// =============================================================================
// Internal
// =============================================================================

/**
 * Make a Vertex AI generateContent API call
 */
async function callVertexAi(
  env: VertexAiEnv,
  messages: ChatMessage[],
  systemInstruction?: string,
  config?: GenerationConfig
): Promise<GenerationResult> {
  const tokenResult = await getGoogleAccessToken(env);
  const projectId = getProjectId(env);
  const region = getRegion(env);
  const modelId = getModelId(env);
  const baseUrl = getVertexAiBaseUrl(env);

  const url = `${baseUrl}/projects/${projectId}/locations/${region}/publishers/google/models/${modelId}:generateContent`;

  // Build request body
  const contents = messages.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: config?.maxOutputTokens ?? 1024,
      temperature: config?.temperature ?? 0.7,
      topP: config?.topP ?? 0.95,
      topK: config?.topK ?? 40,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VERTEX_AI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenResult.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new VertexAiError(
        VERTEX_AI_ERROR_CODES.GENERATION_FAILED,
        `Vertex AI generation failed: HTTP ${response.status}`,
        response.status
      );
    }

    interface VertexResponse {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    }

    const data = await response.json() as VertexResponse;

    // Check for safety blocks
    if (data.promptFeedback?.blockReason) {
      throw new VertexAiError(
        VERTEX_AI_ERROR_CODES.SAFETY_BLOCKED,
        `Generation blocked: ${data.promptFeedback.blockReason}`
      );
    }

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';
    const finishReason = candidate?.finishReason || 'UNKNOWN';

    return {
      text,
      blocked: finishReason === 'SAFETY',
      finishReason,
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount || 0,
            candidateTokens: data.usageMetadata.candidatesTokenCount || 0,
            totalTokens: data.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof VertexAiError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new VertexAiError(
        VERTEX_AI_ERROR_CODES.GENERATION_FAILED,
        `Vertex AI request timed out after ${VERTEX_AI_TIMEOUT_MS}ms`
      );
    }

    throw new VertexAiError(
      VERTEX_AI_ERROR_CODES.GENERATION_FAILED,
      'Vertex AI network error'
    );
  }
}
