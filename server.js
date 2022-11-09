const express = require("express");
let app = express();
const passport = require("passport");
const Strategy = require("passport-twitter").Strategy;
const hbs = require("hbs");
const url = require("url");
const Sequelize = require("sequelize");
const https = require("https");
const session = require("express-session");
const bodyParser = require("body-parser");
const TwitterApi = require("twitter-api-v2").TwitterApi;
const TwitterV2IncludesHelper =
  require("twitter-api-v2").TwitterV2IncludesHelper;
const Op = require("sequelize").Op;
const SequelizeStore = require("connect-session-sequelize")(session.Store);
const WebFinger = require("webfinger.js");

const webfinger = new WebFinger({
  webfist_fallback: false,
  tls_only: true,
  uri_fallback: true,
  request_timeout: 10000,
});

hbs.registerHelper("json", function (context) {
  return JSON.stringify(context);
});

const sessions_db = new Sequelize(
  "sessions",
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: "0.0.0.0",
    dialect: "sqlite",
    pool: {
      max: 5,
      min: 0,
      idle: 10000,
    },
    // Security note: the database is saved to the file `database.sqlite` on the local filesystem. It's deliberately placed in the `.data` directory
    // which doesn't get copied if someone remixes the project.
    storage: ".data/sessions.sqlite",
    logging: false,
  }
);

const sequelizeSessionStore = new SequelizeStore({
  db: sessions_db,
});

const sessionOptions = {
  secret: process.env.SECRET,
  store: sequelizeSessionStore,
  resave: false,
  saveUninitialized: false,
};

const sessionMiddleware = session(sessionOptions);

passport.use(
  new Strategy(
    {
      consumerKey: process.env.TWITTER_CONSUMER_KEY,
      consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
      callbackURL: `https://${process.env.PROJECT_DOMAIN}.glitch.me/login/twitter/return`,
    },
    function (token, tokenSecret, profile, cb) {
      profile["tokenSecret"] = tokenSecret;
      profile["accessToken"] = token;
      return cb(null, profile);
    }
  )
);

passport.serializeUser(function (user, cb) {
  cb(null, user);
});

passport.deserializeUser(function (obj, cb) {
  cb(null, obj);
});

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session(sessionOptions));
app.set("json spaces", 20);
sessions_db.sync(); //{ force: true } for reset

// Define routes.
app.all("*", checkHttps);

app.get("/logoff", function (req, res) {
  req.session.destroy((err) => {
    if (err) {
      res.status(400).send("Logging out went wrong");
    } else {
      res.redirect("/");
    }
  });
});

app.get("/auth/twitter", (req, res) => {
  "user" in req
    ? res.redirect("/success")
    : res.redirect("/actualAuth/twitter");
});

app.get("/actualAuth/twitter", passport.authenticate("twitter"));

app.get(
  "/login/twitter/return",
  passport.authenticate("twitter", { failureRedirect: "/" }),
  function (req, res) {
    req.session.save(function () {
      res.redirect("/success");
    });
  }
);

app.get(
  "/success",
  require("connect-ensure-login").ensureLoggedIn("/"),
  function (req, res) {
    res.header(
      "Cache-Control",
      "no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0"
    );
    res.render("success.hbs", {
      username: req.user.username,
      profile: req.user._json,
    });
  }
);

app.get(process.env.DB_CLEAR + "_sessions", async function (req, res) {
  // visit this URL to reset the DB
  let data = await sessions_db
    .query("SELECT COUNT(sid) FROM sessions", {
      raw: true,
    })
    .then((data) => {
      sessions_db.sync({ force: true });
      res.send(data);
    });
});

app.get(process.env.DB_CLEAR, function (req, res) {
  // visit this URL to reset the DB
  setup();
  res.redirect("/");
});

app.get("/api/known_instances.json", async (req, res) => {
  let data = await Instance.findAll({ where: { part_of_fediverse: true } });
  res.json(data);
});

app.get(process.env.DB_CLEAR + "_cleanup", (req, res) => {
  // visit this URL to remove timed out entries from the DB
  //let not_fedi = await remove_domains_by_part_of_fediverse(false);
  let to_remove = [500, 501, 503, 504, 301, 302];
  let removed = {};
  to_remove.forEach((status) => remove_domains_by_status(status));
  res.send(`Removed ${JSON.stringify(to_remove, null, 4)}`);

  //db_to_log();
});

app.get(process.env.DB_CLEAR + "_pop", async (req, res) => {
  // visit this URL to remove timed out entries from the DB
  Instance.sync({ force: true });
  console.log("Populating the database with known domains");
  populate_db("https://fedifinder.glitch.me/api/known_instances.json");
  res.redirect("/success");
});

const server = app.listen(process.env.PORT, function () {
  // listen for requests
  console.log("Your app is listening on port " + server.address().port);
});

// WARNING: THIS IS BAD. DON'T TURN OFF TLS
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

let Instance;

// setup a new database
// using database credentials set in .env
let sequelize = new Sequelize(
  "database",
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: "0.0.0.0",
    dialect: "sqlite",
    pool: {
      max: 5,
      min: 0,
      idle: 10000,
    },
    // Security note: the database is saved to the file `database.sqlite` on the local filesystem. It's deliberately placed in the `.data` directory
    // which doesn't get copied if someone remixes the project.
    storage: ".data/database.sqlite",
    logging: false,
  }
);

// authenticate with the database
sequelize
  .authenticate()
  .then(function (err) {
    console.log("Connection has been established successfully.");
    // define a new table 'instances'
    Instance = sequelize.define("instances", {
      domain: {
        type: Sequelize.STRING,
        primaryKey: true,
        unique: true,
      },
      local_domain: {
        type: Sequelize.STRING,
      },
      part_of_fediverse: {
        type: Sequelize.BOOLEAN,
      },
      software_name: {
        type: Sequelize.STRING,
      },
      software_version: {
        type: Sequelize.STRING,
      },
      users_total: {
        type: Sequelize.INTEGER,
      },
      users_activeMonth: {
        type: Sequelize.INTEGER,
      },
      users_activeHalfyear: {
        type: Sequelize.INTEGER,
      },
      localPosts: {
        type: Sequelize.INTEGER,
      },
      localComments: {
        type: Sequelize.INTEGER,
      },
      openRegistrations: {
        type: Sequelize.BOOLEAN,
      },
      status: {
        type: Sequelize.STRING,
      },
      retries: {
        type: Sequelize.INTEGER,
      },
    });

    if (/dev|staging|localhost/.test(process.env.PROJECT_DOMAIN)) tests();
  })
  .catch(function (err) {
    console.log("Unable to connect to the database: ", err);
  });

async function setup() {
  // removes all entries from the database by dropping and recreating all tables
  let data = await Instance.sync({ force: true });
  return data;
}

async function db_to_log() {
  // for debugging
  await Instance.findAll().then(function (instances) {
    instances.map((instance) => {
      console.log(instance.domain + " " + instance.status);
    });
  });
}

async function db_add(nodeinfo) {
  let data = await Instance.findOne({ where: { domain: nodeinfo["domain"] } });
  if (data) return data;
  else {
    try {
      await Instance.create(nodeinfo);
    } catch (err) {}
    return nodeinfo;
  }
}

async function db_remove(domain) {
  try {
    return await Instance.destroy({ where: { domain: domain } });
  } catch (err) {
    console.log(err);
  }
}
async function db_update(domain, data) {
  try {
    return await Instance.update(data, { where: { domain: domain } });
  } catch (err) {
    console.log(err);
  }
}

async function remove_domains_by_retries(retries) {
  try {
    return await Instance.destroy({ where: { retries: { [Op.gt]: retries } } });
  } catch (err) {
    console.log(err);
  }
}

async function remove_domains_by_part_of_fediverse(fediversy) {
  try {
    return await Instance.destroy({ where: { part_of_fediverse: fediversy } });
  } catch (err) {
    console.log(err);
  }
}

async function remove_domains_by_status(status) {
  try {
    let data = await Instance.destroy({ where: { status: status } });
    console.log(`${status} removed: ${data}`);
    return data;
  } catch (err) {
    console.log(err);
  }
}

async function update_data(domain, handle = null) {
  const data = await get_nodeinfo_url(domain);
  if (data && "nodeinfo_url" in data) {
    let nodeinfo = await get_nodeinfo(data.nodeinfo_url);
    if (nodeinfo) {
      nodeinfo["domain"] = domain;
      db_add(nodeinfo);
      return nodeinfo;
    } else if (handle) {
      // fallback to webfinger if domaincheck fails
      let profile_url = await url_from_handle(handle);
      const data = await get_nodeinfo_url(
        profile_url.split("//")[1].split("/")[0]
      );
      if (data && "nodeinfo_url" in data) {
        let nodeinfo = await get_nodeinfo(data.nodeinfo_url);
        if (nodeinfo) {
          nodeinfo["domain"] = domain;
          db_add(nodeinfo);
          return nodeinfo;
        }
      }
    }
  } else if (data && "status" in data) {
    let nodeinfo = {
      domain: domain,
      part_of_fediverse: false,
      retries: 1,
      status: data.status,
    };
    db_add(nodeinfo);
    return nodeinfo;
  } else {
    return { domain: domain, part_of_fediverse: false, retries: 1 };
  }
}

async function populate_db(seed_url) {
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
            data.map((instance) => {
              //todo check if data is current or something
              return instance;
            });
            Instance.bulkCreate(data, {
              ignoreDuplicates: true,
            }).then(
              data.map((instance) => {
                check_instance(instance.domain);
              })
            );
          } catch (err) {
            console.log(err);
          }
        } else console.log(false);
      });
    })
    .on("error", (err) => {
      //console.log(err);
      console.log(err);
      //todo: resolve unknown status
    });
}

async function check_instance(domain, handle = null) {
  // retrieve info about a domain
  let data = await Instance.findOne({ where: { domain: domain } });
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
  return new Promise(function (resolve) {
    webfinger.lookup(handle, function (err, info) {
      if (err) {
        console.log("error: ", err.message);
        resolve(false);
      } else {
        resolve(info);
      }
    });
  }).catch((err) => {
    console.log(err);
  });
}

async function url_from_handle(handle) {
  // checks if webfinger exists for a handle and returns the first href aka webadress
  handle = handle.replace(/^@/, "");
  let data = await get_webfinger(handle);
  if (data) {
    return data["object"]["links"][0]["href"];
  } else return false;
}

async function get_nodeinfo_url(host_domain, redirect_count = 0) {
  // get url of nodeinfo json
  return new Promise((resolve) => {
    let options = {
      method: "GET",
      host: host_domain,
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
              resolve(false);
            }
          } else resolve(false);
        });
      })
      .on("error", (err) => {
        //console.log(err);
        resolve({ status: err["code"] });
        //todo: resolve unknown status
      });
  }).catch((err) => {
    //console.log(err)
  });
}

function get_nodeinfo(nodeinfo_url) {
  // get fresh nodeinfo and save to db
  return new Promise((resolve) => {
    https
      .get(nodeinfo_url, { timeout: 5000 }, (res) => {
        let body = "";
        if (res.statusCode != 200) {
          resolve({ part_of_fediverse: false });
        }
        res.on("data", (d) => {
          body += d;
        });
        res.on("end", () => {
          if (body.startsWith("<") === false) {
            try {
              let nodeinfo = JSON.parse(body);
              resolve({
                part_of_fediverse: true,
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
                localComments:
                  "localComments" in nodeinfo["usage"]
                    ? nodeinfo["usage"]["localComments"]
                    : null, //todo handle unavailable counts
                openRegistrations: nodeinfo["openRegistrations"],
              });
            } catch (err) {
              console.log(nodeinfo_url);
              console.log(err);
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

const { Server } = require("socket.io");
const io = new Server(server);

const wrap = (middleware) => (socket, next) =>
  middleware(socket.request, {}, next);

io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));

io.use((socket, next) => {
  if (socket.request.user && socket.request.user.accessToken) {
    next();
  } else {
    next(new Error("SessionError"));
  }
});

io.sockets.on("connection", function (socket) {
  socket.on("checkDomains", function (data) {
    Promise.all(
      data.domains.map((domain) =>
        check_instance(domain.domain, domain.handle)
          .catch((err) => console.log(err))
          .then((data) => {
            socket.emit("checkedDomains", data);
          })
      )
    );
  });

  const errorHandler = (handler) => {
    const handleError = (err) => {
      console.log(err);
      socket.emit("Error", { Error: "SessionError" });
    };
  };

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
      socket.emit("Error", err);
    }
  }

  async function processRequests(type, data) {
    // get accounts from Twitter and sent relevant parts to frontend
    let accounts = [];
    let batch_size = 1000;

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

        if (accounts.length >= batch_size) {
          // don't wait until all accounts are loaded
          accounts.length > 0
            ? socket.emit("newAccounts", { type: type, accounts: accounts })
            : null;
          accounts = [];
        }
      }
      accounts.length > 0
        ? socket.emit("newAccounts", { type: type, accounts: accounts })
        : null;
    } catch (err) {
      socket.emit("Error", err);
      accounts.length > 0
        ? socket.emit("newAccounts", { type: type, accounts: accounts })
        : null;
    }
  }

  let client = create_twitter_client(socket.request.user);

  socket.on("loadLists", async (username) => {
    try {
      let lists = [];

      // get lists owned by user
      const ownedLists = await client.v2.listsOwned(socket.request.user.id, {
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
      const followedLists = await client.v2.listFollowed(
        socket.request.user.id,
        {
          "list.fields": ["member_count"],
        }
      );
      for await (const list of followedLists) {
        lists.push({
          name: list["name"],
          id_str: list["id"],
          member_count: list["member_count"],
        });
      }
      socket.emit("userLists", lists);
    } catch (err) {
      socket.emit("Error", err);
    }
  });

  socket.on("getList", async (list_id) => {
    // get list members from Twitter
    try {
      const data = await client.v2.listMembers(list_id, {
        "user.fields": ["name", "description", "url", "location", "entities"],
        expansions: ["pinned_tweet_id"],
        "tweet.fields": ["text", "entities"],
      });
      processRequests({ type: "list", list_id: list_id }, data);
    } catch (err) {
      socket.emit("Error", err);
    }
  });

  socket.on("getFollowings", async () => {
    // get followings from Twitter
    try {
      const data = await client.v2.following(socket.request.user.id, {
        asPaginator: true,
        max_results: 1000,
        "user.fields": ["name", "description", "url", "location", "entities"],
        expansions: ["pinned_tweet_id"],
        "tweet.fields": ["text", "entities"],
      });
      processRequests({ type: "followings" }, data);
    } catch (err) {
      socket.emit("Error", err);
    }
  });

  socket.on("getFollowers", async () => {
    // get followings from Twitter
    try {
      const data = await client.v2.followers(socket.request.user.id, {
        asPaginator: true,
        max_results: 1000,
        "user.fields": ["name", "description", "url", "location", "entities"],
        expansions: ["pinned_tweet_id"],
        "tweet.fields": ["text", "entities"],
      });
      processRequests({ type: "followers" }, data);
    } catch (err) {
      socket.emit("Error", err);
    }
  });
});

async function tests() {
  console.log("Start Tests");
  const assert = require("assert").strict;
  //Instance.sync({force:true})

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

  it("remove data from the db, add an entry, update the entry, remove entries with many retries", async () => {
    //await setup();
    //let empty = await Instance.findAll({ where: {} });
    //assert(empty.length == 0);

    let added_instance = await db_add({ domain: "test.com", retries: 100 });
    assert(added_instance.domain == "test.com");

    await db_update("test.com", { retries: (added_instance["retries"] += 1) });
    let updated_instance = await Instance.findOne({
      where: { domain: "test.com" },
    });
    assert(updated_instance.retries, 101);

    await remove_domains_by_retries(100);
    let cleaned = await Instance.findAll({
      where: { domain: "test.com" },
    });
    assert(cleaned.length == 0);
  });

  it("should get no info about a non fediverse website", async () => {
    let info = await check_instance("google.com");
    assert(info.part_of_fediverse == false);
  });

  it("should get new info about an instance and save to db", async () => {
    let info = await check_instance("lucahammer.com");
    assert(info.users_total == 1);
    info = await check_instance("lucahammer.com");
    assert(info.users_total == 1);
  });

  await url_from_handle("luca@vis.social");
  it("get url from handle (webfinger)", async () => {
    let url = await url_from_handle("@luca@vis.social");
    assert("https://vis.social/@Luca" == url);
    url = await url_from_handle("luca@lucahammer.com");
    assert("https://lucahammer.com/author/luca" == url);
  });
}
