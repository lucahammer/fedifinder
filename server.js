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

function sort_handles(handles, domains) {
  let sorted_handles = {};
  let not_fedi = [];

  handles.forEach((handle) => {
    let curr_domain = handle.split("@").slice(-1)[0];
    if (curr_domain in sorted_handles) sorted_handles[curr_domain].push(handle);
    else sorted_handles[curr_domain] = [handle];
  });

  //console.log(not_fedi);
  //console.log(sorted_handles)
  return sorted_handles;
}

app.get(
  "/login/twitter/return",
  passport.authenticate("twitter", { failureRedirect: "/" }),
  function (req, res) {
    var user = req.user;

    var T = new Twit({
      consumer_key: process.env.TWITTER_CONSUMER_KEY,
      consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
      access_token: user.accessToken,
      access_token_secret: user.tokenSecret,
      timeout_ms: 60 * 1000,
      strictSSL: true,
    });

    var page = 0;
    let checked_accounts = 0;
    var maxPage = process.env.MAX_PAGE;
    var handles = [];
    T.get(
      "friends/list",
      { screen_name: req.user.username, count: 200, skip_status: true },
      function getData(err, data, response) {
        if (err) {
          //response.redirect("/error.html");
          return res.send(err);
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
              screen_name: req.user.username,
              count: 200,
              skip_status: true,
              cursor: data["next_cursor"],
            },
            getData
          );
        else {
          handles = handles.filter(
            (handle) => typeof handle != "undefined" && handle.length > 0
          );
          handles = [].concat(...handles);
          handles = [...new Set(handles)];
          handles.sort();

          let found_handles = handles.length;

          let domains = extract_domains(handles);
          let sorted_handles = sort_handles(handles, domains);

          res.header(
            "Cache-Control",
            "no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0"
          );

          res.render("success.hbs", {
            username: req.user.username,
            found_handles: found_handles,
            checked_accounts: checked_accounts,
            handles: sorted_handles,
            profile: findHandles(user_to_text(req.user._json)),
          });
        }
      }
    );
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
    res.render("success.hbs");
  }
);

// listen for requests :)
var server = app.listen(process.env.PORT, function () {
  console.log("Your app is listening on port " + server.address().port);
});

// WARNING: THIS IS BAD. DON'T TURN OFF TLS
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// default instances
let instances = [
  ["mastodon.social", true],
  ["gmail.com", false],
  ["vis.social", true],
];
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
      instance: {
        type: Sequelize.STRING,
      },
      well_known: {
        type: Sequelize.BOOLEAN,
      },
    });

    //setup();
  })
  .catch(function (err) {
    console.log("Unable to connect to the database: ", err);
  });

function setup() {
  Instance.sync({ force: true }).then(function () {
    // Add the default instances to the database
    for (var i = 0; i < instances.length; i++) {
      Instance.create({
        instance: instances[i][0],
        well_known: instances[i][1],
      });
    }
  });

  Instance.findOne({ where: { instance: "vis.social" } }).then(function (
    instances
  ) {
    console.log(instances.well_known);
  });
}

function db_to_log() {
  Instance.findAll().then(function (instances) {
    instances.forEach(function (instance) {
      console.log(instance.instance + ": " + instance.well_known);
    });
  });
}

// visit this URL to reset the DB
app.get(process.env.DB_CLEAR, function (request, response) {
  setup();
  response.redirect("/");
});

app.get("/test", function (req, res) {
  asyncCall();
});

function add_to_db(domain, well_known) {
  Instance.create({
    instance: domain,
    well_known: well_known,
  });
}

async function asyncCall() {
  db_to_log();
}

async function check_domain(domain) {
  const info = await check_well_known(domain);
  return { domain: domain, well_known: info };
}

function check_well_known(domain) {
  return new Promise((resolve) => {
    Instance.findOne({ where: { instance: domain } })
      .then(async (data) => {
        if (data === null) {
          const well_known_live = await get_well_known_live(domain);
          add_to_db(domain, well_known_live);
          resolve(well_known_live);
        } else resolve(data.well_known);
      })
      .catch((err) => {
        console.log(err);
      });
  });
}

function get_well_known_live(host_domain) {
  return new Promise((resolve) => {
    let options = {
      method: "HEAD",
      host: host_domain,
      path: "/.well-known/host-meta",
    };

    https
      .get(options, (res) => {
        if (res.statusCode == 200) {
          resolve(true);
        } else {
          resolve(false);
        }
      })
      .on("error", (e) => {
        resolve(false);
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
  //console.log(socket.request.user);

  socket.on("checkDomains", function (data) {
    let domains = data.domains.split(",");
    Promise.all(
      domains.map((domain) =>
        check_well_known(domain)
          .catch(() => undefined)
          .then((completed) => {
            socket.emit("checkedDomains", {
              domain: domain,
              well_known: completed,
            });
          })
      )
    );
  });

  socket.on("getLists", function (dataFront) {
    var T = new Twit({
      consumer_key: process.env.TWITTER_CONSUMER_KEY,
      consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
      access_token: socket.request.user.accessToken,
      access_token_secret: socket.request.user.tokenSecret,
      timeout_ms: 60 * 1000,
      strictSSL: true,
    });

    T.get(
      "lists/list",
      { screen_name: dataFront.username, reverse: true },
      function getData(err, data, response) {
        let lists = [];
        if (err) {
          socket.emit("listError", err);
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
    var T = new Twit({
      consumer_key: process.env.TWITTER_CONSUMER_KEY,
      consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
      access_token: socket.request.user.accessToken,
      access_token_secret: socket.request.user.tokenSecret,
      timeout_ms: 60 * 1000,
      strictSSL: true,
    });
    T.get(
      "lists/members",
      { list_id: list_id, count: 5000, skip_status: true },
      function getData(err, data, response) {
        let handles = [];
        if (err) {
          socket.emit("Error", err);
        }
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
          handles = handles.filter(
            (handle) => typeof handle != "undefined" && handle.length > 0
          );
          handles = [].concat(...handles);
          handles = [...new Set(handles)];
          handles.sort();

          let found_handles = handles.length;

          let domains = extract_domains(handles);
          let sorted_handles = sort_handles(handles, domains);

          socket.emit("usersFromList", {
            found_handles: found_handles,
            handles: sorted_handles,
          });
        }
      }
    );
  });
});
