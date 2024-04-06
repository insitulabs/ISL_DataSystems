require('dotenv').config();

const PORT = process.env.PORT || 3000;

// Fallback to development env if we don't have one.
const ENVIRONMENT = process.env.APP_ENVIRONMENT || 'development';
const IS_LOCAL_DEV_ENV = ENVIRONMENT === 'development';
const IS_PRODUCTION_ENV = ENVIRONMENT === 'production';

const SITE_NAME = 'In Situ Labs';

const MONGO_URI = process.env.MONGO_URI;

const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_S3_REGION = process.env.AWS_S3_REGION;
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET;

let AWS_S3_PREFIX = 'attachments';
if (IS_LOCAL_DEV_ENV) {
  AWS_S3_PREFIX = 'test-attachments';
}

const SEND_ERRORS_TO = process.env.SEND_ERRORS_TO;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const TOKEN_SECRET = process.env.TOKEN_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const CRYPTO_KEY = process.env.CRYPTO_KEY;
const CRYPTO_SALT = process.env.CRYPTO_SALT;

const JOBS_ENABLED = /^true$/i.test(process.env.JOBS_ENABLED);
const JOBS_USER = process.env.JOBS_USER;

const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE;

// Where to send someone if no workspace is provided in the URL.
const MISSING_WORKSPACE_REDIRECT =
  process.env.MISSING_WORKSPACE_REDIRECT || 'https://insitulabs.org';

const PRIMARY_LANG = 'en';

module.exports = {
  PORT,
  ENVIRONMENT,
  IS_LOCAL_DEV_ENV,
  IS_PRODUCTION_ENV,
  SITE_NAME,
  MONGO_URI,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_S3_REGION,
  AWS_S3_BUCKET,
  AWS_S3_PREFIX,
  SEND_ERRORS_TO,
  SMTP_USER,
  SMTP_PASS,
  TOKEN_SECRET,
  SESSION_SECRET,
  CRYPTO_KEY,
  CRYPTO_SALT,
  JOBS_ENABLED,
  JOBS_USER,
  DEFAULT_WORKSPACE,
  MISSING_WORKSPACE_REDIRECT,
  PRIMARY_LANG
};

