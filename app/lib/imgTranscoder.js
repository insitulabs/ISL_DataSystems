const path = require('path');
const sharp = require('sharp');
const S3 = require('./s3');
const s3 = new S3();

module.exports = function (S3_REGION, S3_BUCKET) {
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
        const response = await s3.get(url);
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
            return s3.upload(`${keyPrefix}/${key}-thumbnail.jpg`, data);
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
            return s3.upload(`${keyPrefix}/${key}-small.jpg`, data);
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
            return s3.upload(`${keyPrefix}/${key}-medium.jpg`, data);
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
            return s3.upload(`${keyPrefix}/${key}-large.jpg`, data);
          })
      );

      return Promise.all(promises);
    }
  };
};

