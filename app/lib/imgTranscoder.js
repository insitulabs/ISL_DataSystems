const path = require('path');
const sharp = require('sharp');
const aws = require('aws-sdk');
const s3 = new aws.S3();

module.exports = function (S3_REGION, S3_BUCKET) {
  // TODO MOVE TO UPLOADER
  const upload = async function (buffer, metadata, key) {
    const objectParams = { Bucket: S3_BUCKET, Key: key };
    const response = await s3.putObject({ ...objectParams, Body: buffer }).promise();
    return key;
  };

  const getFile = function (key) {
    return new Promise((resolve, reject) => {
      s3.getObject({ Bucket: S3_BUCKET, Key: key }, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  };

  return {
    transcode: async function (url, file) {
      let keyPrefix = path.dirname(url);
      let ext = path.extname(url);
      let key = path.basename(url, ext);

      // Only images supported.
      if (!/jpg|jpeg|png|heic/i.test(ext)) {
        return [];
      }

      if (!file) {
        const response = await getFile(url);
        file = response.Body;
      }

      if (!file) {
        throw 'Invalid source file';
      }

      const sharpStream = sharp(file).rotate();
      sharpStream.on('error', (e) => {
        console.error(e);
      });

      const promises = [];
      promises.push(
        sharpStream
          .clone()
          .on('error', (e) => {
            // sharp.clone() does not clone event listeners, so this must also be handled.
            console.error(e);
          })
          .resize({ width: 250, height: 250 })
          .jpeg({ quality: 80, progressive: true })
          .toBuffer({ resolveWithObject: true })
          .then(({ data, info }) => {
            return upload(data, info, `${keyPrefix}/${key}-thumbnail.jpg`);
          })
      );

      promises.push(
        sharpStream
          .clone()
          .on('error', (e) => {
            console.error(e);
          })
          .resize({ width: 682 })
          .jpeg({ quality: 80, progressive: true })
          .toBuffer({ resolveWithObject: true })
          .then(({ data, info }) => {
            return upload(data, info, `${keyPrefix}/${key}-small.jpg`);
          })
      );

      promises.push(
        sharpStream
          .clone()
          .on('error', (e) => {
            console.error(e);
          })
          .resize({ width: 1024 })
          .jpeg({ quality: 80, progressive: true })
          .toBuffer({ resolveWithObject: true })
          .then(({ data, info }) => {
            return upload(data, info, `${keyPrefix}/${key}-medium.jpg`);
          })
      );

      promises.push(
        sharpStream
          .clone()
          .on('error', (e) => {
            console.error(e);
          })
          .resize({ width: 2048 })
          .jpeg({ quality: 80, progressive: true })
          .toBuffer({ resolveWithObject: true })
          .then(({ data, info }) => {
            return upload(data, info, `${keyPrefix}/${key}-large.jpg`);
          })
      );

      return Promise.all(promises);
    }
  };
};

