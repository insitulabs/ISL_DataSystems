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

const getHtml = (appName, link) => {
  return `<!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        <title>${appName} Login Link</title>
        <style>
        .apple-link a {
          color: inherit !important;
          font-family: inherit !important;
          font-size: inherit !important;
          font-weight: inherit !important;
          line-height: inherit !important;
          text-decoration: none !important;
        }

        a {
          color: inherit;
          text-decoration: none;
          font-size: inherit;
          font-family: inherit;
          font-weight: inherit;
          line-height: inherit;
        }

        .btn a {
          display: inline-block;
          background-color: #3498db;
          border-width: 10px 20px;
          border-style: solid;
          border-radius: 4px;
          border-color: #3498db;
          font-size: 16px;
          font-weight: bold;
          color: #ffffff;
          letter-spacing: 2px;
          text-decoration: none;
          line-height: 20px;
          text-align: center;
          transition: all 0.2s ease-in;
        }

        .btn a:hover,
        * [lang=x-btn] a:hover {
          background-color: #267db7 !important;
          border-color: #267db7 !important;
        }
      </style>
      </head>
      <body style="font-family: sans-serif; -webkit-font-smoothing: antialiased; font-size: 14px; line-height: 1.4; margin: 0; padding: 0; -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%;">
        <p style="font-family: sans-serif; font-size: 14px; font-weight: normal; margin: 0; margin-bottom: 15px;">Here is your requested login link to ${appName}:</p>
        <div class="btn" lang="x-btn">
          <a href="${link}">Login</a>
        </a>
        <p style="font-family: sans-serif; font-size: 14px; font-weight: normal; margin: 0; margin-top: 15px; margin-bottom: 15px;">The link will expire in 5 minutes.</p>
        <span class="apple-link" style="color: #999999; font-size: 12px; text-align: center;">In Situ Labs</span>
      </body>
    </html>`;
};

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
      html: getHtml(CONFIG.SITE_NAME, url),
      text: text
    });
  }
};

