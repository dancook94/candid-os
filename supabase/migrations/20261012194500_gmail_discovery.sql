-- Phase 1 Gmail discovery. This stores a mailbox connection and discovery
-- records only. It does not create supplier invoices, materials, or prices.
-- Apply manually in Supabase. Do not run automatically from the app.

BEGIN;

CREATE TABLE IF NOT EXISTS public.gmail_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox text NOT NULL,
  status text NOT NULL,
  scopes text NOT NULL,
  google_email text,
  connected_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  connected_at timestamptz,
  revoked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  history_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_connections_mailbox_lower CHECK (mailbox = lower(mailbox)),
  CONSTRAINT gmail_connections_status_check CHECK (
    status IN ('connected', 'error', 'revoked', 'disconnected')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS gmail_connections_mailbox_idx
  ON public.gmail_connections (mailbox);

DROP TRIGGER IF EXISTS gmail_connections_set_updated_at ON public.gmail_connections;
CREATE TRIGGER gmail_connections_set_updated_at
  BEFORE UPDATE ON public.gmail_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

-- Refresh tokens are ciphertext only. Authenticated admins cannot select this table.
CREATE TABLE IF NOT EXISTS public.gmail_connection_secrets (
  connection_id uuid PRIMARY KEY REFERENCES public.gmail_connections (id) ON DELETE CASCADE,
  refresh_token_ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_connection_secrets_ciphertext_not_blank CHECK (
    btrim(refresh_token_ciphertext) <> ''
  )
);

CREATE TABLE IF NOT EXISTS public.gmail_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.gmail_connections (id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'discovery',
  status text NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  page_token text,
  query text NOT NULL,
  messages_seen integer NOT NULL DEFAULT 0,
  attachments_seen integer NOT NULL DEFAULT 0,
  pdfs_seen integer NOT NULL DEFAULT 0,
  images_seen integer NOT NULL DEFAULT 0,
  invoices_found integer NOT NULL DEFAULT 0,
  credit_notes_found integer NOT NULL DEFAULT 0,
  sales_orders_found integer NOT NULL DEFAULT 0,
  delivery_notes_found integer NOT NULL DEFAULT 0,
  unknown_found integer NOT NULL DEFAULT 0,
  duplicates_found integer NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0,
  skipped_found integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  paused_at timestamptz,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_import_runs_kind_check CHECK (kind = 'discovery'),
  CONSTRAINT gmail_import_runs_status_check CHECK (
    status IN ('running', 'paused', 'completed', 'failed')
  ),
  CONSTRAINT gmail_import_runs_dates_check CHECK (date_from <= date_to),
  CONSTRAINT gmail_import_runs_counts_non_negative CHECK (
    messages_seen >= 0
    AND attachments_seen >= 0
    AND pdfs_seen >= 0
    AND images_seen >= 0
    AND invoices_found >= 0
    AND credit_notes_found >= 0
    AND sales_orders_found >= 0
    AND delivery_notes_found >= 0
    AND unknown_found >= 0
    AND duplicates_found >= 0
    AND failures >= 0
    AND skipped_found >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS gmail_import_runs_one_active_idx
  ON public.gmail_import_runs (connection_id)
  WHERE status IN ('running', 'paused');

CREATE INDEX IF NOT EXISTS gmail_import_runs_created_idx
  ON public.gmail_import_runs (created_at DESC);

DROP TRIGGER IF EXISTS gmail_import_runs_set_updated_at ON public.gmail_import_runs;
CREATE TRIGGER gmail_import_runs_set_updated_at
  BEFORE UPDATE ON public.gmail_import_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE TABLE IF NOT EXISTS public.gmail_import_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.gmail_import_runs (id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_import_messages_id_not_blank CHECK (btrim(gmail_message_id) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS gmail_import_messages_run_message_idx
  ON public.gmail_import_messages (run_id, gmail_message_id);

CREATE TABLE IF NOT EXISTS public.gmail_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.gmail_import_runs (id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.gmail_connections (id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL,
  gmail_attachment_id text NOT NULL,
  gmail_thread_id text,
  filename text NOT NULL,
  mime_type text,
  byte_size integer,
  checksum_sha256 text,
  document_type text NOT NULL,
  status text NOT NULL,
  supplier_id uuid REFERENCES public.suppliers (id) ON DELETE SET NULL,
  supplier_note text,
  invoice_number text,
  invoice_date date,
  duplicate_invoice_id uuid REFERENCES public.supplier_invoices (id) ON DELETE SET NULL,
  duplicate_item_id uuid REFERENCES public.gmail_import_items (id) ON DELETE SET NULL,
  detail text,
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_import_items_document_type_check CHECK (
    document_type IN (
      'invoice',
      'credit_note',
      'sales_order',
      'delivery_note',
      'unknown',
      'unsupported_image'
    )
  ),
  CONSTRAINT gmail_import_items_status_check CHECK (
    status IN ('stored', 'recorded', 'duplicate', 'skipped', 'failed')
  ),
  CONSTRAINT gmail_import_items_checksum_length CHECK (
    checksum_sha256 IS NULL OR char_length(checksum_sha256) = 64
  ),
  CONSTRAINT gmail_import_items_byte_size_non_negative CHECK (
    byte_size IS NULL OR byte_size >= 0
  ),
  CONSTRAINT gmail_import_items_attempt_count_non_negative CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS gmail_import_items_attachment_idx
  ON public.gmail_import_items (gmail_message_id, gmail_attachment_id);

CREATE INDEX IF NOT EXISTS gmail_import_items_run_idx
  ON public.gmail_import_items (run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gmail_import_items_failed_idx
  ON public.gmail_import_items (run_id)
  WHERE status = 'failed';

DROP TRIGGER IF EXISTS gmail_import_items_set_updated_at ON public.gmail_import_items;
CREATE TRIGGER gmail_import_items_set_updated_at
  BEFORE UPDATE ON public.gmail_import_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE TABLE IF NOT EXISTS public.gmail_import_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL UNIQUE REFERENCES public.gmail_import_items (id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  checksum_sha256 text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_import_files_size_positive CHECK (byte_size > 0),
  CONSTRAINT gmail_import_files_checksum_length CHECK (char_length(checksum_sha256) = 64)
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gmail-import-files',
  'gmail-import-files',
  false,
  15728640,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.gmail_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_connection_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_import_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_import_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gmail_connections_select_admin ON public.gmail_connections;
CREATE POLICY gmail_connections_select_admin
  ON public.gmail_connections FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS gmail_import_runs_select_admin ON public.gmail_import_runs;
CREATE POLICY gmail_import_runs_select_admin
  ON public.gmail_import_runs FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS gmail_import_messages_select_admin ON public.gmail_import_messages;
CREATE POLICY gmail_import_messages_select_admin
  ON public.gmail_import_messages FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS gmail_import_items_select_admin ON public.gmail_import_items;
CREATE POLICY gmail_import_items_select_admin
  ON public.gmail_import_items FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS gmail_import_files_select_admin ON public.gmail_import_files;
CREATE POLICY gmail_import_files_select_admin
  ON public.gmail_import_files FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS gmail_import_files_storage_select_admin ON storage.objects;
CREATE POLICY gmail_import_files_storage_select_admin
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'gmail-import-files'
    AND public.is_approved_candid_admin()
  );

REVOKE ALL ON TABLE public.gmail_connections FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.gmail_connection_secrets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gmail_import_runs FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.gmail_import_messages FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.gmail_import_items FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.gmail_import_files FROM PUBLIC, anon;

GRANT SELECT ON public.gmail_connections TO authenticated;
GRANT SELECT ON public.gmail_import_runs TO authenticated;
GRANT SELECT ON public.gmail_import_messages TO authenticated;
GRANT SELECT ON public.gmail_import_items TO authenticated;
GRANT SELECT ON public.gmail_import_files TO authenticated;

GRANT ALL ON public.gmail_connections TO service_role;
GRANT ALL ON public.gmail_connection_secrets TO service_role;
GRANT ALL ON public.gmail_import_runs TO service_role;
GRANT ALL ON public.gmail_import_messages TO service_role;
GRANT ALL ON public.gmail_import_items TO service_role;
GRANT ALL ON public.gmail_import_files TO service_role;

COMMIT;
