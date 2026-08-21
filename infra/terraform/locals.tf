locals {
  prefix = "kycvault-${var.environment}"

  labels = merge(var.labels, {
    environment = var.environment
  })

  # Google-managed service agents that need to be able to use our CMEK keys.
  sql_service_agent    = "service-${data.google_project.this.number}@gcp-sa-cloud-sql.iam.gserviceaccount.com"
  secret_service_agent = "service-${data.google_project.this.number}@gcp-sa-secretmanager.iam.gserviceaccount.com"
  ar_service_agent     = "service-${data.google_project.this.number}@gcp-sa-artifactregistry.iam.gserviceaccount.com"

  # The IAM database user name is the service-account email minus the
  # ".gserviceaccount.com" suffix - this is how Cloud SQL IAM auth maps
  # a principal to a Postgres role.
  db_iam_user = trimsuffix(google_service_account.backend.email, ".gserviceaccount.com")
}
