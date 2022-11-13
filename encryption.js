"use strict";

const CryptoJS = require("crypto-js");

function encrypt(text) {
  let encrypted = CryptoJS.AES.encrypt(text, process.env.ENCRYPTION_KEY);
  return encrypted.toString();
}

function decrypt(text) {
  return CryptoJS.AES.decrypt(text, process.env.ENCRYPTION_KEY).toString(
    CryptoJS.enc.Utf8
  );
}

module.exports = { decrypt, encrypt };
