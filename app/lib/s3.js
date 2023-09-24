const {
  S3Client,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const CONFIG = require('../config');
const s3Client = new S3Client({ region: CONFIG.AWS_S3_REGION });

module.exports = class S3 {
  constructor() {
    this.S3_BUCKET = CONFIG.AWS_S3_BUCKET;
  }

  /**
   * Upload to S3.
   * @param {string} key
   * @param {Buffer} buffer
   * @param {object} metadata Must be data known to AWS's PutObjectCommand.
   * @return {string} The key of the upload.
   */
  async upload(key, buffer, metadata = {}) {
    await s3Client.send(
      new PutObjectCommand({ Bucket: this.S3_BUCKET, Key: key, Body: buffer, ...metadata })
    );
    return key;
  }

  /**
   * Get the file from S3.
   * @param {string} key
   * @return {Promise}
   */
  async get(key) {
    return s3Client.send(new GetObjectCommand({ Bucket: this.S3_BUCKET, Key: key }));
  }

  /**
   * List info for a file in S3. Or throw NotFound.
   * @param {string} key
   * @return {Promise}
   */
  async head(key) {
    const objectParams = { Bucket: this.S3_BUCKET, Key: key };
    return s3Client.send(new HeadObjectCommand(objectParams));
  }

  /**
   * List files by prefix.
   * @param {string} prefix
   * @return {Promise}
   */
  async list(prefix) {
    return s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.S3_BUCKET,
        Prefix: prefix
      })
    );
  }

  /**
   * Generate a signed URL for the attachment.
   * @param {string} key
   * @param {string} fileName A name to save the file with if we want.
   * @param {number} expires
   * @return {string} The URL.
   */
  async signedUrl(key, fileName = null, expires = 60) {
    let options = {
      Bucket: this.S3_BUCKET,
      Key: key,
      Expires: expires
    };

    if (fileName) {
      options.ResponseContentDisposition = `attachment; filename=${fileName}`;
    }

    return getSignedUrl(s3Client, new GetObjectCommand(options), { expiresIn: expires });
  }
};

