/*
  # Create Study App Database Schema

  ## Overview
  Creates the complete database schema for a study application with PDF document management,
  chat conversations, exams, and user progress tracking.

  ## New Tables

  ### 1. `documents`
  Stores uploaded PDF documents with metadata and content
  - `id` (uuid, primary key) - Unique document identifier
  - `user_id` (uuid, foreign key) - Owner of the document
  - `title` (text) - Document title
  - `content` (text) - Extracted text content from PDF
  - `page_count` (integer) - Number of pages in document
  - `file_size` (bigint) - File size in bytes
  - `upload_date` (timestamptz) - When document was uploaded
  - `created_at` (timestamptz) - Record creation timestamp

  ### 2. `conversations`
  Stores chat conversations related to documents
  - `id` (uuid, primary key) - Unique conversation identifier
  - `user_id` (uuid, foreign key) - Owner of the conversation
  - `document_id` (uuid, foreign key) - Related document
  - `title` (text) - Conversation title
  - `messages` (jsonb) - Array of message objects
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 3. `exams`
  Stores generated exams and practice tests
  - `id` (uuid, primary key) - Unique exam identifier
  - `user_id` (uuid, foreign key) - Owner of the exam
  - `document_id` (uuid, foreign key) - Source document
  - `title` (text) - Exam title
  - `difficulty` (text) - Difficulty level (basico, intermedio, avanzado)
  - `practice_mode` (text) - Practice mode (mixto, psicotecnico)
  - `questions` (jsonb) - Array of question objects
  - `created_at` (timestamptz) - Record creation timestamp

  ### 4. `exam_results`
  Stores user exam attempt results and answers
  - `id` (uuid, primary key) - Unique result identifier
  - `user_id` (uuid, foreign key) - User who took the exam
  - `exam_id` (uuid, foreign key) - Related exam
  - `answers` (jsonb) - User's answers
  - `score` (integer) - Score achieved (0-100)
  - `completed_at` (timestamptz) - When exam was completed
  - `time_spent_seconds` (integer) - Time spent on exam

  ### 5. `user_app_state`
  Stores user application state and preferences (already exists, will not recreate)
  - `user_id` (uuid, primary key) - User identifier
  - `state` (jsonb) - Application state data
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security
  - Enable Row Level Security (RLS) on all tables
  - Users can only access their own data
  - All policies check `auth.uid() = user_id`
  - Separate policies for SELECT, INSERT, UPDATE, DELETE operations

  ## Indexes
  - Create indexes on foreign keys for better query performance
  - Create indexes on frequently queried columns (user_id, document_id, created_at)
*/

-- Create documents table
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  page_count integer NOT NULL DEFAULT 0,
  file_size bigint NOT NULL DEFAULT 0,
  upload_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create conversations table
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Nueva conversación',
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create exams table
CREATE TABLE IF NOT EXISTS public.exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Examen sin título',
  difficulty text NOT NULL DEFAULT 'intermedio',
  practice_mode text NOT NULL DEFAULT 'mixto',
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create exam_results table
CREATE TABLE IF NOT EXISTS public.exam_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  score integer NOT NULL DEFAULT 0,
  completed_at timestamptz NOT NULL DEFAULT now(),
  time_spent_seconds integer DEFAULT 0
);

-- User app state table already exists from supabase.sql, ensure it exists
CREATE TABLE IF NOT EXISTS public.user_app_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON public.documents(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_document_id ON public.conversations(document_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON public.conversations(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_exams_user_id ON public.exams(user_id);
CREATE INDEX IF NOT EXISTS idx_exams_document_id ON public.exams(document_id);
CREATE INDEX IF NOT EXISTS idx_exams_created_at ON public.exams(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exam_results_user_id ON public.exam_results(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_results_exam_id ON public.exam_results(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_results_completed_at ON public.exam_results(completed_at DESC);

-- Enable Row Level Security on all tables
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_app_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies for documents table
CREATE POLICY "Users can view own documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents"
  ON public.documents FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own documents"
  ON public.documents FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own documents"
  ON public.documents FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for conversations table
CREATE POLICY "Users can view own conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
  ON public.conversations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for exams table
CREATE POLICY "Users can view own exams"
  ON public.exams FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own exams"
  ON public.exams FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own exams"
  ON public.exams FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own exams"
  ON public.exams FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for exam_results table
CREATE POLICY "Users can view own exam results"
  ON public.exam_results FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own exam results"
  ON public.exam_results FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own exam results"
  ON public.exam_results FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own exam results"
  ON public.exam_results FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for user_app_state table (if not already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'user_app_state' 
    AND policyname = 'Users can view own state'
  ) THEN
    CREATE POLICY "Users can view own state"
      ON public.user_app_state FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'user_app_state' 
    AND policyname = 'Users can insert own state'
  ) THEN
    CREATE POLICY "Users can insert own state"
      ON public.user_app_state FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'user_app_state' 
    AND policyname = 'Users can update own state'
  ) THEN
    CREATE POLICY "Users can update own state"
      ON public.user_app_state FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'user_app_state' 
    AND policyname = 'Users can delete own state'
  ) THEN
    CREATE POLICY "Users can delete own state"
      ON public.user_app_state FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;