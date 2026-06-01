# Google Cloud Run Deployment Guide

This guide explains how to deploy the `backend_krishi` service to **Google Cloud Run**.

---

## 1. Prerequisites

Before deploying, ensure you have:
1. A **Google Cloud Platform (GCP)** account.
2. The **Google Cloud SDK (gcloud CLI)** installed on your machine.
   - [Download & Installation Instructions](https://cloud.google.com/sdk/docs/install)
3. A GCP project created.

---

## 2. Initializing the gcloud CLI

Open your terminal (PowerShell, Command Prompt, or bash) and initialize gcloud:

```bash
# 1. Authenticate with your Google Account
gcloud auth login

# 2. Initialize configuration and select your GCP Project
gcloud init
```

---

## 3. Enable Required GCP APIs

To build and run containers on Cloud Run, you need to enable the following APIs in your GCP project:

```bash
gcloud services enable run.googleapis.com \
                       cloudbuild.googleapis.com \
                       artifactregistry.googleapis.com
```

---

## 4. Deploying to Google Cloud Run

We use Google Cloud Build to package and build the container image directly in the cloud, then deploy it to Cloud Run. **You do not need Docker installed locally.**

Run this command from the `backend_krishi` root directory:

```bash
gcloud run deploy krishi-backend \
    --source . \
    --region us-central1 \
    --allow-unauthenticated
```

### Command Flags Explained:
- `--source .`: Uploads the current folder (respecting `.dockerignore`) and builds it on Cloud Build using the local `Dockerfile`.
- `--region us-central1`: Deploys the service to the `us-central1` region (feel free to change this).
- `--allow-unauthenticated`: Makes the endpoint publicly accessible so your Flutter frontend or other services can access it.

*Note: During the deployment process, you will be prompted to confirm project settings. Select default settings when prompted.*

---

## 5. Setting up Environment Variables

Once the service is created, you must configure the environment variables that were previously defined in your `.env` or `render.yaml`.

You can set them in the **Google Cloud Console UI** under Cloud Run > `krishi-backend` > **Edit & Deploy New Revision** > **Variables** tab, or run the following command:

```bash
gcloud run services update krishi-backend \
    --region us-central1 \
    --set-env-vars="NODE_ENV=production,PORT=8080,MONGODB_URI=your_mongo_uri,REDIS_URL=your_redis_url,JWT_ACCESS_SECRET=your_secret,JWT_REFRESH_SECRET=your_secret,MASTER_OTP=123456,GCS_PROJECT_ID=strong-keel-494809-j3,GCS_BUCKET_NAME=krishi-product-images,AIRTEL_IQ_CUSTOMER_ID=your_id,AIRTEL_IQ_USERNAME=your_username,AIRTEL_IQ_PASSWORD=your_password,AIRTEL_IQ_SOURCE_ADDRESS=KRORCS,AIRTEL_IQ_DLT_TEMPLATE_ID=your_dlt_id,AIRTEL_IQ_ENTITY_ID=your_entity_id,AIRTEL_IQ_MESSAGE_TEMPLATE=your_message_template"
```

---

## 6. Configuring Google Cloud IAM Permissions (No-Key Setup)

Since the app is running natively on GCP, we do not need to bundle or upload service account JSON private keys. The app will automatically use the **Cloud Run Service Account** credentials.

### Step A: Identify the Service Account
By default, Cloud Run uses the **Default Compute Service Account**:
`[PROJECT_NUMBER]-compute@developer.gserviceaccount.com`

*(You can verify this in the Cloud Run service details page under the "Security" tab).*

### Step B: Grant Google Cloud Storage Permissions
Grant this service account permission to write/delete files in your GCS bucket (`krishi-product-images`):

1. Go to the **Google Cloud Console** > **Cloud Storage** > **Buckets**.
2. Click on your bucket name (`krishi-product-images`).
3. Select the **Permissions** tab.
4. Click **Grant Access**:
   - **New principals**: Input your Cloud Run Service Account (e.g. `123456789-compute@developer.gserviceaccount.com`).
   - **Role**: Select **Storage Object Admin** (allows upload, overwrite, and deletion of images).
5. Click **Save**.

### Step C: Grant Firebase Push Notifications Permission
If you want to use Firebase push notifications using native Application Default Credentials (ADC) rather than passing the JSON string:
1. Go to **IAM & Admin** > **IAM** in GCP console.
2. Find the default compute service account in the list and click the edit pencil icon.
3. Add the role **Firebase Admin SDK Admin Service Agent** or **Firebase SDK Admin Service Agent**.
4. Click **Save**.

---

## 7. Alternative: Injecting Private Keys as Environment Variables

If you prefer to continue using your existing service account keys (e.g. if the bucket or Firebase project belongs to another GCP organization), you can inject the JSON contents directly as environment variables:

1. **Google Cloud Storage Private Key**:
   - Environment Variable: `GCS_KEY_JSON`
   - Value: Copy the entire contents of your local `gcs-key.json` file and paste it as a single-line JSON string.

2. **Firebase Cloud Messaging Private Key**:
   - Environment Variable: `FIREBASE_SERVICE_ACCOUNT`
   - Value: Copy the entire contents of your `serviceAccountKey.json` file and paste it as a single-line JSON string.

If these environment variables are set, the application will automatically prioritize them over native IAM credentials.
