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

const sessionOptions = {
  secret: process.env.SECRET,
  resave: true,
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

// Define routes.
app.all("*", checkHttps);

app.get("/logoff", function (req, res) {
  req.session.destroy();
  res.redirect("/");
});

app.get("/auth/twitter", passport.authenticate("twitter"));

app.get(
  "/login/twitter/return",
  passport.authenticate("twitter", { failureRedirect: "/" }),
  function (req, res) {
    res.redirect("/success");
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
      profile: findHandles(user_to_text(req.user._json)),
    });
  }
);

app.get(process.env.DB_CLEAR, function (req, res) {
  // visit this URL to reset the DB
  setup();
  res.redirect("/");
});

const server = app.listen(process.env.PORT, function () {
  // listen for requests
  console.log("Your app is listening on port " + server.address().port);
});

function handleFromUrl(urlstring) {
  // transform an URL-like string into a fediverse handle: @name@server.tld
  if (urlstring.match(/^http/i)) {
    let handleUrl = url.parse(urlstring, true);
    let name = urlstring.replace(/\/+$/, "").split("/").slice(-1);
    return `${name}@${handleUrl.host}`;
  } else {
    // not a proper URL
    // host.tld/@name host.tld/web/@name
    let name = "";
    let domain = "";
    if (urlstring.includes("@")) {
      name = urlstring.split("@").slice(-1)[0].replace(/\/+$/, "");
    } else if (urlstring.includes("/profile/")) {
      // friendica: sub.domain.tld/profile/name
      name = urlstring.split("/profile/").slice(-1)[0].replace(/\/+$/, "");
    }
    domain = urlstring.split("/")[0];
    return `@${name}@${domain}`;
  }
}

function findHandles(text) {
  // split text into string and check them for handles

  // different string sperators people use
  text = text.replace(/[^\p{L}\p{N}\p{P}\p{Z}^$\n@\.]/gu, " ").toLowerCase();
  let words = text.split(/,|\s|“|\(|\)|'|》|\n|\r|\t|・|\||…|▲|\.\s|\s$/);

  // remove common false positives
  let unwanted_domains =
    /gmail\.com|medium\.com|tiktok\.com|youtube\.com|pronouns\.page|mail@|observablehq|twitter\.com|contact@|kontakt@|protonmail|medium\.com|traewelling\.de|press@|support@|info@|pobox|hey\.com/;
  words = words.filter((word) => !unwanted_domains.test(word));

  // @username@server.tld
  let handles = words.filter((word) =>
    /^@[a-zA-Z0-9_]+@.+\.[a-zA-Z]+$/.test(word)
  );

  // some people don't include the initial @
  handles = handles.concat(
    words
      .filter((word) => /^[a-zA-Z0-9_]+@.+\.[a-zA-Z|]+$/.test(word))
      .map((maillike) => `@${maillike}`)
  );

  // server.tld/@username
  // friendica: sub.domain.tld/profile/name
  handles = handles.concat(
    words
      .filter((word) =>
        /^.+\.[a-zA-Z]+.*\/(@|profile\/)[a-zA-Z0-9_]+\/*$/.test(word)
      )
      .map((url) => handleFromUrl(url))
  );

  return handles;
}

function user_to_text(user) {
  // where handles could be: name, description, location, entities url urls expanded_url, entities description urls expanded_url
  let text = `${user["name"]} ${user["description"]} ${user["location"]}`;
  if ("entities" in user) {
    if ("url" in user["entities"] && "urls" in user["entities"]["url"]) {
      user["entities"]["url"]["urls"].map(
        (url) => (text += ` ${url["expanded_url"]} `)
      );
    }
    if (
      "description" in user["entities"] &&
      "urls" in user["entities"]["description"]
    ) {
      user["entities"]["description"]["urls"].map(
        (url) => (text += ` ${url["expanded_url"]} `)
      );
    }
  }
  return text;
}

function tweet_to_text(tweet) {
  // combine tweet text and expanded_urls
  let text = tweet["text"] + " ";

  if ("entities" in tweet && "urls" in tweet["entities"]) {
    tweet["entities"]["urls"].map(
      (url) => (text += ` ${url["expanded_url"]} `)
    );
  }
  return text;
}

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
      part_of_fediverse: {
        type: Sequelize.BOOLEAN,
      },
      software: {
        type: Sequelize.STRING,
      },
      users: {
        type: Sequelize.INTEGER,
      },
      posts: {
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
    instances.forEach(function (instance) {
      console.log(instance);
    });
  });
}

async function db_add(nodeinfo) {
  try {
    let data = await Instance.upsert(nodeinfo);
    return data[0];
  } catch (err) {
    console.log(err);
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

async function update_data(domain) {
  const data = await get_nodeinfo_url(domain);
  if (data && "nodeinfo_url" in data) {
    let nodeinfo = await get_nodeinfo(data.nodeinfo_url);
    if (nodeinfo) {
      nodeinfo["domain"] = domain;
      db_add(nodeinfo);
      return nodeinfo;
    }
  } else if (
    data &&
    "status" in data &&
    data.status != "ECONNREFUSED" &&
    data.status != "ECONNRESET"
  ) {
    return {
      domain: domain,
      part_of_fediverse: false,
      retries: 1,
      status: data.status,
    };
  } else {
    return { domain: domain, part_of_fediverse: false, retries: 1 };
  }
}

async function check_instance(domain) {
  // retrieve info about a domain
  let data = await Instance.findOne({ where: { domain: domain } });

  if (data === null) {
    // no cached info -> get new info
    let new_data = await update_data(domain);
    return new_data;
  } else {
    if (data["status"] === "ETIMEDOUT" && data["retries"] <= 5) {
      // if it timed out in the past, try again; but not too often
      return await db_update(domain, { retries: data["retries"] + 1 });
      //update_data(domain);
    }
    return data;
  }
}

async function get_nodeinfo_url(host_domain) {
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
          resolve(false);
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
                software: `${nodeinfo["software"]["name"]} ${nodeinfo["software"]["version"]}`,
                users: nodeinfo["usage"]["users"]["total"],
                posts: nodeinfo["usage"]["localPosts"],
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
        console.log(e);
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
    let domains = data.domains.split(",");
    Promise.all(
      domains.map((domain) =>
        check_instance(domain)
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

  async function processAccounts(data) {
    // scan accounts for handles
    let accounts = [];
    let batch_size = 500;

    try {
      for await (const user of data) {
        const pinnedTweet = data.includes.pinnedTweet(user);
        let text = user_to_text(user);
        pinnedTweet ? (text += " " + tweet_to_text(pinnedTweet)) : "";
        let handles = findHandles(text);
        accounts.push({
          username: user.username,
          handles: handles,
        });

        if (accounts.length >= batch_size) {
          // don't wait until all accounts are loaded
          socket.emit("newHandles", accounts);
          accounts = [];
        }
      }
      accounts.length > 0 ? socket.emit("newHandles", accounts) : void 0;
    } catch (err) {
      socket.emit("Error", err);
      accounts.length > 0 ? socket.emit("newHandles", accounts) : void 0;
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

  socket.on("scanList", async (list_id) => {
    // get list members from Twitter
    try {
      const data = await client.v2.listMembers(list_id, {
        "user.fields": ["name", "description", "url", "location", "entities"],
        expansions: ["pinned_tweet_id"],
        "tweet.fields": ["text", "entities"],
      });
      processAccounts(data);
    } catch (err) {
      socket.emit("Error", err);
    }
  });

  socket.on("scanFollowings", async () => {
    // get followings from Twitter
    try {
      const data = await client.v2.following(socket.request.user.id, {
        asPaginator: true,
        max_results: 1000,
        "user.fields": ["name", "description", "url", "location", "entities"],
        expansions: ["pinned_tweet_id"],
        "tweet.fields": ["text", "entities"],
      });
      processAccounts(data);
    } catch (err) {
      socket.emit("Error", err);
    }
  });

  socket.on("scanFollowers", async () => {
    // get followings from Twitter
    try {
      const data = await client.v2.followers(socket.request.user.id, {
        asPaginator: true,
        max_results: 1000,
        "user.fields": ["name", "description", "url", "location", "entities"],
        expansions: ["pinned_tweet_id"],
        "tweet.fields": ["text", "entities"],
      });
      processAccounts(data);
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

  it("should return handle based on URL string", () => {
    assert.strictEqual(
      handleFromUrl("https://vis.social/@luca"),
      "@luca@vis.social"
    );
    assert.strictEqual(handleFromUrl("vis.social/@luca"), "@luca@vis.social");
    assert.strictEqual(
      handleFromUrl("http://vis.social/@luca"),
      "@luca@vis.social"
    );
  });

  it("should return list of handles from a text string", () => {
    let text =
      "Twitter was my special interest. Scientific Programmer @sfb1472 fedi\
@luca@lucahammer.com \
http://vis.social/web/@Luca/ \
http://det.social/@luca \
@pv@botsin.space";
    assert(findHandles(text), [
      "@pv@botsin.space",
      "@fedi@luca@lucahammer.com",
      "@luca@vis.social",
      "@luca@det.social",
    ]);
  });

  it("should get the nodeinfo URL", async () => {
    let data = await get_nodeinfo_url("lucahammer.com");
    assert(data.nodeinfo_url == "https://lucahammer.com/wp-json/nodeinfo/2.1");
  });

  it("remove data from the db, add an entry, update the entry, remove entries with many retries", async () => {
    await setup();
    let empty = await Instance.findAll({ where: {} });
    assert(empty.length == 0);

    let added_instance = await db_add({ domain: "test.com", retries: 100 });
    assert(added_instance.domain == "test.com");

    await db_update("test.com", { retries: (added_instance["retries"] += 1) });
    let updated_instance = await Instance.findOne({
      where: { domain: "test.com" },
    });
    assert(updated_instance.retries, 101);

    await db_add({ domain: "test2.com", retries: 100 });
    let before_cleaning = await Instance.findAll({});
    assert(before_cleaning.length == 2);
    await remove_domains_by_retries(100);
    let cleaned = await Instance.findAll({});
    assert(cleaned.length == 1);
  });

  it("should get new info about an instance and save to db", async () => {
    let info = await check_instance("lucahammer.com");
    assert(info.users == 1);
    let data = await Instance.findOne({
      where: { domain: "lucahammer.com" },
    });
    assert(data.part_of_fediverse == true);
  });

  it("should get no info about a non fediverse website", async () => {
    let info = await check_instance("google.com");
    assert(info.part_of_fediverse == false);
  });
}
