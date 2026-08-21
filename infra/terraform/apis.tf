# Every API this stack touches. Enabled explicitly so a fresh project can be
# stood up from zero with a single `terraform apply`.
resource "google_project_service" "required" {
  for_each = toset([
    "cloudkms.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "servicenetworking.googleapis.com",
    "vpcaccess.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "cloudasset.googleapis.com",
    "vision.googleapis.com",
  ])

  project = var.project_id
  service = each.value

  # Disabling an API on destroy can orphan resources in other stacks.
  disable_on_destroy = false
}
