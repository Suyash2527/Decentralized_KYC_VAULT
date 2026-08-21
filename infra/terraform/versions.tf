terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.12"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state with locking. Create the bucket once, out of band:
  #   gsutil mb -l asia-south1 gs://<project>-tfstate
  #   gsutil versioning set on gs://<project>-tfstate
  backend "gcs" {
    # bucket = "kycvault-prod-tfstate"   # set via -backend-config
    prefix = "kycvault/infra"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

data "google_project" "this" {
  project_id = var.project_id
}
