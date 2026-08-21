resource "google_artifact_registry_repository" "backend" {
  location      = var.region
  repository_id = "${local.prefix}-images"
  format        = "DOCKER"
  description   = "Backend container images. CMEK-encrypted; immutable tags."

  kms_key_name = google_kms_crypto_key.artifact_cmek.id

  docker_config {
    # Prevents a tag from being repointed after it has been reviewed, so the
    # digest that passed scanning is the digest that runs.
    immutable_tags = true
  }

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = 20
    }
  }

  labels = local.labels

  depends_on = [google_kms_crypto_key_iam_member.artifact_agent_cmek]
}

resource "google_kms_crypto_key" "artifact_cmek" {
  name            = "artifact-cmek"
  key_ring        = google_kms_key_ring.main.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = var.key_rotation_period

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = var.kms_protection_level
  }

  destroy_scheduled_duration = "2592000s"
  labels                     = local.labels
}

resource "google_project_service_identity" "artifactregistry" {
  provider = google-beta
  project  = var.project_id
  service  = "artifactregistry.googleapis.com"

  depends_on = [google_project_service.required]
}

resource "google_kms_crypto_key_iam_member" "artifact_agent_cmek" {
  crypto_key_id = google_kms_crypto_key.artifact_cmek.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${local.ar_service_agent}"

  depends_on = [google_project_service_identity.artifactregistry]
}

resource "google_artifact_registry_repository_iam_member" "backend_reader" {
  location   = google_artifact_registry_repository.backend.location
  repository = google_artifact_registry_repository.backend.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.backend.email}"
}
