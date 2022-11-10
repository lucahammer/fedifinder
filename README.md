# Find fediverse accounts of your Twitter contacts

- Collect twitter accounts based on your account (followings, followers, lists)
- Extract handles from name, description, location, url field and pinned Tweet
- Create CSV that can be imported to Mastodon and other services that support the format

Use it at <a href="https://fedifinder.glitch.me/">**fedifinder.glitch.me**</a> or run it on your own server.

# Contributing and running your own fedifinder

The easiest way to run your own version of fedifinder is to use the remix option of Glitch:

1. Go to the project page [https://glitch.com/edit/#!/fedifinder](https://glitch.com/edit/#!/fedifinder)
2. Click the Remix button on the top right: ![Remix](https://cdn.glitch.global/e1cbae25-ccee-4849-a338-8c4c2be555a6/remix-button.png?v=1668101954303)
3. This will spin up your own server. You don't need an account, but then it will be deleted after 5 days. Enough time to play with it.
   1. Optional: Change the URL in the settings at the top left "Edit Project Details". If the name contains "dev" or "staging" fedifinder will automatically
      run tests that can tell you if some functions correctly work. Useful for development. Annoying if you just want to use it.
4. Sign up for a Twitter Developer account and create an API v2 app: [developer.twitter.com/](https://developer.twitter.com/).
   1. Choose "User authentication set up"
   2. App permissions "Read"
   3. Type of App: Web, App or Bot
   4. Important: Set the Callback URI to https://YOUR_PROJECT_NAME.glitch.me/login/twitter/return
   5. Copy API Key and API Secret for the next step
5. Back in your Glitch project, go to the file .env and fill out the four variables.
   - TWITTER_CONSUMER_KEY (from the Twitter Developer Portal)
   - TWITTER_CONSUMER_SECRET (from the Twitter Developer Portal)
   - DB_CLEAR (Can be any string, but must start with / because it is used as an URL path for certain functionality)
   - SECRET (Any string. Is only used for the sessions.)
     ![.env file](https://cdn.glitch.global/e1cbae25-ccee-4849-a338-8c4c2be555a6/env-variables.png?v=1668102084373)
6. The server should automatically start the app. And restart it whenever you change something in the server.js.
   Status, Logs, and Terminal are at the bottom.
7. Optional: You can send code to Github (commit) by clicking Tools at the bottom of the screen, then export.
8. Optional: If there are new things in the main version (branch), you can use the same menu, select Import from Github and enter lucahammer/fedifinder.
   This will overwrite your own changes, but you will be able to get them back by using the Rewind option the same menu.
9. Optional: If you improved fedifinder, please submit a pull request on Github, so the changes can be added to the main branch. If you need inspiration,
   on what do work on, look into the [Github Issues](https://github.com/lucahammer/fedifinder/issues)

You should be able to run it anywhere where you got node.js, but I haven't tested it. You will need PROJECT_DOMAIN and PORT
as .env variables in addition of the four from step 5.

Take a look at the [Code of Conduct](https://github.com/lucahammer/fedifinder/code_of_conduct.md) and get in contact with [@luca@vis.social](https://vis.social/@luca)
if something or someone makes you uncomfortable.

# Background

Fedifinder is based on [opml.glitch.me](https://opml.glitch.me/). A tiny tool which I built in [2008](https://twitter.com/luca/status/1029354370620694530).
It enables people to export the RSS feeds of the websites of the accounts they follow on Twitter as an OPML file to import it into a RSS reader. Twitter was
my special interest and I am devastated by Musk's decisions. I adapted Fedifinder on a weekend and have since tried to keep up with issues and requests.

Consent is probably the only principle of fedifinder. It should only find, what people have made public themselves.

# Thanks

This project wouldn't be possible without the awesome Open Source Community.

Hosting

- glitch.com
- github.com

Frontend

- jquery
- json2csv
- socket.io
- tinytest

Backend

- better-sqlite3
- better-sqlite3-helper
- better-sqlite3-session-store
- bufferutil
- connect-ensure-login
- cookie-parser
- express
- express-session
- hbs
- passport
- passport-twitter
- socket.io
- twitter-api-v2
- utf-8-validate
- webfinger.js
