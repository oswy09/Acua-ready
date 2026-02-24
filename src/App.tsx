/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import type { User } from '@supabase/supabase-js';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, 
  MessageSquare, 
  BookOpen, 
  Library,
  BarChart3,
  NotebookPen,
  BookmarkPlus,
  Send, 
  Trash2, 
  FileText, 
  Loader2,
  Volume2,
  Square,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  ClipboardCheck,
  GraduationCap,
  RefreshCw,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore - Vite specific import
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { cn } from './lib/utils';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { Message, Document, Exam, Question, ExamDifficulty, ExamPracticeMode } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const GEMINI_MODEL = "gemini-3-flash-preview";
const GROQ_MODEL = "llama-3.3-70b-versatile";

type AIProvider = 'gemini' | 'groq';

const AI_PROVIDER_OPTIONS: {
  id: AIProvider;
  label: string;
  description: string;
  badge?: string;
}[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    description: 'Recomendado para respuestas y generación estructurada.',
    badge: 'Recomendado'
  },
  {
    id: 'groq',
    label: 'Groq',
    description: 'Alternativa para horas de alta demanda.',
  }
];

const EXAM_PRACTICE_MODE_OPTIONS: {
  id: ExamPracticeMode;
  label: string;
  guidance: string;
}[] = [
  {
    id: 'mixto',
    label: 'Mixto integral',
    guidance: 'Combina General, Específica, por Área, Comportamental y Psicotécnica.'
  },
  {
    id: 'psicotecnico',
    label: 'Solo psicotécnico',
    guidance: 'Enfoque exclusivo en atención, lógica, concentración y razonamiento psicométrico.'
  }
];

const EXAM_DIFFICULTY_OPTIONS: {
  id: ExamDifficulty;
  label: string;
  guidance: string;
}[] = [
  {
    id: 'basico',
    label: 'Básico',
    guidance: 'Escenarios guiados, menor ambigüedad y pasos de razonamiento más directos.'
  },
  {
    id: 'intermedio',
    label: 'Intermedio',
    guidance: 'Casos con varios factores, distractores más cercanos y análisis comparativo.'
  },
  {
    id: 'avanzado',
    label: 'Avanzado',
    guidance: 'Casos complejos con ambigüedad realista, priorización, criterio técnico y juicio contextual.'
  }
];

type PreparationQuestion = Question & {
  optionLabels: string[];
};

type ExamHistoryItem = {
  id: string;
  date: Date;
  score: number;
  questionCount: number;
  difficultyLabel: string;
  sourceLabel: string;
};

type StudyRecommendation = {
  id: string;
  text: string;
  docId: string | null;
  docName: string;
};

type NoteItem = {
  id: string;
  content: string;
  source: 'chat' | 'pdf';
  createdAt: Date;
  docId?: string | null;
  docName?: string;
  page?: number;
};

type PersistedDocument = Omit<Document, 'uploadDate' | 'pdfData'> & {
  uploadDate: string;
  pdfDataBase64?: string;
};

type PersistedNoteItem = Omit<NoteItem, 'createdAt'> & {
  createdAt: string;
};

type PersistedExamHistoryItem = Omit<ExamHistoryItem, 'date'> & {
  date: string;
};

type PersistedAppState = {
  version: number;
  showLanding: boolean;
  aiProvider: AIProvider;
  activeTab: 'tutor' | 'library' | 'exam' | 'preparation' | 'stats' | 'notes';
  documents: PersistedDocument[];
  selectedDocId: string | null;
  messages: Message[];
  chatScope: 'all' | 'selected';
  chatDocId: string | null;
  currentExam: Exam | null;
  examQuestionCount: number;
  examDifficulty: ExamDifficulty;
  examPracticeMode: ExamPracticeMode;
  preparationQuestions: PreparationQuestion[];
  preparationQuestionCount: number;
  preparationDifficulty: ExamDifficulty;
  examScope: 'global' | 'selected';
  examDocId: string | null;
  examHistory: PersistedExamHistoryItem[];
  notes: PersistedNoteItem[];
};

const APP_STATE_VERSION = 1;
const APP_STATE_DB_NAME = 'acua-ready-db';
const APP_STATE_STORE = 'kv';
const APP_STATE_KEY = 'app-state';
const APP_STATE_LOCAL_STORAGE_KEY = 'acua-ready-app-state';

const bytesToBase64 = (bytes?: Uint8Array) => {
  if (!bytes || bytes.length === 0) return '';
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...Array.from(chunk));
  }

  return btoa(binary);
};

const base64ToBytes = (encoded?: string) => {
  if (!encoded) return undefined;
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const serializeDocuments = (documents: Document[]): PersistedDocument[] =>
  documents.map((doc) => ({
    ...doc,
    uploadDate: doc.uploadDate.toISOString(),
    pdfDataBase64: doc.pdfData ? bytesToBase64(doc.pdfData) : undefined,
  }));

const deserializeDocuments = (documents: PersistedDocument[]): Document[] =>
  documents.map((doc) => {
    const { pdfDataBase64, uploadDate, ...rest } = doc;
    return {
      ...rest,
      uploadDate: new Date(uploadDate),
      pdfData: base64ToBytes(pdfDataBase64),
    };
  });

const serializeNotes = (notes: NoteItem[]): PersistedNoteItem[] =>
  notes.map((note) => ({
    ...note,
    createdAt: note.createdAt.toISOString(),
  }));

const deserializeNotes = (notes: PersistedNoteItem[]): NoteItem[] =>
  notes.map((note) => ({
    ...note,
    createdAt: new Date(note.createdAt),
  }));

const serializeExamHistory = (history: ExamHistoryItem[]): PersistedExamHistoryItem[] =>
  history.map((item) => ({
    ...item,
    date: item.date.toISOString(),
  }));

const deserializeExamHistory = (history: PersistedExamHistoryItem[]): ExamHistoryItem[] =>
  history.map((item) => ({
    ...item,
    date: new Date(item.date),
  }));

const openAppStateDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB no disponible.'));
      return;
    }

    const request = window.indexedDB.open(APP_STATE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(APP_STATE_STORE)) {
        db.createObjectStore(APP_STATE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB.'));
  });

const savePersistedState = async (state: PersistedAppState) => {
  try {
    const db = await openAppStateDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(APP_STATE_STORE, 'readwrite');
      const store = tx.objectStore(APP_STATE_STORE);
      store.put(state, APP_STATE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Error guardando estado en IndexedDB.'));
    });
    db.close();
  } catch {
    localStorage.setItem(APP_STATE_LOCAL_STORAGE_KEY, JSON.stringify(state));
  }
};

const loadPersistedState = async (): Promise<PersistedAppState | null> => {
  try {
    const db = await openAppStateDb();
    const value = await new Promise<PersistedAppState | null>((resolve, reject) => {
      const tx = db.transaction(APP_STATE_STORE, 'readonly');
      const store = tx.objectStore(APP_STATE_STORE);
      const request = store.get(APP_STATE_KEY);
      request.onsuccess = () => resolve((request.result as PersistedAppState | undefined) ?? null);
      request.onerror = () => reject(request.error || new Error('Error leyendo estado de IndexedDB.'));
    });
    db.close();
    if (value) return value;
  } catch {
    // fallback a localStorage
  }

  const fallback = localStorage.getItem(APP_STATE_LOCAL_STORAGE_KEY);
  if (!fallback) return null;
  try {
    return JSON.parse(fallback) as PersistedAppState;
  } catch {
    return null;
  }
};

const SUPABASE_STATE_TABLE = 'user_app_state';

const saveCloudState = async (userId: string, state: PersistedAppState) => {
  if (!supabase || !isSupabaseConfigured) return;

  const { error } = await supabase
    .from(SUPABASE_STATE_TABLE)
    .upsert(
      {
        user_id: userId,
        state,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id',
      }
    );

  if (error) {
    throw error;
  }
};

const loadCloudState = async (userId: string): Promise<PersistedAppState | null> => {
  if (!supabase || !isSupabaseConfigured) return null;

  const { data, error } = await supabase
    .from(SUPABASE_STATE_TABLE)
    .select('state')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const state = data?.state as PersistedAppState | undefined;
  return state ?? null;
};

const buildReasoningStepsFromExplanation = (explanation: string) => {
  const pieces = explanation
    .split(/\.(\s+|$)/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== ' ');

  if (pieces.length >= 2) {
    return pieces.slice(0, 4).map((item) => item.endsWith('.') ? item : `${item}.`);
  }

  return [
    'Identifica la parte clave del enunciado y qué competencia está evaluando.',
    'Descarta opciones por inconsistencia con el contexto del documento o del caso.',
    'Compara las opciones restantes y elige la que mejor resuelve el escenario planteado.',
    explanation
  ];
};
const buildOptionFeedbackFallback = (options: string[], correctAnswer: number) =>
  options.map((_, index) =>
    index === correctAnswer
      ? 'Esta opción es correcta porque responde mejor al contexto y criterio evaluado en el enunciado.'
      : 'Esta opción es distractora porque no se alinea completamente con el contexto, criterio o prioridad del caso.'
  );

const buildOptionLabelsFallback = (options: string[], correctAnswer: number) =>
  options.map((_, index) => (index === correctAnswer ? 'Correcta' : 'Distractor'));

const clonePdfBytes = (bytes: Uint8Array) => new Uint8Array(bytes);

const getGeminiClient = () => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'PEGA_AQUI_TU_GEMINI_API_KEY') {
    throw new Error('Falta configurar VITE_GEMINI_API_KEY en .env con una clave real de Google AI Studio');
  }
  return new GoogleGenAI({ apiKey });
};

const getGroqApiKey = () => {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY?.trim();
  if (!apiKey || apiKey === 'PEGA_AQUI_TU_GROQ_API_KEY') {
    throw new Error('Falta configurar VITE_GROQ_API_KEY en .env con una clave real de Groq');
  }
  return apiKey;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseGeminiError = (error: any) => {
  const rawMessage = error?.message || '';
  const nestedError = error?.error;

  const parsedFromMessage = (() => {
    if (typeof rawMessage !== 'string') return null;
    const text = rawMessage.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();

  const payload = parsedFromMessage?.error || parsedFromMessage || nestedError || {};
  const code = Number(payload?.code ?? error?.code ?? NaN);
  const status = String(payload?.status ?? error?.status ?? '').toUpperCase();
  const message = String(payload?.message ?? rawMessage ?? '').trim();

  return {
    code: Number.isFinite(code) ? code : null,
    status,
    message,
    rawMessage,
  };
};

const isTransientGeminiError = (error: any) => {
  const parsed = parseGeminiError(error);
  if (parsed.code === 408 || parsed.code === 429 || parsed.code === 500 || parsed.code === 502 || parsed.code === 503 || parsed.code === 504 || parsed.code === 529) {
    return true;
  }
  if (parsed.status === 'UNAVAILABLE' || parsed.status === 'RESOURCE_EXHAUSTED' || parsed.status === 'DEADLINE_EXCEEDED' || parsed.status.includes('RATE_LIMIT')) {
    return true;
  }
  const text = `${parsed.message} ${parsed.rawMessage}`.toLowerCase();
  return text.includes('high demand') || text.includes('temporarily unavailable') || text.includes('try again later') || text.includes('rate limit') || text.includes('too many requests');
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError: any = new Error(`Tiempo de espera agotado tras ${Math.round(timeoutMs / 1000)}s.`);
          timeoutError.code = 408;
          timeoutError.status = 'DEADLINE_EXCEEDED';
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const extractRequestText = (request: any) => {
  if (typeof request?.contents === 'string') {
    return request.contents;
  }

  if (Array.isArray(request?.contents)) {
    return request.contents
      .map((item: any) => {
        if (typeof item?.content === 'string') return item.content;
        if (Array.isArray(item?.parts)) {
          return item.parts.map((part: any) => part?.text || '').join('\n');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  return '';
};

const buildGroqMessages = (request: any) => {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  const systemInstruction = request?.config?.systemInstruction;
  if (systemInstruction) {
    messages.push({ role: 'system', content: String(systemInstruction) });
  }

  if (typeof request?.contents === 'string') {
    messages.push({ role: 'user', content: request.contents });
    return messages;
  }

  if (Array.isArray(request?.contents)) {
    request.contents.forEach((item: any) => {
      const role = item?.role === 'model' ? 'assistant' : 'user';
      const content = Array.isArray(item?.parts)
        ? item.parts.map((part: any) => part?.text || '').join('\n')
        : (typeof item?.content === 'string' ? item.content : '');

      if (content.trim()) {
        messages.push({ role, content });
      }
    });
  }

  if (messages.length === 0) {
    messages.push({ role: 'user', content: extractRequestText(request) });
  }

  return messages;
};

const normalizeGroqJsonText = (text: string) => {
  const cleaned = (text || '').trim();
  if (!cleaned) return '[]';

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return JSON.stringify(parsed);
    }
    if (Array.isArray((parsed as any)?.questions)) {
      return JSON.stringify((parsed as any).questions);
    }
    return JSON.stringify([parsed]);
  } catch {
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return cleaned.slice(arrayStart, arrayEnd + 1);
    }
    return '[]';
  }
};

const generateWithGroq = async (request: any) => {
  const apiKey = getGroqApiKey();
  const messages = buildGroqMessages(request);
  const expectsJson = request?.config?.responseMimeType === 'application/json';

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: expectsJson ? 0.2 : 0.6,
      ...(expectsJson ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  const payload = await response.json().catch(() => ({} as any));

  if (!response.ok) {
    const err: any = new Error(payload?.error?.message || `Groq API error (${response.status})`);
    err.code = payload?.error?.code ?? response.status;
    err.status = String(payload?.error?.type || response.statusText || '').toUpperCase();
    err.error = payload?.error;
    throw err;
  }

  const text = payload?.choices?.[0]?.message?.content || '';
  return {
    text: expectsJson ? normalizeGroqJsonText(text) : text,
  };
};

const isMissingGroqKeyError = (error: any) => {
  const text = `${error?.message || ''} ${error?.rawMessage || ''}`.toLowerCase();
  return text.includes('falta configurar groq_api_key') || text.includes('groq_api_key');
};

const generateContentWithRetry = async (
  provider: AIProvider,
  request: any,
  maxAttempts = 3,
  requestTimeoutMs = 45000
) => {
  let lastError: any;

  const runAttempt = async (targetProvider: AIProvider) => {
    if (targetProvider === 'groq') {
      return await withTimeout(generateWithGroq(request), requestTimeoutMs);
    }

    const ai = getGeminiClient();
    return await withTimeout(ai.models.generateContent(request), requestTimeoutMs);
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runAttempt(provider);
    } catch (error: any) {
      lastError = error;
      if (provider === 'groq' && isMissingGroqKeyError(error)) {
        break;
      }
      if (!isTransientGeminiError(error) || attempt === maxAttempts) {
        break;
      }
      await sleep(500 * attempt);
    }
  }

  if (provider === 'groq' && isMissingGroqKeyError(lastError)) {
    for (let fallbackAttempt = 1; fallbackAttempt <= 2; fallbackAttempt++) {
      try {
        return await runAttempt('gemini');
      } catch (fallbackError: any) {
        lastError = fallbackError;
        if (!isTransientGeminiError(fallbackError) || fallbackAttempt === 2) {
          break;
        }
        await sleep(500 * fallbackAttempt);
      }
    }
  }

  if (provider === 'gemini' && isTransientGeminiError(lastError)) {
    const geminiFailure = lastError;
    for (let fallbackAttempt = 1; fallbackAttempt <= 2; fallbackAttempt++) {
      try {
        return await runAttempt('groq');
      } catch (fallbackError: any) {
        if (isMissingGroqKeyError(fallbackError)) {
          lastError = geminiFailure;
          break;
        }
        lastError = fallbackError;
        if (!isTransientGeminiError(fallbackError) || fallbackAttempt === 2) {
          break;
        }
        await sleep(500 * fallbackAttempt);
      }
    }
  }

  throw lastError;
};

const formatGeminiError = (error: any) => {
  const { code, status, message, rawMessage } = parseGeminiError(error);

  if (code === 503 || status === 'UNAVAILABLE') {
    return 'El modelo está con alta demanda en este momento. Reintenté automáticamente y aún no estuvo disponible; intenta de nuevo en unos segundos.';
  }

  if (code === 429 || status === 'RESOURCE_EXHAUSTED') {
    return 'Se alcanzó el límite temporal de solicitudes. Espera un momento y vuelve a intentar.';
  }

  if (status.includes('RATE_LIMIT')) {
    return 'El proveedor alternativo también está en límite temporal. Espera unos segundos y vuelve a intentar.';
  }

  if (code === 500 || code === 502 || code === 504) {
    return 'El servicio de IA tuvo un fallo temporal. Intenta nuevamente en unos segundos.';
  }

  if (code === 408 || status === 'DEADLINE_EXCEEDED') {
    return 'La generación tardó demasiado y se canceló para evitar bloqueo. Intenta de nuevo o reduce la cantidad de preguntas.';
  }

  if (rawMessage.includes('API_KEY_INVALID') || rawMessage.includes('API key not valid')) {
    return 'Tu VITE_GEMINI_API_KEY es inválida. Genera una nueva en Google AI Studio y actualiza .env.';
  }

  if (code === 401 || rawMessage.toLowerCase().includes('invalid api key') || rawMessage.toLowerCase().includes('authentication')) {
    return 'La clave del proveedor seleccionado es inválida o falta configuración. Revisa VITE_GEMINI_API_KEY o VITE_GROQ_API_KEY en .env.';
  }

  return message || rawMessage || 'Hubo un error al procesar tu solicitud.';
};

const shouldRetryExamWithReducedLoad = (error: any) => {
  const { code, status } = parseGeminiError(error);
  return code === 408 || code === 429 || code === 503 || status === 'DEADLINE_EXCEEDED' || status === 'RESOURCE_EXHAUSTED' || status === 'UNAVAILABLE';
};

const HEADING_REGEX = /^(cap[ií]tulo|cap\.|t[íi]tulo|secci[oó]n|tema|unidad|m[oó]dulo|art[íi]culo)\b/i;
const STOPWORDS = new Set(['para', 'como', 'esta', 'este', 'donde', 'sobre', 'desde', 'hasta', 'entre', 'porque', 'cuanto', 'cual', 'cuáles', 'qué', 'que', 'del', 'las', 'los', 'una', 'unos', 'unas', 'con', 'sin', 'por']);

const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const extractKeywords = (text: string) => {
  const words = normalizeText(text).split(/[^a-z0-9]+/g);
  return Array.from(
    new Set(words.filter((word) => word.length >= 4 && !STOPWORDS.has(word)))
  );
};

const detectDocumentReference = (content: string, query: string) => {
  const lines = content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const keywords = extractKeywords(query);
  if (keywords.length === 0) return null;

  let bestIndex = -1;
  let bestScore = 0;

  lines.forEach((line, index) => {
    const normalizedLine = normalizeText(line);
    const score = keywords.reduce((acc, keyword) => acc + (normalizedLine.includes(keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestIndex === -1 || bestScore === 0) return null;

  const startIndex = Math.max(0, bestIndex - 20);
  for (let i = bestIndex; i >= startIndex; i--) {
    if (HEADING_REGEX.test(lines[i])) {
      return lines[i];
    }
  }

  const fallbackLine = lines[bestIndex];
  return fallbackLine.length > 110 ? `${fallbackLine.slice(0, 107)}...` : fallbackLine;
};

const isHighDemandError = (error: any) => {
  const { code, status, message, rawMessage } = parseGeminiError(error);
  const text = `${message} ${rawMessage}`.toLowerCase();

  if (code === 408 || code === 429 || code === 500 || code === 502 || code === 503 || code === 504 || code === 529) {
    return true;
  }

  if (status === 'UNAVAILABLE' || status === 'RESOURCE_EXHAUSTED' || status === 'DEADLINE_EXCEEDED' || status.includes('RATE_LIMIT')) {
    return true;
  }

  return text.includes('rate limit') || text.includes('high demand') || text.includes('too many requests') || text.includes('temporarily unavailable');
};

const buildLocalFallbackResponse = (docs: Document[], query: string, preferredDocId: string | null) => {
  if (docs.length === 0) {
    return '⚠️ Hay alta demanda del servicio de IA y no encontré documentos para generar una respuesta local. Intenta de nuevo en unos segundos.';
  }

  const keywords = extractKeywords(query);
  const scoreDoc = (doc: Document) => {
    if (keywords.length === 0) return 0;
    const normalized = normalizeText(doc.content.slice(0, 25000));
    return keywords.reduce((acc, keyword) => acc + (normalized.includes(keyword) ? 1 : 0), 0);
  };

  const preferredDoc = docs.find((doc) => doc.id === preferredDocId) || null;
  const sourceDoc = preferredDoc || [...docs].sort((a, b) => scoreDoc(b) - scoreDoc(a))[0] || docs[0];

  const lines = sourceDoc.content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 40 && !/^\d+$/.test(line));

  const scored = lines
    .map((line) => {
      const normalized = normalizeText(line);
      const keywordHits = keywords.reduce((acc, keyword) => acc + (normalized.includes(keyword) ? 1 : 0), 0);
      const headingBoost = HEADING_REGEX.test(line) ? 1 : 0;
      const lengthScore = line.length > 80 && line.length < 260 ? 1 : 0;
      return { line, score: keywordHits * 3 + headingBoost + lengthScore };
    })
    .sort((a, b) => b.score - a.score);

  const selected: string[] = [];
  for (const item of scored) {
    if (item.score <= 0 && selected.length >= 4) break;
    if (!selected.some((existing) => existing.slice(0, 45) === item.line.slice(0, 45))) {
      selected.push(item.line);
    }
    if (selected.length >= 8) break;
  }

  const fallbackPoints = selected.length > 0 ? selected : lines.slice(0, 6);
  const isSummary = /resumen|s[ií]ntesis|ejecutivo|puntos clave|cr[ií]ticos|importantes/i.test(query);
  const title = isSummary ? 'Resumen rápido (modo contingencia)' : 'Respuesta rápida (modo contingencia)';

  return `⚠️ Alta demanda detectada en los modelos. Para no detener tu estudio, te comparto una respuesta local basada en **${sourceDoc.name}**.\n\n**${title}**\n${fallbackPoints
    .map((point, index) => `${index + 1}. ${point}`)
    .join('\n')}\n\nSi quieres, cuando pase la saturación te genero una versión más profunda con IA.`;
};

const buildGlobalContext = (documents: Document[]) => {
  if (documents.length === 0) {
    return 'No hay documentos cargados actualmente.';
  }

  const perDocumentLimit = Math.max(4000, Math.floor(42000 / documents.length));
  const docsContext = documents
    .map((doc, index) => {
      const contentSnippet = doc.content.substring(0, perDocumentLimit);
      return `Documento ${index + 1}: "${doc.name}"\n${contentSnippet}`;
    })
    .join('\n\n---\n\n');

  return `Contexto global de estudio (puedes combinar información entre documentos):\n\n${docsContext}`;
};

const buildAnswerReference = (
  documents: Document[],
  selectedDocId: string | null,
  userMessage: string,
  aiResponse: string
) => {
  const selectedDoc = documents.find((doc) => doc.id === selectedDocId);
  const query = `${userMessage} ${aiResponse.slice(0, 700)}`;

  if (!selectedDoc) {
    for (const doc of documents) {
      const fallbackReference = detectDocumentReference(doc.content, query);
      if (fallbackReference) {
        return `Ubicación sugerida: ${doc.name} · ${fallbackReference}`;
      }
    }
    return 'Ubicación: respuesta global (sin foco en un documento específico).';
  }

  const reference = detectDocumentReference(selectedDoc.content, query);

  if (reference) {
    return `Ubicación sugerida: ${selectedDoc.name} · ${reference}`;
  }

  return `Ubicación sugerida: ${selectedDoc.name} (sin capítulo exacto detectado).`;
};

export default function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState('');
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [cloudHydratedUserId, setCloudHydratedUserId] = useState<string | null>(null);
  const [showLanding, setShowLanding] = useState(true);
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const [activeTab, setActiveTab] = useState<'tutor' | 'library' | 'exam' | 'preparation' | 'stats' | 'notes'>('tutor');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatScope, setChatScope] = useState<'all' | 'selected'>('all');
  const [chatDocId, setChatDocId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [isChatting, setIsChatting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // Exam state
  const [currentExam, setCurrentExam] = useState<Exam | null>(null);
  const [isGeneratingExam, setIsGeneratingExam] = useState(false);
  const [examQuestionCount, setExamQuestionCount] = useState(8);
  const [examDifficulty, setExamDifficulty] = useState<ExamDifficulty>('intermedio');
  const [examPracticeMode, setExamPracticeMode] = useState<ExamPracticeMode>('mixto');
  const [preparationQuestions, setPreparationQuestions] = useState<PreparationQuestion[]>([]);
  const [isGeneratingPreparation, setIsGeneratingPreparation] = useState(false);
  const [preparationQuestionCount, setPreparationQuestionCount] = useState(6);
  const [preparationDifficulty, setPreparationDifficulty] = useState<ExamDifficulty>('intermedio');
  const [examScope, setExamScope] = useState<'global' | 'selected'>('global');
  const [examDocId, setExamDocId] = useState<string | null>(null);
  const [examHistory, setExamHistory] = useState<ExamHistoryItem[]>([]);
  const [examPageIndex, setExamPageIndex] = useState(0);
  const [showExamResults, setShowExamResults] = useState(false);
  const [hasShownGreatModal, setHasShownGreatModal] = useState(false);
  const [hasShownImproveModal, setHasShownImproveModal] = useState(false);
  const [examPulseModal, setExamPulseModal] = useState<{ visible: boolean; emoji: string; title: string; message: string } | null>(null);
  const [libraryPage, setLibraryPage] = useState(1);
  const [libraryTotalPages, setLibraryTotalPages] = useState(0);
  const [libraryZoom, setLibraryZoom] = useState(1);
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryPageText, setLibraryPageText] = useState('');
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState<number | null>(null);
  const [chatSelectionText, setChatSelectionText] = useState('');
  const [chatSelectionMessageIndex, setChatSelectionMessageIndex] = useState<number | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const libraryTextRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedDoc = documents.find(d => d.id === selectedDocId);
  const selectedChatDoc = documents.find(d => d.id === chatDocId) || null;
  const examSelectedDoc = documents.find(d => d.id === examDocId) || null;
  const completedExamsCount = examHistory.length;
  const averageExamScore = completedExamsCount === 0
    ? 0
    : examHistory.reduce((acc, item) => acc + item.score, 0) / completedExamsCount;
  const examQuestionsPerPage = 5;
  const liveExamStats = currentExam ? getExamStats(currentExam) : null;
  const shouldShowExamResults = Boolean(currentExam?.completed) || showExamResults;
  const totalExamPages = currentExam ? Math.max(1, Math.ceil(currentExam.questions.length / examQuestionsPerPage)) : 1;
  const paginatedExamQuestions = currentExam
    ? currentExam.questions.slice(examPageIndex * examQuestionsPerPage, (examPageIndex + 1) * examQuestionsPerPage)
    : [];
  const examStudyRecommendations = currentExam ? buildExamStudyRecommendations(currentExam) : [];
  const selectedProviderConfig = AI_PROVIDER_OPTIONS.find((provider) => provider.id === aiProvider) || AI_PROVIDER_OPTIONS[0];

  const quickActions = selectedDoc
    ? [
        {
          label: '¿Quieres un resumen?',
          prompt: `Hazme un resumen ejecutivo del documento "${selectedDoc.name}" en 8 puntos clave.`
        },
        {
          label: '¿Quieres términos clave?',
          prompt: `Extrae y explica los términos clave del documento "${selectedDoc.name}".`
        },
        {
          label: '¿Quieres puntos críticos?',
          prompt: `Indícame los puntos críticos o más importantes del documento "${selectedDoc.name}".`
        },
        {
          label: '¿Quieres preguntas tipo examen?',
          prompt: `Créame 5 preguntas tipo examen con respuesta y explicación del documento "${selectedDoc.name}".`
        }
      ]
    : [];

  const applyPersistedState = (persisted: PersistedAppState) => {
    const restoredDocs = deserializeDocuments(persisted.documents || []);
    const restoredNotes = deserializeNotes(persisted.notes || []);
    const restoredHistory = deserializeExamHistory(persisted.examHistory || []);

    setShowLanding(typeof persisted.showLanding === 'boolean' ? persisted.showLanding : true);
    setAiProvider(persisted.aiProvider || 'gemini');
    setActiveTab(persisted.activeTab || 'tutor');
    setDocuments(restoredDocs);
    setSelectedDocId(persisted.selectedDocId || null);
    setMessages(Array.isArray(persisted.messages) ? persisted.messages : []);
    setChatScope(persisted.chatScope || 'all');
    setChatDocId(persisted.chatDocId || null);
    setCurrentExam(persisted.currentExam || null);
    setExamQuestionCount(persisted.examQuestionCount ?? 8);
    setExamDifficulty(persisted.examDifficulty || 'intermedio');
    setExamPracticeMode(persisted.examPracticeMode || 'mixto');
    setPreparationQuestions(Array.isArray(persisted.preparationQuestions) ? persisted.preparationQuestions : []);
    setPreparationQuestionCount(persisted.preparationQuestionCount ?? 6);
    setPreparationDifficulty(persisted.preparationDifficulty || 'intermedio');
    setExamScope(persisted.examScope || 'global');
    setExamDocId(persisted.examDocId || null);
    setExamHistory(restoredHistory);
    setNotes(restoredNotes);
  };

  const buildPersistedState = (): PersistedAppState => ({
    version: APP_STATE_VERSION,
    showLanding,
    aiProvider,
    activeTab,
    documents: serializeDocuments(documents),
    selectedDocId,
    messages,
    chatScope,
    chatDocId,
    currentExam,
    examQuestionCount,
    examDifficulty,
    examPracticeMode,
    preparationQuestions,
    preparationQuestionCount,
    preparationDifficulty,
    examScope,
    examDocId,
    examHistory: serializeExamHistory(examHistory),
    notes: serializeNotes(notes),
  });

  useEffect(() => {
    let cancelled = false;

    const hydrateState = async () => {
      const persisted = await loadPersistedState();
      if (cancelled) return;

      if (persisted && persisted.version === APP_STATE_VERSION) {
        applyPersistedState(persisted);
      }

      setIsHydrated(true);
    };

    hydrateState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      return;
    }

    let mounted = true;

    const initializeSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) {
        console.error('No se pudo recuperar sesión de Supabase:', error);
        return;
      }
      setAuthUser(data.session?.user ?? null);
    };

    initializeSession();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setAuthUser(session?.user ?? null);
      if (!session?.user) {
        setCloudHydratedUserId(null);
        setCloudSyncStatus('idle');
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (!isSupabaseConfigured || !supabase || !authUser) return;
    if (cloudHydratedUserId === authUser.id) return;

    let cancelled = false;

    const hydrateCloudState = async () => {
      try {
        setCloudSyncStatus('syncing');
        const cloudState = await loadCloudState(authUser.id);
        if (cancelled) return;

        if (cloudState && cloudState.version === APP_STATE_VERSION) {
          applyPersistedState(cloudState);
        }

        setCloudHydratedUserId(authUser.id);
        setCloudSyncStatus('synced');
      } catch (error) {
        if (cancelled) return;
        console.error('No se pudo sincronizar estado en nube:', error);
        setCloudHydratedUserId(authUser.id);
        setCloudSyncStatus('error');
      }
    };

    hydrateCloudState();

    return () => {
      cancelled = true;
    };
  }, [isHydrated, authUser, cloudHydratedUserId]);

  useEffect(() => {
    if (!isHydrated) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      const state = buildPersistedState();

      savePersistedState(state).catch((error) => {
        console.error('No se pudo persistir el estado de la app:', error);
      });

      if (isSupabaseConfigured && supabase && authUser && cloudHydratedUserId === authUser.id) {
        setCloudSyncStatus('syncing');
        saveCloudState(authUser.id, state)
          .then(() => {
            setCloudSyncStatus('synced');
          })
          .catch((error) => {
            console.error('No se pudo guardar estado en Supabase:', error);
            setCloudSyncStatus('error');
          });
      }
    }, 400);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    isHydrated,
    showLanding,
    aiProvider,
    activeTab,
    documents,
    selectedDocId,
    messages,
    chatScope,
    chatDocId,
    currentExam,
    examQuestionCount,
    examDifficulty,
    examPracticeMode,
    preparationQuestions,
    preparationQuestionCount,
    preparationDifficulty,
    examScope,
    examDocId,
    examHistory,
    notes,
    authUser,
    cloudHydratedUserId,
  ]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (activeTab === 'tutor') {
      scrollToBottom();
    }
  }, [messages, activeTab]);

  useEffect(() => {
    if (selectedDocId && !examDocId) {
      setExamDocId(selectedDocId);
    }
  }, [selectedDocId, examDocId]);

  useEffect(() => {
    if (!chatDocId && documents.length > 0) {
      setChatDocId(documents[0].id);
    }
  }, [documents, chatDocId]);

  useEffect(() => {
    if (!selectedDocId) {
      setLibraryPage(1);
      setLibraryTotalPages(0);
      setLibraryError(null);
      setLibraryPageText('');
      return;
    }

    setLibraryPage(1);
    setLibraryZoom(1);
    setLibraryError(null);
  }, [selectedDocId]);

  useEffect(() => {
    if (activeTab !== 'library') return;
    if (!selectedDoc?.pdfData) {
      setLibraryError('Este documento no tiene datos PDF para visualizar.');
      return;
    }

    let cancelled = false;

    const renderCurrentPage = async () => {
      try {
        setIsRenderingPdf(true);
        setLibraryError(null);

        const loadingTask = pdfjsLib.getDocument({ data: clonePdfBytes(selectedDoc.pdfData) });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        setLibraryTotalPages(pdf.numPages);
        const safePage = Math.min(Math.max(1, libraryPage), pdf.numPages);
        if (safePage !== libraryPage) {
          setLibraryPage(safePage);
          return;
        }

        const page = await pdf.getPage(safePage);
        if (cancelled || !pdfCanvasRef.current) return;

        const canvas = pdfCanvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        const containerWidth = canvas.parentElement?.clientWidth || 920;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = (containerWidth - 16) / baseViewport.width;
        const viewport = page.getViewport({ scale: Math.max(0.4, fitScale * libraryZoom) });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        await page.render({ canvas, canvasContext: context, viewport }).promise;

        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!cancelled) {
          setLibraryPageText(pageText);
        }
      } catch (error: any) {
        if (!cancelled) {
          console.error('Error rendering PDF:', error);
          setLibraryError(error?.message || 'No se pudo renderizar el PDF.');
        }
      } finally {
        if (!cancelled) {
          setIsRenderingPdf(false);
        }
      }
    };

    renderCurrentPage();

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedDoc, libraryPage, libraryZoom]);

  const stopSpeech = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setSpeakingMessageIndex(null);
  };

  const addNote = (payload: Omit<NoteItem, 'id' | 'createdAt'>) => {
    if (!payload.content.trim()) return;
    setNotes((prev) => [
      {
        ...payload,
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date(),
      },
      ...prev,
    ]);
  };

  const captureChatSelection = (messageIndex: number) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || '';

    if (text.length > 0) {
      setChatSelectionText(text);
      setChatSelectionMessageIndex(messageIndex);
    }
  };

  const addSelectedPdfTextToNotes = () => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || '';
    if (!selectedText || !selectedDoc) return;

    if (libraryTextRef.current) {
      const anchorNode = selection?.anchorNode;
      if (anchorNode && !libraryTextRef.current.contains(anchorNode)) {
        return;
      }
    }

    addNote({
      content: selectedText,
      source: 'pdf',
      docId: selectedDoc.id,
      docName: selectedDoc.name,
      page: libraryPage,
    });
  };

  const handleAuthLogin = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthStatus('Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para habilitar login.');
      return;
    }

    const email = authEmail.trim();
    if (!email) {
      setAuthStatus('Ingresa un correo para continuar.');
      return;
    }

    setAuthLoading(true);
    setAuthStatus('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        throw error;
      }

      setAuthStatus('Te envié un enlace mágico a tu correo. Ábrelo en este mismo navegador para entrar.');
    } catch (error: any) {
      setAuthStatus(error?.message || 'No se pudo iniciar sesión en este momento.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAuthLogout = async () => {
    if (!supabase) return;
    setAuthLoading(true);
    setAuthStatus('');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setAuthStatus('Sesión cerrada. Tus datos siguen guardados localmente.');
    } catch (error: any) {
      setAuthStatus(error?.message || 'No se pudo cerrar sesión.');
    } finally {
      setAuthLoading(false);
    }
  };

  const openCreateAccountFlow = async () => {
    setShowLanding(false);
    setSidebarOpen(true);

    if (authUser && supabase) {
      setAuthLoading(true);
      try {
        await supabase.auth.signOut();
        setAuthStatus('Sesión cerrada. Ingresa tu correo para crear cuenta o iniciar sesión.');
      } catch (error: any) {
        setAuthStatus(error?.message || 'No se pudo cambiar de cuenta en este momento.');
      } finally {
        setAuthLoading(false);
      }
      return;
    }

    setAuthStatus('Ingresa tu correo en el panel lateral para crear cuenta o iniciar sesión.');
  };

  const speakMessage = (text: string, index: number) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const cleanText = text
      .replace(/[#*_>`~-]/g, ' ')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'es-ES';
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => setSpeakingMessageIndex(null);
    utterance.onerror = () => setSpeakingMessageIndex(null);
    setSpeakingMessageIndex(index);
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      alert('Por favor, selecciona un archivo PDF válido.');
      return;
    }

    setIsUploading(true);
    setUploadStatus('Leyendo archivo...');
    
    try {
      const reader = new FileReader();
      
      const fileData = await new Promise<ArrayBuffer>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error('Error al leer el archivo'));
        reader.readAsArrayBuffer(file);
      });

      setUploadStatus('Analizando PDF...');
      
      const sourceBytes = new Uint8Array(fileData);

      const loadingTask = pdfjsLib.getDocument({ 
        data: clonePdfBytes(sourceBytes),
        verbosity: 0
      });
      
      const pdf = await loadingTask.promise;
      let fullText = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        setUploadStatus(`Extrayendo texto: página ${i} de ${pdf.numPages}...`);
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => {
            if ('str' in item) return item.str;
            return '';
          })
          .join(' ');
        fullText += pageText + '\n';
      }

      if (!fullText.trim()) {
        throw new Error('El PDF parece estar vacío o ser una imagen sin texto (necesita OCR).');
      }

      const newDoc: Document = {
        id: Math.random().toString(36).substring(7),
        name: file.name,
        content: fullText,
        pdfData: clonePdfBytes(sourceBytes),
        pageCount: pdf.numPages,
        uploadDate: new Date(),
      };

      setDocuments(prev => [...prev, newDoc]);
      setSelectedDocId(newDoc.id);
      setChatDocId(newDoc.id);
      
      setMessages(prev => [...prev, {
        role: 'model',
        content: `✅ **${file.name}** cargado con éxito. He extraído el texto de ${pdf.numPages} páginas. ¿Qué te gustaría saber sobre este documento?`
      }]);

    } catch (error: any) {
      console.error("Error detallado al procesar PDF:", error);
      setMessages(prev => [...prev, {
        role: 'model',
        content: `❌ **Error al cargar el PDF**: ${error.message || 'Error desconocido'}. \n\nIntenta con otro archivo o asegúrate de que el PDF no tenga restricciones de copia.`
      }]);
    } finally {
      setIsUploading(false);
      setUploadStatus('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isChatting) return;
    if (chatScope === 'selected' && !chatDocId) {
      alert('Selecciona un documento específico para usar este modo de chat.');
      return;
    }

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsChatting(true);

    try {
      const scopedDocs =
        chatScope === 'selected'
          ? documents.filter((doc) => doc.id === chatDocId)
          : documents;
      const effectiveDocs = scopedDocs.length > 0 ? scopedDocs : documents;
      const context = buildGlobalContext(effectiveDocs);
      const scopeInstruction =
        chatScope === 'selected' && selectedChatDoc
          ? `Responde usando SOLO el documento "${selectedChatDoc.name}".`
          : 'Puedes usar todos los documentos cargados para responder.';

      const systemInstruction = `Eres un asistente de estudio experto llamado "Tutor Inteligente". Ayudas a los estudiantes a entender el contenido de sus documentos PDF. 
      ${scopeInstruction}
      Responde de manera clara, educativa y estructurada. Si el usuario pregunta algo que no está en el documento, indícalo amablemente pero intenta ayudar con tus conocimientos generales si es relevante.
      Usa Markdown para dar formato a tus respuestas (negritas, listas, etc.).
      
      ${context}`;

      const response = await generateContentWithRetry(aiProvider, {
        model: GEMINI_MODEL,
        contents: messages.concat({ role: 'user', content: userMessage }).map(m => ({
          role: m.role,
          parts: [{ text: m.content }]
        })),
        config: {
          systemInstruction,
        }
      }, 3, 35000);

      const aiResponse = response.text || "Lo siento, no pude generar una respuesta.";
        const referenceDocId = chatScope === 'selected' ? chatDocId : selectedDocId;
        const reference = buildAnswerReference(documents, referenceDocId, userMessage, aiResponse);
      setMessages(prev => [...prev, { role: 'model', content: aiResponse, reference }]);
    } catch (error: any) {
      console.error("Error calling Gemini:", error);
      if (isHighDemandError(error)) {
        const scopedDocs =
          chatScope === 'selected'
            ? documents.filter((doc) => doc.id === chatDocId)
            : documents;
        const effectiveDocs = scopedDocs.length > 0 ? scopedDocs : documents;
        const localFallback = buildLocalFallbackResponse(
          effectiveDocs,
          userMessage,
          chatScope === 'selected' ? chatDocId : selectedDocId
        );

        setMessages(prev => [...prev, {
          role: 'model',
          content: localFallback,
        }]);
      } else {
        const friendlyError = formatGeminiError(error);
        setMessages(prev => [...prev, {
          role: 'model',
          content: `Hubo un error al procesar tu pregunta.\n\n${friendlyError}`
        }]);
      }
    } finally {
      setIsChatting(false);
    }
  };

  const generateExam = async () => {
    if (documents.length === 0) return;

    const targetDocs =
      examScope === 'global'
        ? documents
        : documents.filter(d => d.id === examDocId || d.id === selectedDocId);

    if (targetDocs.length === 0) {
      alert('Selecciona un PDF para generar preguntas específicas.');
      return;
    }

    const safeQuestionCount = Math.min(20, Math.max(3, examQuestionCount));
    const difficultyConfig = EXAM_DIFFICULTY_OPTIONS.find((option) => option.id === examDifficulty) || EXAM_DIFFICULTY_OPTIONS[1];
        const practiceModeConfig = EXAM_PRACTICE_MODE_OPTIONS.find((mode) => mode.id === examPracticeMode) || EXAM_PRACTICE_MODE_OPTIONS[0];
    const perDocLimit = Math.max(3500, Math.floor(28000 / targetDocs.length));
        const practiceInstruction = examPracticeMode === 'psicotecnico'
      ? `Incluye en el conjunto de preguntas SOLO enfoque Psicotécnico.
    - Evalúa atención al detalle, lógica verbal/no verbal, concentración, rapidez perceptiva y resolución de patrones.
    - No mezcles preguntas generales normativas o por área funcional.`
      : `Incluye en el conjunto de preguntas estos 5 enfoques:
    1) Prueba General: conocimientos comunes (Constitución, Ley 142 de 1994 y funciones esenciales de la EAAB).
    2) Prueba Específica: conceptos técnicos del perfil (operativo, técnico, administrativo o profesional).
    3) Prueba por Área: procesos particulares de una dependencia.
    4) Prueba Comportamental: toma de decisiones, ética, comunicación y respuesta ante retos laborales.
    5) Prueba Psicotécnica: atención al detalle, destreza, concentración y rapidez perceptiva.`;
    const buildExamContext = (limit: number) =>
      targetDocs
        .map((doc, index) => `Documento ${index + 1}: "${doc.name}"\n${doc.content.substring(0, limit)}`)
        .join('\n\n---\n\n');

    const buildExamRequest = (questionCount: number, contextText: string) => ({
      model: GEMINI_MODEL,
      contents: `Modo de entrenamiento: ${practiceModeConfig.label}.\n\nDificultad objetivo: ${difficultyConfig.label}.\nCriterio de dificultad: ${difficultyConfig.guidance}\n\n${practiceInstruction}\n\nMetodología obligatoria: Lectura Profunda.\n- No generes preguntas de memoria literal ni de copiar/pegar definiciones.\n- Formula situaciones, interpretación de contexto, inferencias, aplicación normativa/técnica y toma de decisiones.\n- Usa distractores plausibles que exijan razonar.\n- Para cada pregunta, entrega también pasos cortos y accionables para llegar a la respuesta correcta.\n\nGenera ${questionCount} preguntas de opción múltiple basadas en estos documentos:\n\n${contextText}`,
      config: {
        systemInstruction: "Eres un evaluador experto en comprensión profunda. Debes aplicar Lectura Profunda: interpretación, inferencia, aplicación y juicio contextual. Prohibido crear preguntas de memoria literal. Cada pregunta debe tener 4 opciones y solo una correcta. Además, entrega una explicación breve, una lista de pasos concretos para resolver la pregunta y una justificación corta por cada opción (A/B/C/D). Devuelve exclusivamente JSON válido según el schema.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING, description: "El enunciado de la pregunta" },
              options: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "4 opciones de respuesta"
              },
              correctAnswer: { type: Type.INTEGER, description: "Índice de la respuesta correcta (0-3)" },
              explanation: { type: Type.STRING, description: "Breve explicación de por qué es la respuesta correcta" },
              reasoningSteps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Pasos cortos y claros para llegar a la respuesta correcta"
              },
              optionFeedback: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Explicación breve para cada opción en orden (A, B, C, D), indicando por qué es correcta o incorrecta"
              }
            },
            required: ["text", "options", "correctAnswer", "explanation", "reasoningSteps", "optionFeedback"]
          }
        }
      }
    });

    const examContext = buildExamContext(perDocLimit);

    const sourceLabel =
      examScope === 'global'
        ? `Global (${targetDocs.length} documentos)`
        : targetDocs[0].name;
    const sourceDocId = examScope === 'global' ? null : targetDocs[0].id;

    setIsGeneratingExam(true);
    setExamPageIndex(0);
    setShowExamResults(false);
    setHasShownGreatModal(false);
    setHasShownImproveModal(false);
    setExamPulseModal(null);
    try {

      let response;
      try {
        response = await generateContentWithRetry(aiProvider, buildExamRequest(safeQuestionCount, examContext), 3, 70000);
      } catch (error: any) {
        if (!shouldRetryExamWithReducedLoad(error)) {
          throw error;
        }

        const reducedQuestionCount = Math.max(4, Math.min(10, Math.floor(safeQuestionCount * 0.75)));
        const reducedPerDocLimit = Math.max(2200, Math.floor(perDocLimit * 0.65));
        const reducedContext = buildExamContext(reducedPerDocLimit);

        response = await generateContentWithRetry(aiProvider, buildExamRequest(reducedQuestionCount, reducedContext), 2, 90000);
      }

      const rawQuestions = JSON.parse(response.text);
      const questions: Question[] = rawQuestions.map((q: any, idx: number) => {
        const safeOptions = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
        const safeCorrectAnswer = Number(q.correctAnswer);

        return {
          id: `q-${idx}`,
          text: q.text,
          options: safeOptions,
          correctAnswer: safeCorrectAnswer,
          explanation: q.explanation,
          reasoningSteps: Array.isArray(q.reasoningSteps) && q.reasoningSteps.length > 0
            ? q.reasoningSteps.slice(0, 5)
            : buildReasoningStepsFromExplanation(q.explanation || 'Analiza el contexto y compara las opciones antes de responder.'),
          optionFeedback: Array.isArray(q.optionFeedback) && q.optionFeedback.length >= safeOptions.length
            ? q.optionFeedback.slice(0, safeOptions.length)
            : buildOptionFeedbackFallback(safeOptions, safeCorrectAnswer)
        };
      });

      setCurrentExam({
        id: Math.random().toString(36).substring(7),
        docId: sourceDocId,
        scope: examScope,
        practiceMode: examPracticeMode,
        practiceModeLabel: practiceModeConfig.label,
        difficulty: examDifficulty,
        difficultyLabel: difficultyConfig.label,
        sourceLabel,
        questions,
        completed: false,
        userAnswers: {}
      });
    } catch (error: any) {
      console.error("Error generating exam:", error);
      alert(`Error al generar el examen.\n\n${formatGeminiError(error)}`);
    } finally {
      setIsGeneratingExam(false);
    }
  };

  function getExamStats(exam: Exam) {
    const answeredCount = Object.keys(exam.userAnswers).length;
    let correctCount = 0;

    exam.questions.forEach((question) => {
      if (exam.userAnswers[question.id] === question.correctAnswer) {
        correctCount++;
      }
    });

    const wrongCount = answeredCount - correctCount;
    const accuracy = answeredCount === 0 ? 0 : (correctCount / answeredCount) * 100;
    const progress = exam.questions.length === 0 ? 0 : (answeredCount / exam.questions.length) * 100;

    return { answeredCount, correctCount, wrongCount, accuracy, progress };
  }

  function buildExamStudyRecommendations(exam: Exam): StudyRecommendation[] {
    const wrongQuestions = exam.questions.filter((question) => exam.userAnswers[question.id] !== question.correctAnswer);

    if (wrongQuestions.length === 0) {
      return [{
        id: 'study-perfect',
        text: 'Excelente desempeño: mantén la práctica con simulacros de mayor dificultad para consolidar el nivel.',
        docId: null,
        docName: 'General',
      }];
    }

    return wrongQuestions.slice(0, 8).map((question) => {
      const sourceDocId = exam.scope === 'selected' ? exam.docId : null;
      const sourceDoc = documents.find((doc) => doc.id === sourceDocId) || null;
      const reference = buildAnswerReference(documents, sourceDocId, question.text, question.explanation);
      return {
        id: `study-${question.id}`,
        text: `${reference} · Refuerza: ${question.text.slice(0, 120)}${question.text.length > 120 ? '...' : ''}`,
        docId: sourceDocId,
        docName: sourceDoc?.name || 'Global',
      };
    });
  }

  const handleAnswerSelect = (questionId: string, optionIndex: number) => {
    if (!currentExam || currentExam.completed) return;
    
    setCurrentExam(prev => {
      if (!prev) return null;

      const alreadyAnswered = typeof prev.userAnswers[questionId] === 'number';
      const updatedExam: Exam = {
        ...prev,
        userAnswers: {
          ...prev.userAnswers,
          [questionId]: optionIndex
        }
      };

      if (!alreadyAnswered) {
        const stats = getExamStats(updatedExam);

        if (!hasShownGreatModal && stats.answeredCount >= 5 && stats.accuracy >= 80) {
          setExamPulseModal({
            visible: true,
            emoji: '🤓',
            title: '¡Super nerd!',
            message: 'Vas con un rendimiento excelente. Sigue así 💙'
          });
          setHasShownGreatModal(true);
        }

        if (!hasShownImproveModal && stats.answeredCount >= 5 && stats.accuracy <= 45) {
          setExamPulseModal({
            visible: true,
            emoji: '💪',
            title: '¡Ánimo, tú puedes!',
            message: 'Vamos paso a paso. Revisa la explicación y sigue avanzando.'
          });
          setHasShownImproveModal(true);
        }
      }

      return updatedExam;
    });
  };

  const finishExam = () => {
    if (!currentExam) return;
    if (currentExam.completed) return;

    const answeredCount = Object.keys(currentExam.userAnswers).length;
    if (answeredCount < currentExam.questions.length) {
      const firstPendingIndex = currentExam.questions.findIndex(
        (question) => typeof currentExam.userAnswers[question.id] !== 'number'
      );

      if (firstPendingIndex >= 0) {
        const targetPageIndex = Math.floor(firstPendingIndex / examQuestionsPerPage);
        setExamPageIndex(targetPageIndex);
        const missingCount = currentExam.questions.length - answeredCount;
        alert(`Te faltan ${missingCount} pregunta(s). Te llevé a la primera pendiente para terminar el quizz.`);
      } else {
        alert('Responde todas las preguntas para ver resultados globales.');
      }
      return;
    }
    
    let correctCount = 0;
    currentExam.questions.forEach(q => {
      if (currentExam.userAnswers[q.id] === q.correctAnswer) {
        correctCount++;
      }
    });

    const finalScore = (correctCount / currentExam.questions.length) * 100;

    setCurrentExam(prev => {
      if (!prev) return null;
      return {
        ...prev,
        completed: true,
        score: finalScore
      };
    });

    setExamHistory(prev => [
      {
        id: `exam-${Date.now()}`,
        date: new Date(),
        score: finalScore,
        questionCount: currentExam.questions.length,
        difficultyLabel: currentExam.difficultyLabel,
        sourceLabel: currentExam.sourceLabel,
      },
      ...prev,
    ]);

    setShowExamResults(true);
  };

  const restartCurrentQuiz = () => {
    if (!currentExam) return;

    setCurrentExam((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        completed: false,
        score: undefined,
        userAnswers: {},
      };
    });

    setExamPageIndex(0);
    setShowExamResults(false);
    setHasShownGreatModal(false);
    setHasShownImproveModal(false);
    setExamPulseModal(null);
  };

  const goToNewQuizSetup = () => {
    setCurrentExam(null);
    setShowExamResults(false);
    setExamPageIndex(0);
    setHasShownGreatModal(false);
    setHasShownImproveModal(false);
    setExamPulseModal(null);
  };

  const generatePreparation = async () => {
    if (documents.length === 0) return;

    const safeQuestionCount = Math.min(15, Math.max(3, preparationQuestionCount));
    const difficultyConfig = EXAM_DIFFICULTY_OPTIONS.find((option) => option.id === preparationDifficulty) || EXAM_DIFFICULTY_OPTIONS[1];
    const perDocLimit = Math.max(3500, Math.floor(24000 / documents.length));
    const prepContext = documents
      .map((doc, index) => `Documento ${index + 1}: "${doc.name}"\n${doc.content.substring(0, perDocLimit)}`)
      .join('\n\n---\n\n');

    setIsGeneratingPreparation(true);
    try {
      const response = await generateContentWithRetry(aiProvider, {
        model: GEMINI_MODEL,
        contents: `Sección: Preparación (NO examen).\n\nObjetivo: crear preguntas para estudio guiado y comprensión de cómo analizar opciones, sin responder por parte del usuario.\n\nDificultad objetivo: ${difficultyConfig.label}.\nCriterio de dificultad: ${difficultyConfig.guidance}\n\nIncluye enfoque mixto: General, Específica, por Área, Comportamental y Psicotécnica.\n\nMetodología obligatoria: Lectura Profunda.\n- No generes preguntas de memoria literal ni de copiar/pegar definiciones.\n- Formula situaciones, interpretación de contexto, inferencias, aplicación normativa/técnica y toma de decisiones.\n- Usa distractores plausibles que exijan razonar.\n- Para cada opción, asigna una etiqueta exacta entre: "Correcta", "Distractor", "Contiene algo verdadero".\n\nGenera ${safeQuestionCount} preguntas de preparación basadas en estos documentos:\n\n${prepContext}`,
        config: {
          systemInstruction: "Eres un entrenador de estudio. Entregas preguntas para preparación guiada, con explicación de razonamiento y análisis de cada opción. No es un examen para responder; es práctica explicada. Devuelve exclusivamente JSON válido según el schema.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING, description: "El enunciado de la pregunta" },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "4 opciones de respuesta"
                },
                correctAnswer: { type: Type.INTEGER, description: "Índice de la respuesta correcta (0-3)" },
                explanation: { type: Type.STRING, description: "Explicación general breve de la resolución" },
                reasoningSteps: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Pasos cortos y claros para resolver la pregunta"
                },
                optionLabels: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Etiqueta por opción en orden (A, B, C, D): Correcta, Distractor o Contiene algo verdadero"
                },
                optionFeedback: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Explicación breve para cada opción en orden (A, B, C, D)"
                }
              },
              required: ["text", "options", "correctAnswer", "explanation", "reasoningSteps", "optionLabels", "optionFeedback"]
            }
          }
        }
      }, 3, 55000);

      const rawQuestions = JSON.parse(response.text);
      const generatedQuestions: PreparationQuestion[] = rawQuestions.map((q: any, idx: number) => {
        const safeOptions = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
        const safeCorrectAnswer = Number(q.correctAnswer);

        return {
          id: `prep-${idx}`,
          text: q.text,
          options: safeOptions,
          correctAnswer: safeCorrectAnswer,
          explanation: q.explanation,
          reasoningSteps: Array.isArray(q.reasoningSteps) && q.reasoningSteps.length > 0
            ? q.reasoningSteps.slice(0, 5)
            : buildReasoningStepsFromExplanation(q.explanation || 'Analiza el contexto y compara opciones para identificar la mejor decisión.'),
          optionLabels: Array.isArray(q.optionLabels) && q.optionLabels.length >= safeOptions.length
            ? q.optionLabels.slice(0, safeOptions.length)
            : buildOptionLabelsFallback(safeOptions, safeCorrectAnswer),
          optionFeedback: Array.isArray(q.optionFeedback) && q.optionFeedback.length >= safeOptions.length
            ? q.optionFeedback.slice(0, safeOptions.length)
            : buildOptionFeedbackFallback(safeOptions, safeCorrectAnswer)
        };
      });

      setPreparationQuestions(generatedQuestions);
    } catch (error: any) {
      console.error('Error generating preparation:', error);
      alert(`Error al generar la preparación.\n\n${formatGeminiError(error)}`);
    } finally {
      setIsGeneratingPreparation(false);
    }
  };

  const deleteDocument = (id: string) => {
    setDocuments(prev => prev.filter(d => d.id !== id));
    if (selectedDocId === id) {
      setSelectedDocId(null);
    }
    if (chatDocId === id) {
      setChatDocId(null);
      setChatScope('all');
    }
    if (examDocId === id) {
      setExamDocId(null);
    }
    if (currentExam?.scope === 'selected' && currentExam.docId === id) {
      setCurrentExam(null);
    }
  };

  if (showLanding) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#F7FAFF] via-white to-[#EAF1FF] text-black font-sans flex items-center justify-center px-6">
        <div className="w-full max-w-4xl text-center space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-4"
          >
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-[#0B2A5B]">
              Acua-Ready
            </h1>
            <p className="text-base md:text-lg text-black/70 font-medium">Plataforma interactiva</p>
            <p className="text-base md:text-xl text-black/70 max-w-3xl mx-auto leading-relaxed">
              Carga tus temarios en PDF, estúdialos con herramientas inteligentes y entrena con preparación guiada y exámenes.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="flex flex-wrap items-center justify-center gap-3"
          >
            {[
              { label: '📄 Visor PDF', className: 'bg-[#eaf2ff] border-[#cfe1ff] text-[#0f4e9f]' },
              { label: '💬 Chat con tu temario', className: 'bg-[#f0f7ff] border-[#d7e9ff] text-[#1361C5]' },
              { label: '🧠 Preparación guiada', className: 'bg-[#eef8f2] border-[#d4ecd9] text-[#1b7f46]' },
              { label: '📝 Exámenes tipo test', className: 'bg-[#fff3e9] border-[#ffe0c8] text-[#b86a1a]' },
              { label: '📊 Estadísticas', className: 'bg-[#f2edff] border-[#ddd1ff] text-[#5f43b2]' }
            ].map((item) => (
              <span key={item.label} className={`px-4 py-2 rounded-full border text-sm font-medium ${item.className}`}>
                {item.label}
              </span>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
            className="flex justify-center"
          >
            <svg width="180" height="140" viewBox="0 0 180 140" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-sm">
              <motion.rect
                x="28"
                y="54"
                width="124"
                height="62"
                rx="10"
                fill="#FFFFFF"
                stroke="#0B2A5B"
                strokeWidth="2"
                initial={{ y: 0 }}
                animate={{ y: [0, -2, 0] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
              />
              <motion.path
                d="M90 56C90 56 75 48 62 48C48 48 40 54 40 54V108C40 108 48 102 62 102C75 102 90 110 90 110"
                fill="#EEF4FF"
                stroke="#1361C5"
                strokeWidth="2"
                initial={{ y: 0 }}
                animate={{ y: [0, -2, 0] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
              />
              <motion.path
                d="M90 56C90 56 105 48 118 48C132 48 140 54 140 54V108C140 108 132 102 118 102C105 102 90 110 90 110"
                fill="#F7FAFF"
                stroke="#1361C5"
                strokeWidth="2"
                initial={{ y: 0 }}
                animate={{ y: [0, -2, 0] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
              />
              <motion.circle
                cx="126"
                cy="28"
                r="16"
                fill="#0B2A5B"
                initial={{ scale: 1 }}
                animate={{ scale: [1, 1.07, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              />
              <path d="M126 18V39" stroke="white" strokeWidth="2" strokeLinecap="round" />
              <path d="M116 28H136" stroke="white" strokeWidth="2" strokeLinecap="round" />
              <path d="M58 70H82" stroke="#1361C5" strokeWidth="2" strokeLinecap="round" />
              <path d="M98 70H122" stroke="#1361C5" strokeWidth="2" strokeLinecap="round" />
              <path d="M58 80H82" stroke="#1361C5" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
              <path d="M98 80H122" stroke="#1361C5" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
            </svg>
          </motion.div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => setShowLanding(false)}
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-[#0B2A5B] hover:bg-[#082043] text-white font-semibold transition-colors shadow-lg shadow-[#0B2A5B]/25"
            >
              Empezar ahora
              <ChevronRight size={18} />
            </button>

            <button
              onClick={openCreateAccountFlow}
              disabled={authLoading}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl border border-[#D7E5F9] bg-white hover:bg-[#EEF4FF] text-[#0B2A5B] font-semibold transition-colors"
            >
              {authLoading
                ? 'Preparando...'
                : authUser
                  ? 'Cambiar cuenta'
                  : 'Crear cuenta / Iniciar sesión'}
            </button>
          </div>

          {authUser && (
            <p className="text-xs text-black/55">
              Hay una sesión activa con {authUser.email}. Usa “Cambiar cuenta” para crear otra.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#F7FAFF] text-black font-sans selection:bg-[#1361C5]/15">
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            className="w-72 border-r border-[#D7E5F9] flex flex-col bg-[#EEF4FF]"
          >
            <div className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-[#0B2A5B] rounded-lg flex items-center justify-center text-white">
                  <GraduationCap size={18} />
                </div>
                <h1 className="text-xl font-semibold tracking-tight">Acua-Ready</h1>
              </div>
              <button 
                onClick={() => setSidebarOpen(false)}
                className="p-1 hover:bg-[#D7E5F9] rounded-md transition-colors lg:hidden"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-4 mb-6">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-full flex flex-col items-center justify-center gap-1 py-3 px-4 bg-[#1361C5] hover:bg-[#0f4e9f] text-white rounded-xl transition-all shadow-sm disabled:opacity-80 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-2">
                  {isUploading ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                  <span className="font-medium">{isUploading ? 'Cargando...' : 'Subir PDF'}</span>
                </div>
                {isUploading && uploadStatus && (
                  <span className="text-[10px] opacity-80 animate-pulse">{uploadStatus}</span>
                )}
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".pdf"
                className="hidden"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-4 space-y-2">
              <div className="rounded-2xl border border-[#D7E5F9] bg-white p-4 space-y-2">
                <p className="text-[10px] uppercase tracking-widest font-semibold text-black/55">Documentos</p>
                <p className="text-sm text-[#0B2A5B] font-semibold">{documents.length} PDF cargados</p>
                <p className="text-xs text-black/60 leading-relaxed">
                  Administra, navega y visualiza tus archivos en la pestaña Biblioteca.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('library')}
                  className="mt-1 px-3 py-1.5 text-xs rounded-lg border border-[#D7E5F9] bg-[#EEF4FF] text-[#0B2A5B] hover:bg-[#D7E5F9]"
                >
                  Ir a Biblioteca
                </button>
              </div>

              <div className="rounded-2xl border border-[#D7E5F9] bg-white p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-black/55">Motor IA</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[#D7E5F9] bg-[#EEF4FF] text-[#0B2A5B]">
                    {selectedProviderConfig.label}
                  </span>
                </div>

                <div className="space-y-2">
                  {AI_PROVIDER_OPTIONS.map((provider) => (
                    <button
                      key={`provider-${provider.id}`}
                      type="button"
                      onClick={() => setAiProvider(provider.id)}
                      className={cn(
                        'w-full rounded-xl border p-2.5 text-left transition-colors',
                        aiProvider === provider.id
                          ? 'border-[#1361C5] bg-[#EEF4FF]'
                          : 'border-[#D7E5F9] bg-white hover:bg-[#F7FAFF]'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-[#0B2A5B]">{provider.label}</p>
                        {provider.badge && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
                            {provider.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-black/60 mt-1">{provider.description}</p>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-black/50 leading-relaxed">
                  {import.meta.env.VITE_GEMINI_API_KEY ? 'Gemini configurado correctamente' : 'Configura VITE_GEMINI_API_KEY en .env'}
                </p>
              </div>
            </div>

            <div className="p-4 border-top border-[#D7E5F9] space-y-2">
              <div className="rounded-xl bg-white border border-[#D7E5F9] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-black/55">Cuenta</p>
                  <span className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full border',
                    cloudSyncStatus === 'synced'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : cloudSyncStatus === 'syncing'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : cloudSyncStatus === 'error'
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : 'border-[#D7E5F9] bg-[#EEF4FF] text-[#0B2A5B]'
                  )}>
                    {cloudSyncStatus === 'synced'
                      ? 'Nube OK'
                      : cloudSyncStatus === 'syncing'
                        ? 'Sincronizando'
                        : cloudSyncStatus === 'error'
                          ? 'Error nube'
                          : 'Local'}
                  </span>
                </div>

                {!isSupabaseConfigured ? (
                  <p className="text-[11px] text-black/60 leading-relaxed">
                    Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` para habilitar login multiusuario.
                  </p>
                ) : authUser ? (
                  <>
                    <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-[#F7FAFF] border border-[#D7E5F9]">
                      <div className="w-8 h-8 rounded-full bg-[#EEF4FF] flex items-center justify-center text-xs font-bold text-[#1361C5]">
                        {(authUser.email || 'U').slice(0, 1).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{authUser.email || 'Usuario'}</p>
                        <p className="text-[10px] text-black/55">Sesión activa</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleAuthLogout}
                      disabled={authLoading}
                      className="w-full py-2 text-xs rounded-lg border border-[#D7E5F9] bg-white text-[#0B2A5B] hover:bg-[#EEF4FF] disabled:opacity-60"
                    >
                      {authLoading ? 'Cerrando...' : 'Cerrar sesión'}
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      placeholder="tu-correo@ejemplo.com"
                      className="w-full bg-[#EEF4FF] border border-[#D7E5F9] rounded-lg py-2 px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1361C5]/20"
                    />
                    <button
                      type="button"
                      onClick={handleAuthLogin}
                      disabled={authLoading}
                      className="w-full py-2 text-xs rounded-lg bg-[#1361C5] hover:bg-[#0f4e9f] text-white disabled:opacity-60"
                    >
                      {authLoading ? 'Enviando enlace...' : 'Ingresar con enlace mágico'}
                    </button>
                  </>
                )}

                {authStatus && (
                  <p className="text-[10px] text-black/60 leading-relaxed">{authStatus}</p>
                )}
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Header */}
        <header className="h-20 border-b border-[#C8D9F2] flex items-center justify-between px-6 bg-white/90 backdrop-blur-md z-10 relative">
          <div className="flex items-center gap-4">
            {!sidebarOpen && (
              <button 
                onClick={() => setSidebarOpen(true)}
                className="p-2 hover:bg-[#EEF4FF] rounded-lg transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            )}
            <div className="flex flex-col">
              <h2 className="text-sm font-semibold">
                {activeTab === 'tutor'
                  ? 'Tutor Inteligente'
                  : activeTab === 'library'
                    ? 'Biblioteca'
                  : activeTab === 'preparation'
                    ? 'Preparación'
                    : activeTab === 'stats'
                      ? 'Estadísticas'
                        : activeTab === 'notes'
                          ? 'Notas guardadas'
                        : 'Quizz'}
              </h2>
              <p className="text-[10px] text-black/55 flex items-center gap-1">
                {activeTab === 'tutor' && selectedDoc ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    {chatScope === 'selected' && selectedChatDoc
                      ? `Chat por documento · ${selectedChatDoc.name}`
                      : 'Chat global activo'}
                  </>
                ) : activeTab === 'tutor' ? (
                  "Chat global activo (todos los documentos)"
                ) : activeTab === 'library' ? (
                  'Visualización de PDFs con PDF.js'
                ) : (
                  'Entrenamiento y evaluación'
                )}
              </p>
            </div>
          </div>

          <div className="absolute left-1/2 -translate-x-1/2">
            <div className="flex gap-2 bg-[#0B2A5B]/5 p-1.5 rounded-2xl border border-[#0B2A5B]/15">
              <button
                onClick={() => setActiveTab('tutor')}
                className={cn(
                  "min-w-28 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-xl transition-all",
                  activeTab === 'tutor' ? "bg-white shadow-sm text-[#0B2A5B]" : "text-black/55 hover:text-[#0B2A5B]"
                )}
              >
                <MessageSquare size={16} />
                Tutor
              </button>
              <button
                onClick={() => setActiveTab('library')}
                className={cn(
                  "min-w-28 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-xl transition-all",
                  activeTab === 'library' ? "bg-white shadow-sm text-[#0B2A5B]" : "text-black/55 hover:text-[#0B2A5B]"
                )}
              >
                <Library size={16} />
                Biblioteca
              </button>
              <button
                onClick={() => setActiveTab('preparation')}
                className={cn(
                  "min-w-28 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-xl transition-all",
                  activeTab === 'preparation' ? "bg-white shadow-sm text-[#0B2A5B]" : "text-black/55 hover:text-[#0B2A5B]"
                )}
              >
                <BookOpen size={16} />
                Preparación
              </button>
              <button
                onClick={() => setActiveTab('exam')}
                className={cn(
                  "min-w-28 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-xl transition-all",
                  activeTab === 'exam' ? "bg-white shadow-sm text-[#0B2A5B]" : "text-black/55 hover:text-[#0B2A5B]"
                )}
              >
                <ClipboardCheck size={16} />
                Quizz
              </button>
              <button
                onClick={() => setActiveTab('stats')}
                className={cn(
                  "min-w-28 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-xl transition-all",
                  activeTab === 'stats' ? "bg-white shadow-sm text-[#0B2A5B]" : "text-black/55 hover:text-[#0B2A5B]"
                )}
              >
                <BarChart3 size={16} />
                Estadísticas
              </button>
              <button
                onClick={() => setActiveTab('notes')}
                className={cn(
                  "min-w-28 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-xl transition-all",
                  activeTab === 'notes' ? "bg-white shadow-sm text-[#0B2A5B]" : "text-black/55 hover:text-[#0B2A5B]"
                )}
              >
                <NotebookPen size={16} />
                Notas
              </button>
            </div>
          </div>

          <div className="w-10" />
        </header>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'tutor' ? (
            /* TUTOR CHAT SECTION */
            <div className="flex flex-col h-full">
              <div className="flex-1 p-6 space-y-8">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-6">
                    <div className="w-16 h-16 bg-[#EEF4FF] rounded-2xl flex items-center justify-center text-[#1361C5]">
                      <MessageSquare size={32} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-semibold">Tutor Inteligente</h3>
                      <p className="text-black/60 text-sm">
                        Sube un archivo PDF y hazme preguntas sobre su contenido. Estoy aquí para ayudarte a aprender.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-3xl mx-auto w-full space-y-6">
                    {messages.map((msg, idx) => (
                      <motion.div
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        key={idx}
                        className={cn(
                          "flex gap-4",
                          msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                        )}
                      >
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold",
                          msg.role === 'user' ? "bg-[#0B2A5B] text-white" : "bg-[#EEF4FF] text-[#1361C5]"
                        )}>
                          {msg.role === 'user' ? 'U' : 'AI'}
                        </div>
                        <div className={cn(
                          "max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed",
                          msg.role === 'user' 
                            ? "bg-[#0B2A5B] text-white rounded-tr-none" 
                            : "bg-[#EEF4FF] text-black rounded-tl-none border border-[#D7E5F9]"
                        )}
                        onMouseUp={() => {
                          if (msg.role === 'model') {
                            captureChatSelection(idx);
                          }
                        }}
                        >
                          {msg.role === 'model' && (
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-[#0B2A5B]">📎✨ Respuesta del tutor</span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (speakingMessageIndex === idx) {
                                      stopSpeech();
                                    } else {
                                      speakMessage(msg.content, idx);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-[#D7E5F9] bg-white px-2 py-1 text-[11px] text-[#0B2A5B] hover:bg-[#EEF4FF]"
                                  title={speakingMessageIndex === idx ? 'Detener audio' : 'Escuchar respuesta'}
                                >
                                  {speakingMessageIndex === idx ? <Square size={12} /> : <Volume2 size={12} />}
                                  {speakingMessageIndex === idx ? 'Detener' : 'Escuchar'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const selectionForThisMessage = chatSelectionMessageIndex === idx ? chatSelectionText : '';
                                    addNote({
                                      content: selectionForThisMessage || msg.content,
                                      source: 'chat',
                                    });
                                    setChatSelectionText('');
                                    setChatSelectionMessageIndex(null);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-[#D7E5F9] bg-white px-2 py-1 text-[11px] text-[#0B2A5B] hover:bg-[#EEF4FF]"
                                  title="Guardar en notas"
                                >
                                  <BookmarkPlus size={12} />
                                  {chatSelectionMessageIndex === idx && chatSelectionText ? 'Guardar selección' : 'Agregar a notas'}
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="markdown-body prose prose-sm max-w-none">
                            <Markdown>{msg.content}</Markdown>
                          </div>
                          {msg.role === 'model' && msg.reference && (
                            <motion.div
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="mt-3 rounded-xl bg-white border border-[#D7E5F9] px-3 py-2"
                            >
                              <p className="text-xs text-[#1361C5] leading-relaxed">
                                <span className="font-semibold underline decoration-[#1361C5] decoration-2 underline-offset-4">
                                  📌 Notificación:
                                </span>{' '}
                                {msg.reference}
                              </p>
                            </motion.div>
                          )}
                        </div>
                      </motion.div>
                    ))}
                    {isChatting && (
                      <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-lg bg-[#EEF4FF] flex items-center justify-center text-[#1361C5]">
                          <Loader2 size={14} className="animate-spin" />
                        </div>
                        <div className="bg-[#EEF4FF] p-4 rounded-2xl rounded-tl-none border border-[#D7E5F9]">
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 bg-[#1361C5] rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                            <span className="w-1.5 h-1.5 bg-[#1361C5] rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                            <span className="w-1.5 h-1.5 bg-[#1361C5] rounded-full animate-bounce"></span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              {/* Input Area */}
              <div className="p-6 bg-white/90 backdrop-blur-md border-t border-[#D7E5F9]">
                {documents.length > 0 && (
                  <div className="max-w-3xl mx-auto mb-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setChatScope('all')}
                      className={cn(
                        'px-3 py-1.5 text-xs rounded-full border transition-colors',
                        chatScope === 'all'
                          ? 'border-[#1361C5] bg-[#EEF4FF] text-[#1361C5]'
                          : 'border-[#D7E5F9] bg-white text-black/60 hover:text-[#1361C5]'
                      )}
                    >
                      Todos los documentos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setChatScope('selected');
                        if (!chatDocId && selectedDocId) setChatDocId(selectedDocId);
                      }}
                      className={cn(
                        'px-3 py-1.5 text-xs rounded-full border transition-colors',
                        chatScope === 'selected'
                          ? 'border-[#1361C5] bg-[#EEF4FF] text-[#1361C5]'
                          : 'border-[#D7E5F9] bg-white text-black/60 hover:text-[#1361C5]'
                      )}
                    >
                      Documento específico
                    </button>

                    {chatScope === 'selected' && (
                      <select
                        value={chatDocId || ''}
                        onChange={(e) => setChatDocId(e.target.value || null)}
                        className="ml-1 bg-[#EEF4FF] border border-[#D7E5F9] rounded-xl py-1.5 px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1361C5]/20"
                      >
                        <option value="">Selecciona un PDF</option>
                        {documents.map((doc) => (
                          <option key={`chat-doc-${doc.id}`} value={doc.id}>{doc.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {quickActions.length > 0 && (
                  <div className="max-w-3xl mx-auto mb-3">
                    <div className="flex flex-wrap gap-2">
                      {quickActions.map((action) => (
                        <button
                          key={action.label}
                          type="button"
                          onClick={() => setInput(action.prompt)}
                          className="px-3 py-1.5 text-xs rounded-full border border-[#D7E5F9] bg-[#EEF4FF] hover:bg-[#D7E5F9] text-[#1361C5] transition-colors"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <form 
                  onSubmit={handleSendMessage}
                  className="max-w-3xl mx-auto relative"
                >
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder={documents.length > 0 ? "Haz una pregunta sobre uno o varios PDFs..." : "Sube un PDF para empezar..."}
                    className="w-full bg-[#EEF4FF] border border-[#D7E5F9] rounded-2xl py-4 pl-4 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-[#1361C5]/20 focus:border-[#1361C5] transition-all resize-none min-h-[56px] max-h-32"
                    rows={1}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isChatting}
                    className="absolute right-2 bottom-2 p-2 bg-[#1361C5] text-white rounded-xl hover:bg-[#0f4e9f] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  >
                    <Send size={18} />
                  </button>
                </form>
              </div>
            </div>
          ) : activeTab === 'library' ? (
            <div className="p-4 md:p-6 w-full h-full">
              {documents.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-16 h-16 bg-[#EEF4FF] rounded-2xl flex items-center justify-center text-[#1361C5]">
                    <Library size={30} />
                  </div>
                  <h3 className="text-2xl font-semibold">Biblioteca</h3>
                  <p className="text-black/60 text-sm max-w-lg">
                    Sube uno o más documentos para verlos aquí y navegar cada PDF en el navegador.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)] gap-4 pb-10">
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-[#D7E5F9] bg-white p-4">
                      <p className="text-xs uppercase tracking-wider font-semibold text-black/55 mb-2">Biblioteca</p>
                      <div className="space-y-2 max-h-[72vh] overflow-y-auto pr-1">
                        {documents.map((doc) => (
                          <button
                            key={`library-doc-${doc.id}`}
                            onClick={() => {
                              setSelectedDocId(doc.id);
                              setChatDocId(doc.id);
                            }}
                            className={cn(
                              'w-full text-left rounded-xl border px-3 py-2.5 transition-colors',
                              selectedDocId === doc.id
                                ? 'bg-[#EEF4FF] border-[#1361C5]'
                                : 'bg-white border-[#D7E5F9] hover:bg-[#EEF4FF]'
                            )}
                          >
                            <p className="text-sm font-semibold text-[#1361C5] truncate">{doc.name}</p>
                            <p className="text-[11px] text-black/55 mt-0.5">
                              {doc.pageCount || '-'} páginas
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    {!selectedDoc ? (
                      <div className="rounded-2xl border border-dashed border-[#D7E5F9] p-8 text-center text-black/60">
                        Selecciona un documento para visualizar el PDF.
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-[#D7E5F9] bg-white p-4 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-[#1361C5] truncate">{selectedDoc.name}</p>
                            <p className="text-xs text-black/55">
                              Página {Math.min(libraryPage, Math.max(1, libraryTotalPages || 1))} de {libraryTotalPages || selectedDoc.pageCount || '-'}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setLibraryPage((prev) => Math.max(1, prev - 1))}
                              disabled={libraryPage <= 1 || isRenderingPdf}
                              className="p-2 rounded-lg border border-[#D7E5F9] bg-[#EEF4FF] text-[#1361C5] disabled:opacity-50"
                              title="Página anterior"
                            >
                              <ChevronLeft size={16} />
                            </button>
                            <button
                              onClick={() => setLibraryPage((prev) => Math.min(Math.max(1, libraryTotalPages), prev + 1))}
                              disabled={libraryPage >= Math.max(1, libraryTotalPages) || isRenderingPdf}
                              className="p-2 rounded-lg border border-[#D7E5F9] bg-[#EEF4FF] text-[#1361C5] disabled:opacity-50"
                              title="Página siguiente"
                            >
                              <ChevronRight size={16} />
                            </button>
                            <button
                              onClick={() => setLibraryZoom((prev) => Math.max(0.6, Number((prev - 0.1).toFixed(2))))}
                              disabled={isRenderingPdf}
                              className="p-2 rounded-lg border border-[#D7E5F9] bg-white text-[#1361C5] disabled:opacity-50"
                              title="Alejar"
                            >
                              <ZoomOut size={16} />
                            </button>
                            <span className="text-xs text-black/60 w-14 text-center">{Math.round(libraryZoom * 100)}%</span>
                            <button
                              onClick={() => setLibraryZoom((prev) => Math.min(2.5, Number((prev + 0.1).toFixed(2))))}
                              disabled={isRenderingPdf}
                              className="p-2 rounded-lg border border-[#D7E5F9] bg-white text-[#1361C5] disabled:opacity-50"
                              title="Acercar"
                            >
                              <ZoomIn size={16} />
                            </button>
                          </div>
                        </div>

                        <div className="rounded-xl border border-[#D7E5F9] bg-[#F7FAFF] p-2 min-h-[72vh] flex items-start justify-center overflow-auto relative">
                          {isRenderingPdf && (
                            <div className="absolute top-3 right-3 inline-flex items-center gap-2 rounded-full border border-[#D7E5F9] bg-white px-3 py-1 text-xs text-[#1361C5]">
                              <Loader2 size={14} className="animate-spin" />
                              Renderizando...
                            </div>
                          )}
                          {libraryError ? (
                            <p className="text-sm text-red-600 px-4 text-center">{libraryError}</p>
                          ) : (
                            <canvas ref={pdfCanvasRef} className="rounded-lg shadow-sm" />
                          )}
                        </div>

                        <div className="rounded-xl border border-[#D7E5F9] bg-white p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wider text-black/55">Texto seleccionable de la página</p>
                            <button
                              type="button"
                              onClick={addSelectedPdfTextToNotes}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#D7E5F9] bg-[#EEF4FF] px-2 py-1 text-[11px] text-[#0B2A5B] hover:bg-[#D7E5F9]"
                            >
                              <BookmarkPlus size={12} />
                              Agregar selección a notas
                            </button>
                          </div>
                          <div
                            ref={libraryTextRef}
                            className="max-h-28 overflow-y-auto rounded-lg border border-[#D7E5F9] bg-[#F7FAFF] p-2 text-xs text-black/70 leading-relaxed select-text"
                          >
                            {libraryPageText || 'No hay texto extraído en esta página.'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'preparation' ? (
            <div className="p-6 max-w-3xl mx-auto w-full h-full">
              {documents.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-16 h-16 bg-[#EEF4FF] rounded-2xl flex items-center justify-center text-[#1361C5]">
                    <BookOpen size={30} />
                  </div>
                  <h3 className="text-2xl font-semibold">Preparación</h3>
                  <p className="text-black/60 text-sm max-w-lg">
                    Sube uno o más documentos para generar preguntas guiadas con análisis de opciones.
                  </p>
                </div>
              ) : (
                <div className="space-y-6 pb-12">
                  <div className="w-full bg-white border border-[#D7E5F9] rounded-2xl p-5 space-y-5">
                    <div className="rounded-xl border border-[#D7E5F9] bg-[#EEF4FF] p-3">
                      <p className="text-xs text-black/55 font-semibold uppercase tracking-wider mb-1">Modo de preparación</p>
                      <p className="text-sm text-[#1361C5] leading-relaxed">
                        Preguntas guiadas para estudiar cómo razonar respuestas, con etiquetas por opción: Correcta, Distractor o Contiene algo verdadero.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs text-black/55 font-semibold uppercase tracking-wider">Nivel de dificultad</p>
                      <div className="grid grid-cols-3 gap-2">
                        {EXAM_DIFFICULTY_OPTIONS.map((option) => (
                          <button
                            key={`prep-${option.id}`}
                            type="button"
                            onClick={() => setPreparationDifficulty(option.id)}
                            className={cn(
                              "py-2 px-3 rounded-xl border text-sm font-medium transition-colors",
                              preparationDifficulty === option.id
                                ? "bg-[#EEF4FF] border-[#1361C5] text-[#1361C5]"
                                : "border-[#D7E5F9] text-black/55 hover:text-[#1361C5]"
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-black/55 font-semibold uppercase tracking-wider">
                        <span>Cantidad de preguntas</span>
                        <span>{preparationQuestionCount}</span>
                      </div>
                      <input
                        type="range"
                        min={3}
                        max={15}
                        value={preparationQuestionCount}
                        onChange={(e) => setPreparationQuestionCount(Number(e.target.value))}
                        className="w-full accent-[#1361C5]"
                      />
                    </div>

                    <button
                      onClick={generatePreparation}
                      disabled={isGeneratingPreparation}
                      className="flex items-center gap-2 py-3 px-8 bg-[#1361C5] hover:bg-[#0f4e9f] text-white rounded-xl transition-all shadow-md disabled:opacity-50"
                    >
                      {isGeneratingPreparation ? <Loader2 className="animate-spin" size={18} /> : <BookOpen size={18} />}
                      <span className="font-semibold">Generar preparación</span>
                    </button>
                  </div>

                  {preparationQuestions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#D7E5F9] p-6 text-center text-sm text-black/60">
                      Aún no has generado preparación. Haz clic en “Generar preparación”.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {preparationQuestions.map((q, qIdx) => (
                        <div key={q.id} className="rounded-xl border border-[#D7E5F9] bg-[#EEF4FF] p-4">
                          <p className="text-sm font-semibold text-[#1361C5] mb-2">Pregunta {qIdx + 1}</p>
                          <p className="text-sm text-[#1A1A1A] mb-3">{q.text}</p>

                          <div className="space-y-2">
                            {q.options.map((option, optionIdx) => {
                              const letter = String.fromCharCode(65 + optionIdx);
                              const label = q.optionLabels[optionIdx] || 'Distractor';
                              const labelLower = label.toLowerCase();
                              const labelClass = labelLower.includes('correcta')
                                ? 'text-emerald-700 bg-emerald-100 border-emerald-200'
                                : labelLower.includes('verdadero')
                                  ? 'text-amber-700 bg-amber-100 border-amber-200'
                                  : 'text-rose-700 bg-rose-100 border-rose-200';

                              return (
                                <div key={`prep-option-${q.id}-${optionIdx}`} className="rounded-lg border border-[#D7E5F9] bg-white p-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-semibold text-[#1361C5]">{letter}. {option}</p>
                                    <span className={cn('text-[10px] px-2 py-1 rounded-full border font-semibold', labelClass)}>{label}</span>
                                  </div>
                                  <p className="text-xs text-black/70 mt-1.5">{q.optionFeedback[optionIdx]}</p>
                                </div>
                              );
                            })}
                          </div>

                          <div className="mt-4 rounded-lg border border-[#D7E5F9] bg-white p-3">
                            <p className="text-xs font-semibold text-black/55 uppercase tracking-wider mb-2">Ruta de razonamiento</p>
                            <div className="space-y-1.5">
                              {q.reasoningSteps.map((step, stepIdx) => (
                                <div key={`prep-step-${q.id}-${stepIdx}`} className="flex gap-2 text-xs text-black/70 leading-relaxed">
                                  <span className="font-bold">{stepIdx + 1}.</span>
                                  <span>{step}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : activeTab === 'stats' ? (
            <div className="p-6 max-w-4xl mx-auto w-full h-full">
              <div className="space-y-6 pb-12">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-2xl border border-[#D7E5F9] bg-white p-5">
                    <p className="text-xs uppercase tracking-wider text-black/55 font-semibold">PDF cargados</p>
                    <p className="text-3xl font-bold text-[#1361C5] mt-2">{documents.length}</p>
                  </div>
                  <div className="rounded-2xl border border-[#D7E5F9] bg-white p-5">
                    <p className="text-xs uppercase tracking-wider text-black/55 font-semibold">Exámenes realizados</p>
                    <p className="text-3xl font-bold text-[#1361C5] mt-2">{completedExamsCount}</p>
                  </div>
                  <div className="rounded-2xl border border-[#D7E5F9] bg-white p-5">
                    <p className="text-xs uppercase tracking-wider text-black/55 font-semibold">Promedio de nota</p>
                    <p className="text-3xl font-bold text-[#1361C5] mt-2">{averageExamScore.toFixed(1)}%</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#D7E5F9] bg-white p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold">Historial de exámenes</h3>
                    <p className="text-xs text-black/55">Más recientes primero</p>
                  </div>

                  {examHistory.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#D7E5F9] p-6 text-center text-sm text-black/60">
                      Aún no hay exámenes finalizados. Completa uno en la pestaña Examen para ver el historial.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {examHistory.map((item) => (
                        <div key={item.id} className="rounded-xl border border-[#D7E5F9] bg-[#F7FAFF] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-[#1361C5]">{item.score.toFixed(1)}% · {item.questionCount} preguntas · {item.difficultyLabel}</p>
                            <p className="text-xs text-black/60">Fuente: {item.sourceLabel}</p>
                          </div>
                          <p className="text-xs text-black/55">{item.date.toLocaleString('es-CO')}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : activeTab === 'notes' ? (
            <div className="p-6 max-w-4xl mx-auto w-full h-full">
              <div className="space-y-5 pb-12">
                <div className="rounded-2xl border border-[#D7E5F9] bg-white p-5">
                  <h3 className="text-lg font-semibold text-[#0B2A5B]">Notas guardadas para recordar</h3>
                  <p className="text-sm text-black/60 mt-1">
                    Guarda fragmentos clave del chat o del PDF para repasar rápido antes del quizz.
                  </p>
                </div>

                {notes.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#D7E5F9] p-8 text-center text-black/60">
                    Aún no tienes notas. En chat usa “Agregar a notas” o en Biblioteca selecciona texto y guárdalo.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {notes.map((note) => (
                      <div key={note.id} className="rounded-xl border border-[#D7E5F9] bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <p className="text-xs font-semibold uppercase tracking-wider text-black/55">
                            {note.source === 'chat' ? 'Nota desde chat' : 'Nota desde biblioteca'}
                          </p>
                          <p className="text-[11px] text-black/50">{note.createdAt.toLocaleString('es-CO')}</p>
                        </div>

                        <p className="text-sm text-black/80 leading-relaxed whitespace-pre-wrap">{note.content}</p>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {note.docId && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDocId(note.docId || null);
                                setActiveTab('library');
                                if (note.page) {
                                  setLibraryPage(note.page);
                                }
                              }}
                              className="px-3 py-1.5 text-xs rounded-lg border border-[#D7E5F9] bg-[#EEF4FF] text-[#0B2A5B] hover:bg-[#D7E5F9]"
                            >
                              Ir al PDF {note.docName ? `(${note.docName})` : ''}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setNotes((prev) => prev.filter((item) => item.id !== note.id))}
                            className="px-3 py-1.5 text-xs rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                          >
                            Eliminar nota
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* EXAM SIMULATOR SECTION */
            <div className="p-6 max-w-5xl mx-auto w-full h-full">
              {documents.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
                  <div className="w-16 h-16 bg-[#EEF4FF] rounded-2xl flex items-center justify-center text-[#1361C5]">
                    <ClipboardCheck size={32} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-semibold">Quizz</h3>
                    <p className="text-black/60 text-sm">
                      Sube uno o más documentos para generar preguntas de análisis contextual.
                    </p>
                  </div>
                </div>
              ) : !currentExam ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
                  <div className="w-16 h-16 bg-[#EEF4FF] rounded-2xl flex items-center justify-center text-[#1361C5]">
                    <RefreshCw size={32} className={isGeneratingExam ? "animate-spin" : ""} />
                  </div>
                  <div className="space-y-2 max-w-xl">
                    <h3 className="text-2xl font-semibold">¿Listo para tu quizz?</h3>
                    <p className="text-black/60 text-sm">
                      Genera preguntas de análisis y contexto. Elige cantidad y si quieres evaluación global o por un PDF específico.
                    </p>
                  </div>
                  <div className="w-full max-w-xl bg-white border border-[#D7E5F9] rounded-2xl p-5 space-y-5 text-left">
                    <div className="rounded-xl border border-[#D7E5F9] bg-[#EEF4FF] p-3">
                      <p className="text-xs text-black/55 font-semibold uppercase tracking-wider mb-1">Modo de entrenamiento</p>
                      <p className="text-sm text-[#1361C5] leading-relaxed">
                        Selecciona el tipo de práctica: modo mixto integral o solo psicotécnicas, siempre con Lectura Profunda.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs text-black/55 font-semibold uppercase tracking-wider">Tipo de práctica</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {EXAM_PRACTICE_MODE_OPTIONS.map((mode) => (
                          <button
                            key={`practice-${mode.id}`}
                            type="button"
                            onClick={() => setExamPracticeMode(mode.id)}
                            className={cn(
                              'rounded-xl border p-3 text-left transition-colors',
                              examPracticeMode === mode.id
                                ? 'bg-[#EEF4FF] border-[#1361C5]'
                                : 'border-[#D7E5F9] hover:bg-[#F7FAFF]'
                            )}
                          >
                            <p className={cn('text-sm font-semibold', examPracticeMode === mode.id ? 'text-[#1361C5]' : 'text-[#0B2A5B]')}>{mode.label}</p>
                            <p className="text-[11px] text-black/60 mt-1 leading-relaxed">{mode.guidance}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs text-black/55 font-semibold uppercase tracking-wider">Nivel de dificultad</p>
                      <div className="grid grid-cols-3 gap-2">
                        {EXAM_DIFFICULTY_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setExamDifficulty(option.id)}
                            className={cn(
                              "py-2 px-3 rounded-xl border text-sm font-medium transition-colors",
                              examDifficulty === option.id
                                ? "bg-[#EEF4FF] border-[#1361C5] text-[#1361C5]"
                                : "border-[#D7E5F9] text-black/55 hover:text-[#1361C5]"
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-black/55 font-semibold uppercase tracking-wider">
                        <span>Cantidad de preguntas</span>
                        <span>{examQuestionCount}</span>
                      </div>
                      <input
                        type="range"
                        min={3}
                        max={20}
                        value={examQuestionCount}
                        onChange={(e) => setExamQuestionCount(Number(e.target.value))}
                        className="w-full accent-[#1361C5]"
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs text-black/55 font-semibold uppercase tracking-wider">Alcance</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setExamScope('global')}
                          className={cn(
                            "flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors",
                            examScope === 'global'
                              ? "bg-[#EEF4FF] border-[#1361C5] text-[#1361C5]"
                              : "border-[#D7E5F9] text-black/55 hover:text-[#1361C5]"
                          )}
                        >
                          Preguntas globales
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setExamScope('selected');
                            if (!examDocId && selectedDocId) setExamDocId(selectedDocId);
                          }}
                          className={cn(
                            "flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors",
                            examScope === 'selected'
                              ? "bg-[#EEF4FF] border-[#1361C5] text-[#1361C5]"
                              : "border-[#D7E5F9] text-black/55 hover:text-[#1361C5]"
                          )}
                        >
                          PDF específico
                        </button>
                      </div>
                    </div>

                    {examScope === 'selected' && (
                      <div className="space-y-2">
                        <p className="text-xs text-black/55 font-semibold uppercase tracking-wider">Documento</p>
                        <select
                          value={examDocId || ''}
                          onChange={(e) => setExamDocId(e.target.value || null)}
                          className="w-full bg-[#EEF4FF] border border-[#D7E5F9] rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1361C5]/20"
                        >
                          <option value="">Selecciona un PDF</option>
                          {documents.map((doc) => (
                            <option key={doc.id} value={doc.id}>{doc.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={generateExam}
                    disabled={isGeneratingExam || (examScope === 'selected' && !examSelectedDoc)}
                    className="flex items-center gap-2 py-3 px-8 bg-[#1361C5] hover:bg-[#0f4e9f] text-white rounded-xl transition-all shadow-md disabled:opacity-50"
                  >
                    {isGeneratingExam ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                    <span className="font-semibold">Generar {examQuestionCount} preguntas · {examPracticeMode === 'psicotecnico' ? 'Solo psicotécnicas' : 'Modo mixto'}</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-8 pb-12">
                  <div className="sticky top-0 bg-[#F7FAFF]/95 backdrop-blur-sm py-4 z-10 border-b border-[#D7E5F9]">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-bold text-[#0B2A5B]">Reto de preguntas</h3>
                        <p className="text-xs text-black/55">Modo: {currentExam.practiceModeLabel} · Dificultad: {currentExam.difficultyLabel} · Fuente: {currentExam.sourceLabel}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="inline-flex items-center gap-2 rounded-xl border border-[#D7E5F9] bg-white px-3 py-2 text-xs text-black/65">
                          <span>🏁</span>
                          <span>{liveExamStats?.answeredCount || 0}/{currentExam.questions.length} respondidas</span>
                        </div>
                        <button
                          type="button"
                          onClick={goToNewQuizSetup}
                          className="px-3 py-2 rounded-xl bg-[#0B2A5B] hover:bg-[#082043] text-white text-xs font-semibold"
                        >
                          Quizz nuevo
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="h-2 w-full rounded-full bg-[#EAF1FF] overflow-hidden">
                        <div className="h-full rounded-full bg-[#1361C5] transition-all" style={{ width: `${liveExamStats?.progress || 0}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-black/55">
                        <span>Precisión actual: {liveExamStats?.accuracy.toFixed(0) || 0}%</span>
                        <span>Página {examPageIndex + 1} de {totalExamPages}</span>
                      </div>
                    </div>
                  </div>

                  {!shouldShowExamResults && (
                    <>
                      <div className="space-y-6 mt-2">
                        {paginatedExamQuestions.map((q, localIdx) => {
                          const globalIndex = examPageIndex * examQuestionsPerPage + localIdx;
                          const selectedAnswer = currentExam.userAnswers[q.id];
                          const answered = typeof selectedAnswer === 'number';

                          return (
                            <div key={q.id} className="rounded-2xl border border-[#D7E5F9] bg-white p-5 space-y-4">
                              <div className="flex gap-3">
                                <span className="w-7 h-7 rounded-full bg-[#EAF1FF] text-[#0B2A5B] flex items-center justify-center text-xs font-bold flex-shrink-0">
                                  {globalIndex + 1}
                                </span>
                                <h4 className="font-semibold text-lg leading-tight text-[#0B2A5B]">{q.text}</h4>
                              </div>

                              <div className="grid grid-cols-1 gap-3">
                                {q.options.map((option, oIdx) => {
                                  const isSelected = selectedAnswer === oIdx;
                                  const isCorrect = q.correctAnswer === oIdx;
                                  const showImmediate = answered;

                                  return (
                                    <button
                                      key={oIdx}
                                      onClick={() => handleAnswerSelect(q.id, oIdx)}
                                      disabled={currentExam.completed || answered}
                                      className={cn(
                                        'p-4 text-left text-sm rounded-xl border transition-all',
                                        !showImmediate && 'border-[#D7E5F9] hover:border-[#1361C5] hover:bg-[#EEF4FF]',
                                        showImmediate && isCorrect && 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500',
                                        showImmediate && isSelected && !isCorrect && 'border-red-500 bg-red-50 ring-1 ring-red-500',
                                        showImmediate && !isSelected && !isCorrect && 'border-[#D7E5F9] opacity-70'
                                      )}
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <span>{option}</span>
                                        {showImmediate && isCorrect && <CheckCircle2 size={16} className="text-emerald-600" />}
                                        {showImmediate && isSelected && !isCorrect && <X size={16} className="text-red-600" />}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>

                              {answered && (
                                <motion.div
                                  initial={{ opacity: 0, y: 6 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="rounded-xl border border-[#D7E5F9] bg-[#F7FAFF] p-3 space-y-3"
                                >
                                  <p className="text-xs text-black/70">
                                    {selectedAnswer === q.correctAnswer ? '✅ ¡Correcta!' : '❌ Incorrecta.'} {q.explanation}
                                  </p>

                                  <div className="rounded-lg border border-[#D7E5F9] bg-white p-3">
                                    <p className="text-[11px] uppercase tracking-wider font-semibold text-black/55 mb-1">Por qué esta opción</p>
                                    <p className="text-xs text-black/70 leading-relaxed">
                                      {typeof selectedAnswer === 'number' && q.optionFeedback[selectedAnswer]
                                        ? q.optionFeedback[selectedAnswer]
                                        : 'Revisa la relación entre el enunciado y la opción elegida para identificar el criterio correcto.'}
                                    </p>
                                  </div>

                                  <div className="rounded-lg border border-[#D7E5F9] bg-white p-3">
                                    <p className="text-[11px] uppercase tracking-wider font-semibold text-black/55 mb-1">Explicación detallada</p>
                                    <p className="text-xs text-black/75 leading-relaxed mb-2">{q.explanation}</p>
                                    <div className="space-y-1.5">
                                      {q.reasoningSteps.map((step, stepIdx) => (
                                        <div key={`quiz-step-${q.id}-${stepIdx}`} className="flex gap-2 text-xs text-black/70 leading-relaxed">
                                          <span className="font-bold text-[#0B2A5B]">{stepIdx + 1}.</span>
                                          <span>{step}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setExamPageIndex((prev) => Math.max(0, prev - 1))}
                            disabled={examPageIndex === 0}
                            className="px-4 py-2 rounded-xl border border-[#D7E5F9] bg-white text-sm text-[#0B2A5B] disabled:opacity-50"
                          >
                            Anterior
                          </button>
                          <button
                            onClick={() => setExamPageIndex((prev) => Math.min(totalExamPages - 1, prev + 1))}
                            disabled={examPageIndex >= totalExamPages - 1}
                            className="px-4 py-2 rounded-xl border border-[#D7E5F9] bg-white text-sm text-[#0B2A5B] disabled:opacity-50"
                          >
                            Siguiente
                          </button>
                        </div>

                        <button
                          onClick={finishExam}
                          className="py-2.5 px-6 bg-[#1361C5] hover:bg-[#0f4e9f] text-white rounded-xl transition-all shadow-sm"
                        >
                          Ver resultados globales
                        </button>
                      </div>

                      {(liveExamStats?.answeredCount || 0) < currentExam.questions.length && (
                        <p className="text-xs text-black/55">
                          Te faltan {currentExam.questions.length - (liveExamStats?.answeredCount || 0)} pregunta(s) por responder para cerrar el quizz.
                        </p>
                      )}
                    </>
                  )}

                  {shouldShowExamResults && currentExam.completed && (
                    <div className="rounded-2xl border border-[#D7E5F9] bg-white p-5 space-y-4">
                      <h4 className="text-lg font-semibold text-[#0B2A5B]">Resultados globales</h4>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="rounded-xl border border-[#D7E5F9] bg-[#F7FAFF] p-3">
                          <p className="text-xs text-black/55 uppercase">Buenas</p>
                          <p className="text-2xl font-bold text-emerald-600">{liveExamStats?.correctCount || 0}</p>
                        </div>
                        <div className="rounded-xl border border-[#D7E5F9] bg-[#F7FAFF] p-3">
                          <p className="text-xs text-black/55 uppercase">Malas</p>
                          <p className="text-2xl font-bold text-red-600">{liveExamStats?.wrongCount || 0}</p>
                        </div>
                        <div className="rounded-xl border border-[#D7E5F9] bg-[#F7FAFF] p-3">
                          <p className="text-xs text-black/55 uppercase">Nota final</p>
                          <p className="text-2xl font-bold text-[#1361C5]">{(currentExam.score || 0).toFixed(1)}%</p>
                        </div>
                        <div className="rounded-xl border border-[#D7E5F9] bg-[#F7FAFF] p-3 flex items-center justify-center">
                          <svg width="110" height="110" viewBox="0 0 120 120" className="overflow-visible">
                            <circle cx="60" cy="60" r="44" fill="none" stroke="#EAF1FF" strokeWidth="12" />
                            <circle
                              cx="60"
                              cy="60"
                              r="44"
                              fill="none"
                              stroke="#1361C5"
                              strokeWidth="12"
                              strokeLinecap="round"
                              strokeDasharray={`${2 * Math.PI * 44}`}
                              strokeDashoffset={`${2 * Math.PI * 44 * (1 - ((currentExam.score || 0) / 100))}`}
                              transform="rotate(-90 60 60)"
                            />
                            <text x="60" y="64" textAnchor="middle" fontSize="18" fontWeight="700" fill="#0B2A5B">
                              {(currentExam.score || 0).toFixed(0)}%
                            </text>
                          </svg>
                        </div>
                      </div>

                      <div className="rounded-xl border border-[#D7E5F9] bg-[#EEF4FF] p-4">
                        <p className="text-sm font-semibold text-[#0B2A5B] mb-2">Qué debes estudiar y dónde</p>
                        <ul className="space-y-2">
                          {examStudyRecommendations.map((item) => (
                            <li key={item.id} className="text-xs text-black/75 leading-relaxed">
                              <div className="flex flex-wrap items-start gap-2">
                                <span>• {item.text}</span>
                                {item.docId && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedDocId(item.docId);
                                      setActiveTab('library');
                                    }}
                                    className="px-2 py-0.5 rounded-md border border-[#D7E5F9] bg-white text-[#0B2A5B] hover:bg-[#EAF1FF]"
                                  >
                                    Ver PDF
                                  </button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="pt-1 flex flex-wrap items-center gap-2">
                        <button
                          onClick={restartCurrentQuiz}
                          className="py-2.5 px-6 border border-[#D7E5F9] bg-white hover:bg-[#EEF4FF] text-[#0B2A5B] rounded-xl transition-all shadow-sm"
                        >
                          Reiniciar quizz
                        </button>
                        <button
                          onClick={goToNewQuizSetup}
                          className="py-2.5 px-6 bg-[#0B2A5B] hover:bg-[#082043] text-white rounded-xl transition-all shadow-sm"
                        >
                          Quizz nuevo
                        </button>
                      </div>
                    </div>
                  )}

                  {examPulseModal?.visible && (
                    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/25 px-4">
                      <div className="w-full max-w-sm rounded-2xl bg-white border border-[#D7E5F9] p-5 text-center shadow-xl">
                        <p className="text-4xl mb-2">{examPulseModal.emoji}</p>
                        <h5 className="text-lg font-bold text-[#0B2A5B]">{examPulseModal.title}</h5>
                        <p className="text-sm text-black/65 mt-1">{examPulseModal.message}</p>
                        <button
                          onClick={() => setExamPulseModal(null)}
                          className="mt-4 px-4 py-2 rounded-xl bg-[#1361C5] hover:bg-[#0f4e9f] text-white text-sm"
                        >
                          Seguir
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
