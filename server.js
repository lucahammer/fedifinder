const express = require("express");
let app = express();
var server = require("http").createServer(app);
const passport = require("passport");
const Strategy = require("passport-twitter").Strategy;
const Twit = require("twit");
const hbs = require("hbs");
const url = require("url");
const Sequelize = require("sequelize");
const https = require("https");
const session = require("express-session");

hbs.registerHelper("json", function (context) {
  return JSON.stringify(context);
});

app.use(express.static("public"));

passport.use(
  new Strategy(
    {
      consumerKey: process.env.TWITTER_CONSUMER_KEY,
      consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
      callbackURL:
        "https://" +
        process.env.PROJECT_DOMAIN +
        ".glitch.me/login/twitter/return",
    },
    function (token, tokenSecret, profile, cb) {
      // In this example, the user's Twitter profile is supplied as the user
      // record.  In a production-quality application, the Twitter profile should
      // be associated with a user record in the application's database, which
      // allows for account linking and authentication with other identity
      // providers.
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

app.use(require("body-parser").urlencoded({ extended: true }));

const sessionMiddleware = session({
  secret: process.env.SECRET,
  resave: true,
  saveUninitialized: false,
});
app.use(sessionMiddleware);

// Initialize Passport and restore authentication state, if any, from the
// session.
app.use(passport.initialize());
app.use(
  passport.session({
    secret: process.env.SECRET,
    resave: true,
    saveUninitialized: false,
  })
);

// Define routes.
app.get("/logoff", function (req, res) {
  req.session.destroy();
  res.redirect("/");
});

app.get("/auth/twitter", passport.authenticate("twitter"));

function handleFromUrl(urlstring) {
  if (urlstring.match(/^http/i)) {
    let handleUrl = url.parse(urlstring, true);
    return (
      urlstring.replace(/\/+$/, "").split("/").slice(-1) +
      "@" +
      handleUrl.host.toLowerCase()
    );
  } else {
    // not a proper URL
    // host.tld/@name host.tld/web/@name
    return (
      "@" +
      urlstring.split("@").slice(-1)[0].replace(/\/+$/, "") +
      "@" +
      urlstring.split("/")[0]
    );
  }
}

function extract_domains(handles) {
  let domains = handles.map((handle) => handle.split("@").slice(-1)[0]);
  domains = [...new Set(domains)];

  return domains;
}

function findHandles(text) {
  // different sperators people use
  let words = text.split(/,|\s|\(|\)/);

  // remove common false positives
  let unwanted_domains =
    /gmail\.com|medium\.com|tiktok\.com|youtube\.com|pronouns\.page/;
  words = words.filter((word) => !unwanted_domains.test(word));

  // @username@server.tld
  let handles = words.filter((word) =>
    /^@[a-zA-Z0-9_]+@.+\.[a-zA-Z]+$/.test(word)
  );

  // some people don't include the initial @
  handles = handles.concat(
    words
      .filter((word) => /^[a-zA-Z0-9_]+@.+\.[a-zA-Z]+$/.test(word))
      .map((maillike) => "@" + maillike)
  );

  // server.tld/@username
  handles = handles.concat(
    words
      .filter((word) => /^.+\.[a-zA-Z]+.*\/@[a-zA-Z0-9_]+\/*$/.test(word))
      .map((url) => handleFromUrl(url))
  );

  return handles;
}

function user_to_text(user) {
  // where handles could be: name, description, location, entities url urls expanded_url, entities description urls expanded_url
  let text =
    user["name"] + " " + user["description"] + " " + user["location"] + " ";
  if ("url" in user["entities"]) {
    text =
      text +
      user["entities"]["url"]["urls"].map(
        (url) => " " + url["expanded_url"] + " "
      );
  }
  if ("description" in user["entities"]) {
    text =
      text +
      user["entities"]["description"]["urls"].map(
        (url) => " " + url["expanded_url"] + " "
      );
  }
  return text;
}

function sort_handles(handles) {
  handles = handles.filter(
    (handle) => typeof handle != "undefined" && handle.length > 0
  );
  handles = [].concat(...handles);
  handles = [...new Set(handles)];
  handles.sort();

  let domains = extract_domains(handles);
  let sorted_handles = {};

  handles.forEach((handle) => {
    let curr_domain = handle.split("@").slice(-1)[0];
    if (curr_domain in sorted_handles) sorted_handles[curr_domain].push(handle);
    else sorted_handles[curr_domain] = [handle];
  });

  return sorted_handles;
}

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

// listen for requests :)
var server = app.listen(process.env.PORT, function () {
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
    });

    //setup();
  })
  .catch(function (err) {
    console.log("Unable to connect to the database: ", err);
  });

function setup() {
  Instance.sync({ force: true });
}

function db_to_log() {
  Instance.findAll().then(function (instances) {
    instances.forEach(function (instance) {
      console.log(instance);
    });
  });
}

// visit this URL to reset the DB
app.get(process.env.DB_CLEAR, function (req, res) {
  setup();
  res.redirect("/");
});

app.get("/test", function (req, res) {
  asyncCall();
  res.redirect("/");
});

function add_to_db(nodeinfo) {
  Instance.create(nodeinfo);
}

async function asyncCall() {
  db_to_log();
}

function check_instance(domain) {
  return new Promise((resolve) => {
    Instance.findOne({ where: { domain: domain } })
      .then(async (data) => {
        if (data === null) {
          const nodeinfo_url = await get_well_known_live(domain);
          if (nodeinfo_url) {
            let nodeinfo = await get_nodeinfo(nodeinfo_url);
            nodeinfo["domain"] = domain;
            add_to_db(nodeinfo);
            resolve(nodeinfo);
          } else {
            resolve({ domain: domain, part_of_fediverse: false });
          }
        } else resolve(data);
      })
      .catch((err) => {
        console.log(err);
      });
  });
}

async function get_well_known_live(host_domain) {
  return new Promise((resolve) => {
    let options = {
      method: "GET",
      host: host_domain,
      json: true,
      path: "/.well-known/nodeinfo",
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
          try {
            resolve(JSON.parse(body)["links"][0]["href"]);
          } catch (error) {
            resolve(false);
          }
        });
      })
      .on("error", (e) => {
        resolve(false);
        //console.error(e);
      });
  });
}

function get_nodeinfo(nodeinfo_url) {
  return new Promise((resolve) => {
    https
      .get(nodeinfo_url, (res) => {
        let body = "";
        if (res.statusCode != 200) {
          resolve({ part_of_fediverse: false });
        }
        res.on("data", (d) => {
          body += d;
        });
        res.on("end", () => {
          let nodeinfo = JSON.parse(body);
          resolve({
            part_of_fediverse: true,
            software:
              nodeinfo["software"]["name"] +
              " " +
              nodeinfo["software"]["version"],
            users: nodeinfo["usage"]["users"]["total"],
            posts: nodeinfo["usage"]["localPosts"],
            openRegistrations: nodeinfo["openRegistrations"],
          });
        });
      })
      .on("error", (e) => {
        resolve({ part_of_fediverse: false });
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
// force all requests to be SSL
app.all("*", checkHttps);

const { Server } = require("socket.io");
const io = new Server(server);
var connections = [];

const wrap = (middleware) => (socket, next) =>
  middleware(socket.request, {}, next);

io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));

io.use((socket, next) => {
  if (socket.request.user) {
    next();
  } else {
    next(new Error("unauthorized"));
  }
});

io.sockets.on("connection", function (socket) {
  connections.push(socket);

  socket.on("checkDomains", function (data) {
    let domains = data.domains.split(",");
    Promise.all(
      domains.map((domain) =>
        check_instance(domain)
          .catch(() => undefined)
          .then((data) => {
            socket.emit("checkedDomains", data);
          })
      )
    );
  });

  function create_T(user) {
    let T = new Twit({
      consumer_key: process.env.TWITTER_CONSUMER_KEY,
      consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
      access_token: user.accessToken,
      access_token_secret: user.tokenSecret,
      timeout_ms: 60 * 1000,
      strictSSL: true,
    });
    return T;
  }

  socket.on("loadLists", function (username) {
    let T = create_T(socket.request.user);

    T.get(
      "lists/list",
      { screen_name: username, reverse: true },
      function getData(err, data, response) {
        let lists = [];
        if (err) {
          socket.emit("listError", err);
          return;
        }
        data.map((list) =>
          lists.push({
            name: list["name"],
            id_str: list["id_str"],
            member_count: list["member_count"],
          })
        );

        if (data["next_cursor"])
          T.get(
            "lists/list",
            {
              screen_name: data.username,
              reverse: true,
              cursor: data["next_cursor"],
            },
            getData
          );
        else {
          socket.emit("userLists", lists);
        }
      }
    );
  });

  socket.on("scanList", function (list_id) {
    let T = create_T(socket.request.user);
    let amount = 0;

    T.get(
      "lists/members",
      { list_id: list_id, count: 5000, skip_status: true },
      function getData(err, data, response) {
        let handles = [];
        if (err) {
          socket.emit("Error", err);
          return;
        }
        amount += data["users"].length;
        handles = handles.concat(
          data["users"].map((user) => findHandles(user_to_text(user)))
        );

        if (data["next_cursor"])
          T.get(
            "lists/members",
            {
              screen_name: data.username,
              reverse: true,
              cursor: data["next_cursor"],
            },
            getData
          );
        else {
          let sorted_handles = sort_handles(handles);

          socket.emit("newHandles", {
            amount: amount,
            handles: sorted_handles,
          });
        }
      }
    );
  });

  socket.on("scanFollowings", function () {
    let user = socket.request.user;
    let T = create_T(user);

    var page = 0;
    let checked_accounts = 0;
    var maxPage = process.env.MAX_PAGE;
    var handles = [];
    T.get(
      "friends/list",
      { screen_name: user.username, count: 200, skip_status: true },
      function getData(err, data, response) {
        if (err) {
          socket.emit("Error", err);
          return;
        }
        checked_accounts += data["users"].length;
        handles = handles.concat(
          data["users"].map((user) => findHandles(user_to_text(user)))
        );
        page++;

        if (data["next_cursor"] > 0 && page < maxPage)
          T.get(
            "friends/list",
            {
              screen_name: user.username,
              count: 200,
              skip_status: true,
              cursor: data["next_cursor"],
            },
            getData
          );
        else {
          let sorted_handles = sort_handles(handles);
          socket.emit("newHandles", {
            amount: checked_accounts,
            handles: sorted_handles,
          });
        }
      }
    );
  });
});
