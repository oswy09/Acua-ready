export interface Message {
  role: 'user' | 'model';
  content: string;
  reference?: string;
}

export interface Document {
  id: string;
  name: string;
  content: string;
  pdfData?: Uint8Array;
  pageCount?: number;
  uploadDate: Date;
}

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  reasoningSteps: string[];
  optionFeedback: string[];
}

export type ExamDifficulty = 'basico' | 'intermedio' | 'avanzado';
export type ExamPracticeMode = 'mixto' | 'psicotecnico';

export interface Exam {
  id: string;
  docId: string | null;
  scope: 'global' | 'selected';
  practiceMode: ExamPracticeMode;
  practiceModeLabel: string;
  difficulty: ExamDifficulty;
  difficultyLabel: string;
  sourceLabel: string;
  questions: Question[];
  score?: number;
  completed: boolean;
  userAnswers: Record<string, number>;
}
