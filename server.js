const express = require("express");
let app = express();
app.set("trust proxy", 1);
const passport = require("passport");
const Strategy = require("passport-twitter").Strategy;
const url = require("url");
const https = require("https");
const bodyParser = require("body-parser");
const TwitterApi = require("twitter-api-v2").TwitterApi;
const TwitterV2IncludesHelper =
  require("twitter-api-v2").TwitterV2IncludesHelper;
const WebFinger = require("webfinger.js");
const sqlite = require("better-sqlite3");
const DB = require("better-sqlite3-helper");
const fs = require("fs");
const cookieSession = require("cookie-session");
const cors = require("cors");
const parser = require("xml2json");
const { decrypt, encrypt } = require("./encryption.js");
const { getApp, getFollowings, toToken } = require("./mastodon.js");

const webfinger = new WebFinger({
  webfist_fallback: false,
  tls_only: true,
  uri_fallback: true,
  request_timeout: 5000,
});

const sessionMiddleware = cookieSession({
  name: "session",
  keys: [process.env.SECRET],
  proxy: true,
  sameSite: "lax",
  saveUninitialized: false,
  secure: true,
  maxAge: 24 * 60 * 60 * 1000,
});

// Telling passport that cookies are fine and there is no need for server side sessions
// https://github.com/LinkedInLearning/node-authentication-2881188/issues/2#issuecomment-1297496099
const regenerate = (callback) => {
  callback();
};
const save = (callback) => {
  callback();
};

passport.use(
  new Strategy(
    {
      consumerKey: process.env.TWITTER_CONSUMER_KEY,
      consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
      callbackURL: process.env.PROJECT_DOMAIN.includes("http")
        ? process.env.PROJECT_DOMAIN
        : `https://${process.env.PROJECT_DOMAIN}.glitch.me/login/twitter/return`,
    },
    (token, tokenSecret, profile, cb) => {
      profile["tokenSecret"] = tokenSecret;
      profile["accessToken"] = token;

      if (tokenSecret && token) {
        try {
          const client = create_twitter_client(profile);
          client.v2
            .me({
              "user.fields": [
                "name",
                "description",
                "url",
                "location",
                "entities",
              ],
              expansions: ["pinned_tweet_id"],
              "tweet.fields": ["text", "entities"],
            })
            .catch((err) => {
              cb(new Error(err));
            })
            .then((data) => {
              let user = data.data;
              let pinned_tweet;
              let urls = [];
              let pinnedTweetInclude;
              if (data.includes)
                pinnedTweetInclude =
                  "tweets" in data.includes ? data.includes.tweets[0] : null;

              if (pinnedTweetInclude) {
                pinned_tweet = pinnedTweetInclude.text;
                if (
                  "entities" in pinnedTweetInclude &&
                  "urls" in pinnedTweetInclude["entities"]
                ) {
                  pinnedTweetInclude["entities"]["urls"].map((url) =>
                    urls.push(url.expanded_url)
                  );
                }
              }

              "entities" in user && "url" in user.entities
                ? user.entities.url.urls.map((url) =>
                    urls.push(url.expanded_url)
                  )
                : null;

              "entities" in user &&
              "description" in user.entities &&
              "urls" in user.entities.description
                ? user.entities.description.urls.map((url) =>
                    urls.push(url.expanded_url)
                  )
                : null;

              profile = {
                _json: {
                  username: user.username,
                  name: user.name,
                  location: user.location,
                  description: user.description,
                  urls: urls,
                  pinned_tweet: pinned_tweet,
                },
                id: profile.id,
                tokenSecret: tokenSecret,
                accessToken: token,
              };

              return cb(null, profile);
            })
            .catch((err) => {
              cb(new Error(err));
            });
        } catch (err) {
          cb(new Error(err));
        }
      } else {
        cb(new Error("no tokens"));
      }
    }
  )
);

passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((obj, cb) => {
  cb(null, obj);
});

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.set("json spaces", 20);
app.use(cors({ origin: "*", methods: "GET", allowedHeaders: "Content-Type" }));
app.use((req, res, next) => {
  if (
    req.path == "/login/twitter/return" &&
    "oauth:twitter" in req.session == false
  ) {
    // catch empty return requests. probably because of 2FA login
    res.redirect("/actualAuth/twitter");
  } else {
    req.session.regenerate = regenerate;
    req.session.save = save;
  }
  next();
});
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// Define routes.
app.all("*", checkHttps);

app.get("/logoff", (req, res) => {
  //todo: clear localstorage in frontend
  req.session = null;
  res.clearCookie("session", { path: "/" });
  res.redirect("/");
});

app.get("/auth/twitter", (req, res) => {
  //delete old session cookie
  res.clearCookie("connect.sid", { path: "/" });
  "user" in req ? res.redirect("/") : res.redirect("/actualAuth/twitter");
});

app.get("/actualAuth/twitter", passport.authenticate("twitter"));

app.get(
  "/login/twitter/return",
  passport.authenticate("twitter", {
    failureRedirect: "/",
    failureMessage: false,
  }),
  (req, res) => {
    req.session.save(() => {
      res.redirect("/#t");
    });
  }
);

app.get("/", (req, res) => {
  "code" in req.query
    ? res.redirect("/success.html?c=" + req.query.code)
    : res.redirect("/success.html");
});

app.get(process.env.DB_CLEAR + "_all", (req, res) => {
  // visit this URL to reset the DB
  DB().run("DELETE from domains");
  res.redirect("/");
});

async function write_cached_files() {
  if (process.env.LOOKUP_SERVER) {
    // get known instances file from lookup server
    https.get(
      process.env.LOOKUP_SERVER + "/cached/known_instances.json",
      (res) => {
        let body = "";
        if (res.statusCode != 200) {
          console.log(res);
        }
        res.on("data", (d) => {
          body += d;
        });
        res.on("end", () => {
          fs.writeFileSync("public/cached/known_instances.json", body);
          console.log(
            "New cached known_instances.json was created from " +
              process.env.LOOKUP_SERVER
          );
        });
        res.on("error", (err) => {
          console.log(err);
        });
      }
    );
  } else {
    let domains = {};
    let relevant_keys = [
      "part_of_fediverse",
      "openRegistrations",
      "local_domain",
      "software_name",
      "software_version",
      "users_total",
    ];
    let instances = await DB().query(
      "SELECT * FROM domains WHERE part_of_fediverse = 1"
    );

    instances.forEach((instance) => {
      domains[instance.domain] = {};
      relevant_keys.forEach((key) => {
        instance[key]
          ? (domains[instance.domain][key] = instance[key])
          : void 0;
      });
    });
    fs.writeFileSync(
      "public/cached/known_instances.json",
      JSON.stringify(domains, null, 2)
    );
    console.log("New cached known_instances.json was created from database.");
  }
}

app.get("/api/known_instances.json", (req, res) => {
  let data = DB().query("SELECT * FROM domains WHERE part_of_fediverse = 1");
  data.forEach((data) => {
    data["openRegistrations"] = data["openRegistrations"] ? true : false;
    data["part_of_fediverse"] = data["part_of_fediverse"] ? true : false;
  });
  res.json(data);
});

app.get(process.env.DB_CLEAR + "_cleanup", async (req, res) => {
  // visit this URL to remove timed out entries from the DB
  console.log(await remove_domains_by_part_of_fediverse(null));
  console.log(await remove_domains_by_part_of_fediverse(0));

  let to_remove = [
    500,
    501,
    503,
    504,
    301,
    302,
    //"ECONNRESET",
    "ETIMEDOUT",
    //"ENOTFOUND",
  ];
  to_remove.forEach((status) => remove_domains_by_status(status));
  res.send(`Removed ${JSON.stringify(to_remove, null, 4)}`);

  //db_to_log();
});

app.get("/api/check", async (req, res) => {
  // force update a single domain

  let domain = req.query.domain
    ? req.query.domain.match(/[a-zA-Z0-9\-\.]+\.[a-zA-Z]+/)
    : "";
  domain = domain ? domain[0].toLowerCase() : "";

  let handle = req.query.handle
    ? req.query.handle.match(/^@?[a-zA-Z0-9_]+@[a-zA-Z0-9\-\.]+\.[a-zA-Z]+$/)
    : "";
  handle = handle ? handle[0].replace(/^@/, "").toLowerCase() : "";

  domain = domain ? domain : handle ? handle.split("@").slice(-1)[0] : "";

  if (domain) {
    if ("force" in req.query) {
      process.env.LOOKUP_SERVER
        ? https.get(
            `${process.env.LOOKUP_SERVER}/api/check?handle=${domain}&domain=${
              handle ? handle : ""
            }&force`
          )
        : void 0;

      try {
        let info = await update_data(domain, handle, true);
        res.json(info);
      } catch (err) {
        res.json(err);
      }
    } else res.json(await check_instance(domain, handle));
  } else res.json({ error: "not a handle or not a domain" });
});

app.get("/api/app", async (req, res) => {
  // send app id for a domain back

  let domain = req.query.domain
    ? req.query.domain.match(/[a-zA-Z0-9\-\.]+\.[a-zA-Z]+/)
    : "";
  domain = domain ? domain[0].toLowerCase() : "";

  let remote_domain = req.query.remote_domain
    ? req.query.remote_domain.match(/[a-zA-Z0-9\-\.]+\.[a-zA-Z]+/)
    : "";
  remote_domain = remote_domain ? remote_domain[0].toLowerCase() : "";

  console.log(remote_domain);

  if (domain && remote_domain) {
    let data = await getApp(domain, remote_domain);
    data
      ? data.working != 0
        ? res.json({ client_id: data.client_id })
        : res.json({})
      : res.json({});
  } else if (domain) {
    let data = await getApp(domain);
    data
      ? data.working != !0
        ? res.json({ client_id: data.client_id })
        : res.json({})
      : res.json({});
  } else res.json({ error: "not valid" });
});

app.get("/api/totoken", async (req, res) => {
  // send app id for a domain back

  let domain = req.query.domain
    ? req.query.domain.match(/[a-zA-Z0-9\-\.]+\.[a-zA-Z]+/)
    : "";
  domain = domain ? domain[0].toLowerCase() : "";

  let auth_domain = req.query.auth_domain
    ? req.query.auth_domain.match(/[a-zA-Z0-9\-\.]+\.[a-zA-Z]+/)
    : "";
  auth_domain = auth_domain ? auth_domain[0].toLowerCase() : "";

  if (auth_domain && domain && req.query.code) {
    let app = await getApp(auth_domain, true);
    let auth_token = await toToken(domain, app, req.query.code);
    res.json(auth_token);
  } else res.json({ error: "not valid" });
});

app.get(process.env.DB_CLEAR + "_wcache", async (req, res) => {
  // delete all records from the database and repopulate it with data from remote server
  await write_cached_files();
  res.redirect("/success");
});

app.get(process.env.DB_CLEAR + "_pop", async (req, res) => {
  // delete all records from the database and repopulate it with data from remote server
  DB().run("DELETE from domains");
  console.log("Populating the database with known domains");
  populate_db("https://fedifinder.glitch.me/api/known_instances.json");
  res.redirect("/success");
});

app.get(process.env.DB_CLEAR + "_popfresh", async (req, res) => {
  // visit this URL to remove timed out entries from the DB
  let source_url =
    "https://fedifinder-backup.glitch.me/api/known_instances.json";
  console.log(
    "Populating the database with new data for known domains from " + source_url
  );
  ("https://fedifinder.glitch.me/api/known_instances.json");
  populate_db(source_url, true);
  res.send(
    "Started to populate the database with new records from " + source_url
  );
});

const server = app.listen(process.env.PORT, () => {
  // listen for requests
  console.log("Your app is listening on port " + server.address().port);
});

// WARNING: THIS IS BAD. DON'T TURN OFF TLS
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// setup a new database
// using database credentials set in .env
DB({
  path: ".data/better-sqlite3.db",
  readonly: false,
  fileMustExist: false,
  WAL: true,
  migrate: {
    force: false,
    table: "migration",
    migrationsPath: __dirname + "/migrations",
  },
});

function create_twitter_client(user) {
  try {
    const client = new TwitterApi({
      appKey: process.env.TWITTER_CONSUMER_KEY,
      appSecret: process.env.TWITTER_CONSUMER_SECRET,
      accessToken: user.accessToken,
      accessSecret: user.tokenSecret,
    });

    return client;
  } catch (err) {
    console.log("Error", err);
  }
}

function db_to_log() {
  // for debugging
  let instances = DB().query("SELECT * FROM domains");
  instances.forEach((instance) => {
    console.log(instance.domain + " " + instance.status);
  });
}

async function db_add(nodeinfo, force = false) {
  let domain = nodeinfo["domain"];
  if (force) {
    DB().replaceWithBlackList("domains", nodeinfo, []);
  } else {
    let data = await DB().queryFirstRow(
      "SELECT * FROM domains WHERE domain=?",
      domain
    );
    if (data) return data;
    else {
      try {
        DB().insert("domains", nodeinfo);
      } catch (err) {
        console.log(err);
      }
      return nodeinfo;
    }
  }
}

function db_remove(domain) {
  try {
    DB().delete("domains", { domain: domain });
  } catch (err) {
    console.log(err);
  }
}

async function remove_domains_by_part_of_fediverse(fediversy) {
  try {
    return await DB().delete("domains", { part_of_fediverse: fediversy });
  } catch (err) {
    console.log(err);
  }
}

function remove_domains_by_status(status) {
  try {
    let data = DB().delete("domains", { status: status });
    console.log(`${status} removed: ${data}`);
    return data;
  } catch (err) {
    console.log(err);
  }
}

async function update_data(domain, handle = null, force = false) {
  let local_domain, wellknown, nodeinfo;
  if (handle) {
    // get local domain
    let profile_url = await url_from_handle(handle);
    if (profile_url) {
      local_domain = profile_url.split("//")[1].split("/")[0];
      wellknown = await get_nodeinfo_url(local_domain);
    }
  }
  if (wellknown == null) wellknown = await get_nodeinfo_url(domain);

  if (wellknown && "nodeinfo_url" in wellknown) {
    let nodeinfo = await get_nodeinfo(wellknown.nodeinfo_url);
    if (nodeinfo) {
      if (local_domain) nodeinfo["local_domain"] = local_domain;
      nodeinfo["domain"] = domain;
      db_add(nodeinfo, force);
      return nodeinfo;
    }
  } else if (wellknown && "status" in wellknown) {
    let nodeinfo = {
      domain: domain,
      part_of_fediverse: 0,
      retries: 1,
      status: wellknown.status,
      local_domain: local_domain,
    };
    db_add(nodeinfo, force);
    return nodeinfo;
  }
  return { domain: domain, part_of_fediverse: 0, retries: 1 };
}

async function populate_db(seed_url, refresh = false) {
  //https://fedifinder.glitch.me/api/known_instances.json
  https
    .get(seed_url, (res) => {
      let body = "";
      if (res.statusCode != 200) {
        console.log(res);
      }
      res.on("data", (d) => {
        body += d;
      });
      res.on("end", () => {
        if (body.startsWith("<") === false) {
          try {
            let data = JSON.parse(body);
            if (refresh) {
              data.forEach((instance) => {
                //update_data
                check_instance(instance.domain);
              });
            } else {
              data.forEach((item) => {
                delete item.createdAt;
                delete item.updatedAt;
                delete item.localComments;
                item.part_of_fediverse = item.part_of_fediverse ? 1 : 0;
                item.openRegistrations = item.openRegistrations ? 1 : 0;
              });
              let count = DB().insert("domains", data);
              console.log(
                "DB successfully populated " +
                  count +
                  " entries from " +
                  seed_url
              );
            }
          } catch (err) {
            console.log(err);
          }
        }
      });
    })
    .on("error", (err) => {
      console.log(err);
      //todo: resolve unknown status
    });
}

async function check_instance(domain, handle = null) {
  // retrieve info about a domain
  let data = await DB().queryFirstRow(
    "SELECT * FROM domains WHERE domain=?",
    domain
  );
  if (data) {
    return data;
  } else {
    // no cached info -> get new info
    let new_data = await update_data(domain, handle);
    return new_data;
  }
}

function get_webfinger(handle) {
  // get webfinger data for a handle
  return new Promise((resolve) => {
    webfinger.lookup(encodeURI(handle), (err, info) => {
      if (err) {
        //console.log("error: ", err.message);
        resolve(null);
      } else {
        resolve(info);
      }
    });
  }).catch((err) => {
    //console.log(err);
  });
}

async function url_from_handle(handle) {
  // checks if webfinger exists for a handle and returns the first href aka webadress
  handle = handle.replace(/^@/, "");
  try {
    let data = await get_webfinger(handle);
    if (data) {
      return data["object"]["links"][0]["href"];
    } else return false;
  } catch (err) {
    console.log(err);
    return false;
  }
}

async function get_hostmeta(domain) {
  return new Promise((resolve) => {
    https.get("https://" + domain, (res) => {
      if (res.statusCode == 200) {
        let host_body = "";
        res.on("data", (d) => {
          host_body += d;
        });
        res.on("end", () => {
          try {
            console.log(parser.toJson(host_body));
          } catch (err) {
            console.log(err);
            resolve(null);
          }
        });
        res.on("error", (err) => {
          //console.log(err);
          resolve({ status: err["code"] });
        });
      }
    });
  });
}

async function get_nodeinfo_url(host_domain, redirect_count = 0) {
  // get url of nodeinfo json
  return new Promise((resolve) => {
    let options = {
      method: "GET",
      host: encodeURI(host_domain),
      json: true,
      path: "/.well-known/nodeinfo",
      timeout: 5000,
    };

    https
      .get(options, (res) => {
        let body = "";
        if (res.statusCode != 200) {
          if (
            (res.statusCode == 302 || res.statusCode == 301) &&
            redirect_count <= 2 // only follow two redirects deep to prevent circular ones
          ) {
            redirect_count += 1;
            resolve(
              get_nodeinfo_url(
                res.headers.location.split("/")[2],
                redirect_count
              )
            );
          }
        }
        res.on("data", (d) => {
          body += d;
        });
        res.on("end", () => {
          if (body.startsWith("<") === false) {
            try {
              resolve({ nodeinfo_url: JSON.parse(body)["links"][0]["href"] });
            } catch (err) {
              //console.log(err)
              resolve(null);
            }
          } else resolve(null);
        });
      })
      .on("error", (err) => {
        //console.log(err);
        resolve({ status: err["code"] });
        //todo: resolve unknown status
      });
  }).catch((err) => {
    console.log(err);
  });
}

function get_nodeinfo(nodeinfo_url) {
  // get fresh nodeinfo and save to db
  return new Promise((resolve) => {
    https
      .get(encodeURI(nodeinfo_url), { timeout: 5000 }, (res) => {
        let body = "";
        if (res.statusCode != 200) {
          resolve({ part_of_fediverse: 0 });
        }
        res.on("data", (d) => {
          body += d;
        });
        res.on("end", () => {
          if (body.startsWith("<") === false) {
            try {
              let nodeinfo = JSON.parse(body);
              resolve({
                part_of_fediverse: 1,
                software_name: nodeinfo["software"]["name"],
                software_version: nodeinfo["software"]["version"],
                users_total:
                  "users" in nodeinfo["usage"] &&
                  "total" in nodeinfo["usage"]["users"]
                    ? nodeinfo["usage"]["users"]["total"]
                    : null, //todo handle unvailable counts
                users_activeMonth:
                  "users" in nodeinfo["usage"] &&
                  "activeMonth" in nodeinfo["usage"]["users"]
                    ? nodeinfo["usage"]["users"]["activeMonth"]
                    : null, //todo handle unvailable counts
                users_activeHalfyear:
                  "users" in nodeinfo["usage"] &&
                  "activeHalfyear" in nodeinfo["usage"]["users"]
                    ? nodeinfo["usage"]["users"]["activeHalfyear"]
                    : null, //todo handle unvailable counts
                localPosts:
                  "localPosts" in nodeinfo["usage"]
                    ? nodeinfo["usage"]["localPosts"]
                    : null, //todo handle unavailable counts
                openRegistrations: nodeinfo["openRegistrations"] ? 1 : 0,
              });
            } catch (err) {
              console.log(nodeinfo_url);
              console.log(err);
              resolve({ part_of_fediverse: 0 });
            }
          }
        });
      })
      .on("error", (e) => {
        //console.log(e);
        resolve({ status: e["code"] });
        //console.log(nodeinfo_url);
        //console.error(e);
      });
  });
}

function checkHttps(req, res, next) {
  // protocol check, if http, redirect to https
  if (req.get("X-Forwarded-Proto").indexOf("https") != -1) {
    return next();
  } else {
    res.redirect("https://" + req.hostname + req.url);
  }
}

app.get("/api/getProfile", async (req, res) => {
  if ("user" in req) {
    res.json(req.user._json);
  } else {
    res.json({ error: "not logged in" });
  }
});

app.get("/api/lookupServer", async (req, res) => {
  if (process.env.LOOKUP_SERVER) {
    res.json(process.env.LOOKUP_SERVER);
  } else {
    res.json({ error: "no lookup server" });
  }
});

app.get("/api/loadLists", async (req, res) => {
  let client = create_twitter_client(req.user);
  let lists = [];

  // get lists owned by user
  const ownedLists = await client.v2.listsOwned(req.user.id, {
    "list.fields": ["member_count"],
  });
  for await (const list of ownedLists) {
    lists.push({
      name: list["name"],
      id_str: list["id"],
      member_count: list["member_count"],
    });
  }

  // get subscribed lists of user
  const followedLists = await client.v2.listFollowed(req.user.id, {
    "list.fields": ["member_count"],
  });
  for await (const list of followedLists) {
    lists.push({
      name: list["name"],
      id_str: list["id"],
      member_count: list["member_count"],
    });
  }
  res.json(lists);
});

app.get("/api/getList", async (req, res) => {
  let list_id;
  "listid" in req.query
    ? (list_id = req.query.listid)
    : res.json({ error: "no list provided" });
  if ("user" in req) {
    let client = create_twitter_client(req.user);
    const data = await client.v2.listMembers(list_id, {
      "user.fields": ["name", "description", "url", "location", "entities"],
      expansions: ["pinned_tweet_id"],
      "tweet.fields": ["text", "entities"],
    });
    processRequests({ type: "list", list_id: list_id }, data, res);
  } else {
    res.json({ error: "not logged in" });
  }
});

app.get("/api/getFollowings", async (req, res) => {
  if ("user" in req) {
    let client = create_twitter_client(req.user);
    const data = await client.v2.following(req.user.id, {
      asPaginator: true,
      max_results: 1000,
      "user.fields": ["name", "description", "url", "location", "entities"],
      expansions: ["pinned_tweet_id"],
      "tweet.fields": ["text", "entities"],
    });
    processRequests({ type: "followings" }, data, res);
  } else {
    res.json({ error: "not logged in" });
  }
});

app.get("/api/getFollowers", async (req, res) => {
  if ("user" in req) {
    let client = create_twitter_client(req.user);
    const data = await client.v2.followers(req.user.id, {
      asPaginator: true,
      max_results: 1000,
      "user.fields": ["name", "description", "url", "location", "entities"],
      expansions: ["pinned_tweet_id"],
      "tweet.fields": ["text", "entities"],
    });
    processRequests({ type: "followers" }, data, res);
  } else {
    res.json({ error: "not logged in" });
  }
});

async function processRequests(type, data, cb) {
  // get accounts from Twitter and sent relevant parts to frontend
  let accounts = [];

  try {
    for await (const user of data) {
      let urls = [];
      let pinned_tweet;

      const pinnedTweetInclude = data.includes.pinnedTweet(user);

      if (pinnedTweetInclude) {
        pinned_tweet = pinnedTweetInclude.text;
        if (
          "entities" in pinnedTweetInclude &&
          "urls" in pinnedTweetInclude["entities"]
        ) {
          pinnedTweetInclude["entities"]["urls"].map((url) =>
            urls.push(url.expanded_url)
          );
        }
      }

      "entities" in user && "url" in user.entities
        ? user.entities.url.urls.map((url) => urls.push(url.expanded_url))
        : null;

      "entities" in user &&
      "description" in user.entities &&
      "urls" in user.entities.description
        ? user.entities.description.urls.map((url) =>
            urls.push(url.expanded_url)
          )
        : null;

      accounts.push({
        username: user.username,
        name: user.name,
        location: user.location,
        description: user.description,
        urls: urls,
        pinned_tweet: pinned_tweet,
      });
    }
    cb.json({ type: type, accounts: accounts });
  } catch (err) {
    console.log(err);
    cb.json({ type: type, accounts: accounts });
  }
}

async function tests() {
  //DB().run("DELETE from domains");
  console.log("Start tests");
  const assert = require("assert").strict;
  write_cached_files();

  const it = (description, function_to_test) => {
    try {
      function_to_test();
      console.log("\x1b[32m%s\x1b[0m", `\u2714 ${description}`);
    } catch (error) {
      console.log("\n\x1b[31m%s\x1b[0m", `\u2718 ${description}`);
      console.error(error);
    }
  };

  it("should get the nodeinfo URL", async () => {
    let data = await get_nodeinfo_url("lucahammer.com");
    assert(data.nodeinfo_url == "https://lucahammer.com/wp-json/nodeinfo/2.1");
  });

  it("should add an entry, update the entry, remove that entry based on retries", async () => {
    let added_instance = await db_add({ domain: "test.com", retries: 100 });
    assert(added_instance.domain == "test.com");

    let test_domain = DB().queryFirstRow(
      "SELECT * FROM domains WHERE domain=?",
      "test.com"
    );
    assert(test_domain.domain == "test.com");

    db_remove("test.com");
    let cleaned = DB().queryFirstRow(
      "SELECT * FROM domains WHERE domain=?",
      "test.com"
    );
    assert(cleaned == undefined);
  });

  it("should get no info about a non fediverse website", async () => {
    let info = await check_instance("google.com");
    assert(info.part_of_fediverse == 0);
  });

  it("should get new info about an instance and save to db", async () => {
    let info = await check_instance("lucahammer.com");
    assert(info.users_total == 1);
    info = await check_instance("lucahammer.com");
    assert(info.users_total == 1);
  });

  it("should get url from handle (webfinger)", async () => {
    let url = await url_from_handle("@luca@vis.social");
    assert("https://vis.social/@Luca" == url);
    url = await url_from_handle("luca@lucahammer.com");
    assert("https://lucahammer.com/author/luca" == url);
  });

  it("should encrypt and decrypt a string", () => {
    let message = "message";
    let encrypted = encrypt(message);
    assert(encrypted != message);
    assert(message == decrypt(encrypted));
  });

  it("get or create app for a mastodon instance", async () => {
    let app = await getApp("vis.social");
    assert(app.domain == "vis.social");
  });
}

write_cached_files();
if (/dev|staging|localhost/.test(process.env.PROJECT_DOMAIN)) tests();
//DB().run("DELETE from mastodonapps");
