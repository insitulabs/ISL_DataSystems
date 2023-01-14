const nodemailer = require('nodemailer');
const crypto = require('./crypto');
const CONFIG = require('../config');

const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: CONFIG.SMTP_USER,
    pass: CONFIG.SMTP_PASS
  }
});

const FROM_ADDRESS = `${CONFIG.SITE_NAME} <${CONFIG.SMTP_FROM}>`;

module.exports = {
  sendError: async (error, context) => {
    if (CONFIG.IS_LOCAL_DEV_ENV) {
      return Promise.resolve();
    }

    let to = CONFIG.SEND_ERRORS_TO;
    if (!to) {
      return Promise.resolve();
    }

    let subject = `${CONFIG.SITE_NAME} Error: `;
    let text = '';
    if (typeof error === 'string') {
      subject += error.substring(0, Math.max(error.length, 100));
      text = error;
    } else if (error && error.message) {
      subject += error.message.substring(0, Math.min(error.message.length, 100));
      text = error.message;
      text += '\n\n';
      text += error.stack;
    }

    if (context) {
      text += '\n\n' + JSON.stringify(context, null, 2);
    }

    // Return promise
    return transporter
      .sendMail({
        from: FROM_ADDRESS,
        to: to,
        subject: subject,
        text: text
      })
      .catch((e) => {
        console.error(e);
      });
  },

  sendLoginEmail: async (email, appLink, destination) => {
    const token = crypto.getUserToken(email, destination);
    let url = appLink + '?token=' + encodeURIComponent(token);

    let text = 'Click here to login:\n\n' + url;
    text += '\n\n' + 'Note: This link will expire after 5 minutes.';

    return transporter.sendMail({
      from: FROM_ADDRESS,
      to: email,
      subject: `${CONFIG.SITE_NAME} Login Link`,
      text: text
    });
  }
};

