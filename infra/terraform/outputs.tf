output "cloud_run_url" {
  description = "Public HTTPS endpoint of the backend API."
  value       = google_cloud_run_v2_service.backend.uri
}

output "sql_connection_name" {
  description = "Cloud SQL instance connection name, used by the Auth Proxy."
  value       = google_sql_database_instance.main.connection_name
}

output "sql_private_ip" {
  description = "Private IP of the Cloud SQL instance. Unreachable from outside the VPC."
  value       = google_sql_database_instance.main.private_ip_address
}

output "backend_service_account" {
  description = "Runtime identity. Grant nothing else to this principal without review."
  value       = google_service_account.backend.email
}

output "migrator_service_account" {
  description = "Identity to impersonate when running migrations or the encryption backfill."
  value       = google_service_account.migrator.email
}

output "kms_pii_kek" {
  description = "Resource name of the PII key-encryption key."
  value       = google_kms_crypto_key.pii_kek.id
}

output "kms_signing_key_version" {
  description = "Resource name of the Ethereum operator signing key version. Feed this to scripts/kms-operator-address.ts to derive the on-chain operator address."
  value       = "${google_kms_crypto_key.operator_signing.id}/cryptoKeyVersions/1"
}

output "artifact_repository" {
  description = "Docker push target for backend images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.backend.repository_id}"
}
