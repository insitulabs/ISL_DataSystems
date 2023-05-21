const aws = require('aws-sdk');
const fs = require('fs');
const s3 = new aws.S3();
const _ = require('lodash');
const path = require('path');
const CONFIG = require('../config');

const imgTranscoder = require('./imgTranscoder');

module.exports = class Uploader {
  constructor() {
    this.S3_REGION = CONFIG.AWS_S3_REGION;
    this.S3_BUCKET = CONFIG.AWS_S3_BUCKET;
    this.imgTranscoder = imgTranscoder(this.S3_REGION, this.S3_BUCKET);
  }

  /**
   * Generate the cloud storage key for a given file.
   * @param {object} workspace
   * @param {object} source
   * @param {string} submissionId
   * @param {string} fileName
   * @return {string}
   */
  generateFileKey(workspace, source, submissionId, fileName) {
    let key = `${workspace.dbName}/${source.submissionKey}/${submissionId}/${fileName}`;
    if (CONFIG.AWS_S3_PREFIX) {
      return CONFIG.AWS_S3_PREFIX + '/' + key;
    } else {
      return key;
    }
  }

  async uploadFileToS3(buffer, metadata, key) {
    const objectParams = { Bucket: this.S3_BUCKET, Key: key };
    const response = await s3.putObject({ ...objectParams, Body: buffer }).promise();
    return key;
  }

  getFileFromS3(key) {
    return new Promise((resolve, reject) => {
      s3.getObject({ Bucket: this.S3_BUCKET, Key: key }, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  /**
   * Get an attachment.
   * @param {object} workspace
   * @param {object} source
   * @param {string} submissionId
   * @param {string} fileName
   * @return {object} The attachment metadata.
   */
  async getAttachment(workspace, source, submissionId, fileName) {
    const s3Key = this.generateFileKey(workspace, source, submissionId, fileName);
    const objectParams = { Bucket: this.S3_BUCKET, Key: s3Key };
    try {
      const head = await s3.headObject(objectParams).promise();
      let keyPrefix = path.dirname(s3Key);
      let ext = path.extname(s3Key);
      let key = path.basename(s3Key, ext);

      // Lookup transcoded files.
      let transcoded = await s3
        .listObjectsV2({
          Bucket: this.S3_BUCKET,
          Prefix: `${keyPrefix}/${key}-`
        })
        .promise();
      return {
        name: fileName,
        s3Key: s3Key,
        size: head.ContentLength,
        transcodes:
          transcoded && transcoded.Contents && transcoded.Contents.length
            ? transcoded.Contents.map((f) => f.Key)
            : null
      };
    } catch (error) {
      if (error.name !== 'NotFound') {
        throw error;
      }
    }

    return null;
  }

  async uploadAttachment(workspace, source, submissionId, fileName, fileSize, file, label) {
    const s3Key = this.generateFileKey(workspace, source, submissionId, fileName);
    const objectParams = { Bucket: this.S3_BUCKET, Key: s3Key };

    try {
      let s3Body = typeof file === 'string' ? fs.createReadStream(file) : file;
      await s3
        .putObject({
          ...objectParams,
          Body: s3Body,
          ContentDisposition: `attachment; filename=${label || fileName}`
        })
        .promise();

      let transcodes = null;
      let transcodeError = null;
      try {
        transcodes = await this.imgTranscoder.transcode(s3Key, file);
      } catch (error) {
        console.error(
          `Error transcoding ${s3Key} ` +
            `[Workspace: ${workspace.name}] Source: ${source.submissionKey}] [Submission: ${submissionId}]`,
          error.stack
        );
        transcodeError = error.message;
      }

      return {
        name: fileName,
        label: label || fileName,
        s3Key: s3Key,
        size: fileSize,
        transcodes,
        transcodeError
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Generate a signed URL for the attachment.
   * @param {string} key
   * @param {string} fileName A name to save the file with if we want.
   * @param {number} expires
   * @return {string} The URL.
   */
  getSignedUrl(key, fileName = null, expires = 60) {
    let options = {
      Bucket: this.S3_BUCKET,
      Key: key,
      Expires: expires
    };

    if (fileName) {
      options.ResponseContentDisposition = `attachment; filename=${fileName}`;
    }

    return s3.getSignedUrl('getObject', options);
  }
};

