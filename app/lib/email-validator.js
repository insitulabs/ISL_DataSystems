// https://raw.githubusercontent.com/manishsaraan/email-validator/master/index.js

var tester =
  /^[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\.?[a-zA-Z0-9])*\.[a-zA-Z](-?[a-zA-Z0-9])+$/;

module.exports = function (email) {
  if (!email || typeof email !== 'string' || email.length > 320) {
    return false;
  }

  let emailParts = email.split('@');

  if (emailParts.length !== 2) {
    return false;
  }

  if (!tester.test(email)) {
    return false;
  }

  return true;
};

