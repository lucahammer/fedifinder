"use strict";
const https = require("https");
const { decrypt, encrypt } = require("./encryption.js");
const DB = require("better-sqlite3-helper");

const toToken = async (domain, app, user_code) => {
  return new Promise((resolve) => {
    let postData = JSON.stringify({
      client_id: app.client_id,
      client_secret: app.client_secret,
      redirect_uri: "https://" + domain + "/success",
      grant_type: "authorization_code",
      code: user_code,
    });

    let options = {
      hostname: app.domain,
      port: 443,
      path: "/oauth/token",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": postData.length,
      },
    };

    const req = https.request(options, (res) => {
      let body = "";

      res.on("data", (d) => {
        body += d;
      });

      res.on("error", (e) => {
        console.error(e);
      });

      res.on("end", () => {
        try {
          let data = JSON.parse(body);
          resolve(data);
        } catch (err) {
          console.log(err);
        }
        return;
      });
    });

    req.write(postData);
    req.end();
  });
};

const createApp = (domain, remote_domain = false) => {
  let fedifinder_domain = process.env.PROJECT_DOMAIN.includes("http")
    ? process.env.PROJECT_DOMAIN
    : `https://${process.env.PROJECT_DOMAIN}.glitch.me`;

  remote_domain ? (fedifinder_domain += " " + remote_domain) : void 0;

  let postData = JSON.stringify({
    client_name: "Fedifinder",
    redirect_uris:
      fedifinder_domain +
      "/success" +
      " " +
      "https://fedifinder.glitch.me/success" +
      " " +
      "https://fedifinder-backup.glitch.me/success", //todo remove hardcoded URLs, different apps for each?
    scopes: "read:accounts read:follows",
    website: fedifinder_domain,
  });

  let options = {
    hostname: domain,
    port: 443,
    path: "/api/v1/apps",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": postData.length,
    },
  };

  console.log("creating app");
  const req = https.request(options, (res) => {
    let body = "";

    res.on("data", (d) => {
      body += d;
    });

    res.on("error", (e) => {
      console.error(e);
    });

    res.on("end", () => {
      try {
        let data = JSON.parse(body);
        data["client_secret"] = encrypt(data["client_secret"]);

        DB().insert("mastodonapps", {
          domain: domain,
          id: data["id"],
          client_id: data["client_id"],
          client_secret: data["client_secret"],
          vapid_key: data["vapid_key"],
        });
        return data;
      } catch (err) {
        DB().insert("mastodonapps", {
          domain: domain,
          working: 0,
        });
        return {
          domain: domain,
          working: 0,
        };
      }
    });
  });
  req.write(postData);
  req.end();
};

const getApp = async (domain, decrypted = false) => {
  let app = DB().queryFirstRow(
    "SELECT * FROM mastodonapps WHERE domain=?",
    domain
  );
  if (!app) app = await createApp(domain);
  if (decrypted) {
    app["client_secret"] = decrypt(app["client_secret"]);
  }
  return app;
};

const getFollowings = (domain, user) => {
  let url = domain + "/api/v1/accounts/" + user + "/following?limit=80";
};

module.exports = { getApp, toToken, getFollowings };
