# ---------------------------------------------------------------------------
# Workload identities. One service account per job, no shared keys, and no
# exported JSON key files anywhere - Cloud Run gets its credentials from the
# metadata server.
# ---------------------------------------------------------------------------

resource "google_service_account" "backend" {
  account_id   = "${local.prefix}-backend"
  display_name = "KYCVault backend (Cloud Run)"
  description  = "Runtime identity: unwraps PII DEKs, signs Ethereum transactions via KMS, connects to Cloud SQL with IAM auth."
}

resource "google_service_account" "migrator" {
  account_id   = "${local.prefix}-migrator"
  display_name = "KYCVault schema migrator"
  description  = "Runs Prisma migrations and the envelope-encryption backfill. Separate from the runtime identity so migrations can be revoked independently."
}

# --- Cloud SQL access -------------------------------------------------------
# roles/cloudsql.client covers the Auth Proxy handshake; instanceUser is what
# actually permits IAM database authentication.
resource "google_project_iam_member" "backend_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_sql_instance_user" {
  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "migrator_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.migrator.email}"
}

resource "google_project_iam_member" "migrator_sql_instance_user" {
  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${google_service_account.migrator.email}"
}

# The migrator re-encrypts existing rows, so it needs the same KEK access.
resource "google_kms_crypto_key_iam_member" "migrator_pii_kek" {
  crypto_key_id = google_kms_crypto_key.pii_kek.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.migrator.email}"
}

# --- Observability ----------------------------------------------------------
resource "google_project_iam_member" "backend_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_metric_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_trace" {
  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

# ---------------------------------------------------------------------------
# Data-access audit logs.
#
# Admin-activity logs are always on and free. DATA_READ on Cloud KMS is what
# actually produces the record "principal X unwrapped a DEK at time T" - the
# evidence an auditor asks for. Without this block, key usage is invisible.
# ---------------------------------------------------------------------------
resource "google_project_iam_audit_config" "kms" {
  project = var.project_id
  service = "cloudkms.googleapis.com"

  audit_log_config {
    log_type = "DATA_READ"
  }

  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

resource "google_project_iam_audit_config" "secretmanager" {
  project = var.project_id
  service = "secretmanager.googleapis.com"

  audit_log_config {
    log_type = "DATA_READ"
  }
}

resource "google_project_iam_audit_config" "sql" {
  project = var.project_id
  service = "cloudsql.googleapis.com"

  audit_log_config {
    log_type = "DATA_WRITE"
  }
}
