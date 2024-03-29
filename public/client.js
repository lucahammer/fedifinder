/* globals tests, eq json2csv, Vue*/

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nameFromUrl(urlstring) {
  // returns username without @
  let name = "";
  // https://host.tld/@name host.tld/web/@name/
  // not a proper domain host.tld/@name
  if (urlstring.includes("@"))
    name = urlstring
      .split(/\/|\?/)
      .filter((urlparts) => urlparts.includes("@"))[0]
      .replace("@", "");
  // friendica: sub.domain.tld/profile/name
  else if (urlstring.includes("/profile/"))
    name = urlstring.split("/profile/").slice(-1)[0].replace(/\/+$/, "");
  // diaspora: domain.tld/u/name
  else if (urlstring.includes("/u/"))
    name = urlstring.split("/u/").slice(-1)[0].replace(/\/+$/, "");
  // peertube: domain.tld/u/name
  else if (/\/c\/|\/a\//.test(urlstring))
    name = urlstring
      .split(/\/c\/|\/a\//)
      .slice(-1)[0]
      .split("/")[0];
  else {
    console.log(`didn't find name in ${urlstring}`);
  }
  return name;
}

function handleFromUrl(urlstring) {
  // transform an URL-like string into a fediverse handle: @name@server.tld
  let name = nameFromUrl(urlstring);
  let handleUrl;
  try {
    handleUrl = new URL(urlstring);
  } catch (e) {
    handleUrl = null;
  }
  if (handleUrl) {
    // proper url
    return `@${name}@${handleUrl.host}`;
  } else {
    // not a proper URL
    // remove possible inproper http:// or https://
    let pseudoSanitized = urlstring.replace(/^(http)?s?:*\/\//, "");
    let domain = pseudoSanitized.split("/")[0];
    return `@${name}@${domain}`;
  }
}

function findHandles(text) {
  // split text into string and check them for handles

  // remove weird characters and unicode font stuff
  text = text
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}\n@\.^$]/gu, " ")
    .toLowerCase()
    .normalize("NFKD");

  // different separators people use
  let words = text.split(
    /,|;|\s|“|#|\(|\)|'|》|\?|\n|\r|\t|・|丨|\||…|\.\s|\s$/
  );
  words = words.map((w) => w.replace(/^:|\/$/g, ""));
  // remove common false positives
  let unwanted_domains =
    /gmail\.com(?:$|\/)|mixcloud|linktr\.ee(?:$|\/)|pinboard\.com(?:$|\/)|tutanota\.de(?:$|\/)|xing\.com(?:$|\/)|researchgate|about|bit\.ly(?:$|\/)|imprint|impressum|patreon|donate|facebook|github|instagram|medium\.com(?:$|\/)|t\.co(?:$|\/)|tiktok\.com(?:$|\/)|youtube\.com(?:$|\/)|pronouns\.page(?:$|\/)|mail@|observablehq|twitter\.com(?:$|\/)|contact@|kontakt@|protonmail|traewelling\.de(?:$|\/)|press@|support@|info@|pobox|hey\.com(?:$|\/)/;
  words = words.filter((word) => !unwanted_domains.test(word));
  words = words.filter((w) => w);

  let handles = [];

  words.map((word) => {
    // strip leading, trailing dots from word
    word = word.replace(/^\.*|\.*$/g, "");

    // @username@server.tld
    if (/^@[a-zA-Z0-9_\-\.]+@.+\.[a-zA-Z]+$/.test(word))
      handles.push(word.replace(":", " "));
    // some people don't include the initial @
    else if (/^[a-zA-Z0-9_\-]+@.+\.[a-zA-Z|]+$/.test(word.replace(":", " ")))
      handles.push(`@${word.replace(":", " ")}`);
    // server.tld/@username
    // friendica: sub.domain.tld/profile/name
    else if (
      /^.+\.[a-zA-Z]+.*\/(@|web\/|profile\/|\/u\/|\/c\/)[a-zA-Z0-9_\-]+\/*$/.test(
        word
      )
    )
      handles.push(handleFromUrl(word));

    // experimental. domain.tld/name. too many false positives
    // pleroma, snusocial
    //else if (/^.+\.[a-zA-Z]+\/[a-zA-Z_]+\/?$/.test(word)) console.log(word);
  });
  return [...new Set(handles)];
}

const app = Vue.createApp({
  data() {
    return {
      scanned: [],
      scan_count: 0,
      profile: null,
      user_lists: [],
      selected_list: null,
      accounts: [],
      domains: {},
      known_instances: {},
      unchecked_domains: [],
      lookup_server: false,
      twitter_auth: false,
      scanned_followers: false,
      display_accounts: false,
      show_follow_buttons: true,
      error_message: "",
      show_all_instances: false,
      bsky_accounts: {},
      unchecked_bskyhandles: [],
      bskyhandles: [],
      bsky_followings: {},
      threads_handles: [],
    };
  },
  computed: {
    unique_count() {
      let sum = 0;
      for (const [domain, data] of Object.entries(this.domains)) {
        "handles" in data && data.part_of_fediverse === 1
          ? (sum = sum + data.handles.length)
          : void 0;
      }
      return sum;
    },
    broken_count() {
      let sum = 0;
      for (const [domain, data] of Object.entries(this.domains)) {
        "handles" in data && data.part_of_fediverse === 0
          ? (sum = sum + data.handles.length)
          : void 0;
      }
      return sum;
    },
    unchecked_domains_count() {
      return this.unchecked_domains.length;
    },
    sorted_domains() {
      let sorted = [];
      for (const [domain, data] of Object.entries(this.domains)) {
        sorted.push([
          {
            domain: domain,
            local_domain: data.local_domain ? data.local_domain : domain,
            software_name: data.software_name,
            software_version: data.software_version,
            users_total: data.users_total,
            contacts: "handles" in data ? data.handles.length : 0,
            openRegistrations: data.openRegistrations,
            part_of_fediverse: data.part_of_fediverse,
          },
          "handles" in data ? data.handles.length : 0,
        ]);
      }
      sorted.sort(function (a, b) {
        return b[1] - a[1];
      });
      return sorted;
    },
  },
  methods: {
    processAccount(type, user) {
      let followings, follower, list;
      type.type == "followers" ? (follower = true) : null;
      type.type == "followings" ? (followings = true) : null;

      if (user.username in this.accounts) {
        this.accounts[user.username].following = this.accounts[user.username]
          .following
          ? this.accounts[user.username].following
          : followings;
        this.accounts[user.username].follower = this.accounts[user.username]
          .follower
          ? this.accounts[user.username].follower
          : follower;
        type.type == "list"
          ? this.accounts[user.username].lists.push(type.list_name)
          : this.accounts[user.username].lists;
      } else {
        this.scan_count += 1;

        let text = `${user["name"]} ${user["description"]} ${
          user["location"]
        } ${user["pinned_tweet"]} ${user["urls"].join(" ")}`;

        let handles = findHandles(text);

        this.accounts[user.username] = {
          name: user.name,
          following: followings,
          follower: follower,
          lists: [type.list_name],
          handles: handles,
          bskyhandles: [],
          location: user.location,
          description: user.description,
          urls: user.urls,
          pinned_tweet: user.pinned_tweet,
        };
        this.findBskyHandles(user.username, text);
        this.findThreadsHandles(user.username, text);
        this.addHandles(user.username, handles);
        this.removeDuplicates();
      }
    },
    findThreadsHandles(username, text) {
      // split text into string and check them for handles

      // remove weird characters and unicode font stuff
      text = text
        .replace(/[^\p{L}\p{N}\p{P}\p{Z}\n@\.^$]/gu, " ")
        .toLowerCase()
        .normalize("NFKD");

      // different separators people use
      let words = text.split(
        /,|;|\s|“|#|\(|\)|'|》|\?|\n|\r|\t|・|丨|\||…|\.\s|\s$/
      );
      words = words.map((w) => w.replace(/^:|\/$/g, ""));
      // remove common false positives
      words = words.filter((word) => /threads\.net|instagram\.com/.test(word));
      words = words.filter((w) => w);

      let handles = [];
      let urls = [];

      words.map((word) => {
        // strip leading, trailing dots from word
        word = word.replace(/^\.*|\.*$/g, "");

        // https://www.threads.net/@luca._hammer or threads.net/@luca._hammer
        if (word.includes("threads.net")) {
          handles.push({
            handle: word.split("/").slice(-1)[0].replace("@",""),
            matchtype: "threads.net",
          });
        }

        // https://www.instagram.com/luca._hammer/
        else if (word.includes("instagram.com")) {
          handles.push({
            handle: word.split("/").slice(-1)[0],
            matchtype: "instagram account",
          });
        }
      });

      // remove duplicates, keep last handle
      handles = [
        ...new Map(
          handles.map((handle) => [handle["handle"], handle])
        ).values(),
      ];

      this.accounts[username]["threadshandles"] = handles;
      this.addThreadsHandles(username, handles);
    },
    findBskyHandles(username, text) {
      // split text into string and check them for handles

      // remove weird characters and unicode font stuff
      text = text
        .replace(/[^\p{L}\p{N}\p{P}\p{Z}\n@\.^$]/gu, " ")
        .toLowerCase()
        .normalize("NFKD");

      // different separators people use
      let words = text.split(
        /,|;|\s|“|#|\(|\)|'|》|\?|\n|\r|\t|・|丨|\||…|\.\s|\s$/
      );
      words = words.map((w) => w.replace(/^:|\/$/g, ""));
      // remove common false positives
      let unwanted_domains =
        /gmail\.com(?:$|\/)|mixcloud|linktr\.ee(?:$|\/)|pinboard\.com(?:$|\/)|tutanota\.de(?:$|\/)|xing\.com(?:$|\/)|researchgate|bit\.ly(?:$|\/)|patreon|donate|facebook|github|instagram|medium\.com(?:$|\/)|t\.co(?:$|\/)|tiktok\.com(?:$|\/)|youtube\.com(?:$|\/)|pronouns\.page(?:$|\/)|observablehq|twitter\.com(?:$|\/)|protonmail|traewelling\.de(?:$|\/)|pobox|hey\.com(?:$|\/)/;
      words = words.filter((word) => !unwanted_domains.test(word));
      words = words.filter((w) => w);

      let handles = [];
      let urls = [];

      if (`${username}.bsky.social` in this.bsky_accounts) {
        handles.push({
          handle: `${username}.bsky.social`,
          matchtype: "guessed username",
        });
      }

      words.map((word) => {
        // strip leading, trailing dots from word
        word = word.replace(/^\.*|\.*$/g, "");

        // makeithackin.bsky.social or @makeithackin.bsky.social
        if (word.includes("bsky.social")) {
          let match = word.match(/[a-zA-Z0-9\-]+\.bsky\.social/);
          if (match)
            handles.push({
              handle: match[0],
              matchtype: "bsky domain",
            });
        }

        // https://staging.bsky.app/profile/luca.run or https://bsky.app/profile/luca.run
        else if (word.includes("bsky.app")) {
          handles.push({
            handle: word.split("/").slice(-1)[0],
            matchtype: "link",
          });
        }

        // luca.run or https://luca.run or @luca.run or something@luca.run
        else {
          let url = word.match(/[a-zA-Z0-9_\-\.]+\.[a-zA-Z]+/);
          if (url) url = url[0];

          if (url) {
            if (url in this.bsky_accounts) {
              handles.push({ handle: url, matchtype: "known ATP domain" });
            } else if (url.replace("www.", "") in this.bsky_accounts) {
              handles.push({
                handle: url.replace("www.", ""),
                matchtype: "known ATP domain",
              });
            } else {
              urls.push(url);
            }
          }
        }
      });

      // remove duplicates, keep last handle
      handles = [
        ...new Map(
          handles.map((handle) => [handle["handle"], handle])
        ).values(),
      ];

      this.accounts[username]["bskyhandles"] = handles;
      this.addBskyHandles(username, handles);

      this.unchecked_bskyhandles.push({ username: username, urls: urls });
    },
    addHandles(username, handles) {
      // add handles to domains list
      if (handles.length > 0) {
        handles.forEach((handle) => {
          let url = "";
          let domain = handle.split("@").slice(-1)[0];

          if (
            domain in this.domains &&
            "local_domain" in this.domains[domain]
          ) {
            url = `https://${this.domains[domain]}/@${handle.split("@")[1]}`;
          } else {
            url = `https://${domain}/@${handle.split("@")[1]}`;
          }

          // add to domains obj
          if (domain in this.domains) {
            this.domains[domain]["handles"].push({
              username: username,
              handle: handle,
              url: url,
            });
          } else
            this.domains[domain] = {
              handles: [{ username: username, handle: handle, url: url }],
            };
        });
      }
    },
    addBskyHandles(username, handles) {
      // add handles to domains list
      if (handles.length > 0) {
        handles.forEach((handle) => {
          fetch(
            `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${handle.handle}&collection=app.bsky.actor.profile`
          )
            .then((response) => response.json())
            .then((data) => {
              if (data.error) {
                console.error("got error processing bsky handles", data);
              } else {
                this.bskyhandles.push({
                  username: username,
                  handle: handle.handle,
                  matchtype: handle.matchtype,
                  url: `https://bsky.app/profile/${handle.handle}`,
                  avatar: data.records[0].value.avatar.ref.link,
                  description: data.records[0].value.description,
                  display_name: data.records[0].value.displayName,
                  did: data.records[0].uri.match(/did:plc:[a-zA-Z0-9]+/)[0],
                });
              }
            });
        });
      }
    },
    addThreadsHandles(username, handles) {
      // add handles to domains list
      if (handles.length > 0) {
        handles.forEach((handle) => {
          this.threads_handles.push({
            username: username,
            handle: handle.handle,
            matchtype: handle.matchtype,
            url: `https://threads.net/${handle.handle}`,
          });
        });
      }
    },
    removeDuplicates() {
      for (const [domain, data] of Object.entries(this.domains)) {
        if ("handles" in this.domains[domain]) {
          this.domains[domain]["handles"] = [
            ...new Map(
              this.domains[domain]["handles"].map((v) => [v.handle, v])
            ).values(),
          ];
        }
      }
    },
    checkBskyHandles(username, urls) {
      let handles = [];
      fetch(`/api/bskycheck?handles=${urls.join(",")}`)
        .then((response) => response.json())
        .then((data) => {
          if (data.error) {
            console.error("got error processing bsky handles", data);
          } else {
            data
              .filter((handle) => handle.part_of_bsky == true)
              .map((handle) => handles.push(handle.domain));
            handles = [...new Set(handles)];
            this.accounts[username]["bskyhandles"] =
              this.accounts[username]["bskyhandles"] + handles;
            this.addBskyHandles(username, handles);
          }
        });
    },
    checkDomains() {
      // send unchecked domains to server to get more info
      for (const [domain, data] of Object.entries(this.domains)) {
        if ("part_of_fediverse" in data === false) {
          if (domain in this.known_instances) {
            // add info from cached instance data
            this.domains[domain] = Object.assign(
              {},
              this.domains[domain],
              this.known_instances[domain]
            );
          } else {
            // get new info from server
            try {
              this.unchecked_domains.push({
                domain: domain,
                handle: data["handles"][0]["handle"],
              });
            } catch (err) {
              console.log(data);
            }
          }
        }
      }
      if (this.unchecked_domains.length > 0) {
        this.unchecked_domains.forEach((domain) =>
          fetch(
            `${this.lookup_server}/api/check?handle=${domain.handle}&domain=${domain.domain}`
          )
            .then((response) => response.json())
            .then((data) => {
              if (data.error) {
                console.error(
                  "got error processing domain to check",
                  domain,
                  data
                );
                return;
              }

              this.processCheckedDomain(data);
            })
        );
      }
    },
    processCheckedDomain(data) {
      // add info about domains
      let index_of = this.unchecked_domains.findIndex((object) => {
        return object === data["domain"];
      });
      this.unchecked_domains.splice(index_of, 1);

      this.domains[data["domain"]] = Object.assign(
        {},
        this.domains[data["domain"]],
        data
      );
    },
    get_bsky_followings(handle, cursor = "") {
      fetch(
        `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${handle}&collection=app.bsky.graph.follow&limit=100&cursor=${cursor}`
      )
        .then((response) => response.json())
        .then((data) => {
          if (data.error) {
            console.error("got error processing followings", data);
          } else if (data.records.length > 0) {
            data.records.map(
              (record) =>
                (this.bsky_followings[record.value.subject] =
                  record.value.createdAt)
            ),
              this.get_bsky_followings(handle, data.cursor);
          }
        });
    },
    logoff() {
      localStorage.clear();
      window.location.href = "/logoff";
    },
    loadProfile() {
      fetch("/api/getProfile")
        .then((response) => response.json())
        .then((data) => {
          if ("error" in data) {
            console.log(data);
            this.error_message = data.error;
          } else {
            this.profile = data;
            this.processAccount("me", data);
            this.checkDomains();
            this.scanned.push("Your profile");

            if (
              this.accounts[this.profile.username]["bskyhandles"].length > 0
            ) {
              this.get_bsky_followings(
                this.accounts[this.profile.username]["bskyhandles"][0]["handle"]
              );
            }
          }
        });
    },
    loadFollowings(next_token = "") {
      fetch(`/api/getFollowings?next_token=${next_token}`)
        .then((response) => response.json())
        .then((data) => {
          if ("error" in data) {
            this.error_message = data.error;
          } else {
            data.accounts.map((user) =>
              this.processAccount("followings", user)
            );
            this.checkDomains();
            this.scanned.push(", " + data.accounts.length + " followings");
            data.next_token && data.ratelimit_remaining > 0
              ? this.loadFollowings((next_token = data.next_token))
              : void 0;
          }
        });
    },
    loadFollowers(next_token = "") {
      if (document.getElementById("loadFollowers"))
        document.getElementById("loadFollowers").classList.add("is-loading");
      fetch(`/api/getFollowers?next_token=${next_token}`)
        .then((response) => response.json())
        .then((data) => {
          if ("error" in data) {
            this.error_message = data.error;
          } else {
            data.accounts.map((user) => this.processAccount("followers", user));
            this.checkDomains();
            this.scanned.push(", " + data.accounts.length + " followers");
            this.scanned_followers = true;
            data.next_token && data.ratelimit_remaining > 0
              ? this.loadFollowers((next_token = data.next_token))
              : void 0;
          }
        });
    },
    loadLists() {
      fetch("/api/loadLists")
        .then((response) => response.json())
        .then((data) => {
          if ("error" in data) {
            console.log(data);
          } else {
            this.user_lists = data;
            this.selected_list = data[0];
          }
        });
    },
    loadList(next_token = "", list_id = "", list_name = "") {
      if (next_token == "") {
        list_id = this.selected_list.id_str;
        list_name = this.selected_list.name;
        this.skipList();
      }
      fetch(`/api/getList?listid=${list_id}&next_token=${next_token}`)
        .then((response) => response.json())
        .then((data) => {
          if ("error" in data) {
            console.log(data);
          } else {
            data.accounts.map((user) => {
              this.processAccount({ type: "list", list_name: list_name }, user);
            });
            this.checkDomains();
            this.scanned.push(", " + data.accounts.length + " " + list_name);
            data.next_token && data.ratelimit_remaining > 0
              ? this.loadList(
                  (next_token = data.next_token),
                  (list_id = list_id),
                  (list_name = list_name)
                )
              : void 0;
          }
        });
    },
    skipList() {
      let index_of = this.user_lists.findIndex((object) => {
        return object.id_str === this.selected_list.id_str;
      });
      this.user_lists.splice(index_of, 1);
      this.selected_list = this.user_lists[0];
    },
    exportHandles() {
      let csv = "";
      csv = "Account address,Show boosts\n";

      for (const [domain, data] of Object.entries(this.domains)) {
        if ("part_of_fediverse" in data && data["part_of_fediverse"]) {
          data["handles"].forEach(
            (handle) => (csv += handle.handle.replace("@", "") + ",true\n")
          );
        }
      }

      let download = new Blob([csv], { type: "text/plain" });
      let link = document.getElementById("downloadlink");
      link.href = window.URL.createObjectURL(download);
      link.download = "fedifinder_accounts.csv";
    },
    exportAccountsCsv() {
      let output = [];
      for (const [username, data] of Object.entries(this.accounts)) {
        output.push({ username: username, ...data });
      }
      const json2csvParser = new json2csv.Parser();
      const csv = json2csvParser.parse(output);

      let download = new Blob([csv], { type: "text/plain" });
      let link = document.getElementById("allaccountscsv");
      link.href = window.URL.createObjectURL(download);
      link.download = "accounts.csv";
    },
    exportAccountsJson() {
      let output = {};
      for (const [username, data] of Object.entries(this.accounts)) {
        output[username] = data;
      }
      let json_string = JSON.stringify(output, null, 2);
      let download = new Blob([json_string], { type: "application/json" });
      let link = document.getElementById("allaccountsjson");
      link.href = window.URL.createObjectURL(download);
      link.download = "accounts.json";
    },
    toggleDisplayAccounts() {
      this.display_accounts = !this.display_accounts;
    },
    toggleFollowButtons() {
      this.show_follow_buttons = !this.show_follow_buttons;
    },
    toggleShowInstances() {
      this.show_all_instances = !this.show_all_instances;
    },
  },
  async mounted() {
    if (window.location.href.indexOf("#t") !== -1) {
      localStorage.setItem("twitterAuth", true);
      //window.location.hash = "";
      await sleep(100);
    }

    if (localStorage.getItem("twitterAuth")) {
      let lookup_data = await fetch("/api/lookupServer");
      lookup_data = await lookup_data.json();
      "error" in lookup_data
        ? (this.lookup_server = "https://" + window.location.hostname)
        : (this.lookup_server = lookup_data.lookup_server);
      let cached_data = await fetch("/cached/known_instances.json");
      let cached_bsky = await fetch("/cached/bsky_accounts.json");
      this.bsky_accounts = await cached_bsky.json();
      try {
        this.known_instances = await cached_data.json();
        this.twitter_auth = true;
        this.loadProfile();
        if (!window.location.hostname.includes("staging")) {
          this.loadFollowings();
        }
        this.loadLists();
      } catch (err) {
        console.log(err);
      }
    }
  },
});
app.config.errorHandler = function (err, vm, info) {
  console.log({
    error: err,
    params: { info: info },
  });
};
app.mount("#fedifinder");