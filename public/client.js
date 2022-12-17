/* globals tests, eq json2csv, Vue*/

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
  if (urlstring.match(/^http/i)) {
    // proper url
    let handleUrl = new URL(urlstring);
    return `@${name}@${handleUrl.host}`;
  } else {
    // not a proper URL
    let domain = urlstring.split("/")[0];
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
  let words = text.split(/,|\s|“|#|\(|\)|'|》|\?|\n|\r|\t|・|丨|\||…|\.\s|\s$/);
  words = words.map((w) => w.replace(/^:|\/$/g, ""));
  // remove common false positives
  let unwanted_domains =
    /gmail\.com(?:$|\/)|mixcloud|linktr\.ee(?:$|\/)|pinboard\.com(?:$|\/)|tutanota\.de(?:$|\/)|xing\.com(?:$|\/)|researchgate|about|bit\.ly(?:$|\/)|imprint|impressum|patreon|donate|facebook|github|instagram|medium\.com(?:$|\/)|t\.co(?:$|\/)|tiktok\.com(?:$|\/)|youtube\.com(?:$|\/)|pronouns\.page(?:$|\/)|mail@|observablehq|twitter\.com(?:$|\/)|contact@|kontakt@|protonmail|traewelling\.de(?:$|\/)|press@|support@|info@|pobox|hey\.com(?:$|\/)/;
  words = words.filter((word) => !unwanted_domains.test(word));
  words = words.filter((w) => w);

  let handles = [];

  words.map((word) => {
    // @username@server.tld
    if (/^@[a-zA-Z0-9_\-]+@.+\.[a-zA-Z]+$/.test(word))
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
      show_follow_buttons: false,
      error_message: "",
      show_all_instances: false,
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
            contacts: data.handles.length,
            openRegistrations: data.openRegistrations,
            part_of_fediverse: data.part_of_fediverse,
          },
          data.handles.length,
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
          location: user.location,
          description: user.description,
          urls: user.urls,
          pinned_tweet: user.pinned_tweet,
        };
        this.addHandles(user.username, handles);
        this.removeDuplicates();
      }
    },
    addHandles(username, handles) {
      // add handles to domains list
      if (handles.length > 0) {
        handles.forEach((handle) => {
          let domain = handle.split("@").slice(-1)[0];

          // add to domains obj
          if (domain in this.domains) {
            this.domains[domain]["handles"].push({
              username: username,
              handle: handle,
            });
          } else
            this.domains[domain] = {
              handles: [{ username: username, handle: handle }],
            };
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
            .then((data) => this.processCheckedDomain(data))
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
  errorCaptured: function (err) {
    console.log("Caught error", err.message);
    return false;
  },
  async mounted() {
    if (window.location.href.indexOf("#t") !== -1) {
      localStorage.setItem("twitterAuth", true);
      window.location.hash = "";
    }

    if (localStorage.getItem("twitterAuth")) {
      let lookup_data = await fetch("/api/lookupServer");
      lookup_data = await lookup_data.json();
      "error" in lookup_data
        ? (this.lookup_server = "https://" + window.location.hostname)
        : (this.lookup_server = lookup_data.lookup_server);
      let cached_data = await fetch("/cached/known_instances.json");
      try {
        this.known_instances = await cached_data.json();
        this.twitter_auth = true;
        this.loadProfile();
        this.loadFollowings();
        if (!window.location.hostname.includes("staging")) {
          this.loadFollowings();
        }
        this.loadLists();
      } catch (err) {
        this.logoff();
      }
    }
  },
});
app.mount("#fedifinder");
