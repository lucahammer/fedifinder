var express = require("express");
var app = express();
var server = require("http").createServer(app);
const passport = require("passport");
const Strategy = require("passport-twitter").Strategy;
const Twit = require("twit");
const hbs = require("hbs");
var url = require("url");

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
app.use(
  require("express-session")({
    secret: "keyboard cat",
    resave: true,
    saveUninitialized: true,
  })
);

// Initialize Passport and restore authentication state, if any, from the
// session.
app.use(passport.initialize());
app.use(passport.session());

// Define routes.
app.get("/logoff", function (req, res) {
  req.session.destroy();
  res.redirect("/");
});

app.get("/auth/twitter", passport.authenticate("twitter"));

function handleFromUrl(urlstring) {
  if (urlstring.includes("http")) {
    let handleUrl = url.parse(urlstring, true);
    return urlstring.split("/").slice(-1) + "@" + handleUrl.host;
  } else {
    // not a proper URL
    // host.tld/@name host.tld/web/@name
    return "@" + urlstring.split("@").slice(-1) + "@" + urlstring.split("/")[0];
  }
}

function findHandles(text, name) {
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
  /*handles = handles.concat(
    words
      .filter((word) => /^[a-zA-Z0-9_]+@.+\.[a-zA-Z]+$/.test(word))
      .map((maillike) => "@" + maillike)
  );*/

  // server.tld/@username
  handles = handles.concat(
    words
      .filter((word) => /^.+\.[a-zA-Z]+.*\/@[a-zA-Z0-9_]+$/.test(word))
      .map((url) => handleFromUrl(url)).map(url => ({name: name, url: url}))
  );

  return handles;
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
    var maxPage = 15;
    var handles = [];
    T.get(
      "friends/list",
      { screen_name: req.user.username, count: 200, skip_status: true },
      function getData(err, data, response) {
        if (err) {
          return res.send(err);
        }
        handles = handles.concat(
          data["users"].map((user) => {
            // where handles could be: screen_name, description, location, entities url urls expanded_url, entities description urls expanded_url
            let text =
              user["name"] +
              " " +
              user["description"] +
              " " +
              user["location"] +
              " ";
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

            return findHandles(text, user["screen_name"]);
          })
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

          res.header(
            "Cache-Control",
            "no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0"
          );
          res.render("success.hbs", { handles });
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
